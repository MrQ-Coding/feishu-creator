import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../mcp/app.js";
import type { AppConfig } from "../config.js";
import {
  persistUserEnv,
} from "../feishu/userAuthEnv.js";
import { Logger } from "../logger.js";
import { createAppContext, type AppContext } from "../appContext.js";
import { createShutdownHandler } from "./shutdown.js";
import {
  escapeHtml,
  extractBearerToken,
  maskToken,
  parseBooleanQuery,
  parsePositiveIntHeader,
  pickFirstHeaderValue,
  pickFirstQueryString,
  secureTokenEqual,
} from "./helpers.js";

type McpServerInstance = ReturnType<typeof createMcpServer>;

interface HttpSession {
  context: AppContext;
  server: McpServerInstance;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

const MAX_SESSIONS = 100;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface HttpSessionContextHeaders {
  appUserId?: string;
  authType?: "tenant" | "user";
  userAccessToken?: string;
  userRefreshToken?: string;
  userAccessTokenExpiresAt?: number;
  userRefreshTokenExpiresAt?: number;
}

function resolveHttpSessionContextHeaders(
  headers: IncomingHttpHeaders,
): HttpSessionContextHeaders | undefined {
  const appUserId = pickFirstHeaderValue(headers["x-app-user-id"]);
  const authTypeHeader = pickFirstHeaderValue(headers["x-feishu-auth-type"]);
  let authType: "tenant" | "user" | undefined;
  if (authTypeHeader) {
    if (authTypeHeader !== "tenant" && authTypeHeader !== "user") {
      throw new Error(
        "Invalid header x-feishu-auth-type: expected tenant or user.",
      );
    }
    authType = authTypeHeader;
  }

  const userAccessToken = pickFirstHeaderValue(headers["x-feishu-user-access-token"]);
  const userRefreshToken = pickFirstHeaderValue(headers["x-feishu-user-refresh-token"]);
  const userAccessTokenExpiresAt = parsePositiveIntHeader(
    "x-feishu-user-access-token-expires-at",
    pickFirstHeaderValue(headers["x-feishu-user-access-token-expires-at"]),
  );
  const userRefreshTokenExpiresAt = parsePositiveIntHeader(
    "x-feishu-user-refresh-token-expires-at",
    pickFirstHeaderValue(headers["x-feishu-user-refresh-token-expires-at"]),
  );

  const hasSessionScopedIdentity = Boolean(
    appUserId ||
      authType ||
      userAccessToken ||
      userRefreshToken ||
      userAccessTokenExpiresAt ||
      userRefreshTokenExpiresAt,
  );

  if (!hasSessionScopedIdentity) {
    return undefined;
  }

  return {
    appUserId,
    authType:
      authType ?? (userAccessToken || userRefreshToken ? "user" : undefined),
    userAccessToken,
    userRefreshToken,
    userAccessTokenExpiresAt,
    userRefreshTokenExpiresAt,
  };
}

function createHttpSessionConfig(
  baseConfig: AppConfig,
  headers: HttpSessionContextHeaders,
): AppConfig {
  const authType = headers.authType ?? baseConfig.feishu.authType;
  return {
    server: { ...baseConfig.server },
    feishu: {
      ...baseConfig.feishu,
      authType,
      userAccessToken:
        headers.userAccessToken ?? baseConfig.feishu.userAccessToken,
      userRefreshToken:
        headers.userRefreshToken ?? baseConfig.feishu.userRefreshToken,
      userAccessTokenExpiresAt:
        headers.userAccessTokenExpiresAt ??
        baseConfig.feishu.userAccessTokenExpiresAt,
      userRefreshTokenExpiresAt:
        headers.userRefreshTokenExpiresAt ??
        baseConfig.feishu.userRefreshTokenExpiresAt,
    },
    knowledge: { ...baseConfig.knowledge },
  };
}

function createSessionScopedContext(
  baseConfig: AppConfig,
  headers?: HttpSessionContextHeaders,
): AppContext {
  const effectiveHeaders = headers ?? {};
  const sessionConfig = createHttpSessionConfig(baseConfig, effectiveHeaders);
  const context = createAppContext(sessionConfig, {
    runtimeIdentity: {
      scope: "http-session",
      source: headers ? "http-headers" : "env",
      appUserId: effectiveHeaders.appUserId,
    },
    allowUserTokenEnvPersistence: false,
  });
  context.authManager.startBackgroundRefresh();
  return context;
}

export function runHttp(context: AppContext): void {
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
    await session.context.shutdown().catch(() => undefined);
  };

  const closeAllSessions = async (): Promise<void> => {
    await Promise.all(Array.from(sessions.keys(), (sessionId) => closeSession(sessionId)));
  };

  const evictIdleSessions = (): void => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (now - session.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
        Logger.info(`Evicting idle session ${sessionId}`);
        void closeSession(sessionId);
      }
    }
  };

  const idleCleanupTimer = setInterval(evictIdleSessions, 60_000);
  idleCleanupTimer.unref();

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

  app.use("/mcp", rateLimit({
    windowMs: 60_000,
    limit: 200,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests" }, id: null },
  }));

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
        session.lastActivity = Date.now();
      } else if (!sessionId && isInitializeRequest(req.body)) {
        if (sessions.size >= MAX_SESSIONS) {
          evictIdleSessions();
          if (sessions.size >= MAX_SESSIONS) {
            res.status(503).json({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Too many active sessions" },
              id: null,
            });
            return;
          }
        }
        const sessionHeaders = resolveHttpSessionContextHeaders(req.headers);
        const sessionContext = createSessionScopedContext(
          context.config,
          sessionHeaders,
        );
        const server = createMcpServer(sessionContext);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { context: sessionContext, server, transport, lastActivity: Date.now() });
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            void closeSession(transport.sessionId);
          }
        };

        await server.connect(transport);
        session = { context: sessionContext, server, transport, lastActivity: Date.now() };
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
        const message = error instanceof Error ? error.message : "Internal server error";
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message },
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
    clearInterval(idleCleanupTimer);
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
