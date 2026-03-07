import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../../../appContext.js';
import { errorToolResult, jsonToolResult } from '../toolResponse.js';
import { richTextBlockSchema } from './schemas.js';
import { assertHasHeadingLocator } from './validators.js';
import {
  chunkedWriteFields,
  documentIdSchema,
  documentRevisionIdSchema,
  headingLocatorFields,
} from './commonSchemas.js';

export function registerHeadingTools(server: McpServer, context: AppContext): void {
  server.tool(
    'insert_before_heading',
    'Locate a heading and insert rich-text blocks right before it in one call (progressive scan + insert).',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Target heading text used for insertion anchor.',
      }),
      blocks: z.array(richTextBlockSchema).min(1).describe('Rich-text blocks to insert before the target heading.'),
      ...chunkedWriteFields({
        resumeDescription: 'Skip the first N generated children, used for checkpoint resume.',
      }),
    },
    async ({
      documentId,
      sectionHeading,
      headingPath,
      blocks,
      parentBlockId,
      sectionOccurrence,
      pageSize,
      chunkSize,
      minChunkSize,
      adaptiveChunking,
      resumeFromCreatedCount,
      checkpointTokenSeed,
      documentRevisionId,
      continueOnError,
    }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.insertBeforeHeading({
          documentId,
          sectionHeading,
          headingPath,
          blocks,
          parentBlockId,
          sectionOccurrence,
          pageSize,
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
        return errorToolResult('insert_before_heading', error);
      }
    },
  );

  server.tool(
    'locate_section_range',
    'Locate one section range by heading text/path using progressive child-page scan, returning start/end indices for follow-up edits.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Section heading text for locating the range.',
      }),
    },
    async ({ documentId, sectionHeading, headingPath, parentBlockId, sectionOccurrence, pageSize }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.locateSectionRange({
          documentId,
          sectionHeading,
          headingPath,
          parentBlockId,
          sectionOccurrence,
          pageSize,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('locate_section_range', error);
      }
    },
  );

  server.tool(
    'replace_section_blocks',
    'Replace one section content with rich-text blocks by heading text/path using progressive locate + atomic replace workflow.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Section heading text used for locating replacement range.',
      }),
      blocks: z.array(richTextBlockSchema).min(1).describe('Rich-text blocks to replace current section content.'),
      ...chunkedWriteFields({
        resumeDescription: 'Skip the first N generated children, used for checkpoint resume.',
      }),
    },
    async ({
      documentId,
      sectionHeading,
      headingPath,
      blocks,
      parentBlockId,
      sectionOccurrence,
      pageSize,
      chunkSize,
      minChunkSize,
      adaptiveChunking,
      resumeFromCreatedCount,
      checkpointTokenSeed,
      documentRevisionId,
      continueOnError,
    }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.replaceSectionBlocks({
          documentId,
          sectionHeading,
          headingPath,
          blocks,
          parentBlockId,
          sectionOccurrence,
          pageSize,
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
        return errorToolResult('replace_section_blocks', error);
      }
    },
  );

  server.tool(
    'delete_by_heading',
    'Delete section content (or whole section including heading) by heading text/path using progressive locate.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Section heading text used for locating delete range.',
      }),
      includeHeading: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether to delete the heading block itself together with its content.'),
      documentRevisionId: documentRevisionIdSchema(),
    },
    async ({
      documentId,
      sectionHeading,
      headingPath,
      parentBlockId,
      sectionOccurrence,
      pageSize,
      includeHeading,
      documentRevisionId,
    }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.deleteByHeading({
          documentId,
          sectionHeading,
          headingPath,
          parentBlockId,
          sectionOccurrence,
          pageSize,
          includeHeading,
          documentRevisionId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('delete_by_heading', error);
      }
    },
  );

  server.tool(
    'replace_section_with_ordered_list',
    'Replace one section content with Feishu native ordered-list blocks by heading text. Uses minimal block traversal and no markdown convert.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Section heading text used for locating replacement range.',
      }),
      items: z.array(z.string()).min(1).describe('Ordered-list item texts. Empty strings are ignored.'),
      documentRevisionId: documentRevisionIdSchema(),
    },
    async ({
      documentId,
      sectionHeading,
      headingPath,
      items,
      parentBlockId,
      sectionOccurrence,
      pageSize,
      documentRevisionId,
    }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.replaceSectionWithOrderedList({
          documentId,
          sectionHeading,
          headingPath,
          items,
          parentBlockId,
          sectionOccurrence,
          pageSize,
          documentRevisionId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('replace_section_with_ordered_list', error);
      }
    },
  );
}
