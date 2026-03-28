import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { z } from "zod";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");
const projectEnvPath = path.resolve(projectRoot, ".env");

if (existsSync(projectEnvPath)) {
  loadProjectFeishuEnv(projectEnvPath);
  loadDotenv({ path: projectEnvPath, override: true });
} else {
  loadDotenv();
}

function loadProjectFeishuEnv(envPath: string): void {
  const parsedEnv = parseDotenv(readFileSync(envPath));
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("FEISHU_")) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(parsedEnv)) {
    if (key.startsWith("FEISHU_")) {
      process.env[key] = value;
    }
  }
}

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const optionalPositiveIntEnvSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.coerce.number().int().positive().optional());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3333),
  MCP_MODE: z.enum(["auto", "stdio", "http"]).default("stdio"),
  MCP_HTTP_BIND_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_HTTP_REQUIRE_AUTH: booleanEnvSchema.default(true),
  MCP_HTTP_AUTH_TOKEN: z.string().optional(),
  FEISHU_BASE_URL: z.string().url().default("https://open.feishu.cn/open-apis"),
  FEISHU_UI_BASE_URL: z.string().url().default("https://my.feishu.cn"),
  FEISHU_APP_ID: z.string().min(1, "FEISHU_APP_ID is required"),
  FEISHU_APP_SECRET: z.string().min(1, "FEISHU_APP_SECRET is required"),
  FEISHU_AUTH_TYPE: z.enum(["tenant", "user"]).default("tenant"),
  FEISHU_USER_ACCESS_TOKEN: z.string().optional(),
  FEISHU_USER_REFRESH_TOKEN: z.string().optional(),
  FEISHU_USER_ACCESS_TOKEN_EXPIRES_AT: optionalPositiveIntEnvSchema,
  FEISHU_USER_REFRESH_TOKEN_EXPIRES_AT: optionalPositiveIntEnvSchema,
  FEISHU_WIKI_DELETE_STRATEGY: z
    .literal("playwright")
    .default("playwright"),
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
  FEISHU_PLAYWRIGHT_LOGIN_RECOVERY_MODE: z
    .enum(["on_demand", "interactive_first"])
    .default("on_demand"),
  FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(180000),
  FEISHU_GRAPHVIZ_DOT_PATH: z.string().optional(),
  FEISHU_PLANTUML_COMMAND: z.string().optional(),
  FEISHU_PLANTUML_JAR_PATH: z.string().optional(),
  FEISHU_JAVA_PATH: z.string().optional(),
  FEISHU_TOKEN_REFRESH_BEFORE_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(300),
  FEISHU_OAUTH_STATE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(600),
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
  KNOWLEDGE_INDEX_PATH: z.string().optional(),
  KNOWLEDGE_DEFAULT_SPACE_IDS: z.string().optional(),
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
    httpBindHost: string;
    httpRequireAuth: boolean;
    httpAuthToken?: string;
  };
  feishu: {
    baseUrl: string;
    uiBaseUrl: string;
    appId: string;
    appSecret: string;
    authType: AuthType;
    userAccessToken?: string;
    userRefreshToken?: string;
    userAccessTokenExpiresAt?: number;
    userRefreshTokenExpiresAt?: number;
    wikiDeleteStrategy: "playwright";
    playwrightHeadless: boolean;
    playwrightExecutablePath?: string;
    playwrightUserDataDir: string;
    playwrightActionTimeoutMs: number;
    playwrightLoginRecoveryMode: "on_demand" | "interactive_first";
    playwrightLoginTimeoutMs: number;
    graphvizDotPath?: string;
    plantumlCommand?: string;
    plantumlJarPath?: string;
    javaPath?: string;
    refreshBeforeSeconds: number;
    oauthStateTtlSeconds: number;
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
  knowledge: {
    indexPath?: string;
    defaultSpaceIds: string[];
  };
}

export function getConfig(): AppConfig {
  const env = NormalizedConfigSchema.parse(process.env);
  return {
    server: {
      port: env.PORT,
      mcpMode: env.MCP_MODE,
      httpBindHost: env.MCP_HTTP_BIND_HOST.trim(),
      httpRequireAuth: env.MCP_HTTP_REQUIRE_AUTH,
      httpAuthToken: env.MCP_HTTP_AUTH_TOKEN?.trim()
        ? env.MCP_HTTP_AUTH_TOKEN.trim()
        : undefined,
    },
    feishu: {
      baseUrl: env.FEISHU_BASE_URL,
      uiBaseUrl: env.FEISHU_UI_BASE_URL,
      appId: env.FEISHU_APP_ID,
      appSecret: env.FEISHU_APP_SECRET,
      authType: env.FEISHU_AUTH_TYPE,
      userAccessToken: env.FEISHU_USER_ACCESS_TOKEN,
      userRefreshToken: env.FEISHU_USER_REFRESH_TOKEN,
      userAccessTokenExpiresAt: env.FEISHU_USER_ACCESS_TOKEN_EXPIRES_AT,
      userRefreshTokenExpiresAt: env.FEISHU_USER_REFRESH_TOKEN_EXPIRES_AT,
      wikiDeleteStrategy: env.FEISHU_WIKI_DELETE_STRATEGY,
      playwrightHeadless: env.FEISHU_PLAYWRIGHT_HEADLESS,
      playwrightExecutablePath: env.FEISHU_PLAYWRIGHT_EXECUTABLE_PATH,
      // Keep relative profile dirs pinned under the MCP service project root.
      playwrightUserDataDir: resolveProjectPath(env.FEISHU_PLAYWRIGHT_USER_DATA_DIR),
      playwrightActionTimeoutMs: env.FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS,
      playwrightLoginRecoveryMode: env.FEISHU_PLAYWRIGHT_LOGIN_RECOVERY_MODE,
      playwrightLoginTimeoutMs: env.FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS,
      graphvizDotPath: resolveOptionalPathLikeValue(env.FEISHU_GRAPHVIZ_DOT_PATH),
      plantumlCommand: resolveOptionalPathLikeValue(env.FEISHU_PLANTUML_COMMAND),
      plantumlJarPath: resolveOptionalPathLikeValue(env.FEISHU_PLANTUML_JAR_PATH),
      javaPath: resolveOptionalPathLikeValue(env.FEISHU_JAVA_PATH),
      refreshBeforeSeconds: env.FEISHU_TOKEN_REFRESH_BEFORE_SECONDS,
      oauthStateTtlSeconds: env.FEISHU_OAUTH_STATE_TTL_SECONDS,
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
    knowledge: {
      indexPath: resolveOptionalPathLikeValue(env.KNOWLEDGE_INDEX_PATH),
      defaultSpaceIds: (env.KNOWLEDGE_DEFAULT_SPACE_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

function resolveProjectPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(projectRoot, input);
}

function resolveOptionalPathLikeValue(input?: string): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (path.isAbsolute(trimmed) || trimmed.startsWith(".") || /[\\/]/.test(trimmed)) {
    return resolveProjectPath(trimmed);
  }
  return trimmed;
}
