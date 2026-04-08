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

/** Suppress Java GUI/console window on Windows. */
const JAVA_HEADLESS_FLAG = "-Djava.awt.headless=true";

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
      args: [JAVA_HEADLESS_FLAG, "-jar", configuredJar],
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
        args: [JAVA_HEADLESS_FLAG, "-jar", PLANTUML_JAR_PATH],
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
      env: { ...process.env, ...getRendererFontEnv() },
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

/* ------------------------------------------------------------------ */
/*  Cross-platform font environment for Graphviz / PlantUML           */
/* ------------------------------------------------------------------ */

/** Platform-specific system font directories. */
function getSystemFontDirs(): string[] {
  const platform = process.platform;
  if (platform === "win32") {
    return ["C:\\Windows\\Fonts"];
  } else if (platform === "darwin") {
    return [
      "/System/Library/Fonts",
      "/Library/Fonts",
      path.join(os.homedir(), "Library/Fonts"),
    ];
  }
  // Linux and others
  return [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    path.join(os.homedir(), ".local/share/fonts"),
    path.join(os.homedir(), ".fonts"),
  ];
}

/**
 * Build extra env vars so renderers can find system CJK fonts.
 *
 * - GDFONTPATH: used by Graphviz's GD library to locate .ttf/.otf files.
 * - FONTCONFIG_PATH: used by fontconfig (Graphviz on Linux/macOS).
 * - PLANTUML_FONT_DIR: used by PlantUML to locate additional fonts.
 *
 * Only sets a value when the env var is not already present, so user
 * overrides via .env are always respected.
 */
let _cachedFontEnv: Record<string, string> | undefined;

function getRendererFontEnv(): Record<string, string> {
  if (_cachedFontEnv) return _cachedFontEnv;

  const env: Record<string, string> = {};
  const fontDirs = getSystemFontDirs();
  const sep = process.platform === "win32" ? ";" : ":";

  // GDFONTPATH — used by Graphviz's GD library
  if (!process.env.GDFONTPATH) {
    env.GDFONTPATH = fontDirs.join(sep);
  }

  // PLANTUML_FONT_DIR — PlantUML searches this directory for fonts.
  // PlantUML only supports a single directory, so use the primary system path.
  if (!process.env.PLANTUML_FONT_DIR) {
    env.PLANTUML_FONT_DIR = fontDirs[0];
  }

  _cachedFontEnv = env;
  return env;
}

/* ------------------------------------------------------------------ */
/*  CJK font detection & PlantUML font auto-injection                 */
/* ------------------------------------------------------------------ */

/** CJK font candidates in order of preference. */
const CJK_FONT_CANDIDATES = [
  "Microsoft YaHei",
  "Noto Sans CJK SC",
  "WenQuanYi Micro Hei",
  "WenQuanYi Zen Hei",
  "PingFang SC",
  "SimHei",
  "Source Han Sans SC",
];

const CJK_FALLBACK_FONT = "Noto Sans CJK SC";

let _cachedCjkFont: string | undefined;

/**
 * Detect the best available CJK font on the system.
 * Uses `fc-list` on Unix and falls back to a sensible default.
 */
function detectCjkFontName(): string {
  if (_cachedCjkFont !== undefined) return _cachedCjkFont;

  try {
    const output = execSync("fc-list :lang=zh family", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const available = output
      .split("\n")
      .map((line) => line.split(",")[0].trim())
      .filter(Boolean);

    for (const candidate of CJK_FONT_CANDIDATES) {
      if (available.some((f) => f === candidate)) {
        _cachedCjkFont = candidate;
        return _cachedCjkFont;
      }
    }
  } catch {
    // fc-list not available (e.g. Windows without fontconfig) — use fallback
  }

  _cachedCjkFont = CJK_FALLBACK_FONT;
  return _cachedCjkFont;
}

/** Regex matching CJK Unified Ideographs (common Chinese characters). */
const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

/**
 * Auto-inject `skinparam defaultFontName` into PlantUML source when:
 * 1. The source contains CJK characters, AND
 * 2. No `skinparam defaultFontName` is already specified.
 *
 * Must be called AFTER `ensurePlantUmlDocument` (so `@startXXX` is present).
 */
export function ensurePlantUmlFontConfig(sourceText: string): string {
  // Already has font config — respect the explicit setting
  if (/skinparam\s+defaultFontName\b/i.test(sourceText)) {
    return sourceText;
  }
  // No CJK characters — no need to inject
  if (!CJK_CHAR_RE.test(sourceText)) {
    return sourceText;
  }
  const fontName = detectCjkFontName();
  // Inject after @startXXX line
  return sourceText.replace(
    /(@start[A-Za-z]+\b[^\n]*\n)/i,
    `$1skinparam defaultFontName ${fontName}\n`,
  );
}
