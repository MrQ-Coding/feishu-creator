import path from 'node:path';

export function normalizeFileName(fileName: string | undefined, imagePath: string): string {
  const fromInput = fileName?.trim();
  if (fromInput) {
    return fromInput;
  }
  return path.basename(imagePath);
}

export function inferMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  throw new Error(`Unsupported image extension: ${ext || '<none>'}. Use PNG/JPEG/GIF/BMP.`);
}

export function normalizePositiveImageDimension(
  value: number | undefined,
  field: string,
): number | undefined {
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

export function resolveImageDimensions(
  widthOverride: number | undefined,
  heightOverride: number | undefined,
  imageSize: { width: number; height: number } | undefined,
): { width?: number; height?: number } {
  if (widthOverride && heightOverride) {
    return { width: widthOverride, height: heightOverride };
  }
  if (!imageSize?.width || !imageSize?.height) {
    return {
      width: widthOverride,
      height: heightOverride,
    };
  }
  if (widthOverride) {
    return {
      width: widthOverride,
      height: Math.max(1, Math.round((imageSize.height * widthOverride) / imageSize.width)),
    };
  }
  if (heightOverride) {
    return {
      width: Math.max(1, Math.round((imageSize.width * heightOverride) / imageSize.height)),
      height: heightOverride,
    };
  }
  return imageSize;
}

export function detectImageSize(
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
