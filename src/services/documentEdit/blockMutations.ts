import { randomUUID } from 'node:crypto';
import { buildBulletBlock, buildHeadingBlock, buildOrderedBlock, buildRichTextChildren, buildTextBlock } from './richTextBlocks.js';
import type { DocumentEditRuntime } from './context.js';
import {
  buildClientToken,
  buildUpdateTextElement,
  CHUNK_GROWTH_STEP,
  clampChunkSize,
  clampMinChunkSize,
  extractBlockIds,
  isAdaptiveChunkingError,
  normalizeHeadingLevel,
  normalizeOptionalIndex,
  normalizeOptionalNonNegativeInt,
  normalizeOptionalTokenSeed,
  normalizeRequiredIndex,
  normalizeResumeFromCreatedCount,
  normalizeRevisionId,
  normalizeTextItems,
} from './helpers.js';
import type {
  BatchCreateBlocksInput,
  BatchCreateBlocksResult,
  BatchCreateChunkResult,
  BatchUpdateBlockTextInput,
  BatchUpdateBlockTextResult,
  CreateBlockChildrenResponse,
  DeleteDocumentBlocksInput,
  DeleteDocumentBlocksResult,
  GenerateRichTextBlocksInput,
  GenerateRichTextBlocksResult,
  GenerateSectionBlocksInput,
  GenerateSectionBlocksResult,
  UpdateBlockTextInput,
  UpdateBlockTextResponse,
  UpdateBlockTextResult,
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

export async function updateBlockTextCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: UpdateBlockTextInput,
): Promise<UpdateBlockTextResult> {
  const { blockId, elements, documentRevisionId } = normalizeSingleBlockTextUpdate(input);
  const data = await patchBlockText(
    runtime,
    normalizedDocumentId,
    blockId,
    elements,
    documentRevisionId,
  );

  runtime.invalidateDocumentState(normalizedDocumentId);

  return {
    documentId: normalizedDocumentId,
    blockId,
    documentRevisionId: data.document_revision_id,
    elementCount: elements.length,
  };
}

export async function batchUpdateBlockTextCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: BatchUpdateBlockTextInput,
): Promise<BatchUpdateBlockTextResult> {
  if (!Array.isArray(input.updates) || input.updates.length === 0) {
    throw new Error('updates must be a non-empty array.');
  }

  const continueOnError = Boolean(input.continueOnError);
  let currentRevisionId = normalizeRevisionId(input.documentRevisionId);
  let totalUpdated = 0;
  let stoppedEarly = false;
  let hasSuccessfulUpdate = false;
  const results: BatchUpdateBlockTextResult['results'] = [];

  for (const [index, update] of input.updates.entries()) {
    try {
      const { blockId, elements } = normalizeSingleBlockTextUpdate(update);
      const data = await patchBlockText(
        runtime,
        normalizedDocumentId,
        blockId,
        elements,
        currentRevisionId,
      );

      if (typeof data.document_revision_id === 'number') {
        currentRevisionId = data.document_revision_id;
      }

      totalUpdated += 1;
      hasSuccessfulUpdate = true;
      results.push({
        index,
        blockId,
        status: 'success',
        elementCount: elements.length,
        documentRevisionId: data.document_revision_id,
      });
    } catch (error) {
      results.push({
        index,
        blockId: typeof update?.blockId === 'string' ? update.blockId.trim() : '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });

      if (!continueOnError) {
        stoppedEarly = true;
        break;
      }
    }
  }

  if (hasSuccessfulUpdate) {
    runtime.invalidateDocumentState(normalizedDocumentId);
  }

  return {
    documentId: normalizedDocumentId,
    totalRequested: input.updates.length,
    totalUpdated,
    failedCount: results.filter((item) => item.status === 'failed').length,
    continueOnError,
    stoppedEarly,
    results,
  };
}

export async function deleteDocumentBlocksCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: DeleteDocumentBlocksInput,
): Promise<DeleteDocumentBlocksResult> {
  const parentBlockId = input.parentBlockId?.trim();
  if (!parentBlockId) {
    throw new Error('parentBlockId is required.');
  }

  const startIndex = normalizeRequiredIndex(input.startIndex, 'startIndex');
  const endIndex = normalizeRequiredIndex(input.endIndex, 'endIndex');
  if (endIndex <= startIndex) {
    throw new Error('endIndex must be greater than startIndex.');
  }

  await deleteChildrenRange(
    runtime,
    normalizedDocumentId,
    parentBlockId,
    startIndex,
    endIndex,
    normalizeRevisionId(input.documentRevisionId),
  );

  return {
    documentId: normalizedDocumentId,
    parentBlockId,
    startIndex,
    endIndex,
    deletedCount: endIndex - startIndex,
  };
}

export async function generateSectionBlocksCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: GenerateSectionBlocksInput,
): Promise<GenerateSectionBlocksResult> {
  const parentBlockId = input.parentBlockId?.trim() || normalizedDocumentId;
  const title = input.title?.trim();
  if (!title) {
    throw new Error('title is required.');
  }

  const headingLevel = normalizeHeadingLevel(input.headingLevel);
  const paragraphs = normalizeTextItems(input.paragraphs);
  const orderedItems = normalizeTextItems(input.orderedItems);
  const bulletItems = normalizeTextItems(input.bulletItems);

  const children: Array<Record<string, unknown>> = [];
  children.push(buildHeadingBlock(headingLevel, title));
  for (const paragraph of paragraphs) {
    children.push(buildTextBlock(paragraph));
  }
  for (const orderedItem of orderedItems) {
    children.push(buildOrderedBlock(orderedItem));
  }
  for (const bulletItem of bulletItems) {
    children.push(buildBulletBlock(bulletItem));
  }

  const result = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId,
    children,
    index: input.index,
    chunkSize: input.chunkSize,
    minChunkSize: input.minChunkSize,
    adaptiveChunking: input.adaptiveChunking,
    resumeFromCreatedCount: input.resumeFromCreatedCount,
    checkpointTokenSeed: input.checkpointTokenSeed,
    documentRevisionId: input.documentRevisionId,
    continueOnError: input.continueOnError,
  });

  return {
    ...result,
    sectionTitle: title,
    headingLevel,
    paragraphCount: paragraphs.length,
    orderedCount: orderedItems.length,
    bulletCount: bulletItems.length,
  };
}

export async function generateRichTextBlocksCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: GenerateRichTextBlocksInput,
): Promise<GenerateRichTextBlocksResult> {
  const parentBlockId = input.parentBlockId?.trim() || normalizedDocumentId;
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    throw new Error('blocks must be a non-empty array.');
  }

  const { children, typeCounts } = buildRichTextChildren(input.blocks, {
    normalizeHeadingLevel,
    normalizeCodeLanguage: (value) => normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
  });

  const result = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId,
    children,
    index: input.index,
    chunkSize: input.chunkSize,
    minChunkSize: input.minChunkSize,
    adaptiveChunking: input.adaptiveChunking,
    resumeFromCreatedCount: input.resumeFromCreatedCount,
    checkpointTokenSeed: input.checkpointTokenSeed,
    documentRevisionId: input.documentRevisionId,
    continueOnError: input.continueOnError,
  });

  return {
    ...result,
    typeCounts,
  };
}

function normalizeSingleBlockTextUpdate(input: {
  blockId: string;
  textElements: UpdateBlockTextInput['textElements'];
  documentRevisionId?: number;
}): {
  blockId: string;
  elements: Array<Record<string, unknown>>;
  documentRevisionId: number;
} {
  const blockId = input.blockId?.trim();
  if (!blockId) {
    throw new Error('blockId is required.');
  }
  if (!Array.isArray(input.textElements) || input.textElements.length === 0) {
    throw new Error('textElements must be a non-empty array.');
  }

  return {
    blockId,
    elements: input.textElements.map((item) => buildUpdateTextElement(item)),
    documentRevisionId: normalizeRevisionId(input.documentRevisionId),
  };
}

async function patchBlockText(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  blockId: string,
  elements: Array<Record<string, unknown>>,
  documentRevisionId: number,
): Promise<UpdateBlockTextResponse> {
  return runtime.feishuClient.request<UpdateBlockTextResponse>(
    `/docx/v1/documents/${normalizedDocumentId}/blocks/${blockId}`,
    'PATCH',
    {
      update_text_elements: {
        elements,
      },
    },
    {
      document_revision_id: documentRevisionId,
    },
  );
}
