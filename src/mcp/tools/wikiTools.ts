import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { errorToolResult, jsonToolResult } from "./toolResponse.js";

export function registerWikiTools(server: McpServer, context: AppContext): void {
  server.tool(
    "get_feishu_wiki_tree",
    "Get wiki node tree for a Feishu knowledge base with breadth-first traversal, pagination, and caching.",
    {
      spaceId: z
        .string()
        .describe("Feishu wiki space_id (knowledge base ID)."),
      rootNodeToken: z
        .string()
        .optional()
        .describe("Optional root node token. If omitted, lists from space root."),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Optional maximum depth to traverse. Omit for full tree."),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(50)
        .describe("Page size per request. Feishu supports 1-50."),
      maxConcurrency: z
        .number()
        .int()
        .min(1)
        .max(32)
        .optional()
        .describe("Optional traversal concurrency; clamped by FEISHU_MAX_CONCURRENCY."),
    },
    async ({ spaceId, rootNodeToken, maxDepth, pageSize, maxConcurrency }) => {
      try {
        const result = await context.wikiTreeService.getTree(spaceId, {
          rootNodeToken,
          maxDepth,
          pageSize,
          maxConcurrency,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("get_feishu_wiki_tree", error);
      }
    },
  );

  server.tool(
    "list_feishu_wiki_spaces",
    "List Feishu wiki spaces (knowledge bases) visible to current auth identity.",
    {
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(50)
        .describe("Page size for each request. Feishu supports 1-50."),
    },
    async ({ pageSize }) => {
      try {
        const items = await context.wikiSpaceService.listAllSpaces(pageSize);

        return jsonToolResult({
          total: items.length,
          spaces: items.map((item) => ({
            space_id: item.space_id,
            name: item.name,
            space_type: item.space_type,
            description: item.description,
          })),
        });
      } catch (error) {
        return errorToolResult("list_feishu_wiki_spaces", error);
      }
    },
  );

  server.tool(
    "search_feishu_documents",
    "Search Feishu documents and/or wiki nodes by keyword. Supports document/wiki/both with pagination. In tenant mode, wiki search automatically falls back to document search due to API limitations.",
    {
      searchKey: z
        .string()
        .min(1)
        .describe("Search keyword."),
      searchType: z
        .enum(["document", "wiki", "both"])
        .optional()
        .default("both")
        .describe("Search target type."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Document search offset for pagination."),
      pageToken: z
        .string()
        .optional()
        .describe("Wiki search page token for pagination."),
      spaceId: z
        .string()
        .optional()
        .describe("Optional wiki space_id filter applied locally after search."),
    },
    async ({ searchKey, searchType, offset, pageToken, spaceId }) => {
      try {
        const authType = context.authManager.getStatus().effectiveAuthType;
        const result = await context.searchService.search({
          searchKey,
          searchType,
          offset,
          pageToken,
          spaceId,
          authType,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("search_feishu_documents", error);
      }
    },
  );
}
