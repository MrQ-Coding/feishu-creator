#!/usr/bin/env node

/**
 * Full-lifecycle installer for feishu-creator.
 *
 * Automates: preflight checks → npm install → .env setup → build →
 * Claude Code plugin registration → Codex skill sync → verification.
 *
 * Usage:
 *   node scripts/installPlugin.mjs [options]
 *
 * Options:
 *   --force              Rebuild marketplace and overwrite existing plugin
 *   --skip-build         Skip npm install & build (for CI or re-registration)
 *   --codex-only         Only sync skills to Codex, skip Claude Code plugin
 *   --claude-only        Only install Claude Code plugin, skip Codex sync
 *   --transport=stdio    Force stdio MCP transport
 *   --transport=http     Force HTTP MCP transport (requires running HTTP service)
 */

import { execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// ── constants ───────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MARKETPLACE_NAME = "feishu-creator";
const PLUGIN_NAME = "feishu-creator";
const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 17;

// ── flags ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const skipBuild = argv.includes("--skip-build");
const codexOnly = argv.includes("--codex-only");
const claudeOnly = argv.includes("--claude-only");

// Parse --transport=xxx
const transportArg = argv.find((a) => a.startsWith("--transport="));
const transportOverride = transportArg ? transportArg.split("=")[1] : null;

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
Usage: node scripts/installPlugin.mjs [options]

Options:
  --force              Rebuild marketplace and overwrite existing plugin
  --skip-build         Skip npm install & build (use existing dist/)
  --codex-only         Only sync skills to Codex, skip Claude Code plugin
  --claude-only        Only install Claude Code plugin, skip Codex sync
  --transport=stdio    Force stdio MCP transport
  --transport=http     Force HTTP MCP transport
  --help               Show this help

When --transport is not specified, the installer will ask interactively
(WSL defaults to http without asking).
`);
  process.exit(0);
}

// ── environment detection ───────────────────────────────────────────

const isWSL = (() => {
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
})();

const isWindows = process.platform === "win32";
const envLabel = isWSL ? "WSL" : process.platform;

// ── helpers ─────────────────────────────────────────────────────────

/** Run a shell command, return stdout or null on failure. */
function run(cmd, opts = {}) {
  const { silent = false, cwd } = opts;
  if (!silent) console.log(`  $ ${cmd}`);
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    }).trim();
  } catch (e) {
    const stderr = e.stderr?.trim() || e.message;
    if (!silent) console.error(`  ✘ ${stderr}`);
    return null;
  }
}

/** Check if a command exists in PATH. */
function hasCommand(cmd) {
  const check = isWindows ? `where ${cmd}` : `which ${cmd}`;
  return run(check, { silent: true }) !== null;
}

/** Prompt user for a choice in terminal. */
async function askChoice(question, options) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n  ${question}`);
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    console.log(`    ${i + 1}) ${opt.label}${opt.default ? " (default)" : ""}`);
    if (opt.description) console.log(`       ${opt.description}`);
  }
  const defaultIdx = options.findIndex((o) => o.default);
  const defaultDisplay = defaultIdx >= 0 ? ` [${defaultIdx + 1}]` : "";

  return new Promise((resolve) => {
    rl.question(`  Choice${defaultDisplay}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed && defaultIdx >= 0) {
        resolve(options[defaultIdx].value);
        return;
      }
      const idx = parseInt(trimmed, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx].value);
      } else {
        resolve(options[defaultIdx >= 0 ? defaultIdx : 0].value);
      }
    });
  });
}

let stepNum = 0;
let totalSteps = 0;

function step(label) {
  stepNum++;
  console.log(`\n[${stepNum}/${totalSteps}] ${label}`);
}

// ── transport selection ─────────────────────────────────────────────

/** Determine MCP transport: stdio or http. */
async function resolveTransport() {
  // Explicit override
  if (transportOverride) {
    if (!["stdio", "http"].includes(transportOverride)) {
      console.error(`  ✘ Invalid --transport value: ${transportOverride}. Use stdio or http.`);
      process.exit(1);
    }
    return transportOverride;
  }

  // WSL always defaults to http (Windows-hosted service)
  if (isWSL) {
    console.log(`  WSL detected → defaulting to HTTP transport`);
    return "http";
  }

  // Interactive: ask user
  return askChoice("Which MCP transport mode?", [
    {
      value: "stdio",
      label: "stdio",
      description: "Direct process communication. Simpler, no service to manage.",
      default: true,
    },
    {
      value: "http",
      label: "http",
      description: "HTTP server (localhost:3333). Shared across clients, survives restarts via pm2.",
    },
  ]);
}

// ── preflight checks ────────────────────────────────────────────────

function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
    console.error(
      `  ✘ Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0 required, found ${process.versions.node}`,
    );
    console.error(`    Install: https://nodejs.org/ or use nvm/fnm`);
    process.exit(1);
  }
  console.log(`  ✔ Node.js ${process.versions.node}`);
}

function checkGit() {
  if (!hasCommand("git")) {
    console.error(`  ✘ git not found. Install git first.`);
    process.exit(1);
  }
  console.log(`  ✔ git available`);
}

function checkClaude() {
  if (!hasCommand("claude")) {
    console.error(`  ✘ Claude Code CLI not found in PATH.`);
    console.error(`    Install: npm install -g @anthropic-ai/claude-code`);
    return false;
  }
  const version = run("claude --version", { silent: true });
  console.log(`  ✔ Claude Code ${version || "(version unknown)"}`);
  return true;
}

// ── npm install & build ─────────────────────────────────────────────

function npmInstallAndBuild() {
  console.log(`  Running npm install...`);
  const installResult = run("npm install", { cwd: REPO_ROOT });
  if (installResult === null) {
    console.error(`  ✘ npm install failed`);
    process.exit(1);
  }
  console.log(`  ✔ Dependencies installed`);

  console.log(`  Running npm run build...`);
  const buildResult = run("npm run build", { cwd: REPO_ROOT });
  if (buildResult === null) {
    console.error(`  ✘ Build failed`);
    process.exit(1);
  }
  console.log(`  ✔ Build succeeded`);
}

function checkDist() {
  const distEntry = path.join(REPO_ROOT, "dist", "index.js");
  if (!existsSync(distEntry)) {
    console.error(`  ✘ dist/index.js not found. Run without --skip-build first.`);
    process.exit(1);
  }
  console.log(`  ✔ dist/index.js exists`);
}

// ── .env setup ──────────────────────────────────────────────────────

function setupEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  const examplePath = path.join(REPO_ROOT, ".env.example");

  if (existsSync(envPath)) {
    console.log(`  ✔ .env already exists`);
    const envContent = readFileSync(envPath, "utf8");
    const missing = [];
    if (!envContent.match(/FEISHU_APP_ID=cli_\w+/)) missing.push("FEISHU_APP_ID");
    if (!envContent.match(/FEISHU_APP_SECRET=\S+/) || envContent.includes("FEISHU_APP_SECRET=xxx"))
      missing.push("FEISHU_APP_SECRET");

    if (missing.length > 0) {
      console.log(`  ⚠ Credentials not configured: ${missing.join(", ")}`);
      console.log(`    Fill these in .env before using feishu API features.`);
      console.log(`    MCP server will start but auth will fail until credentials are set.`);
    } else {
      console.log(`  ✔ Credentials configured`);
    }
    return;
  }

  if (!existsSync(examplePath)) {
    console.error(`  ✘ Neither .env nor .env.example found`);
    process.exit(1);
  }

  copyFileSync(examplePath, envPath);
  console.log(`  ✔ .env created from .env.example`);
  console.log(`  ⚠ Please edit .env and fill in your Feishu credentials:`);
  console.log(`    FEISHU_APP_ID=cli_xxx`);
  console.log(`    FEISHU_APP_SECRET=your_secret`);
}

// ── Claude Code plugin ──────────────────────────────────────────────

function getMarketplaceDir() {
  return path.join(os.homedir(), ".claude", "feishu-creator-marketplace");
}

function generateMcpConfig(transport) {
  if (transport === "http") {
    return {
      mcpServers: {
        "feishu-creator": {
          type: "http",
          url: "http://localhost:3333/mcp",
        },
      },
    };
  }

  // stdio
  const distPath = path.join(REPO_ROOT, "dist", "index.js");
  return {
    mcpServers: {
      "feishu-creator": {
        command: "node",
        args: [distPath, "--stdio"],
        cwd: REPO_ROOT,
      },
    },
  };
}

function buildMarketplace(marketplaceDir, transport) {
  const pluginDir = path.join(marketplaceDir, "plugins", PLUGIN_NAME);
  const claudePluginDir = path.join(pluginDir, ".claude-plugin");
  const marketplaceMetaDir = path.join(marketplaceDir, ".claude-plugin");

  mkdirSync(claudePluginDir, { recursive: true });
  mkdirSync(marketplaceMetaDir, { recursive: true });

  // Copy plugin.json
  copyFileSync(
    path.join(REPO_ROOT, ".claude-plugin", "plugin.json"),
    path.join(claudePluginDir, "plugin.json"),
  );

  // Copy skills
  const skillsSrc = path.join(REPO_ROOT, "skills");
  const skillsDst = path.join(pluginDir, "skills");
  if (existsSync(skillsSrc)) {
    cpSync(skillsSrc, skillsDst, { recursive: true });
  }

  // Generate .mcp.json based on transport
  writeFileSync(
    path.join(pluginDir, ".mcp.json"),
    JSON.stringify(generateMcpConfig(transport), null, 2) + "\n",
  );

  // Generate marketplace.json
  writeFileSync(
    path.join(marketplaceMetaDir, "marketplace.json"),
    JSON.stringify(
      {
        name: MARKETPLACE_NAME,
        owner: { name: "liuzhipeng" },
        plugins: [
          {
            name: PLUGIN_NAME,
            source: `./plugins/${PLUGIN_NAME}`,
            category: "productivity",
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );

  // Git init + commit (required by marketplace add)
  if (!existsSync(path.join(marketplaceDir, ".git"))) {
    execSync("git init", { cwd: marketplaceDir, stdio: "pipe" });
  }
  execSync("git add -A", { cwd: marketplaceDir, stdio: "pipe" });
  try {
    execSync('git commit -m "feishu-creator plugin marketplace"', {
      cwd: marketplaceDir,
      stdio: "pipe",
    });
  } catch {
    // No changes to commit
  }
}

function cleanupGlobalMcp() {
  // Remove feishu-creator from ~/.claude/.mcp.json if plugin will manage it
  const globalMcpPath = path.join(os.homedir(), ".claude", ".mcp.json");
  if (!existsSync(globalMcpPath)) return;

  try {
    const content = JSON.parse(readFileSync(globalMcpPath, "utf8"));
    if (content.mcpServers && content.mcpServers["feishu-creator"]) {
      delete content.mcpServers["feishu-creator"];
      writeFileSync(globalMcpPath, JSON.stringify(content, null, 2) + "\n");
      console.log(`  ✔ Removed duplicate feishu-creator from ~/.claude/.mcp.json`);
    }
  } catch {
    // Ignore parse errors
  }
}

function installClaudePlugin(transport) {
  const marketplaceDir = getMarketplaceDir();

  // Clean up conflicting global MCP config
  cleanupGlobalMcp();

  // Build marketplace
  console.log(`  Building marketplace at ${marketplaceDir}`);
  console.log(`  Transport: ${transport}`);
  buildMarketplace(marketplaceDir, transport);
  console.log(`  ✔ Marketplace built`);

  // Register marketplace (remove first for idempotency)
  run(`claude plugin marketplace remove ${MARKETPLACE_NAME}`, { silent: true });
  const addResult = run(`claude plugin marketplace add "${marketplaceDir}"`);
  if (addResult === null) {
    console.error(`  ✘ Failed to register marketplace`);
    process.exit(1);
  }

  // Install plugin
  const installResult = run(`claude plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
  if (installResult === null) {
    console.error(`  ✘ Failed to install plugin`);
    process.exit(1);
  }
  console.log(`  ✔ Claude Code plugin installed`);

  // If HTTP transport, ensure pm2 service is set up
  if (transport === "http") {
    setupHttpService();
  }
}

// ── HTTP service setup ──────────────────────────────────────────────

function setupHttpService() {
  if (!hasCommand("pm2")) {
    console.log(`  ⚠ pm2 not found. Install: npm install -g pm2`);
    console.log(`    Then start HTTP service: pm2 start dist/index.js --name feishu-mcp -- --http`);
    return;
  }

  // Check if already running
  const pm2List = run("pm2 jlist", { silent: true });
  if (pm2List) {
    try {
      const processes = JSON.parse(pm2List);
      const existing = processes.find((p) => p.name === "feishu-mcp");
      if (existing && existing.pm2_env?.status === "online") {
        console.log(`  ✔ HTTP service already running (pm2: feishu-mcp)`);
        return;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Start the service
  console.log(`  Starting HTTP service via pm2...`);
  const distPath = path.join(REPO_ROOT, "dist", "index.js");
  const startResult = run(
    `pm2 start "${distPath}" --name feishu-mcp -- --http`,
    { cwd: REPO_ROOT },
  );
  if (startResult !== null) {
    run("pm2 save", { silent: true });
    console.log(`  ✔ HTTP service started (pm2: feishu-mcp)`);
  } else {
    console.log(`  ⚠ Failed to start HTTP service. Start manually:`);
    console.log(`    pm2 start dist/index.js --name feishu-mcp -- --http`);
  }
}

// ── Codex skill sync ────────────────────────────────────────────────

function syncCodexSkills() {
  const mode = isWindows ? "copy" : "symlink";
  const syncScript = path.join(REPO_ROOT, "scripts", "syncSkills.mjs");
  const result = run(`node "${syncScript}" --mode ${mode} --force`, { cwd: REPO_ROOT });
  if (result === null) {
    console.log(`  ⚠ Codex skill sync failed (non-critical)`);
  } else {
    console.log(`  ✔ Skills synced to Codex (mode: ${mode})`);
  }
}

// ── verification ────────────────────────────────────────────────────

function checkHttpService() {
  console.log(`  Checking HTTP MCP service at localhost:3333...`);
  const curlCmd = isWindows
    ? "curl -s http://localhost:3333/health"
    : "curl -s http://localhost:3333/health";
  const result = run(curlCmd, { silent: true });
  if (result && result.includes('"ok":true')) {
    console.log(`  ✔ HTTP MCP service is running`);
    return true;
  }
  console.log(`  ⚠ HTTP MCP service not reachable at localhost:3333`);
  if (isWSL) {
    console.log(`    Start it on Windows: pm2 start dist/index.js --name feishu-mcp -- --http`);
  } else {
    console.log(`    Start it: pm2 start dist/index.js --name feishu-mcp -- --http`);
  }
  return false;
}

function verify(transport) {
  if (codexOnly) {
    console.log(`  Skipping MCP verification (codex-only mode)`);
    return;
  }

  if (transport === "http") {
    checkHttpService();
    return;
  }

  // stdio smoke test
  console.log(`  Running MCP smoke test (ping)...`);
  const callTool = path.join(REPO_ROOT, "scripts", "callTool.mjs");
  if (existsSync(callTool)) {
    const argsJson = isWindows
      ? `"{\\"message\\":\\"install-test\\"}"`
      : `'{"message":"install-test"}'`;
    const result = run(`node "${callTool}" --tool ping --args-json ${argsJson}`, {
      cwd: REPO_ROOT,
    });
    if (result && result.includes("pong")) {
      console.log(`  ✔ MCP ping succeeded`);
    } else {
      console.log(`  ⚠ MCP ping did not return expected response`);
      console.log(`    This may be normal if .env credentials are not set yet`);
    }
  } else {
    console.log(`  ⚠ callTool.mjs not found, skipping smoke test`);
  }
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   feishu-creator installer                   ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  console.log(`  Environment : ${envLabel}`);
  console.log(`  Repo        : ${REPO_ROOT}`);
  console.log(`  Targets     : ${codexOnly ? "Codex only" : claudeOnly ? "Claude Code only" : "Claude Code + Codex"}`);

  // Calculate total steps
  totalSteps = 1; // preflight
  if (!skipBuild) totalSteps++; // install & build
  else totalSteps++; // check dist
  totalSteps++; // .env
  if (!codexOnly) totalSteps++; // transport selection
  if (!codexOnly) totalSteps++; // claude plugin
  if (!claudeOnly) totalSteps++; // codex sync
  totalSteps++; // verify

  // ── Step: Preflight ──
  step("Preflight checks");
  checkNode();
  checkGit();
  let hasClaude = true;
  if (!codexOnly) {
    hasClaude = checkClaude();
    if (!hasClaude) {
      console.log(`  → Claude Code not found. Switching to codex-only mode.`);
    }
  }

  // ── Step: Install & Build ──
  if (!skipBuild) {
    step("Install dependencies & build");
    npmInstallAndBuild();
  } else {
    step("Check build artifacts");
    checkDist();
  }

  // ── Step: .env ──
  step("Environment configuration (.env)");
  setupEnv();

  // ── Step: Transport Selection ──
  let transport = "stdio";
  if (!codexOnly && hasClaude) {
    step("MCP transport selection");
    transport = await resolveTransport();
    console.log(`  → Selected: ${transport}`);
  }

  // ── Step: Claude Code Plugin ──
  if (!codexOnly && hasClaude) {
    step("Claude Code plugin");
    installClaudePlugin(transport);
  }

  // ── Step: Codex Skills ──
  if (!claudeOnly) {
    step("Codex skill sync");
    syncCodexSkills();
  }

  // ── Step: Verify ──
  step("Verification");
  verify(transport);

  // ── Summary ──
  console.log(`\n${"═".repeat(48)}`);
  console.log(`✅ Installation complete!\n`);

  if (!codexOnly && hasClaude) {
    console.log(`  Claude Code:`);
    console.log(`    Plugin  : feishu-creator@feishu-creator ✔`);
    console.log(`    MCP     : ${transport}${transport === "http" ? " (localhost:3333)" : ""}`);
    console.log(`    Skills  : feishu-setup, feishu-creator-doc-workflow,`);
    console.log(`              feishu-doc-writer, feishu-style-extract, knowledge-qa`);
    console.log(`    Action  : Restart Claude Code to load\n`);
  }

  if (!claudeOnly) {
    console.log(`  Codex:`);
    console.log(`    Skills  : synced to ~/.codex/skills/`);
    console.log(`    MCP     : configure manually in Codex settings`);
    console.log(`    Action  : Restart Codex to load\n`);
  }

  if (transport === "http" && isWSL) {
    console.log(`  ⚠ WSL: Ensure HTTP MCP service is running on Windows:`);
    console.log(`    cd ${REPO_ROOT.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\\\`).replace(/\//g, "\\\\")}`);
    console.log(`    pm2 start dist/index.js --name feishu-mcp -- --http\n`);
  }

  // Check for missing credentials
  const envPath = path.join(REPO_ROOT, ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");
    if (envContent.includes("FEISHU_APP_SECRET=xxx") || !envContent.match(/FEISHU_APP_ID=cli_\w+/)) {
      console.log(`  ⚠ Don't forget to configure .env with your Feishu credentials!`);
      console.log(`    Edit: ${envPath}\n`);
    }
  }
}

main().catch((e) => {
  console.error(`\n✘ Fatal error: ${e.message || e}`);
  process.exit(1);
});
