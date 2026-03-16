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
  targetHeadingLocatorFields,
} from './commonSchemas.js';

const previewOperationSchema = z.enum([
  'insert_before_heading',
  'replace_section_blocks',
  'replace_section_with_ordered_list',
  'delete_by_heading',
  'copy_section',
  'move_section',
]);

export function registerHeadingTools(server: McpServer, context: AppContext): void {
  server.tool(
    'copy_section',
    'Copy one section by heading text/path and insert it into the same document or another document. This semantic editing workflow is platform-neutral in the service layer and currently runs on Feishu blocks.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Source section heading text used for locating the section to copy.',
      }),
      ...targetHeadingLocatorFields({
        sectionHeadingDescription: 'Optional target heading text used as the insertion anchor. Omit to append.',
      }),
      chunkSize: chunkedWriteFields({
        resumeDescription: 'Unused for copy_section.',
      }).chunkSize,
      minChunkSize: chunkedWriteFields({
        resumeDescription: 'Unused for copy_section.',
      }).minChunkSize,
      adaptiveChunking: chunkedWriteFields({
        resumeDescription: 'Unused for copy_section.',
      }).adaptiveChunking,
      targetDocumentRevisionId: documentRevisionIdSchema().describe(
        'Target document revision id for insertion. -1 means latest.',
      ),
    },
    async ({
      documentId,
      sectionHeading,
      headingPath,
      parentBlockId,
      sectionOccurrence,
      pageSize,
      targetDocumentId,
      targetParentBlockId,
      targetIndex,
      targetSectionHeading,
      targetHeadingPath,
      targetSectionOccurrence,
      targetPageSize,
      targetDocumentRevisionId,
      chunkSize,
      minChunkSize,
      adaptiveChunking,
    }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.copySection({
          documentId,
          sectionHeading,
          headingPath,
          parentBlockId,
          sectionOccurrence,
          pageSize,
          targetDocumentId,
          targetParentBlockId,
          targetIndex,
          targetSectionHeading,
          targetHeadingPath,
          targetSectionOccurrence,
          targetPageSize,
          targetDocumentRevisionId,
          chunkSize,
          minChunkSize,
          adaptiveChunking,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('copy_section', error);
      }
    },
  );

  server.tool(
    'move_section',
    'Move one section by heading text/path within the same document or into another document. This semantic editing workflow is platform-neutral in the service layer and currently runs on Feishu blocks.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Source section heading text used for locating the section to move.',
      }),
      ...targetHeadingLocatorFields({
        sectionHeadingDescription: 'Optional target heading text used as the insertion anchor. Omit to append.',
      }),
      chunkSize: chunkedWriteFields({
        resumeDescription: 'Unused for move_section.',
      }).chunkSize,
      minChunkSize: chunkedWriteFields({
        resumeDescription: 'Unused for move_section.',
      }).minChunkSize,
      adaptiveChunking: chunkedWriteFields({
        resumeDescription: 'Unused for move_section.',
      }).adaptiveChunking,
      targetDocumentRevisionId: documentRevisionIdSchema().describe(
        'Target document revision id for insertion. -1 means latest.',
      ),
    },
    async ({
      documentId,
      sectionHeading,
      headingPath,
      parentBlockId,
      sectionOccurrence,
      pageSize,
      targetDocumentId,
      targetParentBlockId,
      targetIndex,
      targetSectionHeading,
      targetHeadingPath,
      targetSectionOccurrence,
      targetPageSize,
      targetDocumentRevisionId,
      chunkSize,
      minChunkSize,
      adaptiveChunking,
    }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.moveSection({
          documentId,
          sectionHeading,
          headingPath,
          parentBlockId,
          sectionOccurrence,
          pageSize,
          targetDocumentId,
          targetParentBlockId,
          targetIndex,
          targetSectionHeading,
          targetHeadingPath,
          targetSectionOccurrence,
          targetPageSize,
          targetDocumentRevisionId,
          chunkSize,
          minChunkSize,
          adaptiveChunking,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('move_section', error);
      }
    },
  );

  server.tool(
    'preview_edit_plan',
    'Preview a semantic document edit plan without executing mutations. Returns matched headings, insertion positions, and blocks that would be deleted. The planning layer is platform-neutral and the current runtime targets Feishu docs/wiki.',
    {
      operation: previewOperationSchema.describe(
        'Edit operation to preview.',
      ),
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Source or target section heading text used for locating the semantic edit anchor.',
      }),
      blocks: z
        .array(richTextBlockSchema)
        .optional()
        .describe(
          'Rich-text blocks for insert_before_heading or replace_section_blocks preview.',
        ),
      items: z
        .array(z.string())
        .optional()
        .describe(
          'Ordered-list item texts for replace_section_with_ordered_list preview.',
        ),
      includeHeading: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether delete_by_heading would also remove the heading block itself.'),
      ...targetHeadingLocatorFields({
        sectionHeadingDescription: 'Optional target heading text used as the insertion anchor for copy_section or move_section preview.',
      }),
    },
    async ({
      operation,
      documentId,
      sectionHeading,
      headingPath,
      parentBlockId,
      sectionOccurrence,
      pageSize,
      blocks,
      items,
      includeHeading,
      targetDocumentId,
      targetParentBlockId,
      targetIndex,
      targetSectionHeading,
      targetHeadingPath,
      targetSectionOccurrence,
      targetPageSize,
    }) => {
      try {
        assertHasHeadingLocator(sectionHeading, headingPath);
        const result = await context.documentEditService.previewEditPlan({
          operation,
          documentId,
          sectionHeading,
          headingPath,
          parentBlockId,
          sectionOccurrence,
          pageSize,
          blocks,
          items,
          includeHeading,
          targetDocumentId,
          targetParentBlockId,
          targetIndex,
          targetSectionHeading,
          targetHeadingPath,
          targetSectionOccurrence,
          targetPageSize,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('preview_edit_plan', error);
      }
    },
  );

  server.tool(
    'insert_before_heading',
    'Locate a heading and insert rich-text blocks right before it in one call (progressive scan + insert). This semantic editing workflow is platform-neutral in the service layer and currently runs on Feishu blocks.',
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
    'Locate one section range by heading text/path using progressive child-page scan, returning start/end indices for follow-up edits. The locator logic is platform-neutral in the service layer and currently runs on Feishu blocks.',
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
    'Replace one section content with rich-text blocks by heading text/path using progressive locate + atomic replace workflow. This semantic editing workflow is platform-neutral in the service layer and currently runs on Feishu blocks.',
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
    'upsert_section',
    'Upsert one section by heading text/path: replace its content when found, or append a new heading+content section when missing. This semantic editing workflow is platform-neutral in the service layer and currently runs on Feishu blocks.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Section heading text/path used to locate the target section. When not found, sectionHeading or the last headingPath segment is used for new section creation.',
      }),
      blocks: z
        .array(richTextBlockSchema)
        .min(1)
        .describe('Rich-text blocks to use as the section content. When creating a missing section, the heading block is added automatically.'),
      headingLevel: z
        .number()
        .int()
        .min(1)
        .max(9)
        .optional()
        .describe('Heading level for creating a missing section, within [1, 9]. Ignored when the target section already exists.'),
      ...chunkedWriteFields({
        resumeDescription: 'Skip the first N generated children, used for checkpoint resume. When creating a missing section, the generated heading counts toward this number.',
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
      headingLevel,
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
        const result = await context.documentEditService.upsertSection({
          documentId,
          sectionHeading,
          headingPath,
          blocks,
          parentBlockId,
          sectionOccurrence,
          pageSize,
          headingLevel,
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
        return errorToolResult('upsert_section', error);
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
    'Replace one section content with native ordered-list blocks of the current platform implementation by heading text. Today this creates Feishu ordered-list blocks and supports inline code spans with backticks.',
    {
      documentId: documentIdSchema(),
      ...headingLocatorFields({
        sectionHeadingDescription: 'Section heading text used for locating replacement range.',
      }),
      items: z
        .array(z.string())
        .min(1)
        .describe('Ordered-list item texts. Empty strings are ignored; inline code spans with backticks are supported.'),
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
