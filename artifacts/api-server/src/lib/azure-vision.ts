import sharp from "sharp";

const ENDPOINT = process.env.AZURE_VISION_ENDPOINT ?? "";
const KEY = process.env.AZURE_VISION_KEY ?? "";

const API_VERSION = "2024-02-01";

/**
 * Analyzes an image buffer with Azure Computer Vision (Tags + OCR only, plain fetch).
 * HEIC/HEIF images are converted to JPEG first since Azure Vision does not support them.
 * Returns a comma-separated string. Returns "" if the service is not configured or fails.
 */
export async function analyzePhoto(buffer: Buffer, mimeType: string): Promise<string> {
  if (!mimeType.startsWith("image/")) return "";
  if (!ENDPOINT || !KEY) return "";

  // Azure Vision does not support HEIC/HEIF — convert to JPEG first
  let imageBuffer = buffer;
  if (mimeType === "image/heic" || mimeType === "image/heif" || mimeType === "image/heic-sequence") {
    try {
      imageBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
    } catch {
      return "";
    }
  }

  const url = `${ENDPOINT.replace(/\/$/, "")}/computervision/imageanalysis:analyze?api-version=${API_VERSION}&features=Tags,Read&language=en`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Ocp-Apim-Subscription-Key": KEY,
      },
      body: imageBuffer,
    });
    if (!res.ok) return "";

    const body = await res.json() as Record<string, unknown>;
    const parts: string[] = [];

    const tagsResult = body.tagsResult as { values?: Array<{ name: string; confidence: number }> } | undefined;
    tagsResult?.values?.forEach((t) => {
      if (t.confidence > 0.5) parts.push(t.name);
    });

    const readResult = body.readResult as { blocks?: Array<{ lines?: Array<{ text: string }> }> } | undefined;
    readResult?.blocks?.forEach((b) => {
      b.lines?.forEach((l) => {
        if (l.text?.trim()) parts.push(l.text.trim());
      });
    });

    return parts.join(", ");
  } catch {
    return "";
  }
}
