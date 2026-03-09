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
}
