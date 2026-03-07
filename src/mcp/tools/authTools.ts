import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { persistUserEnv } from "../../feishu/userAuthEnv.js";
import { errorToolResult, jsonToolResult, textToolResult } from "./toolResponse.js";

function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function registerAuthTools(server: McpServer, context: AppContext): void {
  server.tool(
    "ping",
    "Connectivity check for feishu-creator MCP server.",
    {
      message: z.string().optional(),
    },
    async ({ message }) => {
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
        return jsonToolResult(status);
      }

      try {
        const token = await context.authManager.getAccessToken();
        return jsonToolResult({
          ...status,
          tokenFetched: true,
          tokenPreview: maskToken(token),
        });
      } catch (error) {
        return jsonToolResult({
          ...status,
          tokenFetched: false,
          error: error instanceof Error ? error.message : String(error),
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
    async ({ redirectUri, state }) => {
      try {
        const defaultRedirectUri = `http://localhost:${context.config.server.port}/callback`;
        const authorizeUrl = context.authManager.buildUserAuthorizeUrl(
          redirectUri ?? defaultRedirectUri,
          state,
        );
        return jsonToolResult({
          authorizeUrl,
          redirectUri: redirectUri ?? defaultRedirectUri,
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
      envFile: z
        .string()
        .optional()
        .default(".env")
        .describe("Target env file path when writeToEnv=true."),
    },
    async ({ code, redirectUri, switchToUser, writeToEnv, envFile }) => {
      try {
        const tokenResult = await context.authManager.exchangeUserAuthorizationCode(
          code,
          redirectUri,
        );
        const effectiveAuthType = switchToUser
          ? context.authManager.setAuthTypeOverride("user")
          : context.authManager.setAuthTypeOverride(undefined);
        let persistedEnvPath: string | undefined;
        if (writeToEnv) {
          persistedEnvPath = await persistUserEnv({
            envFile,
            accessToken: tokenResult.accessToken,
            refreshToken: tokenResult.refreshToken,
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
          writeToEnv,
          envFile: persistedEnvPath,
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
      envFile: z.string().optional().default(".env"),
    },
    async ({
      accessToken,
      refreshToken,
      expiresInSec,
      switchToUser,
      writeToEnv,
      envFile,
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
        let persistedEnvPath: string | undefined;
        if (writeToEnv) {
          persistedEnvPath = await persistUserEnv({
            envFile,
            accessToken: tokenResult.accessToken,
            refreshToken: tokenResult.refreshToken,
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
          writeToEnv,
          envFile: persistedEnvPath,
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
    async ({ authType }) => {
      try {
        const effectiveAuthType = context.authManager.setAuthTypeOverride(authType);
        return jsonToolResult({
          effectiveAuthType,
          status: context.authManager.getStatus(),
        });
      } catch (error) {
        return errorToolResult("set_auth_mode", error);
      }
    },
  );
}
