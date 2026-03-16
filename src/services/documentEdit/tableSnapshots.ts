import type { DocumentEditRuntime } from './context.js';
import type { TableMergeInfo, TableSnapshot } from './types.js';
import { normalizePositiveInt } from './tableSpecs.js';

export interface ResolvedTableSnapshot {
  parentBlockId: string;
  tableIndex: number;
  snapshot: TableSnapshot;
}

export async function resolveTableParentBlockId(
  runtime: DocumentEditRuntime,
  documentId: string,
  parentBlockId?: string,
): Promise<string> {
  const normalized = parentBlockId?.trim();
  if (normalized) {
    return normalized;
  }
  const rootBlock = await runtime.documentBlockService.getRootBlock(documentId);
  const rootBlockId = extractBlockId(rootBlock);
  if (!rootBlockId) {
    throw new Error('Unable to resolve document root block.');
  }
  return rootBlockId;
}

export async function getTableCellIds(
  runtime: DocumentEditRuntime,
  documentId: string,
  tableBlockId: string,
  rowSize: number,
  columnSize: number,
): Promise<string[][]> {
  const children = await runtime.documentBlockService.getAllChildren(documentId, tableBlockId);
  const expectedCount = rowSize * columnSize;
  if (children.length < expectedCount) {
    throw new Error(
      `Table cell count mismatch: expected at least ${expectedCount}, actual=${children.length}.`,
    );
  }

  const matrix: string[][] = [];
  for (let rowIndex = 0; rowIndex < rowSize; rowIndex += 1) {
    const row: string[] = [];
    for (let columnIndex = 0; columnIndex < columnSize; columnIndex += 1) {
      const child = children[rowIndex * columnSize + columnIndex];
      const blockId = extractBlockId(child);
      if (!blockId) {
        throw new Error(`Table cell at [${rowIndex}, ${columnIndex}] is missing block_id.`);
      }
      row.push(blockId);
    }
    matrix.push(row);
  }
  return matrix;
}

export async function resolveTableSnapshot(
  runtime: DocumentEditRuntime,
  documentId: string,
  tableBlockId: string,
): Promise<ResolvedTableSnapshot> {
  const blocks = await runtime.documentBlockService.getAllBlocks(documentId);
  const blockMap = buildBlockMap(blocks);
  const tableBlock = blockMap.get(tableBlockId);
  if (!tableBlock) {
    throw new Error(`Table block not found: ${tableBlockId}`);
  }

  const tableRecord = asRecord(tableBlock.table, 'table');
  const property = asRecord(tableRecord.property, 'table.property');
  const rowSize = normalizePositiveInt(
    Number(property.row_size),
    'table.property.row_size',
  );
  const columnSize = normalizePositiveInt(
    Number(property.column_size),
    'table.property.column_size',
  );
  const cellBlockIds = await getTableCellIds(runtime, documentId, tableBlockId, rowSize, columnSize);
  const cells = buildCellTextMatrix(cellBlockIds, blockMap);
  const mergeInfo = buildMergeInfoMap(rowSize, columnSize, tableRecord.merge_info);
  const parentInfo = findParentInfo(blockMap, tableBlockId);
  if (!parentInfo) {
    throw new Error(`Unable to resolve parent info for table block: ${tableBlockId}`);
  }

  return {
    parentBlockId: parentInfo.parentBlockId,
    tableIndex: parentInfo.index,
    snapshot: {
      rowSize,
      columnSize,
      cells,
      cellBlockIds,
      mergeInfo,
    },
  };
}

export function assertCellInRange(
  snapshot: TableSnapshot,
  rowIndex: number,
  columnIndex: number,
): void {
  if (rowIndex >= snapshot.rowSize) {
    throw new Error(`rowIndex out of range: ${rowIndex} >= ${snapshot.rowSize}.`);
  }
  if (columnIndex >= snapshot.columnSize) {
    throw new Error(`columnIndex out of range: ${columnIndex} >= ${snapshot.columnSize}.`);
  }
}

function buildMergeInfoMap(
  rowSize: number,
  columnSize: number,
  rawMergeInfo: unknown,
): Record<string, TableMergeInfo> | undefined {
  if (!Array.isArray(rawMergeInfo) || rawMergeInfo.length === 0) {
    return undefined;
  }

  const mergeInfo: Record<string, TableMergeInfo> = {};
  for (let rowIndex = 0; rowIndex < rowSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnSize; columnIndex += 1) {
      const value = rawMergeInfo[rowIndex * columnSize + columnIndex];
      if (!value || typeof value !== 'object') continue;
      const record = value as Record<string, unknown>;
      const rowSpan = typeof record.row_span === 'number' ? record.row_span : undefined;
      const colSpan = typeof record.col_span === 'number' ? record.col_span : undefined;
      if (rowSpan === undefined && colSpan === undefined) continue;
      mergeInfo[`${rowIndex}:${columnIndex}`] = { rowSpan, colSpan };
    }
  }

  return Object.keys(mergeInfo).length > 0 ? mergeInfo : undefined;
}

function findParentInfo(
  blockMap: Map<string, Record<string, unknown>>,
  targetBlockId: string,
): { parentBlockId: string; index: number } | null {
  for (const [blockId, block] of blockMap.entries()) {
    const childIds = extractChildIds(block);
    const index = childIds.indexOf(targetBlockId);
    if (index >= 0) {
      return { parentBlockId: blockId, index };
    }
  }
  return null;
}

function buildBlockMap(
  blocks: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const blockMap = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    const blockId = extractBlockId(block);
    if (blockId) {
      blockMap.set(blockId, block);
    }
  }
  return blockMap;
}

function buildCellTextMatrix(
  cellBlockIds: string[][],
  blockMap: Map<string, Record<string, unknown>>,
): string[][] {
  return cellBlockIds.map((row) =>
    row.map((cellBlockId) => extractBlockText(cellBlockId, blockMap, new Set())),
  );
}

function extractBlockText(
  blockId: string,
  blockMap: Map<string, Record<string, unknown>>,
  visited: Set<string>,
): string {
  if (visited.has(blockId)) return '';
  visited.add(blockId);

  const block = blockMap.get(blockId);
  if (!block) return '';
  const blockType = typeof block.block_type === 'number' ? block.block_type : undefined;

  if (blockType === 2) {
    return extractElementTextArray(extractElements(block, 'text'));
  }
  if (blockType !== undefined && blockType >= 3 && blockType <= 11) {
    return extractElementTextArray(extractElements(block, `heading${blockType - 2}`));
  }
  if (blockType === 12) {
    return extractElementTextArray(extractElements(block, 'bullet'));
  }
  if (blockType === 13) {
    return extractElementTextArray(extractElements(block, 'ordered'));
  }
  if (blockType === 14) {
    return extractElementTextArray(extractElements(block, 'code'));
  }
  if (blockType === 15) {
    return extractElementTextArray(extractElements(block, 'quote'));
  }

  const childIds = extractChildIds(block);
  if (childIds.length === 0) {
    return '';
  }

  return childIds
    .map((childId) => extractBlockText(childId, blockMap, visited))
    .filter((text) => text.length > 0)
    .join('\n');
}

function extractElements(
  block: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const container = block[key];
  if (!container || typeof container !== 'object') return [];
  const elements = (container as Record<string, unknown>).elements;
  return Array.isArray(elements)
    ? elements.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      )
    : [];
}

function extractElementTextArray(elements: Array<Record<string, unknown>>): string {
  return elements
    .map((element) => {
      const textRun = element.text_run;
      if (textRun && typeof textRun === 'object') {
        const content = (textRun as Record<string, unknown>).content;
        return typeof content === 'string' ? content : '';
      }
      const equation = element.equation;
      if (equation && typeof equation === 'object') {
        const content = (equation as Record<string, unknown>).content;
        return typeof content === 'string' ? content : '';
      }
      return '';
    })
    .join('');
}

function extractChildIds(block: Record<string, unknown>): string[] {
  const children = block.children;
  if (!Array.isArray(children)) {
    return [];
  }
  return children.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

function extractBlockId(block: Record<string, unknown>): string | undefined {
  return typeof block.block_id === 'string' && block.block_id.trim().length > 0
    ? block.block_id.trim()
    : undefined;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`${field} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}
