import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface ToolVariant {
  name: string;
  description: string;
}

export function registerAliasedTool<Schema extends z.ZodRawShape>(
  server: McpServer,
  variants: ToolVariant[],
  schema: Schema,
  handler: (
    args: z.infer<z.ZodObject<Schema>>,
    extra?: unknown,
  ) => unknown | Promise<unknown>,
): void {
  for (const variant of variants) {
    server.tool(
      variant.name,
      variant.description,
      schema as never,
      handler as never,
    );
  }
}
