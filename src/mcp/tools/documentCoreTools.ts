import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { registerAliasedTool } from "./registerAliasedTool.js";
import { errorToolResult, jsonToolResult } from "./toolResponse.js";

export function registerDocumentCoreTools(
  server: McpServer,
  context: AppContext,
): void {
  const createDocumentSchema = {
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
  };
  const handleCreateDocument = async ({
    title,
    folderToken,
    wikiContext,
  }: z.infer<z.ZodObject<typeof createDocumentSchema>>) => {
    try {
      const result = await context.documentCreateService.createDocument({
        title,
        folderToken,
        wikiContext,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("create_document", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "create_document",
        description:
          "Create a document in the current platform implementation. The workflow is platform-neutral in the service layer and is currently backed by Feishu document/wiki APIs. In wiki mode it returns both node token and document ID for follow-up editing.",
      },
      {
        name: "create_feishu_document",
        description:
          "Legacy Feishu-named alias for document creation. The workflow is platform-neutral in the service layer and is currently backed by Feishu document/wiki APIs. In wiki mode it returns both node token and document ID for follow-up editing.",
      },
    ],
    createDocumentSchema,
    handleCreateDocument,
  );

  const getDocumentInfoSchema = {
    documentId: z
      .string()
      .describe(
        "Current runtime input. Today this accepts Feishu document ID/URL, wiki token/URL, or raw token.",
      ),
    documentType: z
      .enum(["document", "wiki"])
      .optional()
      .describe("Optional type override. If omitted, type is auto-detected from input."),
  };
  const handleGetDocumentInfo = async ({
    documentId,
    documentType,
  }: z.infer<z.ZodObject<typeof getDocumentInfoSchema>>) => {
    try {
      const result = await context.documentInfoService.getDocumentInfo(
        documentId,
        documentType,
      );
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult("get_document_info", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "get_document_info",
        description:
          "Get basic information for a document or wiki node in the current platform implementation. The current runtime accepts Feishu document/wiki references and returns basic info for the matched document or wiki node.",
      },
      {
        name: "get_feishu_document_info",
        description:
          "Legacy Feishu-named alias for reading document info. The current runtime accepts Feishu document/wiki references and returns basic info for the matched document or wiki node.",
      },
    ],
    getDocumentInfoSchema,
    handleGetDocumentInfo,
  );

  const getDocumentBlocksSchema = {
    documentId: z
      .string()
      .describe(
        "Document ID or URL for the current platform implementation. Today this accepts Feishu doc/wiki references.",
      ),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(500)
      .describe("Page size per API request. Current Feishu implementation supports up to 500."),
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
  };
  const handleGetDocumentBlocks = async ({
    documentId,
    pageSize,
    maxBlocks,
    maxDepth,
  }: z.infer<z.ZodObject<typeof getDocumentBlocksSchema>>) => {
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
      return errorToolResult("get_document_blocks", error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: "get_document_blocks",
        description:
          "Get all blocks in a document with automatic pagination. The service layer is platform-neutral and the current runtime walks Feishu document blocks so you can inspect hierarchy and insertion positions before editing.",
      },
      {
        name: "get_feishu_document_blocks",
        description:
          "Legacy Feishu-named alias for reading document blocks. The current runtime walks Feishu document blocks with automatic pagination so you can inspect hierarchy and insertion positions before editing.",
      },
    ],
    getDocumentBlocksSchema,
    handleGetDocumentBlocks,
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
