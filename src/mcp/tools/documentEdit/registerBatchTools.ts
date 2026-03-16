import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../../../appContext.js';
import { registerAliasedTool } from '../registerAliasedTool.js';
import { errorToolResult, jsonToolResult } from '../toolResponse.js';
import {
  chunkedWriteFields,
  documentIdSchema,
  documentRevisionIdSchema,
  optionalIndexSchema,
  requiredParentBlockIdSchema,
} from './commonSchemas.js';

export function registerBatchTools(server: McpServer, context: AppContext): void {
  const deleteDocumentBlocksSchema = {
    documentId: documentIdSchema(),
    parentBlockId: requiredParentBlockIdSchema('Parent block ID whose children will be deleted.'),
    startIndex: z.number().int().min(0).describe('Inclusive start index in parent children.'),
    endIndex: z.number().int().min(0).describe('Exclusive end index in parent children.'),
    documentRevisionId: documentRevisionIdSchema(),
  };
  const handleDeleteDocumentBlocks = async ({
    documentId,
    parentBlockId,
    startIndex,
    endIndex,
    documentRevisionId,
  }: z.infer<z.ZodObject<typeof deleteDocumentBlocksSchema>>) => {
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
      return errorToolResult('delete_document_blocks', error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: 'delete_document_blocks',
        description:
          'Delete consecutive child blocks under one parent block by index range. This is a low-level primitive and does not perform heading lookup.',
      },
      {
        name: 'delete_feishu_document_blocks',
        description:
          'Legacy Feishu-named alias for deleting consecutive child blocks under one parent block by index range. This is a low-level primitive and does not perform heading lookup.',
      },
    ],
    deleteDocumentBlocksSchema,
    handleDeleteDocumentBlocks,
  );

  const batchCreateBlocksSchema = {
    documentId: documentIdSchema(),
    parentBlockId: requiredParentBlockIdSchema('Parent block ID where children will be inserted.'),
    children: z
      .array(z.record(z.unknown()))
      .min(1)
      .describe('Block payload array for the current platform implementation. Today this accepts native Feishu docx block payloads.'),
    index: optionalIndexSchema(),
    ...chunkedWriteFields({
      resumeDescription: 'Skip the first N children, used for checkpoint resume.',
    }),
  };
  const handleBatchCreateBlocks = async ({
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
  }: z.infer<z.ZodObject<typeof batchCreateBlocksSchema>>) => {
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
      return errorToolResult('batch_create_blocks', error);
    }
  };
  registerAliasedTool(
    server,
    [
      {
        name: 'batch_create_blocks',
        description:
          'Batch create child blocks under a parent block with chunking and detailed per-chunk result. The workflow is platform-neutral in the service layer and the current runtime accepts native Feishu block payloads.',
      },
      {
        name: 'batch_create_feishu_blocks',
        description:
          'Batch create child blocks under a parent block with chunking and detailed per-chunk result.',
      },
    ],
    batchCreateBlocksSchema,
    handleBatchCreateBlocks,
  );
}
