import { randomUUID } from 'node:crypto';
import type { DocumentEditRuntime } from './context.js';
import {
  buildClientToken,
  CHUNK_GROWTH_STEP,
  clampChunkSize,
  clampMinChunkSize,
  extractBlockIds,
  isAdaptiveChunkingError,
  normalizeOptionalIndex,
  normalizeOptionalTokenSeed,
  normalizeResumeFromCreatedCount,
  normalizeRevisionId,
} from './helpers.js';
import type {
  BatchCreateBlocksInput,
  BatchCreateBlocksResult,
  BatchCreateChunkResult,
  CreateBlockChildrenResponse,
} from './types.js';

export async function batchCreateBlocksCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: BatchCreateBlocksInput,
): Promise<BatchCreateBlocksResult> {
  const parentBlockId = input.parentBlockId?.trim();
  if (!parentBlockId) {
    throw new Error('parentBlockId is required.');
  }
  if (!Array.isArray(input.children) || input.children.length === 0) {
    throw new Error('children must be a non-empty array.');
  }

  const chunkSize = clampChunkSize(input.chunkSize);
  const adaptiveChunking = input.adaptiveChunking ?? true;
  const minChunkSize = clampMinChunkSize(input.minChunkSize, chunkSize);
  const totalRequested = input.children.length;
  const resumeBaseCreatedCount = normalizeResumeFromCreatedCount(
    input.resumeFromCreatedCount,
    totalRequested,
  );
  const checkpointTokenSeed = normalizeOptionalTokenSeed(input.checkpointTokenSeed);
  const continueOnError = Boolean(input.continueOnError);
  let nextInsertIndex = normalizeOptionalIndex(input.index);
  if (nextInsertIndex !== undefined) {
    nextInsertIndex += resumeBaseCreatedCount;
  }
  const initialRevisionId = normalizeRevisionId(input.documentRevisionId);
  let currentRevisionId = initialRevisionId;

  const chunkResults: BatchCreateChunkResult[] = [];
  const createdBlockIds: string[] = [];
  let totalCreated = 0;
  let stoppedEarly = false;
  let cursor = resumeBaseCreatedCount;
  let currentChunkSize = chunkSize;
  let consecutiveSuccessCount = 0;
  let chunkIndex = 0;

  while (cursor < totalRequested) {
    const effectiveChunkSize = Math.min(currentChunkSize, totalRequested - cursor);
    const chunk = input.children.slice(cursor, cursor + effectiveChunkSize);
    const requestIndex = nextInsertIndex;
    const clientToken = buildClientToken(checkpointTokenSeed, cursor, chunk.length);
    const requestBody: Record<string, unknown> = { children: chunk };
    if (requestIndex !== undefined) {
      requestBody.index = requestIndex;
    }

    try {
      const data = await runtime.feishuClient.request<CreateBlockChildrenResponse>(
        `/docx/v1/documents/${normalizedDocumentId}/blocks/${parentBlockId}/children`,
        'POST',
        requestBody,
        {
          document_revision_id: currentRevisionId,
          client_token: clientToken,
        },
      );

      const createdChildren = Array.isArray(data.children) ? data.children : [];
      const createdCount = createdChildren.length;
      if (createdCount !== chunk.length) {
        throw new Error(
          `Created count mismatch: expected=${chunk.length}, actual=${createdCount}.`,
        );
      }
      totalCreated += createdCount;
      createdBlockIds.push(...extractBlockIds(createdChildren));
      cursor += chunk.length;
      consecutiveSuccessCount += 1;

      if (nextInsertIndex !== undefined) {
        nextInsertIndex += createdCount;
      }
      if (typeof data.document_revision_id === 'number') {
        currentRevisionId = data.document_revision_id;
      }

      chunkResults.push({
        chunkIndex,
        requestCount: chunk.length,
        effectiveChunkSize,
        createdCount,
        index: requestIndex,
        attempt: chunkResults.length + 1,
        clientToken: data.client_token ?? clientToken,
        status: 'success',
        documentRevisionId: data.document_revision_id,
      });

      if (adaptiveChunking && currentChunkSize < chunkSize && consecutiveSuccessCount >= 2) {
        currentChunkSize = Math.min(chunkSize, currentChunkSize + CHUNK_GROWTH_STEP);
        consecutiveSuccessCount = 0;
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const retryable =
        adaptiveChunking &&
        currentChunkSize > minChunkSize &&
        isAdaptiveChunkingError(error);

      chunkResults.push({
        chunkIndex,
        requestCount: chunk.length,
        effectiveChunkSize,
        createdCount: 0,
        index: requestIndex,
        attempt: chunkResults.length + 1,
        clientToken,
        status: 'failed',
        retryable,
        error: errorText,
      });
      consecutiveSuccessCount = 0;

      if (retryable) {
        currentChunkSize = Math.max(minChunkSize, Math.floor(currentChunkSize / 2));
        continue;
      }

      if (!continueOnError) {
        stoppedEarly = true;
        break;
      }
      cursor += chunk.length;
    }
    chunkIndex += 1;
  }

  if (totalCreated > 0) {
    runtime.invalidateDocumentState(normalizedDocumentId);
  }

  const requestedChunks = chunkResults.length;
  const successfulChunks = chunkResults.filter((item) => item.status === 'success').length;
  const failedChunks = chunkResults.length - successfulChunks;
  const cumulativeCreatedCount = resumeBaseCreatedCount + totalCreated;

  return {
    documentId: normalizedDocumentId,
    parentBlockId,
    totalRequested,
    totalCreated,
    resumeBaseCreatedCount,
    cumulativeCreatedCount,
    nextResumeFromCreatedCount: cumulativeCreatedCount,
    checkpointTokenSeed,
    adaptiveChunking,
    targetChunkSize: chunkSize,
    minChunkSize,
    requestedChunks,
    successfulChunks,
    failedChunks,
    stoppedEarly,
    createdBlockIds,
    chunks: chunkResults,
  };
}

export async function deleteChildrenRange(
  runtime: DocumentEditRuntime,
  documentId: string,
  parentBlockId: string,
  startIndex: number,
  endIndex: number,
  documentRevisionId: number,
): Promise<void> {
  if (endIndex <= startIndex) return;
  await runtime.feishuClient.request(
    `/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children/batch_delete`,
    'DELETE',
    {
      start_index: startIndex,
      end_index: endIndex,
    },
    {
      document_revision_id: documentRevisionId,
      client_token: randomUUID(),
    },
  );
  runtime.invalidateDocumentState(documentId);
}
