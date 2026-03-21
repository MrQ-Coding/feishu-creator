import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../../appContext.js";
import { registerAliasedTool } from "../registerAliasedTool.js";
import { errorToolResult, jsonToolResult } from "../toolResponse.js";

const textStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  inline_code: z.boolean().optional(),
  text_color: z.number().int().min(0).max(7).optional(),
  background_color: z.number().int().min(1).max(7).optional(),
});

const textElementSchema = z.union([
  z.object({
    text: z.string().describe("Plain text content."),
    style: textStyleSchema.optional(),
  }),
  z.object({
    equation: z.string().describe("LaTeX equation content."),
    style: textStyleSchema.optional(),
  }),
]);

const textElementInputSchema = z.union([
  textElementSchema,
  z
    .string()
    .min(1)
    .transform((text) => ({ text })),
]);

const textElementsDescription =
  'Array of text/equation elements with optional style. Preferred: [{"text":"Hello"}]. Legacy shorthand string entries like ["Hello"] are also accepted and normalized to objects.';

const blockTextUpdateSchema = z.object({
  blockId: z.string().min(1).describe("Target block ID."),
  textElements: z
    .array(textElementInputSchema)
    .min(1)
    .describe(textElementsDescription),
});

const tableCellsSchema = z
  .array(z.array(z.string()))
  .optional()
  .describe(
    "Optional initial table content matrix. Ragged rows are allowed and will be padded with empty strings.",
  );

export function registerBlockTools(server: McpServer, context: AppContext): void {
  const updateBlockTextSchema = {
    documentId: z
      .string()
      .describe(
        "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
      ),
    blockId: z.string().min(1).describe("Target block ID."),
    textElements: z
      .array(textElementInputSchema)
      .min(1)
      .describe(textElementsDescription),
    documentRevisionId: z
      .number()
      .int()
      .min(-1)
      .optional()
      .default(-1)
      .describe("Target document revision id. -1 means latest."),
  };
  const handleUpdateBlockText = async ({
    documentId,
    blockId,
    textElements,
    documentRevisionId,
  }: z.infer<z.ZodObject<typeof updateBlockTextSchema>>) => {
    try {
      const result = await context.documentEditService.updateBlockText({
        documentId,
        blockId,
        textElements,
        documentRevisionId,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("update_block_text", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "update_block_text",
        description:
          "Update one existing text-capable block by block ID without any heading scan. This block-editing workflow is platform-neutral in the service layer and currently targets Feishu blocks.",
      },
      {
        name: "update_feishu_block_text",
        description:
          "Legacy Feishu-named alias for updating one text-capable block by block ID. This block-editing workflow is platform-neutral in the service layer and currently targets Feishu blocks.",
      },
    ],
    updateBlockTextSchema,
    handleUpdateBlockText,
  );

  const batchUpdateBlocksSchema = {
    documentId: z
      .string()
      .describe(
        "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
      ),
    updates: z
      .array(blockTextUpdateSchema)
      .min(1)
      .describe(
        "Update requests. Each item targets one block ID and sends update_text_elements.",
      ),
    documentRevisionId: z
      .number()
      .int()
      .min(-1)
      .optional()
      .default(-1)
      .describe("Target document revision id. -1 means latest."),
    continueOnError: z
      .boolean()
      .optional()
      .default(false)
      .describe("Continue remaining updates when one block update fails."),
  };
  const handleBatchUpdateBlocks = async ({
    documentId,
    updates,
    documentRevisionId,
    continueOnError,
  }: z.infer<z.ZodObject<typeof batchUpdateBlocksSchema>>) => {
    try {
      const result = await context.documentEditService.batchUpdateBlockText({
        documentId,
        updates,
        documentRevisionId,
        continueOnError,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("batch_update_blocks", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "batch_update_blocks",
        description:
          "Update multiple existing text-capable blocks by block ID in one document-locked workflow. This editing workflow is platform-neutral in the service layer and currently targets Feishu blocks.",
      },
      {
        name: "batch_update_feishu_blocks",
        description:
          "Legacy Feishu-named alias for batch block text updates. This document-locked editing workflow is platform-neutral in the service layer and currently targets Feishu blocks.",
      },
    ],
    batchUpdateBlocksSchema,
    handleBatchUpdateBlocks,
  );

  const uploadLocalImageSchema = {
    documentId: z
      .string()
      .describe(
        "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
      ),
    imagePath: z
      .string()
      .min(1)
      .describe(
        "Absolute or relative local image path. PNG/JPEG/GIF/BMP supported. Verify the local image content before upload when using screenshots.",
      ),
    replaceBlockId: z
      .string()
      .min(1)
      .optional()
      .describe("Existing image block ID to replace in place."),
    parentBlockId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional parent block ID used when inserting a new image block. Defaults to the document root block.",
      ),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Insert position under parentBlockId. Omit to append."),
    fileName: z
      .string()
      .min(1)
      .optional()
      .describe("Optional upload file name. Defaults to basename(imagePath)."),
    width: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional image width override used when creating the image block. Current Feishu implementation may still display according to the uploaded file's intrinsic size."),
    height: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional image height override used when creating the image block. Current Feishu implementation may still display according to the uploaded file's intrinsic size."),
    documentRevisionId: z
      .number()
      .int()
      .min(-1)
      .optional()
      .default(-1)
      .describe("Target document revision id. -1 means latest."),
  };
  const handleUploadLocalImage = async ({
    documentId,
    imagePath,
    replaceBlockId,
    parentBlockId,
    index,
    fileName,
    width,
    height,
    documentRevisionId,
  }: z.infer<z.ZodObject<typeof uploadLocalImageSchema>>) => {
    try {
      const result = await context.documentEditService.uploadLocalImage({
        documentId,
        imagePath,
        replaceBlockId,
        parentBlockId,
        index,
        fileName,
        width,
        height,
        documentRevisionId,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("upload_local_image", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "upload_local_image",
        description:
          "Upload one local image file into the current document platform implementation. Today this inserts or replaces image blocks in Feishu docs and uploads the file as-is.",
      },
      {
        name: "upload_local_image_to_feishu",
        description:
          "Legacy Feishu-named alias for uploading a local image into the current document platform implementation. Today this inserts or replaces image blocks in Feishu docs and uploads the file as-is.",
      },
    ],
    uploadLocalImageSchema,
    handleUploadLocalImage,
  );

  const createTableSchema = {
      documentId: z
        .string()
        .describe(
          "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
        ),
      parentBlockId: z
        .string()
        .min(1)
        .optional()
        .describe("Optional parent block ID. Defaults to the document root block."),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Insert position under parentBlockId. Omit to append."),
      rowSize: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Optional number of rows (max 500). If omitted, inferred from cells."),
      columnSize: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Optional number of columns (max 100). If omitted, inferred from cells."),
      cells: tableCellsSchema,
      documentRevisionId: z
        .number()
        .int()
        .min(-1)
        .optional()
        .default(-1)
        .describe("Target document revision id. -1 means latest."),
  };
  const handleCreateTable = async ({
    documentId,
    parentBlockId,
    index,
    rowSize,
    columnSize,
    cells,
    documentRevisionId,
  }: z.infer<z.ZodObject<typeof createTableSchema>>) => {
    try {
      const result = await context.documentEditService.createTable({
        documentId,
        parentBlockId,
        index,
        rowSize,
        columnSize,
        cells,
        documentRevisionId,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("create_table", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "create_table",
        description:
          "Create a native table block in the current document platform implementation. Today this creates Feishu table blocks.",
      },
      {
        name: "create_feishu_table",
        description:
          "Legacy Feishu-named alias for creating a native table block in the current document platform implementation. Today this creates Feishu table blocks.",
      },
    ],
    createTableSchema,
    handleCreateTable,
  );

  const getTableSchema = {
      documentId: z
        .string()
        .describe(
          "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
        ),
      tableBlockId: z
        .string()
        .min(1)
        .describe("Existing table block ID."),
  };
  const handleGetTable = async ({
    documentId,
    tableBlockId,
  }: z.infer<z.ZodObject<typeof getTableSchema>>) => {
    try {
      const result = await context.documentEditService.getTable({
        documentId,
        tableBlockId,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("get_table", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "get_table",
        description:
          "Read one native table block from the current document platform implementation and return its size, cell block IDs, and plain-text cell content. Today this reads Feishu table blocks.",
      },
      {
        name: "get_feishu_table",
        description:
          "Legacy Feishu-named alias for reading a native table block from the current document platform implementation. Today this reads Feishu table blocks and returns size, cell block IDs, and plain-text cell content.",
      },
    ],
    getTableSchema,
    handleGetTable,
  );

  const updateTableCellSchema = {
      documentId: z
        .string()
        .describe(
          "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
        ),
      tableBlockId: z
        .string()
        .min(1)
        .describe("Existing table block ID."),
      rowIndex: z
        .number()
        .int()
        .min(0)
        .describe("Zero-based row index."),
      columnIndex: z
        .number()
        .int()
        .min(0)
        .describe("Zero-based column index."),
      text: z
        .string()
        .describe("Replacement plain text. Use an empty string to clear the cell."),
      documentRevisionId: z
        .number()
        .int()
        .min(-1)
        .optional()
        .default(-1)
        .describe("Target document revision id. -1 means latest."),
  };
  const handleUpdateTableCell = async ({
    documentId,
    tableBlockId,
    rowIndex,
    columnIndex,
    text,
    documentRevisionId,
  }: z.infer<z.ZodObject<typeof updateTableCellSchema>>) => {
    try {
      const result = await context.documentEditService.updateTableCell({
        documentId,
        tableBlockId,
        rowIndex,
        columnIndex,
        text,
        documentRevisionId,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("update_table_cell", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "update_table_cell",
        description:
          "Replace the content of one table cell by row/column position using plain text.",
      },
      {
        name: "update_feishu_table_cell",
        description:
          "Legacy Feishu-named alias for updating one table cell by row/column position using plain text.",
      },
    ],
    updateTableCellSchema,
    handleUpdateTableCell,
  );

  const replaceTableSchema = {
      documentId: z
        .string()
        .describe(
          "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
        ),
      tableBlockId: z
        .string()
        .min(1)
        .describe("Existing table block ID."),
      rowSize: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Optional number of rows (max 500). If omitted, inferred from cells."),
      columnSize: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Optional number of columns (max 100). If omitted, inferred from cells."),
      cells: tableCellsSchema,
      documentRevisionId: z
        .number()
        .int()
        .min(-1)
        .optional()
        .default(-1)
        .describe("Target document revision id. -1 means latest."),
  };
  const handleReplaceTable = async ({
    documentId,
    tableBlockId,
    rowSize,
    columnSize,
    cells,
    documentRevisionId,
  }: z.infer<z.ZodObject<typeof replaceTableSchema>>) => {
    try {
      const result = await context.documentEditService.replaceTable({
        documentId,
        tableBlockId,
        rowSize,
        columnSize,
        cells,
        documentRevisionId,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("replace_table", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "replace_table",
        description:
          "Replace a native table block with new basic content. If the target size matches, it updates cells in place; otherwise it recreates the table at the same position.",
      },
      {
        name: "replace_feishu_table",
        description:
          "Legacy Feishu-named alias for replacing a native table block with new basic content. If the target size matches, it updates cells in place; otherwise it recreates the table at the same position.",
      },
    ],
    replaceTableSchema,
    handleReplaceTable,
  );
}
