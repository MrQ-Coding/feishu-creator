#!/usr/bin/env node

import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./mcp/app.js";
import { getConfig } from "./config.js";
import {
  persistUserEnv,
  persistUserRefreshTokenInvalidation,
} from "./feishu/userAuthEnv.js";
import { Logger } from "./logger.js";
import { createAppContext, type AppContext } from "./appContext.js";

function detectMode(configMode: "auto" | "stdio" | "http"): "stdio" | "http" {
  if (process.argv.includes("--stdio")) return "stdio";
  if (process.argv.includes("--http")) return "http";
  if (configMode === "auto") return "stdio";
  return configMode;
}

function pickFirstQueryString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    return pickFirstQueryString(value[0]);
  }
  return undefined;
}

function parseBooleanQuery(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function extractBearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

function secureTokenEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function createShutdownHandler(cleanup: () => Promise<void>): (exitCode?: number) => void {
  let shutdownPromise: Promise<void> | undefined;
  let finalized = false;

  const finalize = (exitCode: number) => {
    if (finalized) {
      return;
    }
    finalized = true;
    process.exit(exitCode);
  };

  return (exitCode = 0) => {
    if (shutdownPromise) {
      return;
    }

    shutdownPromise = (async () => {
      await cleanup();
      finalize(exitCode);
    })();

    // Force process termination if cleanup stalls on hidden handles.
    setTimeout(() => finalize(exitCode), 1000).unref();
  };
}

function createStdioShutdownHandler(
  server: ReturnType<typeof createMcpServer>,
  context: AppContext,
): (exitCode?: number) => void {
  return createShutdownHandler(async () => {
    try {
      await server.close();
    } catch {
      // Ignore close errors during shutdown.
    }

    try {
      await context.shutdown();
    } catch {
      // Ignore cleanup errors during shutdown.
    }
  });
}

type McpServerInstance = ReturnType<typeof createMcpServer>;

interface HttpSession {
  server: McpServerInstance;
  transport: StreamableHTTPServerTransport;
}

async function runStdio(context: AppContext): Promise<void> {
  // Never print logs to stdout/stderr in stdio mode.
  Logger.setEnabled(false);
  const server = createMcpServer(context);
  const transport = new StdioServerTransport();
  const shutdown = createStdioShutdownHandler(server, context);
  const handleStdinClosure = () => shutdown(0);
  const handleStdoutClose = () => shutdown(0);
  const handleStdoutError = (error: NodeJS.ErrnoException) => {
    shutdown(error.code === "EPIPE" ? 0 : 1);
  };
  const handleSignal = () => shutdown(0);

  process.stdin.once("end", handleStdinClosure);
  process.stdin.once("close", handleStdinClosure);
  process.stdout.once("close", handleStdoutClose);
  process.stdout.once("error", handleStdoutError);
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  await server.connect(transport);
}

async function runHttp(context: AppContext): Promise<void> {
  const app = express();
  const sessions = new Map<string, HttpSession>();
  const port = context.config.server.port;
  const bindHost = context.config.server.httpBindHost || "127.0.0.1";
  const requireMcpAuth = context.config.server.httpRequireAuth;
  const mcpAuthToken = context.config.server.httpAuthToken;
  if (requireMcpAuth && !mcpAuthToken) {
    throw new Error(
      "MCP HTTP auth is enabled but MCP_HTTP_AUTH_TOKEN is not configured.",
    );
  }

  const closeHttpServer = async (server: HttpServer): Promise<void> => {
    if (!server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  const closeSession = async (sessionId: string): Promise<void> => {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    sessions.delete(sessionId);
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  };

  const closeAllSessions = async (): Promise<void> => {
    await Promise.all(Array.from(sessions.keys(), (sessionId) => closeSession(sessionId)));
  };

  app.get("/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "feishu-creator",
      authType: context.config.feishu.authType,
    });
  });

  app.get("/callback", async (req, res) => {
    const code = pickFirstQueryString(req.query.code);
    const state = pickFirstQueryString(req.query.state);
    const writeToEnv = parseBooleanQuery(
      pickFirstQueryString(req.query.writeToEnv),
      true,
    );

    if (!code) {
      res
        .status(400)
        .send(
          "<html><body><h3>OAuth callback failed</h3><p>Missing required query parameter: code</p></body></html>",
        );
      return;
    }
    if (!state) {
      res
        .status(400)
        .send(
          "<html><body><h3>OAuth callback failed</h3><p>Missing required query parameter: state</p></body></html>",
        );
      return;
    }
    const stateCheck = context.authManager.verifyAndConsumeUserAuthorizeState(state);
    if (!stateCheck.valid) {
      res.status(400).send(`<!doctype html>
<html><body><h3>OAuth callback failed</h3><p>${escapeHtml(
        stateCheck.reason ?? "Invalid OAuth state.",
      )}</p></body></html>`);
      return;
    }

    const host = req.get("host") ?? `localhost:${port}`;
    const redirectUri = `${req.protocol}://${host}${req.path}`;

    try {
      const tokenResult = await context.authManager.exchangeUserAuthorizationCode(
        code,
        redirectUri,
      );
      context.authManager.setAuthTypeOverride("user");

      let persistedEnvPath: string | undefined;
      let persistWarning: string | undefined;
      if (writeToEnv) {
        try {
          persistedEnvPath = await persistUserEnv({
            envFile: ".env",
            accessToken: tokenResult.accessToken,
            accessTokenExpiresAt: tokenResult.expiresAtUnixSec,
            refreshToken: tokenResult.refreshToken,
            refreshTokenExpiresAt: tokenResult.refreshTokenExpiresAtUnixSec,
          });
        } catch (error) {
          persistWarning = error instanceof Error ? error.message : String(error);
          Logger.warn(`OAuth callback env persistence failed: ${persistWarning}`);
        }
      }

      Logger.info(
        `User OAuth callback succeeded (effectiveAuthType=user, state=${state})`,
      );

      const warningHtml = persistWarning
        ? `<p style="color:#b45309;"><strong>Warning:</strong> Failed to write .env: ${escapeHtml(
            persistWarning,
          )}</p>`
        : "";
      const envPathHtml = persistedEnvPath
        ? `<p>.env updated: <code>${escapeHtml(persistedEnvPath)}</code></p>`
        : "";

      res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>feishu-creator OAuth Success</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="font-family: sans-serif; margin: 24px; line-height: 1.6;">
    <h2>OAuth Success</h2>
    <p>User token has been exchanged successfully.</p>
    <p>Runtime auth mode is now <strong>user</strong>.</p>
    <p>Access token preview: <code>${escapeHtml(
      maskToken(tokenResult.accessToken),
    )}</code></p>
    <p>Refresh token preview: <code>${escapeHtml(
      tokenResult.refreshToken ? maskToken(tokenResult.refreshToken) : "<none>",
    )}</code></p>
    <p>Token expires at (unix sec): <code>${tokenResult.expiresAtUnixSec}</code></p>
    <p>Refresh token expires at (unix sec): <code>${escapeHtml(
      String(tokenResult.refreshTokenExpiresAtUnixSec ?? "<unknown>"),
    )}</code></p>
    <p>State: <code>${escapeHtml(state)}</code></p>
    ${envPathHtml}
    ${warningHtml}
    <p>Now you can close this page and continue in MCP tools.</p>
  </body>
</html>`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error("OAuth callback token exchange failed", error);
      res.status(500).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>feishu-creator OAuth Failed</title>
  </head>
  <body style="font-family: sans-serif; margin: 24px; line-height: 1.6;">
    <h2>OAuth Failed</h2>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`);
    }
  });

  app.use("/mcp", (req, res, next) => {
    if (!requireMcpAuth) {
      next();
      return;
    }
    const authHeader = req.header("authorization");
    const bearerToken = extractBearerToken(authHeader);
    const fallbackToken = req.header("x-mcp-token")?.trim();
    const candidateToken = bearerToken ?? (fallbackToken || undefined);
    if (
      !candidateToken ||
      !mcpAuthToken ||
      !secureTokenEqual(mcpAuthToken, candidateToken)
    ) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  });
  app.use("/mcp", express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let session: HttpSession | undefined;

      if (sessionId) {
        session = sessions.get(sessionId);
      }

      if (session) {
        // Existing stateful HTTP session.
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const server = createMcpServer(context);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { server, transport });
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            void closeSession(transport.sessionId);
          }
        };

        await server.connect(transport);
        session = { server, transport };
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: invalid session" },
          id: null,
        });
        return;
      }

      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      Logger.error("HTTP MCP request failed", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!sessionId || !session) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!sessionId || !session) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await session.transport.handleRequest(req, res);
    await closeSession(sessionId);
  });

  const httpServer = app.listen(port, bindHost, () => {
    Logger.info(`feishu-creator listening on ${bindHost}:${port}`);
    Logger.info(`health: http://localhost:${port}/health`);
    Logger.info(`mcp:    http://localhost:${port}/mcp`);
    Logger.info(`oauth:  http://localhost:${port}/callback`);
    if (requireMcpAuth) {
      Logger.info("mcp auth: enabled (Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>)");
    } else {
      Logger.warn("mcp auth: disabled (MCP_HTTP_REQUIRE_AUTH=false)");
    }
  });

  const shutdown = createShutdownHandler(async () => {
    try {
      await closeAllSessions();
    } catch {
      // Ignore session close errors during shutdown.
    }

    try {
      await closeHttpServer(httpServer);
    } catch {
      // Ignore HTTP server close errors during shutdown.
    }

    try {
      await context.shutdown();
    } catch {
      // Ignore cleanup errors during shutdown.
    }
  });

  const handleSignal = () => shutdown(0);
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
}

async function main(): Promise<void> {
  const config = getConfig();
  const context = createAppContext(config);
  const mode = detectMode(config.server.mcpMode);
  context.authManager.setUserTokenUpdateHandler(async (tokenResult) => {
    const envPath = await persistUserEnv({
      envFile: ".env",
      accessToken: tokenResult.accessToken,
      accessTokenExpiresAt: tokenResult.expiresAtUnixSec,
      refreshToken: tokenResult.refreshToken,
      refreshTokenExpiresAt: tokenResult.refreshTokenExpiresAtUnixSec,
    });
    Logger.info(`Persisted refreshed user token to ${envPath}`);
  });
  context.authManager.setUserTokenInvalidationHandler(async (tokenState) => {
    const envPath = await persistUserRefreshTokenInvalidation({ envFile: ".env" });
    Logger.warn(
      `Persisted invalid refresh token state to ${envPath}: ${tokenState.reason}`,
    );
  });
  context.authManager.startBackgroundRefresh();

  Logger.info(
    `Starting feishu-creator in ${mode} mode (feishuAuthType=${config.feishu.authType})`,
  );

  if (config.feishu.authType === "user") {
    try {
      await context.authManager.getAccessToken();
      Logger.info("User auth startup preflight succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.warn(
        `User auth startup preflight failed: ${message}. Service will continue to run so you can recover auth via /callback or auth tools.`,
      );
    }
  }

  if (mode === "stdio") {
    await runStdio(context);
    return;
  }
  await runHttp(context);
}

main().catch((error) => {
  Logger.error("feishu-creator startup failed", error);
  process.exit(1);
});
