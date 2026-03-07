import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../../../appContext.js';
import { errorToolResult, jsonToolResult } from '../toolResponse.js';
import {
  chunkedWriteFields,
  documentIdSchema,
  documentRevisionIdSchema,
  optionalIndexSchema,
  requiredParentBlockIdSchema,
} from './commonSchemas.js';

export function registerBatchTools(server: McpServer, context: AppContext): void {
  server.tool(
    'delete_feishu_document_blocks',
    'Delete consecutive child blocks under one parent block by index range. This is a low-level primitive and does not perform heading lookup.',
    {
      documentId: documentIdSchema(),
      parentBlockId: requiredParentBlockIdSchema('Parent block ID whose children will be deleted.'),
      startIndex: z.number().int().min(0).describe('Inclusive start index in parent children.'),
      endIndex: z.number().int().min(0).describe('Exclusive end index in parent children.'),
      documentRevisionId: documentRevisionIdSchema(),
    },
    async ({ documentId, parentBlockId, startIndex, endIndex, documentRevisionId }) => {
      try {
        const result = await context.documentEditService.deleteDocumentBlocks({
          documentId,
          parentBlockId,
          startIndex,
          endIndex,
          documentRevisionId,
        });
        return jsonToolResult(result);
      } catch (error) {
        return errorToolResult('delete_feishu_document_blocks', error);
      }
    },
  );

  server.tool(
    'batch_create_feishu_blocks',
    'Batch create child blocks under a parent block with chunking and detailed per-chunk result.',
    {
      documentId: documentIdSchema(),
      parentBlockId: requiredParentBlockIdSchema('Parent block ID where children will be inserted.'),
      children: z
        .array(z.record(z.unknown()))
        .min(1)
        .describe('Block payload array that follows Feishu docx block schema.'),
      index: optionalIndexSchema(),
      ...chunkedWriteFields({
        resumeDescription: 'Skip the first N children, used for checkpoint resume.',
      }),
    },
    async ({
      documentId,
      parentBlockId,
      children,
      index,
      chunkSize,
      minChunkSize,
      adaptiveChunking,
      resumeFromCreatedCount,
      checkpointTokenSeed,
      documentRevisionId,
      continueOnError,
    }) => {
      try {
        const result = await context.documentEditService.batchCreateBlocks({
          documentId,
          parentBlockId,
          children,
          index,
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
        return errorToolResult('batch_create_feishu_blocks', error);
      }
    },
  );
}
