import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../appContext.js";
import { registerAuthTools } from "./tools/authTools.js";
import { registerDocumentCoreTools } from "./tools/documentCoreTools.js";
import { registerDocumentEditTools } from "./tools/documentEditTools.js";
import { registerDocumentMarkdownTools } from "./tools/documentMarkdownTools.js";
import { registerWikiTools } from "./tools/wikiTools.js";

export const serverInfo = {
  name: "feishu-creator",
  version: "0.1.0",
};

export function createMcpServer(context: AppContext): McpServer {
  const server = new McpServer(serverInfo, {
    capabilities: { tools: {}, logging: {} },
  });

  registerAuthTools(server, context);
  registerDocumentCoreTools(server, context);
  registerDocumentEditTools(server, context);
  registerDocumentMarkdownTools(server, context);
  registerWikiTools(server, context);

  return server;
}
