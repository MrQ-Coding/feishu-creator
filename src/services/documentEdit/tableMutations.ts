import type { DocumentEditRuntime } from './context.js';
import { normalizeRequiredIndex, normalizeRevisionId } from './helpers.js';
import { batchCreateBlocksCore, deleteChildrenRange } from './blockMutationPrimitives.js';
import type {
  CreateTableInput,
  CreateTableResult,
  GetTableInput,
  GetTableResult,
  ReplaceTableInput,
  ReplaceTableResult,
  UpdateTableCellInput,
  UpdateTableCellResult,
} from './types.js';
import { replaceCellContent } from './tableCellContent.js';
import {
  assertCellInRange,
  getTableCellIds,
  resolveTableParentBlockId,
  resolveTableSnapshot,
} from './tableSnapshots.js';
import { normalizeTableSpec } from './tableSpecs.js';

export async function createTableCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: CreateTableInput,
): Promise<CreateTableResult> {
  const parentBlockId = await resolveTableParentBlockId(
    runtime,
    normalizedDocumentId,
    input.parentBlockId,
  );
  const tableSpec = normalizeTableSpec(input);

  const result = await batchCreateBlocksCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId,
    index: input.index,
    children: [
      runtime.notePlatformProvider.buildTableBlock(
        tableSpec.rowSize,
        tableSpec.columnSize,
      ),
    ],
    documentRevisionId: input.documentRevisionId,
  });

  const tableBlockId = result.createdBlockIds[0];
  if (!tableBlockId) {
    throw new Error('Failed to create table block.');
  }

  const cellBlockIds = await getTableCellIds(
    runtime,
    normalizedDocumentId,
    tableBlockId,
    tableSpec.rowSize,
    tableSpec.columnSize,
  );

  let filledCellCount = 0;
  for (let rowIndex = 0; rowIndex < tableSpec.rowSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < tableSpec.columnSize; columnIndex += 1) {
      const text = tableSpec.cells[rowIndex][columnIndex];
      if (!text) continue;
      await replaceCellContent(
        runtime,
        normalizedDocumentId,
        cellBlockIds[rowIndex][columnIndex],
        text,
        input.documentRevisionId,
      );
      filledCellCount += 1;
    }
  }

  return {
    documentId: normalizedDocumentId,
    parentBlockId,
    index: input.index,
    tableBlockId,
    rowSize: tableSpec.rowSize,
    columnSize: tableSpec.columnSize,
    cells: tableSpec.cells,
    cellBlockIds,
    filledCellCount,
  };
}

export async function getTableCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: GetTableInput,
): Promise<GetTableResult> {
  const tableBlockId = input.tableBlockId?.trim();
  if (!tableBlockId) {
    throw new Error('tableBlockId is required.');
  }

  const resolved = await resolveTableSnapshot(runtime, normalizedDocumentId, tableBlockId);
  return {
    documentId: normalizedDocumentId,
    tableBlockId,
    parentBlockId: resolved.parentBlockId,
    tableIndex: resolved.tableIndex,
    rowSize: resolved.snapshot.rowSize,
    columnSize: resolved.snapshot.columnSize,
    cells: resolved.snapshot.cells,
    cellBlockIds: resolved.snapshot.cellBlockIds,
    mergeInfo: resolved.snapshot.mergeInfo,
  };
}

export async function updateTableCellCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: UpdateTableCellInput,
): Promise<UpdateTableCellResult> {
  const tableBlockId = input.tableBlockId?.trim();
  if (!tableBlockId) {
    throw new Error('tableBlockId is required.');
  }
  const rowIndex = normalizeRequiredIndex(input.rowIndex, 'rowIndex');
  const columnIndex = normalizeRequiredIndex(input.columnIndex, 'columnIndex');
  const resolved = await resolveTableSnapshot(runtime, normalizedDocumentId, tableBlockId);
  assertCellInRange(resolved.snapshot, rowIndex, columnIndex);
  const cellBlockId = resolved.snapshot.cellBlockIds[rowIndex][columnIndex];
  const replaceResult = await replaceCellContent(
    runtime,
    normalizedDocumentId,
    cellBlockId,
    input.text ?? '',
    input.documentRevisionId,
  );

  return {
    documentId: normalizedDocumentId,
    tableBlockId,
    rowIndex,
    columnIndex,
    cellBlockId,
    text: input.text ?? '',
    clearedBlockCount: replaceResult.clearedBlockCount,
    createdBlockIds: replaceResult.createdBlockIds,
  };
}

export async function replaceTableCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: ReplaceTableInput,
): Promise<ReplaceTableResult> {
  const tableBlockId = input.tableBlockId?.trim();
  if (!tableBlockId) {
    throw new Error('tableBlockId is required.');
  }

  const desired = normalizeTableSpec(input);
  const resolved = await resolveTableSnapshot(runtime, normalizedDocumentId, tableBlockId);
  const current = resolved.snapshot;

  if (current.rowSize === desired.rowSize && current.columnSize === desired.columnSize) {
    let filledCellCount = 0;
    for (let rowIndex = 0; rowIndex < desired.rowSize; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < desired.columnSize; columnIndex += 1) {
        const text = desired.cells[rowIndex][columnIndex];
        await replaceCellContent(
          runtime,
          normalizedDocumentId,
          current.cellBlockIds[rowIndex][columnIndex],
          text,
          input.documentRevisionId,
        );
        if (text) {
          filledCellCount += 1;
        }
      }
    }

    return {
      documentId: normalizedDocumentId,
      originalTableBlockId: tableBlockId,
      tableBlockId,
      parentBlockId: resolved.parentBlockId,
      tableIndex: resolved.tableIndex,
      recreated: false,
      rowSize: desired.rowSize,
      columnSize: desired.columnSize,
      cells: desired.cells,
      cellBlockIds: current.cellBlockIds,
      mergeInfo: current.mergeInfo,
      filledCellCount,
    };
  }

  await deleteChildrenRange(
    runtime,
    normalizedDocumentId,
    resolved.parentBlockId,
    resolved.tableIndex,
    resolved.tableIndex + 1,
    normalizeRevisionId(input.documentRevisionId),
  );

  const recreated = await createTableCore(runtime, normalizedDocumentId, {
    documentId: normalizedDocumentId,
    parentBlockId: resolved.parentBlockId,
    index: resolved.tableIndex,
    rowSize: desired.rowSize,
    columnSize: desired.columnSize,
    cells: desired.cells,
    documentRevisionId: -1,
  });

  return {
    documentId: normalizedDocumentId,
    originalTableBlockId: tableBlockId,
    tableBlockId: recreated.tableBlockId,
    parentBlockId: recreated.parentBlockId,
    tableIndex: resolved.tableIndex,
    recreated: true,
    rowSize: recreated.rowSize,
    columnSize: recreated.columnSize,
    cells: recreated.cells,
    cellBlockIds: recreated.cellBlockIds,
    mergeInfo: recreated.mergeInfo,
    filledCellCount: recreated.filledCellCount,
  };
}
