import { buildOrderedBlock, buildRichTextChildren } from './richTextBlocks.js';
import type { DocumentEditRuntime } from './context.js';
import {
  normalizeHeadingLevel,
  normalizeOptionalNonNegativeInt,
} from './helpers.js';
import {
  batchCreateBlocksCore,
  deleteChildrenRange,
} from './blockMutations.js';
import { resolveHeadingTarget } from './headingLocator.js';
import type {
  InsertBeforeHeadingInput,
  InsertBeforeHeadingResult,
  ReplaceSectionBlocksInput,
  ReplaceSectionBlocksResult,
  ReplaceSectionWithOrderedListInput,
  ReplaceSectionWithOrderedListResult,
} from './types.js';

export async function insertBeforeHeadingCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: InsertBeforeHeadingInput,
): Promise<InsertBeforeHeadingResult> {
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    throw new Error('blocks must be a non-empty array.');
  }

  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, input);
  const { children, typeCounts } = buildRichTextChildren(input.blocks, {
    normalizeHeadingLevel,
    normalizeCodeLanguage: (value) => normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
  });
  const insertIndex = Math.max(0, target.locateResult.range.startIndex - 1);
  const result = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    children,
    index: insertIndex,
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
    targetHeading: target.locateResult.range.headingText,
    sectionOccurrence: target.sectionOccurrence,
    insertIndex,
    scannedChildrenCount: target.locateResult.scannedChildrenCount,
    scannedAllChildren: target.locateResult.scannedAllChildren,
    typeCounts,
  };
}

export async function replaceSectionBlocksCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: ReplaceSectionBlocksInput,
): Promise<ReplaceSectionBlocksResult> {
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    throw new Error('blocks must be a non-empty array.');
  }

  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, input);
  const range = target.locateResult.range;

  const { children, typeCounts } = buildRichTextChildren(input.blocks, {
    normalizeHeadingLevel,
    normalizeCodeLanguage: (value) => normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
  });
  const createResult = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    children,
    index: range.startIndex,
    chunkSize: input.chunkSize,
    minChunkSize: input.minChunkSize,
    adaptiveChunking: input.adaptiveChunking,
    resumeFromCreatedCount: input.resumeFromCreatedCount,
    checkpointTokenSeed: input.checkpointTokenSeed,
    documentRevisionId: input.documentRevisionId,
    continueOnError: false,
  });

  if (createResult.failedChunks > 0 || createResult.totalCreated !== children.length) {
    if (createResult.totalCreated > 0) {
      await deleteChildrenRange(
        runtime,
        normalizedDocumentId,
        target.parentBlockId,
        range.startIndex,
        range.startIndex + createResult.totalCreated,
        -1,
      );
    }
    throw new Error(
      `Create replacement blocks failed: created=${createResult.totalCreated}, expected=${children.length}, failedChunks=${createResult.failedChunks}.`,
    );
  }

  const insertedCount = createResult.totalCreated;
  const deletedCount = range.endIndex - range.startIndex;
  const deleteStart = range.startIndex + insertedCount;
  const deleteEnd = deleteStart + deletedCount;

  try {
    if (deletedCount > 0) {
      await deleteChildrenRange(
        runtime,
        normalizedDocumentId,
        target.parentBlockId,
        deleteStart,
        deleteEnd,
        -1,
      );
    }
  } catch (error) {
    await deleteChildrenRange(
      runtime,
      normalizedDocumentId,
      target.parentBlockId,
      range.startIndex,
      range.startIndex + insertedCount,
      -1,
    );
    throw new Error(
      `Delete old section content failed; rollback applied: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    sectionHeading: range.headingText,
    sectionOccurrence: target.sectionOccurrence,
    insertedCount,
    deletedCount,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    scannedChildrenCount: target.locateResult.scannedChildrenCount,
    scannedAllChildren: target.locateResult.scannedAllChildren,
    createdBlockIds: createResult.createdBlockIds,
    typeCounts,
  };
}

export async function replaceSectionWithOrderedListCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: ReplaceSectionWithOrderedListInput,
): Promise<ReplaceSectionWithOrderedListResult> {
  const items = input.items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new Error('items must include at least one non-empty string.');
  }

  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, input);
  const range = target.locateResult.range;
  const children = items.map((text) => buildOrderedBlock(text));
  const createResult = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    children,
    index: range.startIndex,
    chunkSize: 50,
    documentRevisionId: input.documentRevisionId,
    continueOnError: false,
  });

  if (createResult.failedChunks > 0 || createResult.totalCreated !== children.length) {
    if (createResult.totalCreated > 0) {
      await deleteChildrenRange(
        runtime,
        normalizedDocumentId,
        target.parentBlockId,
        range.startIndex,
        range.startIndex + createResult.totalCreated,
        -1,
      );
    }
    throw new Error(
      `Create ordered list failed: created=${createResult.totalCreated}, expected=${children.length}, failedChunks=${createResult.failedChunks}.`,
    );
  }

  const insertedCount = createResult.totalCreated;
  const deletedCount = range.endIndex - range.startIndex;
  const deleteStart = range.startIndex + insertedCount;
  const deleteEnd = deleteStart + deletedCount;

  try {
    if (deletedCount > 0) {
      await deleteChildrenRange(
        runtime,
        normalizedDocumentId,
        target.parentBlockId,
        deleteStart,
        deleteEnd,
        -1,
      );
    }
  } catch (error) {
    await deleteChildrenRange(
      runtime,
      normalizedDocumentId,
      target.parentBlockId,
      range.startIndex,
      range.startIndex + insertedCount,
      -1,
    );
    throw new Error(
      `Delete old section content failed; rollback applied: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    sectionHeading: range.headingText,
    sectionOccurrence: target.sectionOccurrence,
    insertedCount,
    deletedCount,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    createdBlockIds: createResult.createdBlockIds,
  };
}
