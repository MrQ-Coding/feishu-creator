import { z } from 'zod';

export function documentIdSchema() {
  return z
    .string()
    .describe(
      'Document ID or URL. Examples: https://xxx.feishu.cn/docx/xxx or raw document id.',
    );
}

export function optionalTargetDocumentIdSchema() {
  return z
    .string()
    .optional()
    .describe('Optional target document ID or URL. Defaults to the source document.');
}

export function optionalParentBlockIdSchema() {
  return z
    .string()
    .optional()
    .describe('Optional parent block ID. Defaults to document root block.');
}

export function requiredParentBlockIdSchema(description: string) {
  return z.string().min(1).describe(description);
}

export function optionalIndexSchema() {
  return z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Insert position in parent children. Omit to append.');
}

export function targetIndexSchema() {
  return z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Optional target insert position in target parent children. Do not combine with targetSectionHeading/targetHeadingPath.',
    );
}

export function sectionHeadingSchema(description: string) {
  return z.string().optional().describe(description);
}

export function headingPathSchema() {
  return z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      "Optional heading path, e.g. ['二、章节', '2.1 小节']. If provided, it takes priority over sectionHeading.",
    );
}

export function sectionOccurrenceSchema() {
  return z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe('If heading text/path appears multiple times, choose the Nth occurrence.');
}

export function pageSizeSchema() {
  return z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(200)
    .describe('Page size for progressive listing under the parent block.');
}

export function documentRevisionIdSchema() {
  return z
    .number()
    .int()
    .min(-1)
    .optional()
    .default(-1)
    .describe('Target document revision id. -1 means latest.');
}

export function chunkSizeSchema() {
  return z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(50)
    .describe('Max children per API request chunk.');
}

export function minChunkSizeSchema() {
  return z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(5)
    .describe('Lower bound when adaptive chunking shrinks request size.');
}

export function adaptiveChunkingSchema() {
  return z
    .boolean()
    .optional()
    .default(true)
    .describe('Auto-shrink chunk size on rate-limit/server-pressure errors.');
}

export function resumeFromCreatedCountSchema(description: string) {
  return z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe(description);
}

export function checkpointTokenSeedSchema() {
  return z
    .string()
    .optional()
    .describe(
      'Optional deterministic seed for client_token generation across retries/resume runs.',
    );
}

export function continueOnErrorSchema() {
  return z
    .boolean()
    .optional()
    .default(false)
    .describe('Continue subsequent chunks when one chunk fails.');
}

export function headingLocatorFields(options: {
  sectionHeadingDescription: string;
}) {
  return {
    sectionHeading: sectionHeadingSchema(options.sectionHeadingDescription),
    headingPath: headingPathSchema(),
    parentBlockId: optionalParentBlockIdSchema(),
    sectionOccurrence: sectionOccurrenceSchema(),
    pageSize: pageSizeSchema(),
  };
}

export function chunkedWriteFields(options: {
  resumeDescription: string;
}) {
  return {
    chunkSize: chunkSizeSchema(),
    minChunkSize: minChunkSizeSchema(),
    adaptiveChunking: adaptiveChunkingSchema(),
    resumeFromCreatedCount: resumeFromCreatedCountSchema(options.resumeDescription),
    checkpointTokenSeed: checkpointTokenSeedSchema(),
    documentRevisionId: documentRevisionIdSchema(),
    continueOnError: continueOnErrorSchema(),
  };
}

export function targetHeadingLocatorFields(options: {
  sectionHeadingDescription: string;
}) {
  return {
    targetDocumentId: optionalTargetDocumentIdSchema(),
    targetParentBlockId: z
      .string()
      .optional()
      .describe('Optional target parent block ID. Defaults to target document root block.'),
    targetIndex: targetIndexSchema(),
    targetSectionHeading: sectionHeadingSchema(options.sectionHeadingDescription),
    targetHeadingPath: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Optional target heading path, e.g. ['二、章节', '2.1 小节']. If provided, it takes priority over targetSectionHeading.",
      ),
    targetSectionOccurrence: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(1)
      .describe('If target heading text/path appears multiple times, choose the Nth occurrence.'),
    targetPageSize: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(200)
      .describe('Page size for progressive listing under the target parent block.'),
  };
}
