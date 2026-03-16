import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../../appContext.js";
import { errorToolResult, jsonToolResult } from "./toolResponse.js";

const renderFormatSchema = z
  .enum(["png", "svg"])
  .optional()
  .default("png");

const graphvizLayoutEngineSchema = z
  .enum(["dot", "neato", "fdp", "sfdp", "twopi", "circo"])
  .optional()
  .default("dot");

const documentIdField = z
  .string()
  .describe(
    "Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.",
  );

const createImageBlockFields = {
  replaceBlockId: z
    .string()
    .min(1)
    .optional()
    .describe("Existing image block ID to replace in place."),
  parentBlockId: z
    .string()
    .min(1)
    .optional()
    .describe("Parent block ID used when inserting a new image block."),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Insert position under parentBlockId. Omit to append."),
  fileName: z
    .string()
    .min(1)
    .optional()
    .describe("Optional upload file name. Defaults to a renderer-specific PNG file name."),
  cleanupGeneratedFile: z
    .boolean()
    .optional()
    .default(true)
    .describe("Delete the intermediate rendered image file after upload."),
  width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional image width override used when creating the image block."),
  height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional image height override used when creating the image block."),
  documentRevisionId: z
    .number()
    .int()
    .min(-1)
    .optional()
    .default(-1)
    .describe("Target document revision id. -1 means latest."),
};

export function registerDiagramTools(
  server: McpServer,
  context: AppContext,
): void {
  server.tool(
    "render_graphviz_diagram",
    "Render Graphviz DOT source text to a local PNG or SVG file.",
    {
      sourceText: z
        .string()
        .min(1)
        .describe("Graphviz DOT source text, for example `digraph G { A -> B }`."),
      format: renderFormatSchema.describe("Output format."),
      outputPath: z
        .string()
        .optional()
        .describe("Optional local output path. Defaults to a temp file under the OS temp directory."),
      layoutEngine: graphvizLayoutEngineSchema.describe(
        "Graphviz layout engine. Use `dot` for most flowcharts and dependency graphs.",
      ),
    },
    async ({ sourceText, format, outputPath, layoutEngine }) => {
      try {
        const result = await context.diagramImageService.renderGraphvizToImage({
          sourceText,
          format,
          outputPath,
          layoutEngine,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("render_graphviz_diagram", error);
      }
    },
  );

  server.tool(
    "create_graphviz_diagram_block",
    "Render Graphviz DOT source to a PNG image, then upload it into a Feishu document.",
    {
      documentId: documentIdField,
      sourceText: z
        .string()
        .min(1)
        .describe("Graphviz DOT source text, for example `digraph G { A -> B }`."),
      layoutEngine: graphvizLayoutEngineSchema.describe(
        "Graphviz layout engine. Use `dot` for most flowcharts and dependency graphs.",
      ),
      ...createImageBlockFields,
    },
    async ({
      documentId,
      sourceText,
      layoutEngine,
      replaceBlockId,
      parentBlockId,
      index,
      fileName,
      cleanupGeneratedFile,
      width,
      height,
      documentRevisionId,
    }) => {
      try {
        const result = await context.diagramImageService.createGraphvizImageBlock({
          documentId,
          sourceText,
          layoutEngine,
          replaceBlockId,
          parentBlockId,
          index,
          fileName,
          cleanupGeneratedFile,
          width,
          height,
          documentRevisionId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("create_graphviz_diagram_block", error);
      }
    },
  );

  server.tool(
    "render_plantuml_diagram",
    "Render PlantUML source text to a local PNG or SVG file.",
    {
      sourceText: z
        .string()
        .min(1)
        .describe(
          "PlantUML source text. If `@startuml` / `@enduml` are omitted, they are added automatically.",
        ),
      format: renderFormatSchema.describe("Output format."),
      outputPath: z
        .string()
        .optional()
        .describe("Optional local output path. Defaults to a temp file under the OS temp directory."),
    },
    async ({ sourceText, format, outputPath }) => {
      try {
        const result = await context.diagramImageService.renderPlantUmlToImage({
          sourceText,
          format,
          outputPath,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("render_plantuml_diagram", error);
      }
    },
  );

  server.tool(
    "create_plantuml_diagram_block",
    "Render PlantUML source to a PNG image, then upload it into a Feishu document.",
    {
      documentId: documentIdField,
      sourceText: z
        .string()
        .min(1)
        .describe(
          "PlantUML source text. If `@startuml` / `@enduml` are omitted, they are added automatically.",
        ),
      ...createImageBlockFields,
    },
    async ({
      documentId,
      sourceText,
      replaceBlockId,
      parentBlockId,
      index,
      fileName,
      cleanupGeneratedFile,
      width,
      height,
      documentRevisionId,
    }) => {
      try {
        const result = await context.diagramImageService.createPlantUmlImageBlock({
          documentId,
          sourceText,
          replaceBlockId,
          parentBlockId,
          index,
          fileName,
          cleanupGeneratedFile,
          width,
          height,
          documentRevisionId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult("create_plantuml_diagram_block", error);
      }
    },
  );
}
