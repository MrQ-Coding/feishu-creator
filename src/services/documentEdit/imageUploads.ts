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

export async function uploadLocalImageCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: UploadLocalImageInput,
): Promise<UploadLocalImageResult> {
  const normalized = await normalizeUploadInput(input);
  const imageBytes = await readFile(normalized.imagePath);
  let imageBlockId = normalized.imageBlockId;
  let currentRevisionId = normalized.documentRevisionId;
  let mode: UploadLocalImageResult['mode'] = 'replace';

  if (!imageBlockId) {
    mode = 'insert';
    const requestBody: Record<string, unknown> = {
      children: [
        {
          block_type: 27,
          image: {
            width: normalized.width,
            height: normalized.height,
            token: '',
          },
        },
      ],
    };
    if (normalized.index !== undefined) {
      requestBody.index = normalized.index;
    }

    const createResult = await runtime.feishuClient.request<CreateBlockChildrenResponse>(
      `/docx/v1/documents/${normalizedDocumentId}/blocks/${normalized.parentBlockId}/children`,
      'POST',
      requestBody,
      {
        document_revision_id: currentRevisionId,
        client_token: randomUUID(),
      },
    );
    imageBlockId = extractBlockIds(createResult.children ?? [])[0];
    if (!imageBlockId) {
      throw new Error('Image block creation failed: response missing created block_id.');
    }
    if (typeof createResult.document_revision_id === 'number') {
      currentRevisionId = createResult.document_revision_id;
    }
  }

  const formData = new FormData();
  const blob = new Blob([imageBytes], { type: normalized.mimeType });
  formData.append('file', blob, normalized.fileName);
  formData.append('file_name', normalized.fileName);
  formData.append('parent_type', 'docx_image');
  formData.append('parent_node', imageBlockId);
  formData.append('size', String(imageBytes.byteLength));

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
    `/docx/v1/documents/${normalizedDocumentId}/blocks/${imageBlockId}`,
    'PATCH',
    {
      replace_image: {
        token: fileToken,
      },
    },
    {
      document_revision_id: currentRevisionId,
    },
  );

  runtime.invalidateDocumentState(normalizedDocumentId);

  return {
    documentId: normalizedDocumentId,
    mode,
    imageBlockId,
    parentBlockId: normalized.parentBlockId,
    replaceBlockId: normalized.imageBlockId,
    index: normalized.index,
    imagePath: normalized.imagePath,
    fileName: normalized.fileName,
    mimeType: normalized.mimeType,
    fileToken,
    size: imageBytes.byteLength,
    width: normalized.width,
    height: normalized.height,
    documentRevisionId: bindResult.document_revision_id,
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
