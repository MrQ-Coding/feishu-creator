#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultServerPath = path.join(repoRoot, "dist", "index.js");

function parseCli(argv) {
  const options = {
    tool: undefined,
    argsJson: undefined,
    argsFile: undefined,
    server: defaultServerPath,
    listTools: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--tool") {
      options.tool = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--args-json") {
      options.argsJson = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--args-file") {
      options.argsFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--server") {
      options.server = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--list-tools") {
      options.listTools = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.listTools && !options.tool) {
    throw new Error("Missing required --tool <tool-name>.");
  }
  if (options.argsJson && options.argsFile) {
    throw new Error("Use either --args-json or --args-file, not both.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/callTool.mjs --list-tools
  node scripts/callTool.mjs --tool ping --args-json '{"message":"hello"}'
  node scripts/callTool.mjs --tool ping --args-file ./request.json

Options:
  --tool <name>         Tool name to call.
  --args-json <json>    Inline JSON arguments.
  --args-file <path>    UTF-8 JSON file containing tool arguments.
  --server <path>       Override server entry. Defaults to dist/index.js.
  --list-tools          List tools instead of calling one.
  -h, --help            Show this help message.
`);
}

async function loadArguments(options) {
  if (options.argsJson) {
    return JSON.parse(options.argsJson);
  }
  if (options.argsFile) {
    const raw = await readFile(path.resolve(options.argsFile), "utf8");
    return JSON.parse(raw);
  }
  return {};
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.server, "--stdio"],
    cwd: repoRoot,
    env: { ...process.env },
  });
  const client = new Client(
    { name: "feishu-creator-local-tool-client", version: "0.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    if (options.listTools) {
      const result = await client.listTools();
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const toolArgs = await loadArguments(options);
    const result = await client.callTool({
      name: options.tool,
      arguments: toolArgs,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await transport.close().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
