import { buildTextBlock } from './richTextBlocks.js';
import type { DocumentEditRuntime } from './context.js';
import { normalizeRevisionId } from './helpers.js';
import { batchCreateBlocksCore, deleteChildrenRange } from './blockMutationPrimitives.js';

export async function replaceCellContent(
  runtime: DocumentEditRuntime,
  documentId: string,
  cellBlockId: string,
  text: string,
  documentRevisionId?: number,
): Promise<{ clearedBlockCount: number; createdBlockIds: string[] }> {
  const existingChildren = await runtime.documentBlockService.getAllChildren(documentId, cellBlockId);
  const clearedBlockCount = existingChildren.length;
  if (clearedBlockCount > 0) {
    await deleteChildrenRange(
      runtime,
      documentId,
      cellBlockId,
      0,
      clearedBlockCount,
      normalizeRevisionId(documentRevisionId),
    );
  }

  const normalizedText = typeof text === 'string' ? text : '';
  if (normalizedText.length === 0) {
    return {
      clearedBlockCount,
      createdBlockIds: [],
    };
  }

  const createResult = await batchCreateBlocksCore(runtime, documentId, {
    documentId,
    parentBlockId: cellBlockId,
    children: [buildTextBlock(normalizedText)],
    index: 0,
    documentRevisionId: -1,
  });

  return {
    clearedBlockCount,
    createdBlockIds: createResult.createdBlockIds,
  };
}
