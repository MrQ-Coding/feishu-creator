import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { persistUserEnv } from "../../feishu/userAuthEnv.js";
import { errorToolResult, jsonToolResult, textToolResult } from "./toolResponse.js";
import { maskToken, isLikelyTransportError } from "../../transport/helpers.js";

const DEFAULT_ENV_FILE = ".env";

function getNetworkEnvSummary() {
  return {
    hasHttpProxy: Boolean(process.env.HTTP_PROXY || process.env.http_proxy),
    hasHttpsProxy: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
    hasAllProxy: Boolean(process.env.ALL_PROXY || process.env.all_proxy),
    hasNoProxy: Boolean(process.env.NO_PROXY || process.env.no_proxy),
    nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY ?? null,
    hasNodeExtraCaCerts: Boolean(process.env.NODE_EXTRA_CA_CERTS),
    hasSslCertFile: Boolean(process.env.SSL_CERT_FILE),
    hasSslCertDir: Boolean(process.env.SSL_CERT_DIR),
  };
}

function buildTokenFetchHint(errorMessage: string): string | undefined {
  if (!isLikelyTransportError(errorMessage)) {
    return undefined;
  }
  const env = getNetworkEnvSummary();
  const hasProxy =
    env.hasHttpProxy || env.hasHttpsProxy || env.hasAllProxy;
  if (!hasProxy) {
    return "No proxy env was detected inside the MCP process. If your network requires a proxy, pass HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY into the MCP child-process env and set NODE_USE_ENV_PROXY=1.";
  }
  if (env.nodeUseEnvProxy !== "1") {
    return "Proxy env is present, but NODE_USE_ENV_PROXY is not set to 1. For Node fetch-based requests, enable NODE_USE_ENV_PROXY=1 in the MCP child-process env.";
  }
  return "Proxy env is present in the MCP process. Check proxy reachability, credentials, and any custom CA settings such as NODE_EXTRA_CA_CERTS or SSL_CERT_FILE.";
}

export function registerAuthTools(server: McpServer, context: AppContext): void {
  server.tool(
    "ping",
    "Connectivity check for feishu-creator MCP server.",
    {
      message: z.string().optional(),
    },
    ({ message }) => {
      return textToolResult(message ? `pong: ${message}` : "pong");
    },
  );

  server.tool(
    "auth_status",
    "Check Feishu auth configuration and optionally verify access token retrieval.",
    {
      fetchToken: z.boolean().optional().default(false),
    },
    async ({ fetchToken }) => {
      const status = context.authManager.getStatus();
      if (!fetchToken) {
        return jsonToolResult({
          ...status,
          runtimeIdentity: context.runtimeIdentity,
          allowUserTokenEnvPersistence: context.allowUserTokenEnvPersistence,
        });
      }

      try {
        const token = await context.authManager.getAccessToken();
        return jsonToolResult({
          ...status,
          tokenFetched: true,
          tokenPreview: maskToken(token),
          runtimeIdentity: context.runtimeIdentity,
          allowUserTokenEnvPersistence: context.allowUserTokenEnvPersistence,
          networkEnv: getNetworkEnvSummary(),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return jsonToolResult({
          ...status,
          tokenFetched: false,
          error: errorMessage,
          runtimeIdentity: context.runtimeIdentity,
          allowUserTokenEnvPersistence: context.allowUserTokenEnvPersistence,
          networkEnv: getNetworkEnvSummary(),
          hint: buildTokenFetchHint(errorMessage),
        });
      }
    },
  );

  server.tool(
    "get_user_authorize_url",
    "Build Feishu user OAuth authorize URL. Open it in browser, then copy `code` from redirect URL.",
    {
      redirectUri: z
        .string()
        .optional()
        .describe(
          "OAuth redirect URI configured in app. Defaults to http://localhost:<port>/callback.",
        ),
      state: z.string().optional().describe("Optional anti-CSRF state."),
    },
    ({ redirectUri, state }) => {
      try {
        const defaultRedirectUri = `http://localhost:${context.config.server.port}/callback`;
        const effectiveState = context.authManager.issueUserAuthorizeState(state);
        const authorizeUrl = context.authManager.buildUserAuthorizeUrl(
          redirectUri ?? defaultRedirectUri,
          effectiveState,
        );
        return jsonToolResult({
          authorizeUrl,
          redirectUri: redirectUri ?? defaultRedirectUri,
          state: effectiveState,
          nextStep:
            "Open authorizeUrl, approve login, then call exchange_user_auth_code with the `code` parameter.",
        });
      } catch (error) {
        return errorToolResult("get_user_authorize_url", error);
      }
    },
  );

  server.tool(
    "exchange_user_auth_code",
    "Exchange Feishu OAuth `code` for user access/refresh token, optionally switch to user mode and persist into .env.",
    {
      code: z.string().min(1).describe("OAuth authorization code from redirect URL."),
      redirectUri: z
        .string()
        .optional()
        .describe("Must match redirect URI used during authorize."),
      switchToUser: z
        .boolean()
        .optional()
        .default(true)
        .describe("Switch runtime auth mode to user after exchange."),
      writeToEnv: z
        .boolean()
        .optional()
        .default(true)
        .describe("Write FEISHU_AUTH_TYPE/FEISHU_USER_* into env file."),
    },
    async ({ code, redirectUri, switchToUser, writeToEnv }) => {
      try {
        const tokenResult = await context.authManager.exchangeUserAuthorizationCode(
          code,
          redirectUri,
        );
        const effectiveAuthType = switchToUser
          ? context.authManager.setAuthTypeOverride("user")
          : context.authManager.setAuthTypeOverride(undefined);
        const appliedWriteToEnv = writeToEnv && context.allowUserTokenEnvPersistence;
        let persistedEnvPath: string | undefined;
        let writeToEnvWarning: string | undefined;
        if (writeToEnv && !context.allowUserTokenEnvPersistence) {
          writeToEnvWarning =
            "Skipping shared .env persistence because the current runtime is session-scoped.";
        }
        if (appliedWriteToEnv) {
          persistedEnvPath = await persistUserEnv({
            envFile: DEFAULT_ENV_FILE,
            accessToken: tokenResult.accessToken,
            accessTokenExpiresAt: tokenResult.expiresAtUnixSec,
            refreshToken: tokenResult.refreshToken,
            refreshTokenExpiresAt: tokenResult.refreshTokenExpiresAtUnixSec,
          });
        }
        return jsonToolResult({
          exchanged: true,
          effectiveAuthType,
          accessTokenPreview: maskToken(tokenResult.accessToken),
          refreshTokenPreview: tokenResult.refreshToken
            ? maskToken(tokenResult.refreshToken)
            : undefined,
          expiresAtUnixSec: tokenResult.expiresAtUnixSec,
          refreshTokenExpiresAtUnixSec: tokenResult.refreshTokenExpiresAtUnixSec,
          writeToEnvRequested: writeToEnv,
          writeToEnvApplied: appliedWriteToEnv,
          writeToEnvWarning,
          envFile: persistedEnvPath,
          runtimeIdentity: context.runtimeIdentity,
        });
      } catch (error) {
        return errorToolResult("exchange_user_auth_code", error);
      }
    },
  );

  server.tool(
    "set_user_tokens",
    "Set user access/refresh token directly for runtime usage, optionally switch to user mode and persist into .env.",
    {
      accessToken: z.string().min(1),
      refreshToken: z.string().optional(),
      expiresInSec: z.number().int().positive().optional().default(7200),
      switchToUser: z.boolean().optional().default(true),
      writeToEnv: z.boolean().optional().default(true),
    },
    async ({
      accessToken,
      refreshToken,
      expiresInSec,
      switchToUser,
      writeToEnv,
    }) => {
      try {
        const tokenResult = context.authManager.setUserTokens(
          accessToken,
          refreshToken,
          expiresInSec,
        );
        const effectiveAuthType = switchToUser
          ? context.authManager.setAuthTypeOverride("user")
          : context.authManager.setAuthTypeOverride(undefined);
        const appliedWriteToEnv = writeToEnv && context.allowUserTokenEnvPersistence;
        let persistedEnvPath: string | undefined;
        let writeToEnvWarning: string | undefined;
        if (writeToEnv && !context.allowUserTokenEnvPersistence) {
          writeToEnvWarning =
            "Skipping shared .env persistence because the current runtime is session-scoped.";
        }
        if (appliedWriteToEnv) {
          persistedEnvPath = await persistUserEnv({
            envFile: DEFAULT_ENV_FILE,
            accessToken: tokenResult.accessToken,
            accessTokenExpiresAt: tokenResult.expiresAtUnixSec,
            refreshToken: tokenResult.refreshToken,
            refreshTokenExpiresAt: tokenResult.refreshTokenExpiresAtUnixSec,
          });
        }
        return jsonToolResult({
          set: true,
          effectiveAuthType,
          accessTokenPreview: maskToken(tokenResult.accessToken),
          refreshTokenPreview: tokenResult.refreshToken
            ? maskToken(tokenResult.refreshToken)
            : undefined,
          expiresAtUnixSec: tokenResult.expiresAtUnixSec,
          refreshTokenExpiresAtUnixSec: tokenResult.refreshTokenExpiresAtUnixSec,
          writeToEnvRequested: writeToEnv,
          writeToEnvApplied: appliedWriteToEnv,
          writeToEnvWarning,
          envFile: persistedEnvPath,
          runtimeIdentity: context.runtimeIdentity,
        });
      } catch (error) {
        return errorToolResult("set_user_tokens", error);
      }
    },
  );

  server.tool(
    "set_auth_mode",
    "Switch runtime auth mode between tenant/user without restart.",
    {
      authType: z.enum(["tenant", "user"]),
    },
    ({ authType }) => {
      try {
        const effectiveAuthType = context.authManager.setAuthTypeOverride(authType);
        return jsonToolResult({
          effectiveAuthType,
          status: context.authManager.getStatus(),
          runtimeIdentity: context.runtimeIdentity,
        });
      } catch (error) {
        return errorToolResult("set_auth_mode", error);
      }
    },
  );
}
