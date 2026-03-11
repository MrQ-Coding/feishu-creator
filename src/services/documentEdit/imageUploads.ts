import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentEditRuntime } from './context.js';
import { extractBlockIds, normalizeOptionalIndex, normalizeRevisionId } from './helpers.js';
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
  const width = normalizePositiveInt(input.width, 'width') ?? imageSize?.width;
  const height = normalizePositiveInt(input.height, 'height') ?? imageSize?.height;
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

  const width = normalizePositiveInt(input.width, 'width');
  const height = normalizePositiveInt(input.height, 'height');
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

function normalizeFileName(fileName: string | undefined, imagePath: string): string {
  const fromInput = fileName?.trim();
  if (fromInput) {
    return fromInput;
  }
  return path.basename(imagePath);
}

function inferMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  throw new Error(`Unsupported image extension: ${ext || '<none>'}. Use PNG/JPEG/GIF/BMP.`);
}

function normalizePositiveInt(value: number | undefined, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite integer.`);
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    throw new Error(`${field} must be greater than 0.`);
  }
  return normalized;
}

function detectImageSize(
  fileBytes: Buffer,
): { width: number; height: number } | undefined {
  if (isPng(fileBytes)) {
    return {
      width: fileBytes.readUInt32BE(16),
      height: fileBytes.readUInt32BE(20),
    };
  }

  if (isJpeg(fileBytes)) {
    return detectJpegSize(fileBytes);
  }

  if (isGif(fileBytes)) {
    return {
      width: fileBytes.readUInt16LE(6),
      height: fileBytes.readUInt16LE(8),
    };
  }

  if (isBmp(fileBytes)) {
    return {
      width: fileBytes.readUInt32LE(18),
      height: Math.abs(fileBytes.readInt32LE(22)),
    };
  }

  return undefined;
}

function isPng(fileBytes: Buffer): boolean {
  return (
    fileBytes.length >= 24 &&
    fileBytes[0] === 0x89 &&
    fileBytes[1] === 0x50 &&
    fileBytes[2] === 0x4e &&
    fileBytes[3] === 0x47
  );
}

function isJpeg(fileBytes: Buffer): boolean {
  return fileBytes.length >= 4 && fileBytes[0] === 0xff && fileBytes[1] === 0xd8;
}

function isGif(fileBytes: Buffer): boolean {
  return (
    fileBytes.length >= 10 &&
    (fileBytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      fileBytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  );
}

function isBmp(fileBytes: Buffer): boolean {
  return fileBytes.length >= 26 && fileBytes.subarray(0, 2).toString('ascii') === 'BM';
}

function detectJpegSize(
  fileBytes: Buffer,
): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < fileBytes.length) {
    if (fileBytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = fileBytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (offset + 2 > fileBytes.length) {
      break;
    }
    const segmentLength = fileBytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > fileBytes.length) {
      break;
    }
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame && offset + 7 < fileBytes.length) {
      return {
        height: fileBytes.readUInt16BE(offset + 3),
        width: fileBytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return undefined;
}
