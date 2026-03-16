import type { DocumentEditRuntime } from './context.js';
import { resolveHeadingTarget } from './headingLocator.js';
import {
  clampPageSize,
  normalizeHeadingLevel,
  normalizeOptionalNonNegativeInt,
  normalizeTextItems,
} from './helpers.js';
import type { RichTextBlockSpec } from './richTextBlocks.js';
import {
  computeMoveDeleteRange,
  resolveSourceSection,
  resolveTargetInsertion,
  validateMoveTarget,
} from './sectionTransfers.js';
import type {
  DeleteByHeadingInput,
  InsertBeforeHeadingInput,
  PreviewBlockSummary,
  PreviewCreateBlockSummary,
  PreviewDeletePlan,
  PreviewEditPlanInput,
  PreviewEditPlanResult,
  PreviewInsertionTarget,
  PreviewLocateTarget,
  ReplaceSectionBlocksInput,
  ReplaceSectionWithOrderedListInput,
} from './types.js';

export async function previewEditPlanCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: PreviewEditPlanInput,
): Promise<PreviewEditPlanResult> {
  switch (input.operation) {
    case 'insert_before_heading':
      return previewInsertBeforeHeading(runtime, normalizedDocumentId, input);
    case 'replace_section_blocks':
      return previewReplaceSectionBlocks(runtime, normalizedDocumentId, input);
    case 'replace_section_with_ordered_list':
      return previewReplaceSectionWithOrderedList(runtime, normalizedDocumentId, input);
    case 'delete_by_heading':
      return previewDeleteByHeading(runtime, normalizedDocumentId, input);
    case 'copy_section':
      return previewCopySection(runtime, normalizedDocumentId, input);
    case 'move_section':
      return previewMoveSection(runtime, normalizedDocumentId, input);
    default:
      throw new Error(`Unsupported operation for preview_edit_plan: ${String(input.operation)}.`);
  }
}

async function previewInsertBeforeHeading(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: PreviewEditPlanInput,
): Promise<PreviewEditPlanResult> {
  const typedInput = input as PreviewEditPlanInput & InsertBeforeHeadingInput;
  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, typedInput);
  const { children, typeCounts } = runtime.notePlatformProvider.buildRichTextChildren(
    typedInput.blocks ?? [],
    {
      normalizeHeadingLevel,
      normalizeCodeLanguage: (value) =>
        normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
    },
  );
  const insertIndex = Math.max(0, target.locateResult.range.startIndex - 1);

  return {
    dryRun: true,
    operation: input.operation,
    summary: `Will insert ${children.length} block(s) before heading "${target.locateResult.range.headingText}".`,
    target: buildLocatePreview(normalizedDocumentId, target),
    createPlan: {
      documentId: normalizedDocumentId,
      parentBlockId: target.parentBlockId,
      insertIndex,
      blockCount: children.length,
      typeCounts,
      blocks: summarizeRichTextSpecs(typedInput.blocks ?? []),
    },
    warnings: [],
  };
}

async function previewReplaceSectionBlocks(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: PreviewEditPlanInput,
): Promise<PreviewEditPlanResult> {
  const typedInput = input as PreviewEditPlanInput & ReplaceSectionBlocksInput;
  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, typedInput);
  const { children, typeCounts } = runtime.notePlatformProvider.buildRichTextChildren(
    typedInput.blocks ?? [],
    {
      normalizeHeadingLevel,
      normalizeCodeLanguage: (value) =>
        normalizeOptionalNonNegativeInt(value, 'codeLanguage'),
    },
  );
  const siblings = await getSiblings(runtime, normalizedDocumentId, target.parentBlockId, typedInput.pageSize, target.locateResult.siblings);
  const range = target.locateResult.range;
  const currentBlocks = summarizeExistingBlocks(
    runtime,
    siblings,
    range.startIndex,
    range.endIndex,
  );

  return {
    dryRun: true,
    operation: input.operation,
    summary: `Will replace ${currentBlocks.length} existing block(s) under heading "${range.headingText}" with ${children.length} new block(s).`,
    target: buildLocatePreview(normalizedDocumentId, target),
    createPlan: {
      documentId: normalizedDocumentId,
      parentBlockId: target.parentBlockId,
      insertIndex: range.startIndex,
      blockCount: children.length,
      typeCounts,
      blocks: summarizeRichTextSpecs(typedInput.blocks ?? []),
    },
    deletePlan: {
      documentId: normalizedDocumentId,
      parentBlockId: target.parentBlockId,
      startIndex: range.startIndex + children.length,
      endIndex: range.startIndex + children.length + currentBlocks.length,
      deletedCount: currentBlocks.length,
      currentRangeStartIndex: range.startIndex,
      currentRangeEndIndex: range.endIndex,
      blocks: currentBlocks,
      note:
        currentBlocks.length > 0
          ? 'Delete happens after the replacement blocks are inserted, so the live delete indices shift by the number of newly created blocks.'
          : 'The target section is currently empty; no existing content would be deleted.',
    },
    warnings: [],
  };
}

async function previewReplaceSectionWithOrderedList(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: PreviewEditPlanInput,
): Promise<PreviewEditPlanResult> {
  const typedInput = input as PreviewEditPlanInput & ReplaceSectionWithOrderedListInput;
  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, typedInput);
  const items = normalizeTextItems(typedInput.items);
  if (items.length === 0) {
    throw new Error('items must include at least one non-empty string.');
  }

  const siblings = await getSiblings(runtime, normalizedDocumentId, target.parentBlockId, typedInput.pageSize, target.locateResult.siblings);
  const range = target.locateResult.range;
  const currentBlocks = summarizeExistingBlocks(
    runtime,
    siblings,
    range.startIndex,
    range.endIndex,
  );

  return {
    dryRun: true,
    operation: input.operation,
    summary: `Will replace ${currentBlocks.length} existing block(s) under heading "${range.headingText}" with ${items.length} ordered list item(s).`,
    target: buildLocatePreview(normalizedDocumentId, target),
    createPlan: {
      documentId: normalizedDocumentId,
      parentBlockId: target.parentBlockId,
      insertIndex: range.startIndex,
      blockCount: items.length,
      typeCounts: { ordered: items.length },
      blocks: items.map((item, index) => summarizePlannedBlock(index, { type: 'ordered', text: item })),
    },
    deletePlan: {
      documentId: normalizedDocumentId,
      parentBlockId: target.parentBlockId,
      startIndex: range.startIndex + items.length,
      endIndex: range.startIndex + items.length + currentBlocks.length,
      deletedCount: currentBlocks.length,
      currentRangeStartIndex: range.startIndex,
      currentRangeEndIndex: range.endIndex,
      blocks: currentBlocks,
      note:
        currentBlocks.length > 0
          ? 'Delete happens after the ordered list items are inserted, so the live delete indices shift by the inserted item count.'
          : 'The target section is currently empty; no existing content would be deleted.',
    },
    warnings: [],
  };
}

async function previewDeleteByHeading(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: PreviewEditPlanInput,
): Promise<PreviewEditPlanResult> {
  const typedInput = input as PreviewEditPlanInput & DeleteByHeadingInput;
  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, typedInput);
  const siblings = await getSiblings(runtime, normalizedDocumentId, target.parentBlockId, typedInput.pageSize, target.locateResult.siblings);
  const range = target.locateResult.range;
  const includeHeading = Boolean(typedInput.includeHeading);
  const startIndex = includeHeading ? Math.max(0, range.startIndex - 1) : range.startIndex;
  const endIndex = range.endIndex;
  const blocks = summarizeExistingBlocks(runtime, siblings, startIndex, endIndex);

  return {
    dryRun: true,
    operation: input.operation,
    summary: includeHeading
      ? `Will delete heading "${range.headingText}" and ${Math.max(0, blocks.length - 1)} block(s) under it.`
      : `Will delete ${blocks.length} block(s) under heading "${range.headingText}" and keep the heading itself.`,
    target: buildLocatePreview(normalizedDocumentId, target),
    deletePlan: {
      documentId: normalizedDocumentId,
      parentBlockId: target.parentBlockId,
      startIndex,
      endIndex,
      deletedCount: blocks.length,
      includeHeading,
      blocks,
    },
    warnings: [],
  };
}

async function previewCopySection(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: PreviewEditPlanInput,
): Promise<PreviewEditPlanResult> {
  const source = await resolveSourceSection(runtime, normalizedDocumentId, input);
  const target = await resolveTargetInsertion(runtime, normalizedDocumentId, input);
  const estimatedCopiedBlockCount = await estimateBlockTreeSize(
    runtime,
    source.sourceDocumentId,
    source.blocks,
  );
  const sourceBlocks = summarizeExistingBlocks(
    runtime,
    source.blocks,
    0,
    source.blocks.length,
    source.sourceHeadingIndex,
  );

  return {
    dryRun: true,
    operation: input.operation,
    summary: `Will copy section "${source.sourceSectionHeading}" into document ${target.targetDocumentId} at index ${target.insertIndex}.`,
    source: buildSourcePreview(source),
    target: buildInsertionPreview(target),
    createPlan: {
      documentId: target.targetDocumentId,
      parentBlockId: target.targetParentBlockId,
      insertIndex: target.insertIndex,
      blockCount: source.blocks.length,
      topLevelBlockCount: source.blocks.length,
      estimatedCopiedBlockCount,
      blocks: sourceBlocks.map((block, position) => ({
        position,
        blockType: existingBlockTypeToCreateType(block.blockType),
        textPreview: block.textPreview,
      })),
    },
    warnings: buildCopyWarnings(
      runtime,
      source.blocks,
      source.blocks.length,
      estimatedCopiedBlockCount,
    ),
  };
}

async function previewMoveSection(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: PreviewEditPlanInput,
): Promise<PreviewEditPlanResult> {
  const source = await resolveSourceSection(runtime, normalizedDocumentId, input);
  const target = await resolveTargetInsertion(runtime, normalizedDocumentId, input);
  validateMoveTarget(source, target);
  const estimatedCopiedBlockCount = await estimateBlockTreeSize(
    runtime,
    source.sourceDocumentId,
    source.blocks,
  );
  const sourceBlocks = summarizeExistingBlocks(
    runtime,
    source.blocks,
    0,
    source.blocks.length,
    source.sourceHeadingIndex,
  );
  const deleteRange = computeMoveDeleteRange(source, target);

  return {
    dryRun: true,
    operation: input.operation,
    summary: `Will move section "${source.sourceSectionHeading}" into document ${target.targetDocumentId} at index ${target.insertIndex}, then delete the original section.`,
    source: buildSourcePreview(source),
    target: buildInsertionPreview(target),
    createPlan: {
      documentId: target.targetDocumentId,
      parentBlockId: target.targetParentBlockId,
      insertIndex: target.insertIndex,
      blockCount: source.blocks.length,
      topLevelBlockCount: source.blocks.length,
      estimatedCopiedBlockCount,
      blocks: sourceBlocks.map((block, position) => ({
        position,
        blockType: existingBlockTypeToCreateType(block.blockType),
        textPreview: block.textPreview,
      })),
    },
    deletePlan: {
      documentId: source.sourceDocumentId,
      parentBlockId: source.sourceParentBlockId,
      startIndex: deleteRange.startIndex,
      endIndex: deleteRange.endIndex,
      deletedCount: source.blocks.length,
      currentRangeStartIndex: source.sourceHeadingIndex,
      currentRangeEndIndex: source.sourceEndIndex,
      blocks: sourceBlocks,
      note:
        deleteRange.startIndex === source.sourceHeadingIndex
          ? 'The original section is deleted in place after the copy succeeds.'
          : 'Because the section is inserted before its current position in the same parent, the live delete indices shift forward after insertion.',
    },
    warnings: buildCopyWarnings(
      runtime,
      source.blocks,
      source.blocks.length,
      estimatedCopiedBlockCount,
    ),
  };
}

function buildLocatePreview(
  documentId: string,
  target: Awaited<ReturnType<typeof resolveHeadingTarget>>,
): PreviewLocateTarget {
  return {
    documentId,
    parentBlockId: target.parentBlockId,
    sectionHeading: target.locateResult.range.headingText,
    sectionOccurrence: target.sectionOccurrence,
    headingIndex: Math.max(0, target.locateResult.range.startIndex - 1),
    startIndex: target.locateResult.range.startIndex,
    endIndex: target.locateResult.range.endIndex,
    scannedChildrenCount: target.locateResult.scannedChildrenCount,
    scannedAllChildren: target.locateResult.scannedAllChildren,
  };
}

function buildSourcePreview(
  source: Awaited<ReturnType<typeof resolveSourceSection>>,
): PreviewLocateTarget {
  return {
    documentId: source.sourceDocumentId,
    parentBlockId: source.sourceParentBlockId,
    sectionHeading: source.sourceSectionHeading,
    sectionOccurrence: source.sourceSectionOccurrence,
    headingIndex: source.sourceHeadingIndex,
    startIndex: source.sourceStartIndex,
    endIndex: source.sourceEndIndex,
    scannedChildrenCount: source.scannedChildrenCount,
    scannedAllChildren: source.scannedAllChildren,
  };
}

function buildInsertionPreview(
  target: Awaited<ReturnType<typeof resolveTargetInsertion>>,
): PreviewInsertionTarget {
  return {
    documentId: target.targetDocumentId,
    parentBlockId: target.targetParentBlockId,
    insertIndex: target.insertIndex,
    mode: target.mode,
    anchorHeading: target.targetAnchorHeading,
  };
}

async function getSiblings(
  runtime: DocumentEditRuntime,
  documentId: string,
  parentBlockId: string,
  pageSize: number | undefined,
  cachedSiblings?: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (cachedSiblings) {
    return cachedSiblings;
  }
  return runtime.documentBlockService.getAllChildren(
    documentId,
    parentBlockId,
    clampPageSize(pageSize),
  );
}

function summarizeExistingBlocks(
  runtime: DocumentEditRuntime,
  blocks: Array<Record<string, unknown>>,
  startIndex: number,
  endIndex: number,
  indexOffset = 0,
): PreviewBlockSummary[] {
  return blocks.slice(startIndex, endIndex).map((block, offset) => ({
    blockId: runtime.notePlatformProvider.extractBlockId(block),
    index: indexOffset + startIndex + offset,
    blockType: detectExistingBlockType(runtime, block),
    textPreview: runtime.notePlatformProvider.extractBlockText(block).slice(0, 160),
    hasChildren: runtime.notePlatformProvider.extractChildIds(block).length > 0,
    childCount: runtime.notePlatformProvider.extractChildIds(block).length,
  }));
}

function summarizeRichTextSpecs(blocks: RichTextBlockSpec[]): PreviewCreateBlockSummary[] {
  return blocks
    .map((block, index) => summarizePlannedBlock(index, block))
    .filter((block) => block.textPreview.length > 0);
}

function summarizePlannedBlock(
  position: number,
  block: RichTextBlockSpec,
): PreviewCreateBlockSummary {
  return {
    position,
    blockType: block.type,
    textPreview: block.text.trim().slice(0, 160),
    headingLevel: block.headingLevel,
    codeLanguage: block.codeLanguage,
    codeWrap: block.codeWrap,
  };
}

async function estimateBlockTreeSize(
  runtime: DocumentEditRuntime,
  documentId: string,
  blocks: Array<Record<string, unknown>>,
): Promise<number> {
  let total = blocks.length;
  for (const block of blocks) {
    const childIds = runtime.notePlatformProvider.extractChildIds(block);
    if (childIds.length === 0) {
      continue;
    }
    const blockId = runtime.notePlatformProvider.extractBlockId(block) ?? '';
    if (!blockId) {
      continue;
    }
    const children = await runtime.documentBlockService.getAllChildren(documentId, blockId, 200);
    total += await estimateBlockTreeSize(runtime, documentId, children);
  }
  return total;
}

function buildCopyWarnings(
  runtime: DocumentEditRuntime,
  sourceBlocks: Array<Record<string, unknown>>,
  topLevelBlockCount: number,
  estimatedCopiedBlockCount: number,
): string[] {
  const warnings: string[] = [];
  if (estimatedCopiedBlockCount > topLevelBlockCount) {
    warnings.push(
      `The section contains nested child blocks. Top-level blocks=${topLevelBlockCount}, estimated total copied blocks=${estimatedCopiedBlockCount}.`,
    );
  }
  const imageCount = sourceBlocks.filter(
    (block) => detectExistingBlockType(runtime, block) === 'image',
  ).length;
  if (imageCount > 0) {
    warnings.push(
      `The section contains ${imageCount} image block(s). copy_section/move_section will download the source image bytes and re-upload them into the target document, so copied images receive new file tokens and may take longer than plain-text transfers.`,
    );
  }
  return warnings;
}

function detectExistingBlockType(
  runtime: DocumentEditRuntime,
  block: Record<string, unknown>,
): PreviewBlockSummary['blockType'] {
  const kind = runtime.notePlatformProvider.extractBlockKind(block);
  if (
    kind === 'heading' ||
    kind === 'text' ||
    kind === 'bullet' ||
    kind === 'ordered' ||
    kind === 'code' ||
    kind === 'quote' ||
    kind === 'image' ||
    kind === 'page'
  ) {
    return kind;
  }
  return runtime.notePlatformProvider.extractBlockType(block) ?? 'unknown';
}

function existingBlockTypeToCreateType(
  blockType: PreviewBlockSummary['blockType'],
): PreviewCreateBlockSummary['blockType'] {
  if (
    blockType === 'heading' ||
    blockType === 'text' ||
    blockType === 'ordered' ||
    blockType === 'bullet' ||
    blockType === 'quote' ||
    blockType === 'code' ||
    blockType === 'image'
  ) {
    return blockType;
  }
  return 'text';
}
