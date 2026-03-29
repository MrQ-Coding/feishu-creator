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
/*  Auto-installation helpers                                         */
/* ------------------------------------------------------------------ */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");

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

/** Run an OS-level install command (blocking, best-effort). */
function runInstall(description: string, cmd: string): boolean {
  console.log(`[diagram] ${description}...`);
  try {
    execSync(cmd, { stdio: "inherit", timeout: 300_000 });
    console.log(`[diagram] ${description} — done.`);
    return true;
  } catch (err) {
    console.warn(`[diagram] ${description} — failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** Well-known Graphviz install paths (checked after install if not on PATH). */
const GRAPHVIZ_KNOWN_PATHS = process.platform === "win32"
  ? ["C:\\Program Files\\Graphviz\\bin\\dot.exe", "C:\\Program Files (x86)\\Graphviz\\bin\\dot.exe"]
  : ["/usr/bin/dot", "/usr/local/bin/dot", "/opt/homebrew/bin/dot"];

/**
 * Find `dot` binary: first check PATH, then well-known install locations.
 * Returns the resolved path or null.
 */
function findDotBinary(): string | null {
  if (commandExists("dot")) return "dot";
  for (const p of GRAPHVIZ_KNOWN_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Attempt to install Graphviz (the `dot` command) using the first
 * available package manager.  Returns the resolved dot path or null.
 */
function tryInstallGraphviz(): string | null {
  const existing = findDotBinary();
  if (existing) return existing;

  const platform = process.platform;
  if (platform === "win32") {
    if (commandExists("choco"))  runInstall("Installing Graphviz via Chocolatey",  "choco install graphviz -y");
    else if (commandExists("scoop"))  runInstall("Installing Graphviz via Scoop",  "scoop install graphviz");
    else if (commandExists("winget")) runInstall("Installing Graphviz via winget", "winget install --id Graphviz.Graphviz --accept-source-agreements --accept-package-agreements");
  } else if (platform === "darwin") {
    if (commandExists("brew")) runInstall("Installing Graphviz via Homebrew", "brew install graphviz");
  } else {
    if (commandExists("apt-get"))      runInstall("Installing Graphviz via apt",    "sudo apt-get install -y graphviz");
    else if (commandExists("yum"))     runInstall("Installing Graphviz via yum",    "sudo yum install -y graphviz");
    else if (commandExists("dnf"))     runInstall("Installing Graphviz via dnf",    "sudo dnf install -y graphviz");
    else if (commandExists("pacman"))  runInstall("Installing Graphviz via pacman", "sudo pacman -S --noconfirm graphviz");
  }

  return findDotBinary();
}

/** Local plantuml.jar path inside project vendor directory. */
const PLANTUML_JAR_DIR = path.join(projectRoot, "vendor");
const PLANTUML_JAR_PATH = path.join(PLANTUML_JAR_DIR, "plantuml.jar");
const PLANTUML_JAR_URL = "https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar";

/** Well-known Java install paths (checked after winget/msi install before PATH refreshes). */
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
      // Scan subdirectories for bin/java.exe (e.g. jre-21.0.10.7-hotspot/bin/java.exe)
      const entries = execSync(`dir /b "${baseDir}" 2>NUL`, { encoding: "utf8", shell: "cmd.exe" }).trim().split(/\r?\n/);
      for (const entry of entries) {
        const candidate = path.join(baseDir, entry, "bin", "java.exe");
        if (existsSync(candidate)) return candidate;
      }
    } catch { /* directory doesn't exist */ }
  }
  return null;
}

/**
 * Download plantuml.jar to vendor/ and ensure Java is available.
 * Returns a RendererCommand if successful, or null on failure.
 */
function tryInstallPlantUmlJar(): RendererCommand | null {
  // Step 1: ensure Java
  let javaCmd = findJavaBinary();
  if (!javaCmd) {
    const platform = process.platform;
    let javaInstalled = false;
    if (platform === "win32" && commandExists("winget")) {
      javaInstalled = runInstall(
        "Installing Java (Eclipse Temurin JRE) via winget",
        "winget install --id EclipseAdoptium.Temurin.21.JRE --accept-source-agreements --accept-package-agreements",
      );
    } else if (platform === "darwin" && commandExists("brew")) {
      javaInstalled = runInstall("Installing Java via Homebrew", "brew install --cask temurin");
    } else if (platform === "linux") {
      if (commandExists("apt-get"))      javaInstalled = runInstall("Installing Java via apt", "sudo apt-get install -y default-jre-headless");
      else if (commandExists("yum"))     javaInstalled = runInstall("Installing Java via yum", "sudo yum install -y java-17-openjdk-headless");
      else if (commandExists("dnf"))     javaInstalled = runInstall("Installing Java via dnf", "sudo dnf install -y java-17-openjdk-headless");
      else if (commandExists("pacman"))  javaInstalled = runInstall("Installing Java via pacman", "sudo pacman -S --noconfirm jre-openjdk-headless");
    }
    if (!javaInstalled) {
      console.warn("[diagram] Could not install Java automatically.");
      return null;
    }
    javaCmd = findJavaBinary();
    if (!javaCmd) {
      console.warn("[diagram] Java installed but binary not found on known paths.");
      return null;
    }
  }

  // Step 2: download plantuml.jar if not present
  if (!existsSync(PLANTUML_JAR_PATH)) {
    console.log(`[diagram] Downloading plantuml.jar to ${PLANTUML_JAR_DIR}...`);
    try {
      execSync(`mkdir -p "${PLANTUML_JAR_DIR}"`, { stdio: "ignore" });
    } catch {
      try {
        // Windows fallback
        execSync(`if not exist "${PLANTUML_JAR_DIR}" mkdir "${PLANTUML_JAR_DIR}"`, { stdio: "ignore", shell: "cmd.exe" });
      } catch { /* ignore */ }
    }
    const downloaded = runInstall(
      "Downloading plantuml.jar",
      `curl -fSL -o "${PLANTUML_JAR_PATH}" "${PLANTUML_JAR_URL}"`,
    );
    if (!downloaded || !existsSync(PLANTUML_JAR_PATH)) {
      console.warn("[diagram] Failed to download plantuml.jar.");
      return null;
    }
  }

  return {
    command: javaCmd,
    args: ["-jar", PLANTUML_JAR_PATH],
    label: `java -jar ${PLANTUML_JAR_PATH}`,
  };
}

/**
 * Attempt to install PlantUML using the first available package manager.
 * Falls back to downloading plantuml.jar + installing Java.
 * Returns a RendererCommand override if jar-based install was used, or null.
 */
function tryInstallPlantUml(): RendererCommand | null {
  if (commandExists("plantuml")) return null; // already available as CLI
  const platform = process.platform;

  // Try native package managers first
  if (platform === "win32") {
    if (commandExists("choco") && runInstall("Installing PlantUML via Chocolatey", "choco install plantuml -y")) return null;
    if (commandExists("scoop") && runInstall("Installing PlantUML via Scoop", "scoop install plantuml")) return null;
  } else if (platform === "darwin") {
    if (commandExists("brew") && runInstall("Installing PlantUML via Homebrew", "brew install plantuml")) return null;
  } else {
    if (commandExists("apt-get") && runInstall("Installing PlantUML via apt", "sudo apt-get install -y plantuml")) return null;
    if (commandExists("yum") && runInstall("Installing PlantUML via yum", "sudo yum install -y plantuml")) return null;
    if (commandExists("dnf") && runInstall("Installing PlantUML via dnf", "sudo dnf install -y plantuml")) return null;
    if (commandExists("pacman") && runInstall("Installing PlantUML via pacman", "sudo pacman -S --noconfirm plantuml")) return null;
  }

  // Fallback: download plantuml.jar + ensure Java
  return tryInstallPlantUmlJar();
}

/** Remember whether we already attempted an auto-install this session. */
const autoInstallAttempted = { graphviz: false, plantuml: false };
/** Cached resolved path from auto-install. */
let cachedDotPath: string | null = null;
/** Cached jar-based command from auto-install (if applicable). */
let cachedPlantUmlJarCommand: RendererCommand | null = null;

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

  // Auto-install on first use if `dot` is missing
  if (!autoInstallAttempted.graphviz) {
    const found = findDotBinary();
    if (found) {
      cachedDotPath = found;
    } else {
      autoInstallAttempted.graphviz = true;
      cachedDotPath = tryInstallGraphviz();
    }
  }
  return cachedDotPath ?? "dot";
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
    const javaCommand = config.javaPath?.trim() || "java";
    if (isPathLike(javaCommand)) {
      await assertExecutable(javaCommand, "FEISHU_JAVA_PATH");
    }
    return {
      command: javaCommand,
      args: ["-jar", configuredJar],
      label: `${javaCommand} -jar ${configuredJar}`,
    };
  }

  // Auto-install on first use if `plantuml` is missing
  if (!commandExists("plantuml") && !autoInstallAttempted.plantuml) {
    autoInstallAttempted.plantuml = true;
    cachedPlantUmlJarCommand = tryInstallPlantUml();
  }

  // If jar-based install was used, return that command
  if (cachedPlantUmlJarCommand) {
    return cachedPlantUmlJarCommand;
  }

  // Also check if vendor/plantuml.jar exists from a previous install
  if (!commandExists("plantuml") && existsSync(PLANTUML_JAR_PATH)) {
    const javaCmd = findJavaBinary();
    if (javaCmd) {
      return {
        command: javaCmd,
        args: ["-jar", PLANTUML_JAR_PATH],
        label: `java -jar ${PLANTUML_JAR_PATH}`,
      };
    }
  }

  return {
    command: "plantuml",
    args: [],
    label: "plantuml",
  };
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
    });

    child.once("error", (error) => {
      settle(() =>
        reject(
          new Error(
            `${command.label} is not available. Install it or set the matching env path. ${error.message}`,
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
