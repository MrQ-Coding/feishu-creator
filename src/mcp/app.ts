import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../appContext.js";
import { registerAuthTools } from "./tools/authTools.js";
import { registerDiagramTools } from "./tools/diagramTools.js";
import { registerDocumentCoreTools } from "./tools/documentCoreTools.js";
import { registerDocumentEditTools } from "./tools/documentEditTools.js";
import { registerDocumentExportTools } from "./tools/documentExportTools.js";
import { registerDocumentMarkdownTools } from "./tools/documentMarkdownTools.js";
import { registerWikiTools } from "./tools/wikiTools.js";
import { registerStyleProfileTools } from "./tools/styleProfileTools.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export const serverInfo = {
  name: "feishu-creator",
  version,
};

export function createMcpServer(context: AppContext): McpServer {
  const server = new McpServer(serverInfo, {
    capabilities: { tools: {}, logging: {} },
  });

  registerAuthTools(server, context);
  registerDocumentCoreTools(server, context);
  registerDocumentEditTools(server, context);
  registerDiagramTools(server, context);
  registerDocumentExportTools(server, context);
  registerDocumentMarkdownTools(server, context);
  registerWikiTools(server, context);
  registerStyleProfileTools(server, context);

  return server;
}
