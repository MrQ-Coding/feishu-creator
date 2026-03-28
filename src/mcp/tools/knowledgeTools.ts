import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { errorToolResult, jsonToolResult } from "./toolResponse.js";

export function registerKnowledgeTools(server: McpServer, context: AppContext): void {
  server.tool(
    "knowledge_search",
    "Search the local knowledge index first (millisecond-level), then optionally fall back to Feishu API. Use this before solving a problem to check if a solution already exists in the knowledge base.",
    {
      query: z
        .string()
        .min(1)
        .describe("Search keywords or question description."),
      spaceId: z
        .string()
        .optional()
        .describe("Optional wiki space_id filter. Uses configured default if omitted."),
      fallbackToApi: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to fall back to Feishu search API when local index has no matches. Default false."),
      includeContent: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to fetch full document content for matched entries. Default true."),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Maximum number of results to return. Default 5."),
    },
    async ({ query, spaceId, fallbackToApi, includeContent, maxResults }) => {
      try {
        const result = await context.knowledgeService.search({
          query,
          spaceId,
          fallbackToApi,
          includeContent,
          maxResults,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("knowledge_search", error);
      }
    },
  );

  server.tool(
    "knowledge_record",
    "Record a problem and its solution to the Feishu knowledge base, and update the local search index. Use this after solving a problem to build up the knowledge base for future reference.",
    {
      spaceId: z
        .string()
        .min(1)
        .describe("Target wiki space_id (knowledge base ID)."),
      documentId: z
        .string()
        .optional()
        .describe("Append to an existing document. Mutually exclusive with category."),
      category: z
        .string()
        .optional()
        .describe("Category name. Auto-finds or creates a document with this title. Mutually exclusive with documentId."),
      parentNodeToken: z
        .string()
        .optional()
        .describe("Optional parent wiki node token when creating a new document."),
      title: z
        .string()
        .min(1)
        .describe("Problem title (used as H2 heading in the document)."),
      keywords: z
        .array(z.string().min(1))
        .min(1)
        .describe("Keywords for indexing and search. At least one required."),
      problem: z
        .string()
        .min(1)
        .describe("Problem description."),
      solution: z
        .string()
        .min(1)
        .describe("Solution description."),
      reference: z
        .string()
        .optional()
        .describe("Optional reference links or materials."),
    },
    async ({ spaceId, documentId, category, parentNodeToken, title, keywords, problem, solution, reference }) => {
      try {
        const result = await context.knowledgeService.record({
          spaceId,
          documentId,
          category,
          parentNodeToken,
          title,
          keywords,
          problem,
          solution,
          reference,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("knowledge_record", error);
      }
    },
  );

  server.tool(
    "knowledge_index_rebuild",
    "Rebuild the local knowledge index from a Feishu wiki space. Use this on first setup, when the index is stale, or after manual edits to the knowledge base.",
    {
      spaceId: z
        .string()
        .min(1)
        .describe("Target wiki space_id to index."),
      rootNodeToken: z
        .string()
        .optional()
        .describe("Optional root node token. If omitted, indexes the entire space."),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(3)
        .describe("Maximum traversal depth. Default 3."),
    },
    async ({ spaceId, rootNodeToken, maxDepth }) => {
      try {
        const result = await context.knowledgeService.rebuildIndex({
          spaceId,
          rootNodeToken,
          maxDepth,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("knowledge_index_rebuild", error);
      }
    },
  );
}
