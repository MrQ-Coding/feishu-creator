import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { errorToolResult, jsonToolResult } from "./toolResponse.js";

export function registerDocumentCoreTools(
  server: McpServer,
  context: AppContext,
): void {
  server.tool(
    "create_feishu_document",
    "Create a new Feishu document. Wiki creation is the primary mode; folderToken is retained for Drive-folder compatibility. In wiki mode it returns both node token and document ID for follow-up editing.",
    {
      title: z.string().min(1).describe("Document title."),
      folderToken: z
        .string()
        .optional()
        .describe(
          "Optional Feishu Drive folder token for compatibility when creating under a Drive folder instead of wiki.",
        ),
      wikiContext: z
        .object({
          spaceId: z
            .string()
            .min(1)
            .describe("Wiki space_id (knowledge base ID)."),
          parentNodeToken: z
            .string()
            .optional()
            .describe("Optional parent wiki node token. Omit for root-level creation."),
        })
        .optional()
        .describe(
          "Wiki creation context. Use this mode to create a doc node in a wiki space.",
        ),
    },
    async ({ title, folderToken, wikiContext }) => {
      try {
        const result = await context.documentCreateService.createDocument({
          title,
          folderToken,
          wikiContext,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("create_feishu_document", error);
      }
    },
  );

  server.tool(
    "get_feishu_document_info",
    "Get basic information for a Feishu document or wiki node. Supports URL or ID/token input.",
    {
      documentId: z
        .string()
        .describe(
          "Feishu document ID/URL, or wiki token/URL. Examples: https://xxx.feishu.cn/docx/xxx, https://xxx.feishu.cn/wiki/xxx, or raw token.",
        ),
      documentType: z
        .enum(["document", "wiki"])
        .optional()
        .describe("Optional type override. If omitted, type is auto-detected from input."),
    },
    async ({ documentId, documentType }) => {
      try {
        const result = await context.documentInfoService.getDocumentInfo(
          documentId,
          documentType,
        );
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("get_feishu_document_info", error);
      }
    },
  );

  server.tool(
    "get_feishu_document_blocks",
    "Get all blocks in a Feishu document with automatic pagination. Use this before editing to understand block hierarchy and insertion positions.",
    {
      documentId: z
        .string()
        .describe(
          "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
        ),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(500)
        .describe("Page size per API request. Feishu default/upper bound is 500."),
      maxBlocks: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional upper bound for returned blocks. Uses BFS traversal and may truncate."),
      maxDepth: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Optional maximum traversal depth. Root page block is depth 0."),
    },
    async ({ documentId, pageSize, maxBlocks, maxDepth }) => {
      try {
        const result = await context.documentBlockService.getBlocks(documentId, {
          pageSize,
          maxBlocks,
          maxDepth,
        });
        return jsonToolResult({
          total: result.blocks.length,
          truncated: result.truncated,
          maxBlocks,
          maxDepth,
          blocks: result.blocks,
        });
      } catch (error) {
        return errorToolResult("get_feishu_document_blocks", error);
      }
    },
  );

  server.tool(
    "delete_feishu_document",
    "Delete a Feishu document/wiki node by browser-based wiki deletion flow.",
    {
      documentId: z
        .string()
        .describe(
          "Docx ID/URL, or wiki token/URL.",
        ),
      documentType: z
        .enum(["document", "wiki"])
        .optional()
        .describe("Optional source type override. Auto-detected when omitted."),
      ignoreNotFound: z
        .boolean()
        .optional()
        .default(true)
        .describe("Return notFound=true instead of throwing when document is missing."),
    },
    async ({ documentId, documentType, ignoreNotFound }) => {
      try {
        const result = await context.documentEditService.deleteDocument({
          documentId,
          documentType,
          ignoreNotFound,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("delete_feishu_document", error);
      }
    },
  );

  server.tool(
    "batch_delete_feishu_documents",
    "Delete multiple Feishu documents or wiki nodes in sequence using browser-based wiki deletion flow.",
    {
      documents: z
        .array(
          z.object({
            documentId: z
              .string()
              .describe(
                "Docx ID/URL, or wiki token/URL.",
              ),
            documentType: z
              .enum(["document", "wiki"])
              .optional()
              .describe(
                "Optional source type override. Auto-detected when omitted.",
              ),
            ignoreNotFound: z
              .boolean()
              .optional()
              .default(true)
              .describe("Return notFound=true instead of throwing when missing."),
          }),
        )
        .min(1)
        .describe("Documents to delete in order."),
      continueOnError: z
        .boolean()
        .optional()
        .default(false)
        .describe("Continue deleting remaining documents if one item fails."),
    },
    async ({ documents, continueOnError }) => {
      try {
        const result = await context.documentEditService.batchDeleteDocuments({
          documents,
          continueOnError,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("batch_delete_feishu_documents", error);
      }
    },
  );
}
