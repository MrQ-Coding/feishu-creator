import type { DocumentEditRuntime } from './context.js';
import {
  clampPageSize,
  normalizeHeadingPath,
  normalizeHeadingLevel,
  normalizeSectionOccurrence,
  normalizeOptionalNonNegativeInt,
} from './helpers.js';
import {
  batchCreateBlocksCore,
  deleteChildrenRange,
} from './blockMutations.js';
import {
  locateSectionRangeCached,
  resolveHeadingTarget,
} from './headingLocator.js';
import type {
  InsertBeforeHeadingInput,
  InsertBeforeHeadingResult,
  ReplaceSectionBlocksInput,
  ReplaceSectionBlocksResult,
  ReplaceSectionWithOrderedListInput,
  ReplaceSectionWithOrderedListResult,
  UpsertSectionInput,
  UpsertSectionResult,
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
  const { children, typeCounts } = runtime.notePlatformProvider.buildRichTextChildren(
    input.blocks,
    {
      normalizeHeadingLevel,
      normalizeCodeLanguage: (value) =>
        normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
    },
  );
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

  const { children, typeCounts } = runtime.notePlatformProvider.buildRichTextChildren(
    input.blocks,
    {
      normalizeHeadingLevel,
      normalizeCodeLanguage: (value) =>
        normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
    },
  );
  const createResult = await replaceSectionContent(
    runtime,
    normalizedDocumentId,
    target.parentBlockId,
    range.startIndex,
    range.endIndex,
    children,
    input,
  );

  return {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    sectionHeading: range.headingText,
    sectionOccurrence: target.sectionOccurrence,
    insertedCount: createResult.totalCreated,
    deletedCount: range.endIndex - range.startIndex,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    scannedChildrenCount: target.locateResult.scannedChildrenCount,
    scannedAllChildren: target.locateResult.scannedAllChildren,
    createdBlockIds: createResult.createdBlockIds,
    typeCounts,
  };
}

export async function upsertSectionCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: UpsertSectionInput,
): Promise<UpsertSectionResult> {
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    throw new Error('blocks must be a non-empty array.');
  }

  const parentBlockId = input.parentBlockId?.trim() || normalizedDocumentId;
  const sectionHeading = input.sectionHeading?.trim();
  const headingPath = normalizeHeadingPath(input.headingPath);
  if (!sectionHeading && headingPath.length === 0) {
    throw new Error('Either sectionHeading or headingPath is required.');
  }

  const sectionOccurrence = normalizeSectionOccurrence(input.sectionOccurrence);
  const pageSize = clampPageSize(input.pageSize);
  const locateResult = await locateSectionRangeCached(runtime, {
    documentId: normalizedDocumentId,
    parentBlockId,
    sectionHeading,
    headingPath,
    sectionOccurrence,
    pageSize,
  });

  const { children, typeCounts } = runtime.notePlatformProvider.buildRichTextChildren(
    input.blocks,
    {
      normalizeHeadingLevel,
      normalizeCodeLanguage: (value) =>
        normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
    },
  );

  if (locateResult) {
    const range = locateResult.range;
    const createResult = await replaceSectionContent(
      runtime,
      normalizedDocumentId,
      parentBlockId,
      range.startIndex,
      range.endIndex,
      children,
      input,
    );

    return {
      documentId: normalizedDocumentId,
      parentBlockId,
      mode: 'updated',
      sectionHeading: range.headingText,
      sectionOccurrence,
      insertedCount: createResult.totalCreated,
      deletedCount: range.endIndex - range.startIndex,
      insertIndex: range.startIndex,
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      scannedChildrenCount: locateResult.scannedChildrenCount,
      scannedAllChildren: locateResult.scannedAllChildren,
      createdBlockIds: createResult.createdBlockIds,
      typeCounts,
    };
  }

  const newSectionHeading = sectionHeading ?? headingPath[headingPath.length - 1];
  if (!newSectionHeading) {
    throw new Error('Unable to derive section heading for creation.');
  }

  const headingLevel = normalizeHeadingLevel(input.headingLevel);
  const siblings =
    runtime.documentBlockService.peekChildren(normalizedDocumentId, parentBlockId) ??
    (await runtime.documentBlockService.getAllChildren(
      normalizedDocumentId,
      parentBlockId,
      pageSize,
    ));
  const insertIndex = siblings.length;
  const createResult = await createNewSection(
    runtime,
    normalizedDocumentId,
    parentBlockId,
    insertIndex,
    newSectionHeading,
    headingLevel,
    children,
    input,
  );

  const [headingBlockId, ...contentBlockIds] = createResult.createdBlockIds;
  return {
    documentId: normalizedDocumentId,
    parentBlockId,
    mode: 'created',
    sectionHeading: newSectionHeading,
    sectionOccurrence,
    insertedCount: createResult.totalCreated,
    deletedCount: 0,
    insertIndex,
    startIndex: insertIndex + 1,
    endIndex: insertIndex + 1,
    scannedChildrenCount: siblings.length,
    scannedAllChildren: true,
    headingLevel,
    headingBlockId,
    createdBlockIds: contentBlockIds,
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
  const children = items.map((text) =>
    runtime.notePlatformProvider.buildOrderedBlock(text),
  );
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

async function replaceSectionContent(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  parentBlockId: string,
  startIndex: number,
  endIndex: number,
  children: Array<Record<string, unknown>>,
  input: {
    chunkSize?: number;
    minChunkSize?: number;
    adaptiveChunking?: boolean;
    resumeFromCreatedCount?: number;
    checkpointTokenSeed?: string;
    documentRevisionId?: number;
  },
) {
  const createResult = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId,
    children,
    index: startIndex,
    chunkSize: input.chunkSize,
    minChunkSize: input.minChunkSize,
    adaptiveChunking: input.adaptiveChunking,
    resumeFromCreatedCount: input.resumeFromCreatedCount,
    checkpointTokenSeed: input.checkpointTokenSeed,
    documentRevisionId: input.documentRevisionId,
    continueOnError: false,
  });

  await assertAtomicCreateResult(
    runtime,
    normalizedDocumentId,
    parentBlockId,
    startIndex,
    children.length,
    createResult,
    'Create replacement blocks failed',
  );

  const insertedCount = createResult.totalCreated;
  const deletedCount = endIndex - startIndex;
  const deleteStart = startIndex + insertedCount;
  const deleteEnd = deleteStart + deletedCount;

  try {
    if (deletedCount > 0) {
      await deleteChildrenRange(
        runtime,
        normalizedDocumentId,
        parentBlockId,
        deleteStart,
        deleteEnd,
        -1,
      );
    }
  } catch (error) {
    await deleteChildrenRange(
      runtime,
      normalizedDocumentId,
      parentBlockId,
      startIndex,
      startIndex + insertedCount,
      -1,
    );
    throw new Error(
      `Delete old section content failed; rollback applied: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return createResult;
}

async function createNewSection(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  parentBlockId: string,
  insertIndex: number,
  sectionHeading: string,
  headingLevel: number,
  contentChildren: Array<Record<string, unknown>>,
  input: {
    chunkSize?: number;
    minChunkSize?: number;
    adaptiveChunking?: boolean;
    resumeFromCreatedCount?: number;
    checkpointTokenSeed?: string;
    documentRevisionId?: number;
  },
) {
  const children = [
    runtime.notePlatformProvider.buildHeadingBlock(headingLevel, sectionHeading),
    ...contentChildren,
  ];
  const createResult = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId,
    children,
    index: insertIndex,
    chunkSize: input.chunkSize,
    minChunkSize: input.minChunkSize,
    adaptiveChunking: input.adaptiveChunking,
    resumeFromCreatedCount: input.resumeFromCreatedCount,
    checkpointTokenSeed: input.checkpointTokenSeed,
    documentRevisionId: input.documentRevisionId,
    continueOnError: false,
  });

  await assertAtomicCreateResult(
    runtime,
    normalizedDocumentId,
    parentBlockId,
    insertIndex,
    children.length,
    createResult,
    'Create new section failed',
  );

  return createResult;
}

async function assertAtomicCreateResult(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  parentBlockId: string,
  insertIndex: number,
  expectedCount: number,
  createResult: {
    failedChunks: number;
    totalCreated: number;
    createdBlockIds: string[];
  },
  errorPrefix: string,
): Promise<void> {
  if (createResult.failedChunks <= 0 && createResult.totalCreated === expectedCount) {
    return;
  }

  if (createResult.totalCreated > 0) {
    await deleteChildrenRange(
      runtime,
      normalizedDocumentId,
      parentBlockId,
      insertIndex,
      insertIndex + createResult.totalCreated,
      -1,
    );
  }

  throw new Error(
    `${errorPrefix}: created=${createResult.totalCreated}, expected=${expectedCount}, failedChunks=${createResult.failedChunks}.`,
  );
}
