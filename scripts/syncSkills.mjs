#!/usr/bin/env node

import { cp, lstat, mkdir, readdir, readlink, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function printUsage() {
  console.log(`Usage: node scripts/syncSkills.mjs [--target <dir>] [--mode symlink|copy] [--force]

Defaults:
  --target ~/.codex/skills
  --mode symlink
`);
}

function parseArgs(argv) {
  const options = {
    target: path.join(os.homedir(), ".codex", "skills"),
    mode: "symlink",
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      options.target = expandHome(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      options.mode = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["symlink", "copy"].includes(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}`);
  }

  return options;
}

async function exists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function collectSkills(skillsRoot) {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillDir = path.join(skillsRoot, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (await exists(skillFile)) {
      skills.push({ name: entry.name, dir: skillDir });
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function removeIfNeeded(targetPath, force) {
  if (!(await exists(targetPath))) {
    return;
  }
  if (!force) {
    throw new Error(
      `Target already exists: ${targetPath}\nRe-run with --force to replace it.`,
    );
  }
  await rm(targetPath, { recursive: true, force: true });
}

async function syncSkill(skill, targetRoot, mode, force) {
  const destination = path.join(targetRoot, skill.name);
  const sourceRealPath = path.resolve(skill.dir);

  if (await exists(destination)) {
    const stats = await lstat(destination);
    if (stats.isSymbolicLink()) {
      const linkedPath = await readlink(destination);
      const resolvedLinkPath = path.resolve(path.dirname(destination), linkedPath);
      if (resolvedLinkPath === sourceRealPath) {
        return { name: skill.name, status: "unchanged", destination };
      }
    }
    await removeIfNeeded(destination, force);
  }

  if (mode === "symlink") {
    await symlink(sourceRealPath, destination, "dir");
  } else {
    await cp(sourceRealPath, destination, { recursive: true });
  }

  return { name: skill.name, status: "synced", destination };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const skillsRoot = path.join(repoRoot, "skills");
  const targetRoot = path.resolve(options.target);

  await mkdir(targetRoot, { recursive: true });

  const skills = await collectSkills(skillsRoot);
  if (skills.length === 0) {
    console.log(`No local skills found under ${skillsRoot}`);
    return;
  }

  console.log(`Syncing ${skills.length} skill(s) to ${targetRoot} with mode=${options.mode}`);

  for (const skill of skills) {
    const result = await syncSkill(skill, targetRoot, options.mode, options.force);
    console.log(`${result.status.padEnd(9)} ${result.name} -> ${result.destination}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
