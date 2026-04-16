import createClient from "@azure-rest/ai-vision-image-analysis";
import { AzureKeyCredential } from "@azure/core-auth";

const ENDPOINT = process.env.AZURE_VISION_ENDPOINT ?? "";
const KEY = process.env.AZURE_VISION_KEY ?? "";

let _client: ReturnType<typeof createClient> | null = null;

function getClient(): ReturnType<typeof createClient> | null {
  if (!ENDPOINT || !KEY) return null;
  if (!_client) {
    _client = createClient(ENDPOINT, new AzureKeyCredential(KEY));
  }
  return _client;
}

/**
 * Analyzes an image buffer with Azure Computer Vision and returns a
 * comma-separated string of caption text, object/scene tags, and OCR words.
 * Returns "" gracefully if the service is not configured or the call fails.
 */
export async function analyzePhoto(buffer: Buffer, mimeType: string): Promise<string> {
  if (!mimeType.startsWith("image/")) return "";
  const client = getClient();
  if (!client) return "";

  try {
    const result = await client.path("/imageanalysis:analyze").post({
      body: buffer,
      queryParameters: {
        features: ["Tags", "Read"],
        language: "en",
        "api-version": "2024-02-01",
      } as Record<string, string | string[]>,
      contentType: "application/octet-stream",
    });

    if (result.status !== "200") return "";
    const body = result.body as Record<string, unknown>;

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
