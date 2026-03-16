import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../../appContext.js";
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
  server.tool(
    "update_feishu_block_text",
    "Update one existing text-capable block by block ID without any heading scan. Use locate tools first when block ID is unknown.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
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
    },
    async ({ documentId, blockId, textElements, documentRevisionId }) => {
      try {
        const result = await context.documentEditService.updateBlockText({
          documentId,
          blockId,
          textElements,
          documentRevisionId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("update_feishu_block_text", error);
      }
    },
  );

  server.tool(
    "batch_update_feishu_blocks",
    "Update multiple existing text-capable blocks by block ID in one document-locked workflow.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
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
    },
    async ({ documentId, updates, documentRevisionId, continueOnError }) => {
      try {
        const result = await context.documentEditService.batchUpdateBlockText({
          documentId,
          updates,
          documentRevisionId,
          continueOnError,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("batch_update_feishu_blocks", error);
      }
    },
  );

  server.tool(
    "upload_local_image_to_feishu",
    "Upload one local image file into a Feishu docx document. Use replaceBlockId to replace an existing image block, or parentBlockId to insert a new image block under a parent. This tool uploads the given file as-is and does not verify whether the screenshot content is the intended target.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
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
        .describe("Parent block ID used when inserting a new image block."),
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
        .describe("Optional image width override used when creating the image block. Feishu may still display according to the uploaded file's intrinsic size."),
      height: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional image height override used when creating the image block. Feishu may still display according to the uploaded file's intrinsic size."),
      documentRevisionId: z
        .number()
        .int()
        .min(-1)
        .optional()
        .default(-1)
        .describe("Target document revision id. -1 means latest."),
    },
    async ({
      documentId,
      imagePath,
      replaceBlockId,
      parentBlockId,
      index,
      fileName,
      width,
      height,
      documentRevisionId,
    }) => {
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
        return errorToolResult("upload_local_image_to_feishu", error);
      }
    },
  );

  server.tool(
    "create_feishu_table",
    "Create a basic table block in a Feishu docx document. You can provide rowSize/columnSize directly, or let them be inferred from the cells matrix.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
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
        .optional()
        .describe("Optional number of rows. If omitted, inferred from cells."),
      columnSize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional number of columns. If omitted, inferred from cells."),
      cells: tableCellsSchema,
      documentRevisionId: z
        .number()
        .int()
        .min(-1)
        .optional()
        .default(-1)
        .describe("Target document revision id. -1 means latest."),
    },
    async ({ documentId, parentBlockId, index, rowSize, columnSize, cells, documentRevisionId }) => {
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
        return errorToolResult("create_feishu_table", error);
      }
    },
  );

  server.tool(
    "get_feishu_table",
    "Read one table block from a Feishu docx document and return its size, cell block IDs, and plain-text cell content.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
        ),
      tableBlockId: z
        .string()
        .min(1)
        .describe("Existing table block ID."),
    },
    async ({ documentId, tableBlockId }) => {
      try {
        const result = await context.documentEditService.getTable({
          documentId,
          tableBlockId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("get_feishu_table", error);
      }
    },
  );

  server.tool(
    "update_feishu_table_cell",
    "Replace the content of one table cell by row/column position using plain text.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
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
    },
    async ({ documentId, tableBlockId, rowIndex, columnIndex, text, documentRevisionId }) => {
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
        return errorToolResult("update_feishu_table_cell", error);
      }
    },
  );

  server.tool(
    "replace_feishu_table",
    "Replace a table with new basic content. If the target size matches, it updates cells in place; otherwise it recreates the table at the same position.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
        ),
      tableBlockId: z
        .string()
        .min(1)
        .describe("Existing table block ID."),
      rowSize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional number of rows. If omitted, inferred from cells."),
      columnSize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional number of columns. If omitted, inferred from cells."),
      cells: tableCellsSchema,
      documentRevisionId: z
        .number()
        .int()
        .min(-1)
        .optional()
        .default(-1)
        .describe("Target document revision id. -1 means latest."),
    },
    async ({ documentId, tableBlockId, rowSize, columnSize, cells, documentRevisionId }) => {
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
        return errorToolResult("replace_feishu_table", error);
      }
    },
  );
}
