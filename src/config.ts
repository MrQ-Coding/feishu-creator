import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");
const projectEnvPath = path.resolve(projectRoot, ".env");

if (existsSync(projectEnvPath)) {
  loadDotenv({ path: projectEnvPath });
} else {
  loadDotenv();
}

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3333),
  MCP_MODE: z.enum(["auto", "stdio", "http"]).default("auto"),
  FEISHU_BASE_URL: z.string().url().default("https://open.feishu.cn/open-apis"),
  FEISHU_UI_BASE_URL: z.string().url().default("https://my.feishu.cn"),
  FEISHU_APP_ID: z.string().min(1, "FEISHU_APP_ID is required"),
  FEISHU_APP_SECRET: z.string().min(1, "FEISHU_APP_SECRET is required"),
  FEISHU_AUTH_TYPE: z.enum(["tenant", "user"]).default("tenant"),
  FEISHU_USER_ACCESS_TOKEN: z.string().optional(),
  FEISHU_USER_REFRESH_TOKEN: z.string().optional(),
  FEISHU_WIKI_DELETE_STRATEGY: z
    .enum(["clear_content", "playwright"])
    .default("clear_content"),
  FEISHU_PLAYWRIGHT_HEADLESS: booleanEnvSchema.default(true),
  FEISHU_PLAYWRIGHT_EXECUTABLE_PATH: z.string().optional(),
  FEISHU_PLAYWRIGHT_USER_DATA_DIR: z
    .string()
    .default(path.resolve(projectRoot, ".playwright", "feishu-user-data")),
  FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(45000),
  FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(180000),
  FEISHU_TOKEN_REFRESH_BEFORE_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(300),
  FEISHU_MAX_CONCURRENCY: z.coerce.number().int().positive().default(8),
  FEISHU_REQUEST_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  FEISHU_REQUEST_BACKOFF_BASE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(250),
  FEISHU_DOC_INFO_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  FEISHU_DOC_BLOCKS_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  FEISHU_WIKI_SPACES_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(120),
  FEISHU_WIKI_TREE_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(120),
  FEISHU_WIKI_TREE_MAX_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .default(6),
  FEISHU_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  FEISHU_CACHE_CLEANUP_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
});

const NormalizedConfigSchema = EnvSchema.superRefine((env, ctx) => {
  if (env.FEISHU_AUTH_TYPE === "user") {
    const hasAccessToken = Boolean(env.FEISHU_USER_ACCESS_TOKEN);
    const hasRefreshToken = Boolean(env.FEISHU_USER_REFRESH_TOKEN);
    if (!hasAccessToken && !hasRefreshToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FEISHU_USER_ACCESS_TOKEN"],
        message:
          "In user mode, set FEISHU_USER_ACCESS_TOKEN or FEISHU_USER_REFRESH_TOKEN.",
      });
    }
  }
});

export type AuthType = "tenant" | "user";

export interface AppConfig {
  server: {
    port: number;
    mcpMode: "auto" | "stdio" | "http";
  };
  feishu: {
    baseUrl: string;
    uiBaseUrl: string;
    appId: string;
    appSecret: string;
    authType: AuthType;
    userAccessToken?: string;
    userRefreshToken?: string;
    wikiDeleteStrategy: "clear_content" | "playwright";
    playwrightHeadless: boolean;
    playwrightExecutablePath?: string;
    playwrightUserDataDir: string;
    playwrightActionTimeoutMs: number;
    playwrightLoginTimeoutMs: number;
    refreshBeforeSeconds: number;
    maxConcurrency: number;
    requestMaxRetries: number;
    requestBackoffBaseMs: number;
    docInfoCacheTtlSeconds: number;
    docBlocksCacheTtlSeconds: number;
    wikiSpacesCacheTtlSeconds: number;
    wikiTreeCacheTtlSeconds: number;
    wikiTreeMaxConcurrency: number;
    cacheMaxEntries: number;
    cacheCleanupIntervalSeconds: number;
  };
}

export function getConfig(): AppConfig {
  const env = NormalizedConfigSchema.parse(process.env);
  return {
    server: {
      port: env.PORT,
      mcpMode: env.MCP_MODE,
    },
    feishu: {
      baseUrl: env.FEISHU_BASE_URL,
      uiBaseUrl: env.FEISHU_UI_BASE_URL,
      appId: env.FEISHU_APP_ID,
      appSecret: env.FEISHU_APP_SECRET,
      authType: env.FEISHU_AUTH_TYPE,
      userAccessToken: env.FEISHU_USER_ACCESS_TOKEN,
      userRefreshToken: env.FEISHU_USER_REFRESH_TOKEN,
      wikiDeleteStrategy: env.FEISHU_WIKI_DELETE_STRATEGY,
      playwrightHeadless: env.FEISHU_PLAYWRIGHT_HEADLESS,
      playwrightExecutablePath: env.FEISHU_PLAYWRIGHT_EXECUTABLE_PATH,
      playwrightUserDataDir: env.FEISHU_PLAYWRIGHT_USER_DATA_DIR,
      playwrightActionTimeoutMs: env.FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS,
      playwrightLoginTimeoutMs: env.FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS,
      refreshBeforeSeconds: env.FEISHU_TOKEN_REFRESH_BEFORE_SECONDS,
      maxConcurrency: env.FEISHU_MAX_CONCURRENCY,
      requestMaxRetries: env.FEISHU_REQUEST_MAX_RETRIES,
      requestBackoffBaseMs: env.FEISHU_REQUEST_BACKOFF_BASE_MS,
      docInfoCacheTtlSeconds: env.FEISHU_DOC_INFO_CACHE_TTL_SECONDS,
      docBlocksCacheTtlSeconds: env.FEISHU_DOC_BLOCKS_CACHE_TTL_SECONDS,
      wikiSpacesCacheTtlSeconds: env.FEISHU_WIKI_SPACES_CACHE_TTL_SECONDS,
      wikiTreeCacheTtlSeconds: env.FEISHU_WIKI_TREE_CACHE_TTL_SECONDS,
      wikiTreeMaxConcurrency: env.FEISHU_WIKI_TREE_MAX_CONCURRENCY,
      cacheMaxEntries: env.FEISHU_CACHE_MAX_ENTRIES,
      cacheCleanupIntervalSeconds: env.FEISHU_CACHE_CLEANUP_INTERVAL_SECONDS,
    },
  };
}
