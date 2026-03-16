import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { errorToolResult, jsonToolResult } from "./toolResponse.js";

export function registerStyleProfileTools(
  server: McpServer,
  context: AppContext,
): void {
  server.tool(
    "find_style_profiles",
    "Find candidate style profile documents saved in Feishu and parse their reusable metadata and drafting rules.",
    {
      ownerId: z
        .string()
        .optional()
        .describe("Stable profile owner key. Defaults to current app user when available."),
      profileKind: z
        .string()
        .optional()
        .describe("Optional profile kind such as deep-explainer or work-log."),
      spaceId: z
        .string()
        .optional()
        .describe("Optional wiki space_id filter."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Maximum number of candidates to return."),
      searchKey: z
        .string()
        .optional()
        .describe("Optional custom search keyword. Defaults to 写作风格画像."),
    },
    async ({ ownerId, profileKind, spaceId, limit, searchKey }) => {
      try {
        const result = await context.styleProfileService.findProfiles({
          ownerId,
          profileKind,
          spaceId,
          limit,
          searchKey,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("find_style_profiles", error);
      }
    },
  );

  server.tool(
    "resolve_style_profile",
    "Resolve the best saved style profile for the current user or a specified owner, so drafting can reuse approved style rules deterministically.",
    {
      ownerId: z
        .string()
        .optional()
        .describe("Stable profile owner key. Defaults to current app user when available."),
      profileKind: z
        .string()
        .optional()
        .describe("Optional profile kind such as deep-explainer or work-log."),
      spaceId: z
        .string()
        .optional()
        .describe("Optional wiki space_id filter."),
      documentId: z
        .string()
        .optional()
        .describe("Optional explicit profile document ID or URL. When provided it bypasses search."),
      allowFallback: z
        .boolean()
        .optional()
        .default(true)
        .describe("Return the highest-scoring candidate when no exact owner/profile match exists."),
    },
    async ({ ownerId, profileKind, spaceId, documentId, allowFallback }) => {
      try {
        const result = await context.styleProfileService.resolveProfile({
          ownerId,
          profileKind,
          spaceId,
          documentId,
          allowFallback,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("resolve_style_profile", error);
      }
    },
  );
}
