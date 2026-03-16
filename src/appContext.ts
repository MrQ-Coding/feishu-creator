import type { AppConfig } from "./config.js";
import { FeishuAuthManager } from "./feishu/authManager.js";
import { FeishuClient } from "./feishu/client.js";
import { Logger } from "./logger.js";
import {
  DocumentBlockService,
  DocumentCreateService,
  DocumentInfoService,
} from "./services/document/index.js";
import { DocumentEditService } from "./services/documentEdit/index.js";
import { DiagramImageService } from "./services/diagramImage/index.js";
import { MarkdownDocumentService } from "./services/markdown/index.js";
import { SearchService } from "./services/search/index.js";
import { WikiBrowserDeletionService } from "./services/wikiBrowser/index.js";
import { WikiSpaceService, WikiTreeService } from "./services/wiki/index.js";

export interface AppContext {
  config: AppConfig;
  authManager: FeishuAuthManager;
  feishuClient: FeishuClient;
  documentBlockService: DocumentBlockService;
  documentCreateService: DocumentCreateService;
  documentEditService: DocumentEditService;
  documentInfoService: DocumentInfoService;
  diagramImageService: DiagramImageService;
  markdownDocumentService: MarkdownDocumentService;
  searchService: SearchService;
  wikiSpaceService: WikiSpaceService;
  wikiTreeService: WikiTreeService;
  shutdown(): Promise<void>;
}

export function createAppContext(config: AppConfig): AppContext {
  const authManager = new FeishuAuthManager(config.feishu);
  const feishuClient = new FeishuClient(config.feishu, authManager);
  const documentBlockService = new DocumentBlockService(feishuClient, config.feishu);
  const documentInfoService = new DocumentInfoService(feishuClient, config.feishu);
  const searchService = new SearchService(feishuClient);
  const wikiSpaceService = new WikiSpaceService(feishuClient, config.feishu);
  const wikiTreeService = new WikiTreeService(feishuClient, config.feishu);
  const wikiBrowserDeletionService = new WikiBrowserDeletionService(config.feishu);
  const documentCreateService = new DocumentCreateService(
    feishuClient,
    wikiSpaceService,
    wikiTreeService,
  );
  const documentEditService = new DocumentEditService(
    feishuClient,
    documentBlockService,
    documentInfoService,
    wikiBrowserDeletionService,
    config.feishu,
  );
  const diagramImageService = new DiagramImageService(
    documentEditService,
    config.feishu,
  );
  const markdownDocumentService = new MarkdownDocumentService(
    documentBlockService,
    documentEditService,
  );

  const cleanupTimer = setInterval(() => {
    const blocksRemoved = documentBlockService.cleanupExpired();
    const docRemoved = documentInfoService.cleanupExpired();
    const locateRemoved = documentEditService.cleanupExpired();
    const wikiRemoved = wikiSpaceService.cleanupExpired();
    const wikiTreeRemoved = wikiTreeService.cleanupExpired();
    const oauthStateRemoved = authManager.cleanupExpiredOauthStates();
    if (
      blocksRemoved > 0 ||
      docRemoved > 0 ||
      locateRemoved > 0 ||
      wikiRemoved > 0 ||
      wikiTreeRemoved > 0 ||
      oauthStateRemoved > 0
    ) {
      Logger.info(
        `Cache cleanup: documentBlocks=${blocksRemoved}, documentInfo=${docRemoved}, locate=${locateRemoved}, wikiSpaces=${wikiRemoved}, wikiTree=${wikiTreeRemoved}, oauthStates=${oauthStateRemoved}`,
      );
    }
  }, config.feishu.cacheCleanupIntervalSeconds * 1000);
  cleanupTimer.unref();

  const shutdown = async () => {
    clearInterval(cleanupTimer);
    await wikiBrowserDeletionService.shutdown().catch(() => undefined);
    authManager.stopBackgroundRefresh();
  };

  return {
    config,
    authManager,
    feishuClient,
    documentBlockService,
    documentCreateService,
    documentEditService,
    documentInfoService,
    diagramImageService,
    markdownDocumentService,
    searchService,
    wikiSpaceService,
    wikiTreeService,
    shutdown,
  };
}
