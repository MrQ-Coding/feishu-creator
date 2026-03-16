import type { DocumentEditRuntime } from './context.js';
import { batchCreateBlocksCore, deleteChildrenRange } from './blockMutations.js';
import {
  clampPageSize,
  normalizeHeadingPath,
  normalizeOptionalIndex,
} from './helpers.js';
import { resolveHeadingTarget } from './headingLocator.js';
import { uploadImageBytesCore } from './imageUploads.js';
import type {
  CopySectionInput,
  CopySectionResult,
  MoveSectionInput,
  MoveSectionResult,
  SectionCopyTargetInput,
} from './types.js';

export interface ResolvedSourceSection {
  sourceDocumentId: string;
  sourceParentBlockId: string;
  sourceSectionHeading: string;
  sourceSectionOccurrence: number;
  sourceStartIndex: number;
  sourceEndIndex: number;
  sourceHeadingIndex: number;
  siblingCount: number;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
  blocks: Array<Record<string, unknown>>;
}

export interface ResolvedTargetInsertion {
  targetDocumentId: string;
  targetParentBlockId: string;
  targetAnchorHeading?: string;
  insertIndex: number;
  mode: 'before_heading' | 'explicit_index' | 'append';
}

interface CopyTreeResult {
  createdBlockIds: string[];
  copiedBlockCount: number;
}

interface CreatedTopLevelBlocksResult {
  createdBlockIds: string[];
  totalCreated: number;
}

export async function copySectionCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: CopySectionInput,
): Promise<CopySectionResult> {
  const source = await resolveSourceSection(runtime, normalizedDocumentId, input);
  const target = await resolveTargetInsertion(runtime, normalizedDocumentId, input);

  const copyResult = await copySectionBlocks(runtime, source, target, input);
  return {
    sourceDocumentId: source.sourceDocumentId,
    sourceParentBlockId: source.sourceParentBlockId,
    sourceSectionHeading: source.sourceSectionHeading,
    sourceSectionOccurrence: source.sourceSectionOccurrence,
    sourceStartIndex: source.sourceStartIndex,
    sourceEndIndex: source.sourceEndIndex,
    targetDocumentId: target.targetDocumentId,
    targetParentBlockId: target.targetParentBlockId,
    targetAnchorHeading: target.targetAnchorHeading,
    insertIndex: target.insertIndex,
    topLevelBlockCount: source.blocks.length,
    copiedBlockCount: copyResult.copiedBlockCount,
    createdBlockIds: copyResult.createdBlockIds,
  };
}

export async function moveSectionCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: MoveSectionInput,
): Promise<MoveSectionResult> {
  const source = await resolveSourceSection(runtime, normalizedDocumentId, input);
  const target = await resolveTargetInsertion(runtime, normalizedDocumentId, input);

  validateMoveTarget(source, target);

  const copyResult = await copySectionBlocks(runtime, source, target, input);
  const deleteRange = computeMoveDeleteRange(source, target);

  try {
    await deleteChildrenRange(
      runtime,
      source.sourceDocumentId,
      source.sourceParentBlockId,
      deleteRange.startIndex,
      deleteRange.endIndex,
      -1,
    );
  } catch (error) {
    await rollbackCopiedSection(runtime, target, source.blocks.length);
    throw new Error(
      `Delete source section failed; rollback applied: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    sourceDocumentId: source.sourceDocumentId,
    sourceParentBlockId: source.sourceParentBlockId,
    sourceSectionHeading: source.sourceSectionHeading,
    sourceSectionOccurrence: source.sourceSectionOccurrence,
    sourceStartIndex: source.sourceStartIndex,
    sourceEndIndex: source.sourceEndIndex,
    targetDocumentId: target.targetDocumentId,
    targetParentBlockId: target.targetParentBlockId,
    targetAnchorHeading: target.targetAnchorHeading,
    insertIndex: target.insertIndex,
    topLevelBlockCount: source.blocks.length,
    copiedBlockCount: copyResult.copiedBlockCount,
    createdBlockIds: copyResult.createdBlockIds,
    deletedCount: source.blocks.length,
  };
}

export async function resolveSourceSection(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: CopySectionInput,
): Promise<ResolvedSourceSection> {
  const sourceTarget = await resolveHeadingTarget(runtime, normalizedDocumentId, input);
  const siblings =
    sourceTarget.locateResult.siblings ??
    (await runtime.documentBlockService.getAllChildren(
      normalizedDocumentId,
      sourceTarget.parentBlockId,
      clampPageSize(input.pageSize),
    ));

  const sourceHeadingIndex = Math.max(0, sourceTarget.locateResult.range.startIndex - 1);
  const blocks = siblings.slice(sourceHeadingIndex, sourceTarget.locateResult.range.endIndex);
  if (blocks.length === 0) {
    throw new Error('Resolved section is empty; cannot copy or move.');
  }

  return {
    sourceDocumentId: normalizedDocumentId,
    sourceParentBlockId: sourceTarget.parentBlockId,
    sourceSectionHeading: sourceTarget.locateResult.range.headingText,
    sourceSectionOccurrence: sourceTarget.sectionOccurrence,
    sourceStartIndex: sourceTarget.locateResult.range.startIndex,
    sourceEndIndex: sourceTarget.locateResult.range.endIndex,
    sourceHeadingIndex,
    siblingCount: siblings.length,
    scannedChildrenCount: sourceTarget.locateResult.scannedChildrenCount,
    scannedAllChildren: sourceTarget.locateResult.scannedAllChildren,
    blocks,
  };
}

export async function resolveTargetInsertion(
  runtime: DocumentEditRuntime,
  defaultDocumentId: string,
  input: SectionCopyTargetInput,
): Promise<ResolvedTargetInsertion> {
  const targetDocumentId = runtime.notePlatformProvider.extractDocumentId(
    input.targetDocumentId ?? defaultDocumentId,
  );
  if (!targetDocumentId) {
    throw new Error('Invalid targetDocumentId or target document URL.');
  }

  const targetParentBlockId = input.targetParentBlockId?.trim() || targetDocumentId;
  const targetIndex = normalizeOptionalIndex(input.targetIndex);
  const targetSectionHeading = input.targetSectionHeading?.trim();
  const targetHeadingPath = normalizeHeadingPath(input.targetHeadingPath);
  const hasTargetHeading = Boolean(targetSectionHeading) || targetHeadingPath.length > 0;

  if (targetIndex !== undefined && hasTargetHeading) {
    throw new Error(
      'targetIndex cannot be combined with targetSectionHeading or targetHeadingPath.',
    );
  }

  if (hasTargetHeading) {
    const target = await resolveHeadingTarget(runtime, targetDocumentId, {
      parentBlockId: targetParentBlockId,
      sectionHeading: targetSectionHeading,
      headingPath: targetHeadingPath,
      sectionOccurrence: input.targetSectionOccurrence,
      pageSize: input.targetPageSize,
    });
    return {
      targetDocumentId,
      targetParentBlockId,
      targetAnchorHeading: target.locateResult.range.headingText,
      insertIndex: Math.max(0, target.locateResult.range.startIndex - 1),
      mode: 'before_heading',
    };
  }

  if (targetIndex !== undefined) {
    return {
      targetDocumentId,
      targetParentBlockId,
      insertIndex: targetIndex,
      mode: 'explicit_index',
    };
  }

  const siblings = await runtime.documentBlockService.getAllChildren(
    targetDocumentId,
    targetParentBlockId,
    clampPageSize(input.targetPageSize),
  );
  return {
    targetDocumentId,
    targetParentBlockId,
    insertIndex: siblings.length,
    mode: 'append',
  };
}

export function validateMoveTarget(
  source: ResolvedSourceSection,
  target: ResolvedTargetInsertion,
): void {
  if (
    source.sourceDocumentId !== target.targetDocumentId ||
    source.sourceParentBlockId !== target.targetParentBlockId
  ) {
    return;
  }

  if (
    target.insertIndex >= source.sourceHeadingIndex &&
    target.insertIndex <= source.sourceEndIndex
  ) {
    throw new Error(
      'Move target resolves inside the source section or at its current boundary. Choose a different destination.',
    );
  }

  const finalInsertIndex =
    target.insertIndex < source.sourceHeadingIndex
      ? target.insertIndex
      : target.insertIndex - source.blocks.length;
  if (finalInsertIndex === source.sourceHeadingIndex) {
    throw new Error('Section is already at the requested destination.');
  }

  if (
    target.insertIndex === source.siblingCount &&
    source.sourceEndIndex === source.siblingCount
  ) {
    throw new Error('Section is already at the end of the target parent block.');
  }
}

export function computeMoveDeleteRange(
  source: ResolvedSourceSection,
  target: ResolvedTargetInsertion,
): { startIndex: number; endIndex: number } {
  if (
    source.sourceDocumentId === target.targetDocumentId &&
    source.sourceParentBlockId === target.targetParentBlockId &&
    target.insertIndex <= source.sourceHeadingIndex
  ) {
    return {
      startIndex: source.sourceHeadingIndex + source.blocks.length,
      endIndex: source.sourceEndIndex + source.blocks.length,
    };
  }

  return {
    startIndex: source.sourceHeadingIndex,
    endIndex: source.sourceEndIndex,
  };
}

async function copySectionBlocks(
  runtime: DocumentEditRuntime,
  source: ResolvedSourceSection,
  target: ResolvedTargetInsertion,
  input: SectionCopyTargetInput,
): Promise<CopyTreeResult> {
  for (const block of source.blocks) {
    const blockType = runtime.notePlatformProvider.extractBlockType(block);
    if (blockType === undefined) {
      throw new Error('Source block is missing block_type.');
    }
  }

  return copyBlockCollection(runtime, {
    sourceDocumentId: source.sourceDocumentId,
    sourceBlocks: source.blocks,
    targetDocumentId: target.targetDocumentId,
    targetParentBlockId: target.targetParentBlockId,
    insertIndex: target.insertIndex,
    chunkSize: input.chunkSize,
    minChunkSize: input.minChunkSize,
    adaptiveChunking: input.adaptiveChunking,
    targetDocumentRevisionId: input.targetDocumentRevisionId,
  });
}

async function rollbackCopiedSection(
  runtime: DocumentEditRuntime,
  target: ResolvedTargetInsertion,
  topLevelBlockCount: number,
): Promise<void> {
  if (topLevelBlockCount <= 0) return;
  try {
    await deleteChildrenRange(
      runtime,
      target.targetDocumentId,
      target.targetParentBlockId,
      target.insertIndex,
      target.insertIndex + topLevelBlockCount,
      -1,
    );
  } catch {
    // Best-effort rollback: keep the original error if cleanup also fails.
  }
}

async function copyBlockCollection(
  runtime: DocumentEditRuntime,
  input: {
    sourceDocumentId: string;
    sourceBlocks: Array<Record<string, unknown>>;
    targetDocumentId: string;
    targetParentBlockId: string;
    insertIndex?: number;
    chunkSize?: number;
    minChunkSize?: number;
    adaptiveChunking?: boolean;
    targetDocumentRevisionId?: number;
  },
): Promise<CopyTreeResult> {
  if (input.sourceBlocks.length === 0) {
    return {
      createdBlockIds: [],
      copiedBlockCount: 0,
    };
  }

  let resolvedInsertIndex = input.insertIndex;
  if (resolvedInsertIndex === undefined) {
    const siblings = await runtime.documentBlockService.getAllChildren(
      input.targetDocumentId,
      input.targetParentBlockId,
      200,
    );
    resolvedInsertIndex = siblings.length;
  }

  const topLevelCreateResult = await createCopiedTopLevelBlocks(runtime, {
    sourceDocumentId: input.sourceDocumentId,
    sourceBlocks: input.sourceBlocks,
    targetDocumentId: input.targetDocumentId,
    targetParentBlockId: input.targetParentBlockId,
    insertIndex: resolvedInsertIndex,
    chunkSize: input.chunkSize,
    minChunkSize: input.minChunkSize,
    adaptiveChunking: input.adaptiveChunking,
    targetDocumentRevisionId: input.targetDocumentRevisionId,
  });

  try {
    const currentChildren = await runtime.documentBlockService.getAllChildren(
      input.targetDocumentId,
      input.targetParentBlockId,
      200,
    );
    const createdBlocks = currentChildren.slice(
      resolvedInsertIndex,
      resolvedInsertIndex + input.sourceBlocks.length,
    );
    if (createdBlocks.length !== input.sourceBlocks.length) {
      throw new Error(
        `Created block lookup mismatch: expected=${input.sourceBlocks.length}, actual=${createdBlocks.length}.`,
      );
    }

    const createdBlockIds = [...topLevelCreateResult.createdBlockIds];
    let copiedBlockCount = topLevelCreateResult.totalCreated;

    for (const [index, sourceBlock] of input.sourceBlocks.entries()) {
      if (runtime.notePlatformProvider.extractChildIds(sourceBlock).length === 0) continue;
      const sourceBlockId = requireBlockId(runtime, sourceBlock);
      const targetBlockId = requireBlockId(runtime, createdBlocks[index]);
      const sourceChildren = await runtime.documentBlockService.getAllChildren(
        input.sourceDocumentId,
        sourceBlockId,
        200,
      );
      if (sourceChildren.length === 0) continue;

      const childResult = await copyBlockCollection(runtime, {
        sourceDocumentId: input.sourceDocumentId,
        sourceBlocks: sourceChildren,
        targetDocumentId: input.targetDocumentId,
        targetParentBlockId: targetBlockId,
        chunkSize: input.chunkSize,
        minChunkSize: input.minChunkSize,
        adaptiveChunking: input.adaptiveChunking,
        targetDocumentRevisionId: input.targetDocumentRevisionId,
      });
      createdBlockIds.push(...childResult.createdBlockIds);
      copiedBlockCount += childResult.copiedBlockCount;
    }

    return {
      createdBlockIds,
      copiedBlockCount,
    };
  } catch (error) {
    await deleteChildrenRange(
      runtime,
      input.targetDocumentId,
      input.targetParentBlockId,
      resolvedInsertIndex,
      resolvedInsertIndex + input.sourceBlocks.length,
      -1,
    );
    throw error;
  }
}

async function createCopiedTopLevelBlocks(
  runtime: DocumentEditRuntime,
  input: {
    sourceDocumentId: string;
    sourceBlocks: Array<Record<string, unknown>>;
    targetDocumentId: string;
    targetParentBlockId: string;
    insertIndex: number;
    chunkSize?: number;
    minChunkSize?: number;
    adaptiveChunking?: boolean;
    targetDocumentRevisionId?: number;
  },
): Promise<CreatedTopLevelBlocksResult> {
  const createdBlockIds: string[] = [];
  let totalCreated = 0;
  let nextInsertIndex = input.insertIndex;
  let pendingSourceBlocks: Array<Record<string, unknown>> = [];
  let pendingChildren: Array<Record<string, unknown>> = [];

  const flushPendingRun = async () => {
    if (pendingChildren.length === 0) {
      return;
    }

    const result = await createRawCopiedBlockRun(runtime, {
      sourceBlocks: pendingSourceBlocks,
      children: pendingChildren,
      targetDocumentId: input.targetDocumentId,
      targetParentBlockId: input.targetParentBlockId,
      insertIndex: nextInsertIndex,
      chunkSize: input.chunkSize,
      minChunkSize: input.minChunkSize,
      adaptiveChunking: input.adaptiveChunking,
      targetDocumentRevisionId: input.targetDocumentRevisionId,
    });
    createdBlockIds.push(...result.createdBlockIds);
    totalCreated += result.totalCreated;
    nextInsertIndex += result.totalCreated;
    pendingSourceBlocks = [];
    pendingChildren = [];
  };

  try {
    for (const block of input.sourceBlocks) {
      if (runtime.notePlatformProvider.extractBlockKind(block) === 'image') {
        await flushPendingRun();
        const imageResult = await copyImageBlock(runtime, {
          sourceBlock: block,
          targetDocumentId: input.targetDocumentId,
          targetParentBlockId: input.targetParentBlockId,
          insertIndex: nextInsertIndex,
          targetDocumentRevisionId: input.targetDocumentRevisionId,
        });
        createdBlockIds.push(imageResult.imageBlockId);
        totalCreated += 1;
        nextInsertIndex += 1;
        continue;
      }
      pendingSourceBlocks.push(block);
      pendingChildren.push(runtime.notePlatformProvider.sanitizeBlockForCopy(block));
    }

    await flushPendingRun();
    return {
      createdBlockIds,
      totalCreated,
    };
  } catch (error) {
    if (totalCreated > 0) {
      await deleteChildrenRange(
        runtime,
        input.targetDocumentId,
        input.targetParentBlockId,
        input.insertIndex,
        input.insertIndex + totalCreated,
        -1,
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function createRawCopiedBlockRun(
  runtime: DocumentEditRuntime,
  input: {
    sourceBlocks: Array<Record<string, unknown>>;
    children: Array<Record<string, unknown>>;
    targetDocumentId: string;
    targetParentBlockId: string;
    insertIndex: number;
    chunkSize?: number;
    minChunkSize?: number;
    adaptiveChunking?: boolean;
    targetDocumentRevisionId?: number;
  },
): Promise<CreatedTopLevelBlocksResult> {
  const createResult = await batchCreateBlocksCore(
    runtime,
    input.targetDocumentId,
    {
      documentId: input.targetDocumentId,
      parentBlockId: input.targetParentBlockId,
      children: input.children,
      index: input.insertIndex,
      chunkSize: input.chunkSize,
      minChunkSize: input.minChunkSize,
      adaptiveChunking: input.adaptiveChunking,
      documentRevisionId: input.targetDocumentRevisionId,
      continueOnError: false,
    },
  );

  if (
    createResult.failedChunks > 0 ||
    createResult.totalCreated !== input.sourceBlocks.length
  ) {
    throw new Error(
      `Create copied blocks failed: created=${createResult.totalCreated}, expected=${input.sourceBlocks.length}, failedChunks=${createResult.failedChunks}, sourceBlocks=${summarizeSourceBlocksForError(runtime, input.sourceBlocks)}.`,
    );
  }

  return {
    createdBlockIds: createResult.createdBlockIds,
    totalCreated: createResult.totalCreated,
  };
}

async function copyImageBlock(
  runtime: DocumentEditRuntime,
  input: {
    sourceBlock: Record<string, unknown>;
    targetDocumentId: string;
    targetParentBlockId: string;
    insertIndex: number;
    targetDocumentRevisionId?: number;
  },
): Promise<{ imageBlockId: string }> {
  const sourceImage = runtime.notePlatformProvider.extractImageBlockData(input.sourceBlock);
  const sourceBlockId = requireBlockId(runtime, input.sourceBlock);
  const downloadResult = await runtime.notePlatformMediaGateway.downloadMediaByToken(
    sourceImage.token,
  );
  const fileName = resolveDownloadedImageFileName(downloadResult, sourceImage.token);
  const mimeType =
    normalizeDownloadedMimeType(downloadResult.contentType) ??
    inferMimeTypeFromFileName(fileName) ??
    'image/png';

  try {
    const uploadResult = await uploadImageBytesCore(runtime, input.targetDocumentId, {
      imageBytes: downloadResult.body,
      fileName,
      mimeType,
      parentBlockId: input.targetParentBlockId,
      index: input.insertIndex,
      width: sourceImage.width,
      height: sourceImage.height,
      documentRevisionId: input.targetDocumentRevisionId,
    });
    return { imageBlockId: uploadResult.imageBlockId };
  } catch (error) {
    throw new Error(
      `Image reconstruction failed for source block ${sourceBlockId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function summarizeSourceBlocksForError(
  runtime: DocumentEditRuntime,
  blocks: Array<Record<string, unknown>>,
): string {
  const preview = blocks
    .slice(0, 5)
    .map((block) => describeSourceBlock(runtime, block))
    .join(', ');
  return blocks.length > 5 ? `${preview}, ... total=${blocks.length}` : preview;
}

function describeSourceBlock(
  runtime: DocumentEditRuntime,
  block: Record<string, unknown>,
): string {
  const blockId = runtime.notePlatformProvider.extractBlockId(block) ?? '<no-block-id>';
  const blockType = runtime.notePlatformProvider.extractBlockType(block);
  return `${blockId}:${blockType ?? 'unknown'}`;
}

function resolveDownloadedImageFileName(
  response: { contentDisposition?: string; contentType?: string },
  sourceToken: string,
): string {
  const parsed = parseFileNameFromContentDisposition(response.contentDisposition);
  if (parsed) {
    return parsed;
  }
  const ext = inferImageExtensionFromContentType(response.contentType) ?? '.png';
  return `feishu-image-${sourceToken}${ext}`;
}

function parseFileNameFromContentDisposition(
  contentDisposition: string | undefined,
): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }
  const utf8Match = contentDisposition.match(/filename\\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim()).replaceAll('/', '_');
  }
  const simpleMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (simpleMatch?.[1]) {
    return simpleMatch[1].trim().replaceAll('/', '_');
  }
  return undefined;
}

function normalizeDownloadedMimeType(contentType: string | undefined): string | undefined {
  const normalized = contentType?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const [typeOnly] = normalized.split(';', 1);
  return typeOnly || undefined;
}

function inferMimeTypeFromFileName(fileName: string): string | undefined {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.bmp')) return 'image/bmp';
  return undefined;
}

function inferImageExtensionFromContentType(contentType: string | undefined): string | undefined {
  const normalized = normalizeDownloadedMimeType(contentType);
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/jpeg') return '.jpg';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'image/bmp') return '.bmp';
  return undefined;
}

function requireBlockId(
  runtime: DocumentEditRuntime,
  block: Record<string, unknown>,
): string {
  const blockId = runtime.notePlatformProvider.extractBlockId(block);
  if (blockId) {
    return blockId;
  }
  throw new Error('Block is missing block_id.');
}
