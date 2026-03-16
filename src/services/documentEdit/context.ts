import type { AppConfig } from '../../config.js';
import type {
  NotePlatformDocumentGateway,
  NotePlatformEditGateway,
  NotePlatformMediaGateway,
  NotePlatformProvider,
} from '../../platform/index.js';
import type { DocumentBlockService, DocumentInfoService } from '../document/index.js';
import type { WikiBrowserDeletionService } from '../wikiBrowser/index.js';
import type { TtlCache } from '../../utils/ttlCache.js';
import type { ProgressiveLocateSectionResult } from './sectionLocator.js';

export interface DocumentEditRuntime {
  config: AppConfig['feishu'];
  notePlatformProvider: NotePlatformProvider;
  notePlatformDocumentGateway: NotePlatformDocumentGateway;
  notePlatformEditGateway: NotePlatformEditGateway;
  notePlatformMediaGateway: NotePlatformMediaGateway;
  documentBlockService: DocumentBlockService;
  documentInfoService: DocumentInfoService;
  wikiBrowserDeletionService: WikiBrowserDeletionService;
  locateCache: TtlCache<ProgressiveLocateSectionResult>;
  invalidateDocumentState(documentId: string): void;
}
