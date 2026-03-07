import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../appContext.js";
import { registerBatchTools } from "./documentEdit/registerBatchTools.js";
import { registerBlockTools } from "./documentEdit/registerBlockTools.js";
import { registerGenerateTools } from "./documentEdit/registerGenerateTools.js";
import { registerHeadingTools } from "./documentEdit/registerHeadingTools.js";

export function registerDocumentEditTools(
  server: McpServer,
  context: AppContext,
): void {
  registerBlockTools(server, context);
  registerBatchTools(server, context);
  registerHeadingTools(server, context);
  registerGenerateTools(server, context);
}
