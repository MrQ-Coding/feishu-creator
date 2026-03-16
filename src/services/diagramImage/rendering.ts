import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../../config.js";
import type {
  DiagramImageFormat,
  NormalizedRenderInput,
  RenderGraphvizDiagramInput,
  RenderPlantUmlDiagramInput,
  RendererCommand,
} from "./types.js";

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
  if (!configured) {
    return "dot";
  }
  if (isPathLike(configured)) {
    await assertExecutable(configured, "FEISHU_GRAPHVIZ_DOT_PATH");
  }
  return configured;
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
    const child = spawn(command.command, command.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.once("error", (error) => {
      reject(
        new Error(
          `${command.label} is not available. Install it or set the matching env path. ${error.message}`,
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
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const details = stderr
        ? `: ${stderr}`
        : signal
          ? `: terminated by signal ${signal}`
          : ".";
      reject(new Error(`${command.label} exited with code ${code ?? "unknown"}${details}`));
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
