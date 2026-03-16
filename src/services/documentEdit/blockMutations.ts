import type { DocumentEditRuntime } from './context.js';
import {
  buildUpdateTextElement,
  normalizeHeadingLevel,
  normalizeOptionalIndex,
  normalizeOptionalNonNegativeInt,
  normalizeRequiredIndex,
  normalizeRevisionId,
  normalizeTextItems,
} from './helpers.js';
import { batchCreateBlocksCore, deleteChildrenRange } from './blockMutationPrimitives.js';
import {
  createTableCore,
  getTableCore,
  replaceTableCore,
  updateTableCellCore,
} from './tableMutations.js';
import type {
  BatchUpdateBlockTextInput,
  BatchUpdateBlockTextResult,
  DeleteDocumentBlocksInput,
  DeleteDocumentBlocksResult,
  GenerateRichTextBlocksInput,
  GenerateRichTextBlocksResult,
  GenerateSectionBlocksInput,
  GenerateSectionBlocksResult,
  UpdateBlockTextInput,
  UpdateBlockTextResult,
} from './types.js';

export { batchCreateBlocksCore, deleteChildrenRange } from './blockMutationPrimitives.js';
export {
  createTableCore,
  getTableCore,
  replaceTableCore,
  updateTableCellCore,
} from './tableMutations.js';

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
  children.push(runtime.notePlatformProvider.buildHeadingBlock(headingLevel, title));
  for (const paragraph of paragraphs) {
    children.push(runtime.notePlatformProvider.buildTextBlock(paragraph));
  }
  for (const orderedItem of orderedItems) {
    children.push(runtime.notePlatformProvider.buildOrderedBlock(orderedItem));
  }
  for (const bulletItem of bulletItems) {
    children.push(runtime.notePlatformProvider.buildBulletBlock(bulletItem));
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

  const { children, typeCounts } = runtime.notePlatformProvider.buildRichTextChildren(
    input.blocks,
    {
      normalizeHeadingLevel,
      normalizeCodeLanguage: (value) =>
        normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
    },
  );

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
): Promise<{ document_revision_id?: number }> {
  const result = await runtime.notePlatformEditGateway.updateBlockText({
    documentId: normalizedDocumentId,
    blockId,
    elements,
    documentRevisionId,
  });
  return {
    document_revision_id: result.documentRevisionId,
  };
}
