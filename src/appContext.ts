import type { AppConfig } from "./config.js";
import { FeishuAuthManager } from "./feishu/authManager.js";
import { FeishuClient } from "./feishu/client.js";
import { Logger } from "./logger.js";
import {
  FeishuNotePlatformDocumentGateway,
  FeishuNotePlatformEditGateway,
  FeishuNotePlatformExportGateway,
  FeishuNotePlatformKnowledgeGateway,
  FeishuNotePlatformMarkdownGateway,
  FeishuNotePlatformMediaGateway,
  FeishuNotePlatformProvider,
  type NotePlatformDocumentGateway,
  type NotePlatformEditGateway,
  type NotePlatformExportGateway,
  type NotePlatformKnowledgeGateway,
  type NotePlatformMarkdownGateway,
  type NotePlatformMediaGateway,
  type NotePlatformProvider,
} from "./platform/index.js";
import {
  DocumentBlockService,
  DocumentCreateService,
  DocumentInfoService,
} from "./services/document/index.js";
import { DocumentEditService } from "./services/documentEdit/index.js";
import { DiagramImageService } from "./services/diagramImage/index.js";
import { DocumentExportService } from "./services/export/index.js";
import { MarkdownDocumentService } from "./services/markdown/index.js";
import { SearchService } from "./services/search/index.js";
import { StyleProfileService } from "./services/styleProfile/index.js";
import { WikiBrowserDeletionService } from "./services/wikiBrowser/index.js";
import { WikiSpaceService, WikiTreeService } from "./services/wiki/index.js";

export interface RuntimeIdentity {
  scope: "global" | "http-session";
  source: "env" | "http-headers";
  appUserId?: string;
}

export interface AppContextOptions {
  runtimeIdentity?: RuntimeIdentity;
  allowUserTokenEnvPersistence?: boolean;
}

export interface AppContext {
  config: AppConfig;
  runtimeIdentity: RuntimeIdentity;
  allowUserTokenEnvPersistence: boolean;
  notePlatformProvider: NotePlatformProvider;
  notePlatformDocumentGateway: NotePlatformDocumentGateway;
  notePlatformKnowledgeGateway: NotePlatformKnowledgeGateway;
  notePlatformEditGateway: NotePlatformEditGateway;
  notePlatformMarkdownGateway: NotePlatformMarkdownGateway;
  notePlatformMediaGateway: NotePlatformMediaGateway;
  notePlatformExportGateway: NotePlatformExportGateway;
  authManager: FeishuAuthManager;
  feishuClient: FeishuClient;
  documentBlockService: DocumentBlockService;
  documentCreateService: DocumentCreateService;
  documentEditService: DocumentEditService;
  documentInfoService: DocumentInfoService;
  diagramImageService: DiagramImageService;
  documentExportService: DocumentExportService;
  markdownDocumentService: MarkdownDocumentService;
  searchService: SearchService;
  styleProfileService: StyleProfileService;
  wikiSpaceService: WikiSpaceService;
  wikiTreeService: WikiTreeService;
  shutdown(): Promise<void>;
}

export function createAppContext(
  config: AppConfig,
  options: AppContextOptions = {},
): AppContext {
  const notePlatformProvider = new FeishuNotePlatformProvider();
  const authManager = new FeishuAuthManager(config.feishu);
  const feishuClient = new FeishuClient(config.feishu, authManager);
  const notePlatformDocumentGateway = new FeishuNotePlatformDocumentGateway(feishuClient);
  const notePlatformKnowledgeGateway = new FeishuNotePlatformKnowledgeGateway(feishuClient);
  const notePlatformEditGateway = new FeishuNotePlatformEditGateway(feishuClient);
  const notePlatformMarkdownGateway = new FeishuNotePlatformMarkdownGateway();
  const notePlatformMediaGateway = new FeishuNotePlatformMediaGateway(feishuClient);
  const notePlatformExportGateway = new FeishuNotePlatformExportGateway(feishuClient);
  const documentBlockService = new DocumentBlockService(
    notePlatformDocumentGateway,
    notePlatformProvider,
    config.feishu,
  );
  const documentInfoService = new DocumentInfoService(
    notePlatformDocumentGateway,
    notePlatformProvider,
    config.feishu,
  );
  const searchService = new SearchService(notePlatformKnowledgeGateway);
  const wikiSpaceService = new WikiSpaceService(
    notePlatformKnowledgeGateway,
    config.feishu,
  );
  const wikiTreeService = new WikiTreeService(
    notePlatformKnowledgeGateway,
    config.feishu,
  );
  const wikiBrowserDeletionService = new WikiBrowserDeletionService(config.feishu);
  const documentCreateService = new DocumentCreateService(
    notePlatformDocumentGateway,
    wikiSpaceService,
    wikiTreeService,
  );
  const documentEditService = new DocumentEditService(
    notePlatformDocumentGateway,
    notePlatformEditGateway,
    notePlatformMediaGateway,
    notePlatformProvider,
    documentBlockService,
    documentInfoService,
    wikiBrowserDeletionService,
    config.feishu,
  );
  const diagramImageService = new DiagramImageService(
    documentEditService,
    config.feishu,
  );
  const documentExportService = new DocumentExportService(
    notePlatformProvider,
    notePlatformExportGateway,
  );
  const markdownDocumentService = new MarkdownDocumentService(
    notePlatformProvider,
    notePlatformMarkdownGateway,
    documentBlockService,
    documentEditService,
  );
  const styleProfileService = new StyleProfileService(
    searchService,
    markdownDocumentService,
    authManager,
    options.runtimeIdentity ?? {
      scope: "global",
      source: "env",
    },
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
    await wikiBrowserDeletionService.shutdown().catch((err: unknown) => {
      Logger.warn(`Wiki browser shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    authManager.stopBackgroundRefresh();
  };

  return {
    config,
    runtimeIdentity: options.runtimeIdentity ?? {
      scope: "global",
      source: "env",
    },
    allowUserTokenEnvPersistence: options.allowUserTokenEnvPersistence ?? true,
    notePlatformProvider,
    notePlatformDocumentGateway,
    notePlatformKnowledgeGateway,
    notePlatformEditGateway,
    notePlatformMarkdownGateway,
    notePlatformMediaGateway,
    notePlatformExportGateway,
    authManager,
    feishuClient,
    documentBlockService,
    documentCreateService,
    documentEditService,
    documentInfoService,
    diagramImageService,
    documentExportService,
    markdownDocumentService,
    searchService,
    styleProfileService,
    wikiSpaceService,
    wikiTreeService,
    shutdown,
  };
}
