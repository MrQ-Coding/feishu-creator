#!/usr/bin/env node

import express from "express";
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./mcp/app.js";
import { getConfig } from "./config.js";
import { persistUserEnv } from "./feishu/userAuthEnv.js";
import { Logger } from "./logger.js";
import { createAppContext, type AppContext } from "./appContext.js";

function detectMode(configMode: "auto" | "stdio" | "http"): "stdio" | "http" {
  if (process.argv.includes("--stdio")) return "stdio";
  if (process.argv.includes("--http")) return "http";
  if (configMode === "auto") return "http";
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

async function runStdio(context: AppContext): Promise<void> {
  // Never print logs to stdout/stderr in stdio mode.
  Logger.setEnabled(false);
  const server = createMcpServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHttp(context: AppContext): Promise<void> {
  const app = express();
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const port = context.config.server.port;

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
    const envFile = pickFirstQueryString(req.query.envFile) ?? ".env";
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
            envFile,
            accessToken: tokenResult.accessToken,
            refreshToken: tokenResult.refreshToken,
          });
        } catch (error) {
          persistWarning = error instanceof Error ? error.message : String(error);
          Logger.warn(`OAuth callback env persistence failed: ${persistWarning}`);
        }
      }

      Logger.info(
        `User OAuth callback succeeded (effectiveAuthType=user, state=${state ?? ""})`,
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
    <p>State: <code>${escapeHtml(state ?? "<empty>")}</code></p>
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

  app.use("/mcp", express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };

        const server = createMcpServer(context);
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: invalid session" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
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
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
    delete transports[sessionId];
  });

  app.listen(port, "0.0.0.0", () => {
    Logger.info(`feishu-creator listening on :${port}`);
    Logger.info(`health: http://localhost:${port}/health`);
    Logger.info(`mcp:    http://localhost:${port}/mcp`);
    Logger.info(`oauth:  http://localhost:${port}/callback`);
  });
}

async function main(): Promise<void> {
  const config = getConfig();
  const context = createAppContext(config);
  const mode = detectMode(config.server.mcpMode);
  context.authManager.setUserTokenUpdateHandler(async (tokenResult) => {
    const envPath = await persistUserEnv({
      envFile: ".env",
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
    });
    Logger.info(`Persisted refreshed user token to ${envPath}`);
  });

  Logger.info(
    `Starting feishu-creator in ${mode} mode (feishuAuthType=${config.feishu.authType})`,
  );

  if (config.feishu.authType === "user") {
    if (config.feishu.userRefreshToken?.trim()) {
      context.authManager.invalidateCachedAccessToken(
        "startup preflight with configured user refresh token",
      );
    }
    await context.authManager.getAccessToken();
    Logger.info("User auth startup preflight succeeded");
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
