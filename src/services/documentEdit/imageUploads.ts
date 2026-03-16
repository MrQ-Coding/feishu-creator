import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentEditRuntime } from './context.js';
import { extractBlockIds, normalizeOptionalIndex, normalizeRevisionId } from './helpers.js';
import {
  detectImageSize,
  inferMimeType,
  normalizeFileName,
  normalizePositiveImageDimension,
  resolveImageDimensions,
} from './imageMetadata.js';
import type {
  CreateBlockChildrenResponse,
  UploadLocalImageInput,
  UploadLocalImageResult,
} from './types.js';

interface UploadMediaResponse {
  file_token?: string;
}

interface UpdateImageBlockResponse {
  block?: Record<string, unknown>;
  document_revision_id?: number;
}

interface NormalizedUploadInput {
  imagePath: string;
  fileName: string;
  mimeType: string;
  imageBlockId?: string;
  parentBlockId?: string;
  index?: number;
  width: number;
  height: number;
  documentRevisionId: number;
}

export interface UploadImageBytesInput {
  imageBytes: Buffer;
  fileName: string;
  mimeType: string;
  imageBlockId?: string;
  parentBlockId?: string;
  index?: number;
  width: number;
  height: number;
  documentRevisionId?: number;
}

export interface UploadImageBytesResult {
  mode: 'insert' | 'replace';
  imageBlockId: string;
  parentBlockId?: string;
  replaceBlockId?: string;
  index?: number;
  fileName: string;
  mimeType: string;
  fileToken: string;
  size: number;
  width: number;
  height: number;
  documentRevisionId?: number;
}

export async function uploadLocalImageCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: UploadLocalImageInput,
): Promise<UploadLocalImageResult> {
  const normalized = await normalizeUploadInput(input);
  const imageBytes = await readFile(normalized.imagePath);
  const uploadResult = await uploadImageBytesCore(runtime, normalizedDocumentId, {
    imageBytes,
    fileName: normalized.fileName,
    mimeType: normalized.mimeType,
    imageBlockId: normalized.imageBlockId,
    parentBlockId: normalized.parentBlockId,
    index: normalized.index,
    width: normalized.width,
    height: normalized.height,
    documentRevisionId: normalized.documentRevisionId,
  });

  return {
    documentId: normalizedDocumentId,
    mode: uploadResult.mode,
    imageBlockId: uploadResult.imageBlockId,
    parentBlockId: normalized.parentBlockId,
    replaceBlockId: normalized.imageBlockId,
    index: normalized.index,
    imagePath: normalized.imagePath,
    fileName: normalized.fileName,
    mimeType: normalized.mimeType,
    fileToken: uploadResult.fileToken,
    size: uploadResult.size,
    width: normalized.width,
    height: normalized.height,
    documentRevisionId: uploadResult.documentRevisionId,
  };
}

export async function uploadImageBytesCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: UploadImageBytesInput,
): Promise<UploadImageBytesResult> {
  const normalized = normalizeUploadBytesInput(input);
  let imageBlockId = normalized.imageBlockId;
  let currentRevisionId = normalized.documentRevisionId;
  let mode: UploadImageBytesResult['mode'] = 'replace';

  if (!imageBlockId) {
    mode = 'insert';
    const createResult = await createImageBlock(runtime, normalizedDocumentId, {
      parentBlockId: normalized.parentBlockId,
      index: normalized.index,
      width: normalized.width,
      height: normalized.height,
      documentRevisionId: currentRevisionId,
    });
    imageBlockId = createResult.imageBlockId;
    if (typeof createResult.documentRevisionId === 'number') {
      currentRevisionId = createResult.documentRevisionId;
    }
  }

  const { fileToken, documentRevisionId } = await uploadImageBytesToBlock(
    runtime,
    normalizedDocumentId,
    {
      imageBlockId,
      imageBytes: normalized.imageBytes,
      fileName: normalized.fileName,
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      documentRevisionId: currentRevisionId,
    },
  );

  return {
    mode,
    imageBlockId,
    parentBlockId: normalized.parentBlockId,
    replaceBlockId: normalized.imageBlockId,
    index: normalized.index,
    fileName: normalized.fileName,
    mimeType: normalized.mimeType,
    fileToken,
    size: normalized.imageBytes.byteLength,
    width: normalized.width,
    height: normalized.height,
    documentRevisionId,
  };
}

async function normalizeUploadInput(
  input: UploadLocalImageInput,
): Promise<NormalizedUploadInput> {
  const imagePath = path.resolve(input.imagePath?.trim() || '');
  if (!imagePath) {
    throw new Error('imagePath is required.');
  }

  const replaceBlockId = input.replaceBlockId?.trim() || undefined;
  const parentBlockId = input.parentBlockId?.trim() || undefined;
  if (replaceBlockId && parentBlockId) {
    throw new Error('Provide either replaceBlockId or parentBlockId, not both.');
  }
  if (!replaceBlockId && !parentBlockId) {
    throw new Error('Either replaceBlockId or parentBlockId is required.');
  }

  const fileStats = await readFile(imagePath).catch(() => null);
  if (!fileStats) {
    throw new Error(`imagePath does not exist or is not readable: ${imagePath}`);
  }

  const fileName = normalizeFileName(input.fileName, imagePath);
  const mimeType = inferMimeType(fileName);
  const imageSize = detectImageSize(fileStats);
  const { width, height } = resolveImageDimensions(
    normalizePositiveImageDimension(input.width, 'width'),
    normalizePositiveImageDimension(input.height, 'height'),
    imageSize,
  );
  if (!width || !height) {
    throw new Error(
      'Unable to detect image size automatically. Provide explicit width and height.',
    );
  }

  return {
    imagePath,
    fileName,
    mimeType,
    imageBlockId: replaceBlockId,
    parentBlockId,
    index: normalizeOptionalIndex(input.index),
    width,
    height,
    documentRevisionId: normalizeRevisionId(input.documentRevisionId),
  };
}

function normalizeUploadBytesInput(input: UploadImageBytesInput): UploadImageBytesInput & {
  imageBlockId?: string;
  parentBlockId?: string;
  index?: number;
  documentRevisionId: number;
} {
  const imageBlockId = input.imageBlockId?.trim() || undefined;
  const parentBlockId = input.parentBlockId?.trim() || undefined;
  if (imageBlockId && parentBlockId) {
    throw new Error('Provide either imageBlockId or parentBlockId, not both.');
  }
  if (!imageBlockId && !parentBlockId) {
    throw new Error('Either imageBlockId or parentBlockId is required.');
  }
  const fileName = input.fileName?.trim();
  if (!fileName) {
    throw new Error('fileName is required.');
  }
  const mimeType = input.mimeType?.trim();
  if (!mimeType) {
    throw new Error('mimeType is required.');
  }
  if (!(input.imageBytes instanceof Buffer) || input.imageBytes.byteLength === 0) {
    throw new Error('imageBytes must be a non-empty Buffer.');
  }

  const width = normalizePositiveImageDimension(input.width, 'width');
  const height = normalizePositiveImageDimension(input.height, 'height');
  if (!width || !height) {
    throw new Error('width and height are required.');
  }

  return {
    imageBytes: input.imageBytes,
    fileName,
    mimeType,
    imageBlockId,
    parentBlockId,
    index: normalizeOptionalIndex(input.index),
    width,
    height,
    documentRevisionId: normalizeRevisionId(input.documentRevisionId),
  };
}

async function createImageBlock(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: {
    parentBlockId?: string;
    index?: number;
    width: number;
    height: number;
    documentRevisionId: number;
  },
): Promise<{ imageBlockId: string; documentRevisionId?: number }> {
  const requestBody: Record<string, unknown> = {
    children: [
      {
        block_type: 27,
        image: {
          width: input.width,
          height: input.height,
          token: '',
        },
      },
    ],
  };
  if (input.index !== undefined) {
    requestBody.index = input.index;
  }

  const createResult = await runtime.feishuClient.request<CreateBlockChildrenResponse>(
    `/docx/v1/documents/${normalizedDocumentId}/blocks/${input.parentBlockId}/children`,
    'POST',
    requestBody,
    {
      document_revision_id: input.documentRevisionId,
      client_token: randomUUID(),
    },
  );
  const imageBlockId = extractBlockIds(createResult.children ?? [])[0];
  if (!imageBlockId) {
    throw new Error('Image block creation failed: response missing created block_id.');
  }
  return {
    imageBlockId,
    documentRevisionId: createResult.document_revision_id,
  };
}

async function uploadImageBytesToBlock(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: {
    imageBlockId: string;
    imageBytes: Buffer;
    fileName: string;
    mimeType: string;
    width: number;
    height: number;
    documentRevisionId: number;
  },
): Promise<{ fileToken: string; documentRevisionId?: number }> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(input.imageBytes)], {
    type: input.mimeType,
  });
  formData.append('file', blob, input.fileName);
  formData.append('file_name', input.fileName);
  formData.append('parent_type', 'docx_image');
  formData.append('parent_node', input.imageBlockId);
  formData.append('size', String(input.imageBytes.byteLength));

  const uploadResult = await runtime.feishuClient.request<UploadMediaResponse>(
    '/drive/v1/medias/upload_all',
    'POST',
    formData,
  );
  const fileToken = uploadResult.file_token?.trim();
  if (!fileToken) {
    throw new Error('Image upload failed: response missing file_token.');
  }

  const bindResult = await runtime.feishuClient.request<UpdateImageBlockResponse>(
    `/docx/v1/documents/${normalizedDocumentId}/blocks/${input.imageBlockId}`,
    'PATCH',
    {
      replace_image: {
        token: fileToken,
        width: input.width,
        height: input.height,
      },
    },
    {
      document_revision_id: input.documentRevisionId,
    },
  );

  runtime.invalidateDocumentState(normalizedDocumentId);

  return {
    fileToken,
    documentRevisionId: bindResult.document_revision_id,
  };
}
