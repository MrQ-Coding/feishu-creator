import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../../appContext.js';
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
  server.tool(
    'import_markdown_to_feishu',
    'Parse minimal Markdown and append the resulting blocks into a Feishu doc or wiki docx. Supports headings, paragraphs, ordered lists, bullet lists, quotes, fenced code blocks, and inline code spans.',
    {
      documentId: documentIdSchema(),
      parentBlockId: optionalParentBlockIdSchema(),
      index: optionalIndexSchema(),
      markdown: z.string().min(1).describe('Markdown source text to import.'),
      ...chunkedWriteFields({
        resumeDescription: 'Skip the first N generated children, used for checkpoint resume.',
      }),
    },
    async ({
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
    }) => {
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
        return errorToolResult('import_markdown_to_feishu', error);
      }
    },
  );

  server.tool(
    'export_feishu_document_to_markdown',
    'Export a Feishu doc or wiki docx subtree to minimal Markdown. Supports headings, paragraphs, ordered lists, bullet lists, quotes, code blocks, and common inline styles.',
    {
      documentId: documentIdSchema(),
      parentBlockId: optionalParentBlockIdSchema(),
    },
    async ({ documentId, parentBlockId }) => {
      try {
        const result = await context.markdownDocumentService.exportMarkdown({
          documentId,
          parentBlockId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('export_feishu_document_to_markdown', error);
      }
    },
  );
}
