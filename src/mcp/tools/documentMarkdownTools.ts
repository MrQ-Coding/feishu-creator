import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../../appContext.js';
import { registerAliasedTool } from './registerAliasedTool.js';
import { errorToolResult, jsonToolResult } from './toolResponse.js';
import {
  chunkedWriteFields,
  documentIdSchema,
  optionalIndexSchema,
  optionalParentBlockIdSchema,
} from './documentEdit/commonSchemas.js';

export function registerDocumentMarkdownTools(
  server: McpServer,
  context: AppContext,
): void {
  const importMarkdownSchema = {
    documentId: documentIdSchema(),
    parentBlockId: optionalParentBlockIdSchema(),
    index: optionalIndexSchema(),
    markdown: z.string().min(1).describe('Markdown source text to import.'),
    ...chunkedWriteFields({
      resumeDescription: 'Skip the first N generated children, used for checkpoint resume.',
    }),
  };
  const handleImportMarkdown = async ({
    documentId,
    parentBlockId,
    index,
    markdown,
    chunkSize,
    minChunkSize,
    adaptiveChunking,
    resumeFromCreatedCount,
    checkpointTokenSeed,
    documentRevisionId,
    continueOnError,
  }: z.infer<z.ZodObject<typeof importMarkdownSchema>>) => {
    try {
      const result = await context.markdownDocumentService.importMarkdown({
        documentId,
        parentBlockId,
        index,
        markdown,
        chunkSize,
        minChunkSize,
        adaptiveChunking,
        resumeFromCreatedCount,
        checkpointTokenSeed,
        documentRevisionId,
        continueOnError,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult('import_markdown_to_document', error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: 'import_markdown_to_document',
        description:
          'Import minimal Markdown into a document subtree of the current platform implementation. This Markdown-to-block workflow is platform-neutral in the service layer and is currently backed by Feishu doc/wiki blocks.',
      },
      {
        name: 'import_markdown_to_feishu',
        description:
          'Legacy Feishu-named alias for Markdown import. This is a platform-neutral Markdown-to-block workflow in the service layer and is currently backed by Feishu doc/wiki blocks.',
      },
    ],
    importMarkdownSchema,
    handleImportMarkdown,
  );

  const exportMarkdownSchema = {
    documentId: documentIdSchema(),
    parentBlockId: optionalParentBlockIdSchema(),
  };
  const handleExportMarkdown = async ({
    documentId,
    parentBlockId,
  }: z.infer<z.ZodObject<typeof exportMarkdownSchema>>) => {
    try {
      const result = await context.markdownDocumentService.exportMarkdown({
        documentId,
        parentBlockId,
      });
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult('export_document_to_markdown', error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: 'export_document_to_markdown',
        description:
          'Export a document subtree of the current platform implementation to minimal Markdown. This block-to-Markdown workflow is platform-neutral in the service layer and is currently backed by Feishu doc/wiki blocks.',
      },
      {
        name: 'export_feishu_document_to_markdown',
        description:
          'Legacy Feishu-named alias for Markdown export. This is a platform-neutral block-to-Markdown workflow in the service layer and is currently backed by Feishu doc/wiki blocks.',
      },
    ],
    exportMarkdownSchema,
    handleExportMarkdown,
  );
}
