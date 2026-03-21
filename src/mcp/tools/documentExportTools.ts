import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../../appContext.js';
import { registerAliasedTool } from './registerAliasedTool.js';
import { errorToolResult, jsonToolResult } from './toolResponse.js';
import { documentIdSchema } from './documentEdit/commonSchemas.js';

export function registerDocumentExportTools(
  server: McpServer,
  context: AppContext,
): void {
  const exportFileSchema = {
    documentId: documentIdSchema(),
    fileExtension: z
      .enum(['pdf', 'docx'])
      .describe('Target file format: "pdf" or "docx".'),
    outputPath: z
      .string()
      .optional()
      .describe(
        'Optional absolute path to save the exported file. Defaults to a temp directory.',
      ),
  };

  const handleExportFile = async ({
    documentId,
    fileExtension,
    outputPath,
  }: z.infer<z.ZodObject<typeof exportFileSchema>>) => {
    try {
      const result = await context.documentExportService.exportDocument({
        documentId,
        fileExtension,
        outputPath,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult('export_document_to_file', error);
    }
  };

  registerAliasedTool(
    server,
    [
      {
        name: 'export_document_to_file',
        description:
          'Export a Feishu document to PDF or DOCX file. Creates an async export task, polls until complete, downloads the file, and saves it locally. Returns the file path, name, and size.',
      },
      {
        name: 'export_feishu_document_to_file',
        description:
          'Legacy Feishu-named alias for document file export. Exports a Feishu document to PDF or DOCX format.',
      },
    ],
    exportFileSchema,
    handleExportFile,
  );
}
