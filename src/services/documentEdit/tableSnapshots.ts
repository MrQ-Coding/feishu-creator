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
  const rootBlockId = runtime.notePlatformProvider.extractBlockId(rootBlock);
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
      const blockId = runtime.notePlatformProvider.extractBlockId(child);
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
  const blockMap = buildBlockMap(runtime, blocks);
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
  const cells = buildCellTextMatrix(runtime, cellBlockIds, blockMap);
  const mergeInfo = buildMergeInfoMap(rowSize, columnSize, tableRecord.merge_info);
  const parentInfo = findParentInfo(runtime, blockMap, tableBlockId);
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
  runtime: DocumentEditRuntime,
  blockMap: Map<string, Record<string, unknown>>,
  targetBlockId: string,
): { parentBlockId: string; index: number } | null {
  for (const [blockId, block] of blockMap.entries()) {
    const childIds = runtime.notePlatformProvider.extractChildIds(block);
    const index = childIds.indexOf(targetBlockId);
    if (index >= 0) {
      return { parentBlockId: blockId, index };
    }
  }
  return null;
}

function buildBlockMap(
  runtime: DocumentEditRuntime,
  blocks: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const blockMap = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    const blockId = runtime.notePlatformProvider.extractBlockId(block);
    if (blockId) {
      blockMap.set(blockId, block);
    }
  }
  return blockMap;
}

function buildCellTextMatrix(
  runtime: DocumentEditRuntime,
  cellBlockIds: string[][],
  blockMap: Map<string, Record<string, unknown>>,
): string[][] {
  return cellBlockIds.map((row) =>
    row.map((cellBlockId) =>
      extractBlockText(runtime, cellBlockId, blockMap, new Set()),
    ),
  );
}

function extractBlockText(
  runtime: DocumentEditRuntime,
  blockId: string,
  blockMap: Map<string, Record<string, unknown>>,
  visited: Set<string>,
): string {
  if (visited.has(blockId)) return '';
  visited.add(blockId);

  const block = blockMap.get(blockId);
  if (!block) return '';
  const text = runtime.notePlatformProvider.extractBlockText(block);
  if (text.length > 0) {
    return text;
  }

  const childIds = runtime.notePlatformProvider.extractChildIds(block);
  if (childIds.length === 0) {
    return '';
  }

  return childIds
    .map((childId) => extractBlockText(runtime, childId, blockMap, visited))
    .filter((text) => text.length > 0)
    .join('\n');
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`${field} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}
