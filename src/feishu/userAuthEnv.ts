import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "../..");

function upsertEnvLine(content: string, key: string, value: string): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  let replaced = false;
  const next = lines.map((line) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    next.push(`${key}=${value}`);
  }
  return `${next.join("\n").replace(/\n*$/, "\n")}`;
}

export async function persistUserEnv(input: {
  envFile?: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
}): Promise<string> {
  const envFile = input.envFile?.trim() || ".env";
  const target = path.isAbsolute(envFile)
    ? envFile
    : path.resolve(projectRoot, envFile);

  let content = "";
  try {
    content = await fs.readFile(target, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("enoent")) {
      throw error;
    }
  }

  let next = upsertEnvLine(content, "FEISHU_AUTH_TYPE", "user");
  next = upsertEnvLine(next, "FEISHU_USER_ACCESS_TOKEN", input.accessToken);
  next = upsertEnvLine(
    next,
    "FEISHU_USER_ACCESS_TOKEN_EXPIRES_AT",
    String(input.accessTokenExpiresAt),
  );
  if (input.refreshToken?.trim()) {
    next = upsertEnvLine(next, "FEISHU_USER_REFRESH_TOKEN", input.refreshToken.trim());
  }
  if (input.refreshTokenExpiresAt) {
    next = upsertEnvLine(
      next,
      "FEISHU_USER_REFRESH_TOKEN_EXPIRES_AT",
      String(input.refreshTokenExpiresAt),
    );
  }
  await fs.writeFile(target, next, "utf8");
  return target;
}

export async function persistUserRefreshTokenInvalidation(input?: {
  envFile?: string;
}): Promise<string> {
  const envFile = input?.envFile?.trim() || ".env";
  const target = path.isAbsolute(envFile)
    ? envFile
    : path.resolve(projectRoot, envFile);

  let content = "";
  try {
    content = await fs.readFile(target, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("enoent")) {
      throw error;
    }
  }

  let next = upsertEnvLine(content, "FEISHU_USER_REFRESH_TOKEN", "");
  next = upsertEnvLine(next, "FEISHU_USER_REFRESH_TOKEN_EXPIRES_AT", "");
  await fs.writeFile(target, next, "utf8");
  return target;
}
