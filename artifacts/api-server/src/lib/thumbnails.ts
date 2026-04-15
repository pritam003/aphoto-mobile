/**
 * Thumbnail generation using sharp.
 * Generates two variants for every uploaded image:
 *   thumb/   — 600×600px JPEG cover crop (for grid, ~50-80KB)
 *   preview/ — 1920px wide JPEG (for lightbox, ~300-500KB)
 */

import sharp from "sharp";
import path from "path";
import { uploadBlob } from "./azure-storage.js";

const THUMB_SIZE = 600;
const PREVIEW_WIDTH = 1920;

export interface ThumbnailResult {
  thumbBlobName: string;
  previewBlobName: string;
}

/**
 * Generate thumb + preview from an image buffer and upload both to blob storage.
 * Returns null for videos or on error (callers fall back to original URL).
 */
export async function generateThumbnails(
  buffer: Buffer,
  originalBlobName: string,
  contentType: string,
): Promise<ThumbnailResult | null> {
  if (!contentType.startsWith("image/")) return null;

  const dir = path.dirname(originalBlobName);
  const base = path.basename(originalBlobName, path.extname(originalBlobName));

  const thumbBlobName = `${dir}/thumb_${base}.jpg`;
  const previewBlobName = `${dir}/preview_${base}.jpg`;

  try {
    const sharpInstance = sharp(buffer, { failOn: "none" }).rotate(); // auto-rotate from EXIF

    const [thumbBuf, previewBuf] = await Promise.all([
      sharpInstance
        .clone()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover", position: "centre" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer(),
      sharpInstance
        .clone()
        .resize(PREVIEW_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer(),
    ]);

    await Promise.all([
      uploadBlob(thumbBlobName, thumbBuf, "image/jpeg"),
      uploadBlob(previewBlobName, previewBuf, "image/jpeg"),
    ]);

    return { thumbBlobName, previewBlobName };
  } catch (err) {
    console.error("[thumbnails] generation failed:", err);
    return null;
  }
}
