export function buildTableBlock(
  rowSize: number,
  columnSize: number,
): Record<string, unknown> {
  return {
    block_type: 31,
    table: {
      property: {
        row_size: rowSize,
        column_size: columnSize,
      },
    },
  };
}
