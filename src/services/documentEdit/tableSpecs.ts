import type { TableSnapshot } from './types.js';
export { buildTableBlock } from '../../platform/feishuTableBlocks.js';

export function normalizeTableSpec(input: {
  rowSize?: number;
  columnSize?: number;
  cells?: string[][];
}): TableSnapshot {
  const sourceRows = Array.isArray(input.cells) ? input.cells : [];
  const sourceRowSize = sourceRows.length;
  const sourceColumnSize = sourceRows.reduce(
    (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
    0,
  );

  const rowSize =
    input.rowSize !== undefined
      ? normalizePositiveInt(input.rowSize, 'rowSize')
      : sourceRowSize;
  const columnSize =
    input.columnSize !== undefined
      ? normalizePositiveInt(input.columnSize, 'columnSize')
      : sourceColumnSize;

  if (rowSize <= 0 || columnSize <= 0) {
    throw new Error('Provide rowSize/columnSize, or provide non-empty cells to infer them.');
  }
  if (sourceRowSize > rowSize) {
    throw new Error(`cells contains ${sourceRowSize} rows, which exceeds rowSize=${rowSize}.`);
  }
  if (sourceColumnSize > columnSize) {
    throw new Error(
      `cells contains ${sourceColumnSize} columns, which exceeds columnSize=${columnSize}.`,
    );
  }

  const cells: string[][] = [];
  const cellBlockIds: string[][] = [];
  for (let rowIndex = 0; rowIndex < rowSize; rowIndex += 1) {
    const sourceRow = Array.isArray(sourceRows[rowIndex]) ? sourceRows[rowIndex] : [];
    const row: string[] = [];
    const idRow: string[] = [];
    for (let columnIndex = 0; columnIndex < columnSize; columnIndex += 1) {
      const value = sourceRow[columnIndex];
      row.push(typeof value === 'string' ? value : '');
      idRow.push('');
    }
    cells.push(row);
    cellBlockIds.push(idRow);
  }

  return {
    rowSize,
    columnSize,
    cells,
    cellBlockIds,
  };
}

export function normalizePositiveInt(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite integer.`);
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    throw new Error(`${field} must be greater than 0.`);
  }
  return normalized;
}
