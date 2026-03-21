import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface ToolVariant {
  name: string;
  description: string;
}

const registerLegacyAliases = process.env.FEISHU_REGISTER_LEGACY_ALIASES !== "false";

export function registerAliasedTool<Schema extends z.ZodRawShape>(
  server: McpServer,
  variants: ToolVariant[],
  schema: Schema,
  handler: (
    args: z.infer<z.ZodObject<Schema>>,
    extra?: unknown,
  ) => Promise<unknown>,
): void {
  for (const [index, variant] of variants.entries()) {
    if (index > 0 && !registerLegacyAliases) continue;
    server.tool(
      variant.name,
      variant.description,
      schema as never,
      handler as never,
    );
  }
}
