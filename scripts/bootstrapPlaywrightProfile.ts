import path from "node:path";
import { bootstrapAutomationProfile } from "../src/services/wikiBrowser/playwrightProfileBootstrap.js";

interface Options {
  source: string;
  target: string;
  clean: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await bootstrapAutomationProfile({
    browserFamily: "chromium",
    clean: options.clean,
    continueOnError: false,
    requireSource: true,
    sourceDir: options.source,
    targetDir: options.target,
  });

  console.log(
    JSON.stringify(
      {
        clean: options.clean,
        copiedEntries: result.copiedEntries,
        mode: result.mode,
        skippedEntries: result.skippedEntries,
        source: options.source,
        target: options.target,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): Options {
  let source = "";
  let target = "";
  let clean = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      source = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--target") {
      target = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--no-clean") {
      clean = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!source || !target) {
    printUsageAndExit(1);
  }

  return {
    source: path.resolve(source),
    target: path.resolve(target),
    clean,
  };
}

function printUsageAndExit(code: number): never {
  const usage = [
    "Usage:",
    "  npm run profile:bootstrap -- --source <chrome-profile-dir> --target <automation-profile-dir> [--no-clean]",
    "",
    "Example:",
    "  npm run profile:bootstrap -- --source .playwright/system-chrome-clone-20260306-143253 --target .playwright/feishu-automation-profile",
  ].join("\n");
  console.error(usage);
  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
