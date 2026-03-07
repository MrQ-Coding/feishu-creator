import { constants } from "node:fs";
import { access, cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type PlaywrightBrowserFamily = "chromium" | "firefox";

export interface BootstrapAutomationProfileInput {
  browserFamily: PlaywrightBrowserFamily;
  clean?: boolean;
  continueOnError?: boolean;
  requireSource?: boolean;
  sourceDir?: string;
  targetDir: string;
}

export interface BootstrapAutomationProfileResult {
  copiedEntries: string[];
  mode: "seeded" | "empty";
  skippedEntries: string[];
  sourceLabel: string;
  targetDir: string;
}

export interface BrowserProfileSeedSource {
  dir: string;
  label: string;
}

const chromiumRootEntries = ["Local State", "First Run"];
const chromiumDefaultProfileEntries = [
  "Cookies",
  "Cookies-journal",
  "Preferences",
  "Secure Preferences",
  "Sessions",
  "Session Storage",
  "Local Storage",
  "IndexedDB",
  "Service Worker",
  "Storage",
  "Extension State",
  "Web Data",
  "Login Data",
];

export async function createTemporaryAutomationProfileDir(
  targetDir: string,
): Promise<string> {
  const parentDir = path.dirname(path.resolve(targetDir));
  const targetBaseName = path.basename(path.resolve(targetDir));
  await mkdir(parentDir, { recursive: true });
  return await mkdtemp(path.join(parentDir, `${targetBaseName}-login-`));
}

export async function bootstrapAutomationProfile(
  input: BootstrapAutomationProfileInput,
): Promise<BootstrapAutomationProfileResult> {
  const targetDir = path.resolve(input.targetDir);
  const clean = input.clean ?? true;
  const continueOnError = input.continueOnError ?? false;
  const requireSource = input.requireSource ?? false;

  if (clean) {
    await rm(targetDir, { recursive: true, force: true });
  }
  await mkdir(targetDir, { recursive: true });

  if (input.browserFamily !== "chromium") {
    return {
      copiedEntries: [],
      mode: "empty",
      skippedEntries: [],
      sourceLabel: "empty profile",
      targetDir,
    };
  }

  await mkdir(path.join(targetDir, "Default"), { recursive: true });

  const sourceDir = input.sourceDir?.trim()
    ? path.resolve(input.sourceDir)
    : undefined;
  if (!sourceDir) {
    return {
      copiedEntries: [],
      mode: "empty",
      skippedEntries: [],
      sourceLabel: "empty profile",
      targetDir,
    };
  }

  const sourceDefaultDir = path.join(sourceDir, "Default");
  if (!(await isReadable(sourceDir)) || !(await isReadable(sourceDefaultDir))) {
    if (requireSource) {
      throw new Error(`source profile is not readable: ${sourceDir}`);
    }
    return {
      copiedEntries: [],
      mode: "empty",
      skippedEntries: [],
      sourceLabel: `${sourceDir} (unreadable)`,
      targetDir,
    };
  }

  const copiedEntries: string[] = [];
  const skippedEntries: string[] = [];
  for (const entry of chromiumRootEntries) {
    const sourceEntry = path.join(sourceDir, entry);
    if (!(await exists(sourceEntry))) continue;
    try {
      await copyEntry(sourceEntry, path.join(targetDir, entry));
      copiedEntries.push(entry);
    } catch (error) {
      if (!continueOnError) {
        throw error;
      }
      skippedEntries.push(
        `${entry}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const entry of chromiumDefaultProfileEntries) {
    const sourceEntry = path.join(sourceDefaultDir, entry);
    if (!(await exists(sourceEntry))) continue;
    try {
      await copyEntry(sourceEntry, path.join(targetDir, "Default", entry));
      copiedEntries.push(path.posix.join("Default", entry));
    } catch (error) {
      if (!continueOnError) {
        throw error;
      }
      skippedEntries.push(
        `${path.posix.join("Default", entry)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    copiedEntries,
    mode: copiedEntries.length > 0 ? "seeded" : "empty",
    skippedEntries,
    sourceLabel: sourceDir,
    targetDir,
  };
}

export async function promoteAutomationProfile(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  const resolvedSource = path.resolve(sourceDir);
  const resolvedTarget = path.resolve(targetDir);
  if (resolvedSource === resolvedTarget) {
    return;
  }

  await rm(resolvedTarget, { recursive: true, force: true });
  try {
    await rename(resolvedSource, resolvedTarget);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code !== "EXDEV") {
      throw error;
    }
    await cp(resolvedSource, resolvedTarget, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    await rm(resolvedSource, { recursive: true, force: true });
  }
}

export async function resolveSystemBrowserProfileSeedSource(
  browserFamily: PlaywrightBrowserFamily,
  browserExecutablePath?: string,
): Promise<BrowserProfileSeedSource | null> {
  if (browserFamily !== "chromium") {
    return null;
  }

  const executableHint = (browserExecutablePath ?? "").toLowerCase();
  const candidates = buildProfileSeedCandidates(process.platform, os.homedir(), executableHint);
  for (const candidate of candidates) {
    if (await isReadable(path.join(candidate.dir, "Default"))) {
      return candidate;
    }
  }
  return null;
}

function buildProfileSeedCandidates(
  platform: NodeJS.Platform,
  homeDir: string,
  executableHint: string,
): BrowserProfileSeedSource[] {
  const chromeCandidates = getChromiumProfileCandidates(platform, homeDir);
  const preferredVendors = inferPreferredVendors(executableHint);
  const preferred = chromeCandidates.filter((candidate) =>
    preferredVendors.includes(candidate.label),
  );
  const fallback = chromeCandidates.filter(
    (candidate) => !preferredVendors.includes(candidate.label),
  );
  return [...preferred, ...fallback];
}

function getChromiumProfileCandidates(
  platform: NodeJS.Platform,
  homeDir: string,
): BrowserProfileSeedSource[] {
  switch (platform) {
    case "darwin":
      return [
        {
          label: "Google Chrome",
          dir: path.join(homeDir, "Library", "Application Support", "Google", "Chrome"),
        },
        {
          label: "Chromium",
          dir: path.join(homeDir, "Library", "Application Support", "Chromium"),
        },
        {
          label: "Microsoft Edge",
          dir: path.join(homeDir, "Library", "Application Support", "Microsoft Edge"),
        },
        {
          label: "Brave",
          dir: path.join(
            homeDir,
            "Library",
            "Application Support",
            "BraveSoftware",
            "Brave-Browser",
          ),
        },
        {
          label: "Vivaldi",
          dir: path.join(homeDir, "Library", "Application Support", "Vivaldi"),
        },
      ];
    case "win32":
      return [
        {
          label: "Google Chrome",
          dir: path.join(homeDir, "AppData", "Local", "Google", "Chrome", "User Data"),
        },
        {
          label: "Chromium",
          dir: path.join(homeDir, "AppData", "Local", "Chromium", "User Data"),
        },
        {
          label: "Microsoft Edge",
          dir: path.join(homeDir, "AppData", "Local", "Microsoft", "Edge", "User Data"),
        },
        {
          label: "Brave",
          dir: path.join(
            homeDir,
            "AppData",
            "Local",
            "BraveSoftware",
            "Brave-Browser",
            "User Data",
          ),
        },
        {
          label: "Vivaldi",
          dir: path.join(homeDir, "AppData", "Local", "Vivaldi", "User Data"),
        },
      ];
    default:
      return [
        {
          label: "Google Chrome",
          dir: path.join(homeDir, ".config", "google-chrome"),
        },
        {
          label: "Chromium",
          dir: path.join(homeDir, ".config", "chromium"),
        },
        {
          label: "Microsoft Edge",
          dir: path.join(homeDir, ".config", "microsoft-edge"),
        },
        {
          label: "Brave",
          dir: path.join(homeDir, ".config", "BraveSoftware", "Brave-Browser"),
        },
        {
          label: "Vivaldi",
          dir: path.join(homeDir, ".config", "vivaldi"),
        },
        {
          label: "Opera",
          dir: path.join(homeDir, ".config", "opera"),
        },
      ];
  }
}

function inferPreferredVendors(executableHint: string): string[] {
  if (executableHint.includes("edge")) {
    return ["Microsoft Edge"];
  }
  if (executableHint.includes("brave")) {
    return ["Brave"];
  }
  if (executableHint.includes("vivaldi")) {
    return ["Vivaldi"];
  }
  if (executableHint.includes("opera")) {
    return ["Opera"];
  }
  if (executableHint.includes("chromium")) {
    return ["Chromium"];
  }
  if (executableHint.includes("chrome")) {
    return ["Google Chrome"];
  }
  return ["Google Chrome", "Chromium", "Microsoft Edge", "Brave", "Vivaldi", "Opera"];
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isReadable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(source: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
}
