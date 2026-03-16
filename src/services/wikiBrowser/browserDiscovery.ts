import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PlaywrightBrowserFamily } from "./playwrightProfileBootstrap.js";

const execFile = promisify(execFileCallback);

export type BrowserFamily = PlaywrightBrowserFamily;

export interface BrowserLaunchTarget {
  family: BrowserFamily;
  executablePath?: string;
  source: string;
}

interface BrowserCandidate {
  family: BrowserFamily;
  source: string;
  commands: string[];
}

export function inferBrowserFamilyFromExecutable(executablePath: string): BrowserFamily {
  return executablePath.toLowerCase().includes("firefox") ? "firefox" : "chromium";
}

export async function resolveSystemBrowserCandidate(): Promise<BrowserLaunchTarget | null> {
  const envBrowser = process.env.BROWSER?.trim();
  if (envBrowser) {
    const resolved = await resolveExecutable(envBrowser);
    if (resolved) {
      return {
        family: inferBrowserFamilyFromExecutable(resolved),
        executablePath: resolved,
        source: "env:BROWSER",
      };
    }
  }

  const candidates: BrowserCandidate[] = [];
  const defaultCandidate = await detectDefaultBrowserCandidate();
  if (defaultCandidate) {
    candidates.push(defaultCandidate);
  }
  candidates.push(...getCommonBrowserCandidates());

  for (const candidate of candidates) {
    for (const command of candidate.commands) {
      const resolved = await resolveExecutable(command);
      if (!resolved) continue;
      return {
        family: candidate.family,
        executablePath: resolved,
        source: candidate.source,
      };
    }
  }

  return null;
}

async function detectDefaultBrowserCandidate(): Promise<BrowserCandidate | null> {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const { stdout } = await execFile("xdg-settings", ["get", "default-web-browser"]);
    const desktopEntry = stdout.trim().toLowerCase();
    if (!desktopEntry) return null;

    const mapped = mapDesktopEntryToCandidate(desktopEntry);
    if (!mapped) return null;
    return {
      ...mapped,
      source: `system-default:${desktopEntry}`,
    };
  } catch {
    return null;
  }
}

function mapDesktopEntryToCandidate(
  desktopEntry: string,
): Pick<BrowserCandidate, "family" | "commands"> | null {
  if (desktopEntry.includes("firefox")) {
    return { family: "firefox", commands: ["firefox"] };
  }
  if (desktopEntry.includes("edge")) {
    return {
      family: "chromium",
      commands: ["microsoft-edge-stable", "microsoft-edge", "msedge"],
    };
  }
  if (desktopEntry.includes("brave")) {
    return {
      family: "chromium",
      commands: ["brave-browser", "brave-browser-stable"],
    };
  }
  if (desktopEntry.includes("vivaldi")) {
    return { family: "chromium", commands: ["vivaldi-stable", "vivaldi"] };
  }
  if (desktopEntry.includes("opera")) {
    return { family: "chromium", commands: ["opera"] };
  }
  if (desktopEntry.includes("chromium")) {
    return { family: "chromium", commands: ["chromium", "chromium-browser"] };
  }
  if (desktopEntry.includes("chrome")) {
    return {
      family: "chromium",
      commands: ["google-chrome-stable", "google-chrome", "chrome"],
    };
  }
  return null;
}

function getCommonBrowserCandidates(): BrowserCandidate[] {
  switch (process.platform) {
    case "darwin":
      return [
        {
          family: "chromium",
          source: "common:macos-chromium",
          commands: [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          ],
        },
        {
          family: "firefox",
          source: "common:macos-firefox",
          commands: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
        },
      ];
    case "win32": {
      const prefixes = [
        process.env["PROGRAMFILES"],
        process.env["PROGRAMFILES(X86)"],
        process.env["LOCALAPPDATA"],
      ].filter((value): value is string => Boolean(value));
      return [
        {
          family: "chromium",
          source: "common:windows-chromium",
          commands: prefixes.flatMap((prefix) => [
            path.join(prefix, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(prefix, "Chromium", "Application", "chrome.exe"),
            path.join(prefix, "Microsoft", "Edge", "Application", "msedge.exe"),
            path.join(prefix, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
          ]),
        },
        {
          family: "firefox",
          source: "common:windows-firefox",
          commands: prefixes.map((prefix) =>
            path.join(prefix, "Mozilla Firefox", "firefox.exe"),
          ),
        },
      ];
    }
    default:
      return [
        {
          family: "chromium",
          source: "common:linux-chromium",
          commands: [
            "google-chrome-stable",
            "google-chrome",
            "chromium",
            "chromium-browser",
            "microsoft-edge-stable",
            "microsoft-edge",
            "brave-browser",
            "brave-browser-stable",
            "vivaldi-stable",
            "vivaldi",
            "opera",
          ],
        },
        {
          family: "firefox",
          source: "common:linux-firefox",
          commands: ["firefox"],
        },
      ];
  }
}

async function resolveExecutable(command: string): Promise<string | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;

  if (path.isAbsolute(trimmed)) {
    return (await isExecutable(trimmed)) ? trimmed : null;
  }

  if (trimmed.includes(path.sep)) {
    const absolute = path.resolve(trimmed);
    return (await isExecutable(absolute)) ? absolute : null;
  }

  const resolver = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFile(resolver, [trimmed]);
    const resolved = stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean);
    if (!resolved) return null;
    return (await isExecutable(resolved)) ? resolved : null;
  } catch {
    return null;
  }
}

async function isExecutable(targetPath: string): Promise<boolean> {
  try {
    const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
    await access(targetPath, mode);
    return true;
  } catch {
    return false;
  }
}
