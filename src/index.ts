#!/usr/bin/env node

import { getConfig } from "./config.js";
import {
  persistUserEnv,
  persistUserRefreshTokenInvalidation,
} from "./feishu/userAuthEnv.js";
import { Logger } from "./logger.js";
import { createAppContext } from "./appContext.js";
import { runStdio } from "./transport/stdio.js";
import { runHttp } from "./transport/http.js";

function detectMode(configMode: "auto" | "stdio" | "http"): "stdio" | "http" {
  if (process.argv.includes("--stdio")) return "stdio";
  if (process.argv.includes("--http")) return "http";
  if (configMode === "auto") return "stdio";
  return configMode;
}

process.on("unhandledRejection", (reason) => {
  Logger.error("Unhandled promise rejection", reason);
});

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

  // Rebuild knowledge index on startup for all configured spaces.
  const knowledgeSpaceIds = config.knowledge.defaultSpaceIds;
  if (knowledgeSpaceIds.length > 0) {
    Promise.all(
      knowledgeSpaceIds.map((spaceId) =>
        context.knowledgeService
          .rebuildIndex({ spaceId })
          .then((result) => {
            Logger.info(
              `Knowledge index rebuilt: ${result.totalEntries} entries from ${result.totalDocuments} docs (space=${spaceId})`,
            );
            return result;
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            Logger.warn(`Knowledge index rebuild failed for space=${spaceId}: ${message}`);
            return null;
          }),
      ),
    ).catch(() => {});
  }

  if (mode === "stdio") {
    await runStdio(context);
    return;
  }
  runHttp(context);
}

main().catch((error) => {
  Logger.error("feishu-creator startup failed", error);
  process.exit(1);
});
