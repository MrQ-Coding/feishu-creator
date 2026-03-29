import { constants as fsConstants, existsSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../../config.js";
import type {
  NormalizedRenderInput,
  RenderGraphvizDiagramInput,
  RenderPlantUmlDiagramInput,
  RendererCommand,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Well-known path helpers (find already-installed tools not on PATH) */
/* ------------------------------------------------------------------ */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// moduleDir is dist/services/diagramImage/ at runtime → go up 3 levels to project root
const projectRoot = path.resolve(moduleDir, "..", "..", "..");

/** Check whether a command exists on the system PATH. */
function commandExists(cmd: string): boolean {
  try {
    const check = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Vendor-local dot binary (portable install via feishu-setup skill). */
const VENDOR_DOT_PATH = process.platform === "win32"
  ? path.join(projectRoot, "vendor", "graphviz", "bin", "dot.exe")
  : path.join(projectRoot, "vendor", "graphviz", "bin", "dot");

/** Well-known Graphviz system install paths (fallback). */
const GRAPHVIZ_KNOWN_PATHS = process.platform === "win32"
  ? [VENDOR_DOT_PATH, "C:\\Program Files\\Graphviz\\bin\\dot.exe", "C:\\Program Files (x86)\\Graphviz\\bin\\dot.exe"]
  : [VENDOR_DOT_PATH, "/usr/bin/dot", "/usr/local/bin/dot", "/opt/homebrew/bin/dot"];

/**
 * Find `dot` binary: first check vendor/, then PATH, then well-known system locations.
 */
function findDotBinary(): string | null {
  // Vendor-local takes priority
  if (existsSync(VENDOR_DOT_PATH)) return VENDOR_DOT_PATH;
  if (commandExists("dot")) return "dot";
  for (const p of GRAPHVIZ_KNOWN_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Well-known Java install directories on Windows. */
const JAVA_KNOWN_DIRS = process.platform === "win32"
  ? ["C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Java", "C:\\Program Files\\Microsoft\\jdk"]
  : [];

/**
 * Find `java` binary: first check PATH, then scan well-known Windows directories.
 */
function findJavaBinary(): string | null {
  if (commandExists("java")) return "java";
  for (const baseDir of JAVA_KNOWN_DIRS) {
    try {
      const entries = execSync(`dir /b "${baseDir}" 2>NUL`, { encoding: "utf8", shell: "cmd.exe" }).trim().split(/\r?\n/);
      for (const entry of entries) {
        const candidate = path.join(baseDir, entry, "bin", "java.exe");
        if (existsSync(candidate)) return candidate;
      }
    } catch { /* directory doesn't exist */ }
  }
  return null;
}

/** Local plantuml.jar path inside project vendor directory. */
const PLANTUML_JAR_PATH = path.join(projectRoot, "vendor", "plantuml.jar");

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export function normalizeRenderInput(
  input: RenderGraphvizDiagramInput | RenderPlantUmlDiagramInput,
  sourceType: "graphviz" | "plantuml",
): NormalizedRenderInput {
  const sourceText = input.sourceText.trim();
  if (!sourceText) {
    throw new Error(`${sourceType} sourceText must not be empty.`);
  }
  const format = input.format ?? "png";
  const outputPath =
    input.outputPath?.trim() ||
    path.join(
      getTempDir(sourceType),
      `${sourceType}-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`,
    );

  return {
    sourceText,
    format,
    outputPath,
  };
}

export async function resolveGraphvizCommand(
  config: AppConfig["feishu"],
): Promise<string> {
  const configured = config.graphvizDotPath?.trim();
  if (configured) {
    if (isPathLike(configured)) {
      await assertExecutable(configured, "FEISHU_GRAPHVIZ_DOT_PATH");
    }
    return configured;
  }

  // Try to find an already-installed dot binary (even if not on PATH)
  return findDotBinary() ?? "dot";
}

export async function resolvePlantUmlCommand(
  config: AppConfig["feishu"],
): Promise<RendererCommand> {
  const configuredCommand = config.plantumlCommand?.trim();
  if (configuredCommand) {
    if (isPathLike(configuredCommand)) {
      await assertExecutable(configuredCommand, "FEISHU_PLANTUML_COMMAND");
    }
    return {
      command: configuredCommand,
      args: [],
      label: configuredCommand,
    };
  }

  const configuredJar = config.plantumlJarPath?.trim();
  if (configuredJar) {
    const javaCommand = config.javaPath?.trim() || findJavaBinary() || "java";
    if (isPathLike(javaCommand)) {
      await assertExecutable(javaCommand, "FEISHU_JAVA_PATH");
    }
    return {
      command: javaCommand,
      args: ["-jar", configuredJar],
      label: `${javaCommand} -jar ${configuredJar}`,
    };
  }

  // Check if plantuml CLI is available
  if (commandExists("plantuml")) {
    return { command: "plantuml", args: [], label: "plantuml" };
  }

  // Check if vendor/plantuml.jar exists (installed via feishu-setup skill)
  if (existsSync(PLANTUML_JAR_PATH)) {
    const javaCmd = findJavaBinary();
    if (javaCmd) {
      return {
        command: javaCmd,
        args: ["-jar", PLANTUML_JAR_PATH],
        label: `java -jar ${PLANTUML_JAR_PATH}`,
      };
    }
  }

  // Default fallback — will produce a clear error if not installed
  return { command: "plantuml", args: [], label: "PlantUML" };
}

export async function runRendererCommand(
  command: RendererCommand,
  input: string,
  outputPath: string,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const child = spawn(command.command, command.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.once("error", (error) => {
      settle(() =>
        reject(
          new Error(
            `${command.label} is not available. Install it via feishu-setup skill, or set the matching env path. ${error.message}`,
          ),
        ),
      );
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        settle(() => resolve());
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const details = stderr
        ? `: ${stderr}`
        : signal
          ? `: terminated by signal ${signal}`
          : ".";
      settle(() => reject(new Error(`${command.label} exited with code ${code ?? "unknown"}${details}`)));
    });

    child.stdin.end(input, "utf8");
  });

  const output = Buffer.concat(stdoutChunks);
  if (output.length === 0) {
    throw new Error(`${command.label} produced no output.`);
  }

  await writeFile(outputPath, output);
}

export function ensurePlantUmlDocument(sourceText: string): string {
  if (/@start[A-Za-z]+\b/i.test(sourceText)) {
    return sourceText;
  }
  return `@startuml\n${sourceText}\n@enduml\n`;
}

function getTempDir(sourceType: "graphviz" | "plantuml"): string {
  return path.join(os.tmpdir(), `feishu-creator-${sourceType}`);
}

function isPathLike(input: string): boolean {
  return path.isAbsolute(input) || input.startsWith(".") || /[\\/]/.test(input);
}

async function assertExecutable(
  executablePath: string,
  envName: string,
): Promise<void> {
  try {
    await access(executablePath, fsConstants.X_OK);
  } catch {
    throw new Error(`Configured ${envName} is not executable: ${executablePath}`);
  }
}
