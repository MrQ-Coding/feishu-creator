import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../../../appContext.js';
import { errorToolResult, jsonToolResult } from '../toolResponse.js';
import { richTextBlockSchema } from './schemas.js';
import {
  chunkedWriteFields,
  documentIdSchema,
  optionalIndexSchema,
  optionalParentBlockIdSchema,
} from './commonSchemas.js';

export function registerGenerateTools(server: McpServer, context: AppContext): void {
  server.tool(
    'generate_section_blocks',
    'Generate a section by composing heading, paragraphs, ordered items, and bullet items, then batch insert with minimal API calls.',
    {
      documentId: documentIdSchema(),
      parentBlockId: optionalParentBlockIdSchema(),
      index: optionalIndexSchema(),
      title: z.string().min(1).describe('Section title text.'),
      headingLevel: z
        .number()
        .int()
        .min(1)
        .max(9)
        .optional()
        .default(2)
        .describe('Heading level for title, within [1, 9].'),
      paragraphs: z.array(z.string()).optional().default([]).describe('Plain paragraph texts.'),
      orderedItems: z
        .array(z.string())
        .optional()
        .default([])
        .describe('Ordered-list item texts.'),
      bulletItems: z
        .array(z.string())
        .optional()
        .default([])
        .describe('Bullet-list item texts.'),
      ...chunkedWriteFields({
        resumeDescription: 'Skip the first N generated children, used for checkpoint resume.',
      }),
    },
    async ({
      documentId,
      parentBlockId,
      index,
      title,
      headingLevel,
      paragraphs,
      orderedItems,
      bulletItems,
      chunkSize,
      minChunkSize,
      adaptiveChunking,
      resumeFromCreatedCount,
      checkpointTokenSeed,
      documentRevisionId,
      continueOnError,
    }) => {
      try {
        const result = await context.documentEditService.generateSectionBlocks({
          documentId,
          parentBlockId,
          index,
          title,
          headingLevel,
          paragraphs,
          orderedItems,
          bulletItems,
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
        return errorToolResult('generate_section_blocks', error);
      }
    },
  );

  server.tool(
    'generate_rich_text_blocks',
    'Generate rich text blocks (heading/text/ordered/bullet/quote/code) and batch insert with minimal API calls.',
    {
      documentId: documentIdSchema(),
      parentBlockId: optionalParentBlockIdSchema(),
      index: optionalIndexSchema(),
      blocks: z
        .array(richTextBlockSchema)
        .min(1)
        .describe(
          'Rich-text blocks to generate. heading uses headingLevel; code can use codeLanguage/codeWrap.',
        ),
      ...chunkedWriteFields({
        resumeDescription: 'Skip the first N generated children, used for checkpoint resume.',
      }),
    },
    async ({
      documentId,
      parentBlockId,
      index,
      blocks,
      chunkSize,
      minChunkSize,
      adaptiveChunking,
      resumeFromCreatedCount,
      checkpointTokenSeed,
      documentRevisionId,
      continueOnError,
    }) => {
      try {
        const result = await context.documentEditService.generateRichTextBlocks({
          documentId,
          parentBlockId,
          index,
          blocks,
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
        return errorToolResult('generate_rich_text_blocks', error);
      }
    },
  );
}
