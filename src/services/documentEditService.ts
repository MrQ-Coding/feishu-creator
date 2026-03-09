import type { AppConfig } from '../config.js';
import { detectDocumentType, extractDocumentId } from '../feishu/document.js';
import type { FeishuClient } from '../feishu/client.js';
import type { DocumentBlockService } from './documentBlockService.js';
import type { DocumentInfoService } from './documentInfoService.js';
import type { WikiBrowserDeletionService } from './wikiBrowserDeletionService.js';
import { TtlCache } from '../utils/ttlCache.js';
import type { ProgressiveLocateSectionResult } from './documentEdit/sectionLocator.js';
import type { DocumentEditRuntime } from './documentEdit/context.js';
import {
  batchUpdateBlockTextCore,
  batchCreateBlocksCore,
  deleteDocumentBlocksCore,
  generateRichTextBlocksCore,
  generateSectionBlocksCore,
  updateBlockTextCore,
} from './documentEdit/blockMutations.js';
import {
  deleteByHeadingCore,
  insertBeforeHeadingCore,
  locateSectionRangeCore,
  replaceSectionBlocksCore,
  replaceSectionWithOrderedListCore,
} from './documentEdit/headingOperations.js';
import {
  deleteDocumentCore,
  resolveDocumentIdForDelete,
} from './documentEdit/documentDeletion.js';

export type {
  BatchCreateBlocksInput,
  BatchCreateBlocksResult,
  BatchCreateChunkResult,
  BatchDeleteDocumentsInput,
  BatchDeleteDocumentsResult,
  BatchUpdateBlockTextInput,
  BatchUpdateBlockTextResult,
  DeleteByHeadingInput,
  DeleteByHeadingResult,
  DeleteDocumentBlocksInput,
  DeleteDocumentBlocksResult,
  DeleteDocumentInput,
  DeleteDocumentResult,
  GenerateRichTextBlocksInput,
  GenerateRichTextBlocksResult,
  GenerateSectionBlocksInput,
  GenerateSectionBlocksResult,
  InsertBeforeHeadingInput,
  InsertBeforeHeadingResult,
  LocateSectionRangeInput,
  LocateSectionRangeResult,
  ReplaceSectionBlocksInput,
  ReplaceSectionBlocksResult,
  ReplaceSectionWithOrderedListInput,
  ReplaceSectionWithOrderedListResult,
  RichTextBlockSpec,
  RichTextBlockType,
  TextElementInput,
  TextElementStyle,
  UpdateBlockTextInput,
  UpdateBlockTextResult,
} from './documentEdit/types.js';
import type {
  BatchCreateBlocksInput,
  BatchCreateBlocksResult,
  BatchDeleteDocumentsInput,
  BatchDeleteDocumentsResult,
  BatchUpdateBlockTextInput,
  BatchUpdateBlockTextResult,
  DeleteByHeadingInput,
  DeleteByHeadingResult,
  DeleteDocumentBlocksInput,
  DeleteDocumentBlocksResult,
  DeleteDocumentInput,
  DeleteDocumentResult,
  GenerateRichTextBlocksInput,
  GenerateRichTextBlocksResult,
  GenerateSectionBlocksInput,
  GenerateSectionBlocksResult,
  InsertBeforeHeadingInput,
  InsertBeforeHeadingResult,
  LocateSectionRangeInput,
  LocateSectionRangeResult,
  ReplaceSectionBlocksInput,
  ReplaceSectionBlocksResult,
  ReplaceSectionWithOrderedListInput,
  ReplaceSectionWithOrderedListResult,
  UpdateBlockTextInput,
  UpdateBlockTextResult,
} from './documentEdit/types.js';

export class DocumentEditService {
  private readonly documentLocks = new Map<string, Promise<void>>();
  private readonly runtime: DocumentEditRuntime;

  constructor(
    feishuClient: FeishuClient,
    documentBlockService: DocumentBlockService,
    documentInfoService: DocumentInfoService,
    wikiBrowserDeletionService: WikiBrowserDeletionService,
    config: AppConfig['feishu'],
  ) {
    const locateCache = new TtlCache<ProgressiveLocateSectionResult>({
      defaultTtlMs: config.docBlocksCacheTtlSeconds * 1000,
      maxEntries: Math.max(100, Math.floor(config.cacheMaxEntries / 2)),
    });

    this.runtime = {
      config,
      feishuClient,
      documentBlockService,
      documentInfoService,
      wikiBrowserDeletionService,
      locateCache,
      invalidateDocumentState: (documentId: string) => {
        documentBlockService.invalidateDocument(documentId);
        documentInfoService.invalidateDocument(documentId);
        locateCache.invalidatePrefix(`locate:${documentId}:`);
      },
    };
  }

  async batchCreateBlocks(
    input: BatchCreateBlocksInput,
  ): Promise<BatchCreateBlocksResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      batchCreateBlocksCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async replaceSectionWithOrderedList(
    input: ReplaceSectionWithOrderedListInput,
  ): Promise<ReplaceSectionWithOrderedListResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      replaceSectionWithOrderedListCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async locateSectionRange(
    input: LocateSectionRangeInput,
  ): Promise<LocateSectionRangeResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      locateSectionRangeCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async insertBeforeHeading(
    input: InsertBeforeHeadingInput,
  ): Promise<InsertBeforeHeadingResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      insertBeforeHeadingCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async replaceSectionBlocks(
    input: ReplaceSectionBlocksInput,
  ): Promise<ReplaceSectionBlocksResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      replaceSectionBlocksCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async deleteByHeading(input: DeleteByHeadingInput): Promise<DeleteByHeadingResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      deleteByHeadingCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async generateSectionBlocks(
    input: GenerateSectionBlocksInput,
  ): Promise<GenerateSectionBlocksResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      generateSectionBlocksCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async generateRichTextBlocks(
    input: GenerateRichTextBlocksInput,
  ): Promise<GenerateRichTextBlocksResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      generateRichTextBlocksCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async deleteDocument(input: DeleteDocumentInput): Promise<DeleteDocumentResult> {
    const sourceDocumentId = input.documentId?.trim();
    if (!sourceDocumentId) {
      throw new Error('documentId is required.');
    }

    const sourceType = input.documentType ?? detectDocumentType(sourceDocumentId);
    const normalizedDocumentId = await resolveDocumentIdForDelete(
      this.runtime,
      sourceDocumentId,
      sourceType,
    ).catch(() => extractDocumentId(sourceDocumentId) ?? sourceDocumentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      deleteDocumentCore(this.runtime, input),
    );
  }

  async batchDeleteDocuments(
    input: BatchDeleteDocumentsInput,
  ): Promise<BatchDeleteDocumentsResult> {
    const documents = input.documents.filter(
      (item) => item.documentId?.trim().length > 0,
    );
    if (documents.length <= 0) {
      throw new Error('documents must contain at least one item.');
    }

    const continueOnError = input.continueOnError ?? false;
    const results: BatchDeleteDocumentsResult['results'] = [];
    let totalDeleted = 0;
    let notFoundCount = 0;
    let failedCount = 0;
    let stoppedEarly = false;

    for (const [index, item] of documents.entries()) {
      try {
        const result = await this.deleteDocument(item);
        results.push({
          index,
          documentId: item.documentId,
          documentType: item.documentType,
          status: 'success',
          result,
        });
        if (result.deleted) {
          totalDeleted += 1;
        }
        if (result.notFound) {
          notFoundCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        results.push({
          index,
          documentId: item.documentId,
          documentType: item.documentType,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        if (!continueOnError) {
          stoppedEarly = true;
          break;
        }
      }
    }

    return {
      totalRequested: documents.length,
      totalSucceeded: results.length - failedCount,
      totalDeleted,
      notFoundCount,
      failedCount,
      continueOnError,
      stoppedEarly,
      results,
    };
  }

  async updateBlockText(input: UpdateBlockTextInput): Promise<UpdateBlockTextResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      updateBlockTextCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async batchUpdateBlockText(
    input: BatchUpdateBlockTextInput,
  ): Promise<BatchUpdateBlockTextResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      batchUpdateBlockTextCore(this.runtime, normalizedDocumentId, input),
    );
  }

  async deleteDocumentBlocks(
    input: DeleteDocumentBlocksInput,
  ): Promise<DeleteDocumentBlocksResult> {
    const normalizedDocumentId = this.requireDocumentId(input.documentId);
    return this.withDocumentLock(normalizedDocumentId, () =>
      deleteDocumentBlocksCore(this.runtime, normalizedDocumentId, input),
    );
  }

  cleanupExpired(): number {
    return this.runtime.locateCache.cleanupExpired();
  }

  getCacheStats() {
    return {
      locate: this.runtime.locateCache.getStats(),
    };
  }

  private requireDocumentId(documentId: string): string {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) {
      throw new Error('Invalid document ID or document URL.');
    }
    return normalizedDocumentId;
  }

  private async withDocumentLock<T>(
    documentId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.documentLocks.get(documentId) ?? Promise.resolve();
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const chained = previous.then(() => current);
    this.documentLocks.set(documentId, chained);

    await previous;
    try {
      return await task();
    } finally {
      releaseCurrent?.();
      if (this.documentLocks.get(documentId) === chained) {
        this.documentLocks.delete(documentId);
      }
    }
  }
}
