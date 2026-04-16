#!/usr/bin/env node
/**
 * One-shot backfill: analyse all photos without AI tags using Azure Computer Vision.
 * Run from the api-server directory:
 *   AZURE_VISION_ENDPOINT=https://... AZURE_VISION_KEY=... node backfill-vision.mjs
 *
 * Optional env vars:
 *   BATCH_SIZE   - photos processed in each batch (default 5)
 *   MAX_PHOTOS   - stop after this many (default unlimited)
 */
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import pg from "pg";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL env var required");

const ENDPOINT = process.env.AZURE_VISION_ENDPOINT;
const KEY = process.env.AZURE_VISION_KEY;
if (!ENDPOINT || !KEY) throw new Error("AZURE_VISION_ENDPOINT and AZURE_VISION_KEY env vars required");

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
if (!accountName || !containerName) throw new Error("AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_CONTAINER_NAME required");

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? "5", 10);
const MAX_PHOTOS = process.env.MAX_PHOTOS ? parseInt(process.env.MAX_PHOTOS, 10) : Infinity;

// ── Azure Blob ──────────────────────────────────────────────────────────────
const credential = new DefaultAzureCredential();
const blobServiceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
const containerClient = blobServiceClient.getContainerClient(containerName);

async function downloadBlob(blobName) {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const downloadResponse = await blockBlobClient.download(0);
  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ── Azure Vision ────────────────────────────────────────────────────────────
const API_VERSION = "2024-02-01";
const ANALYZE_URL = `${ENDPOINT.replace(/\/$/, "")}/computervision/imageanalysis:analyze?api-version=${API_VERSION}&features=Caption,Tags,Read&language=en`;

async function analyzeBuffer(buffer, mimeType) {
  const res = await fetch(ANALYZE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Ocp-Apim-Subscription-Key": KEY,
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`  Vision API error ${res.status}: ${text}`);
    return "";
  }

  const body = await res.json();
  const parts = [];

  if (body.captionResult?.text) parts.push(body.captionResult.text);
  body.tagsResult?.values?.forEach((t) => {
    if (t.confidence > 0.5) parts.push(t.name);
  });
  body.readResult?.blocks?.forEach((b) => {
    b.lines?.forEach((l) => {
      if (l.text?.trim()) parts.push(l.text.trim());
    });
  });

  return parts.join(", ");
}

// ── Main ────────────────────────────────────────────────────────────────────
const { Client } = pg;
const dbClient = new Client({ connectionString: DB_URL });
await dbClient.connect();

const result = await dbClient.query(`
  SELECT id, blob_name, content_type
  FROM public.photos
  WHERE tags IS NULL AND content_type LIKE 'image/%'
  ORDER BY uploaded_at DESC
`);

const rows = result.rows.slice(0, MAX_PHOTOS);
console.log(`Found ${rows.length} photos without AI tags (of ${result.rows.length} total).\n`);

let success = 0;
let failed = 0;

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  await Promise.all(
    batch.map(async (row) => {
      try {
        console.log(`[${i + 1}/${rows.length}] Analyzing ${row.blob_name} …`);
        const buffer = await downloadBlob(row.blob_name);
        const tags = await analyzeBuffer(buffer, row.content_type);
        if (tags) {
          await dbClient.query("UPDATE public.photos SET tags = $1 WHERE id = $2", [tags, row.id]);
          console.log(`  ✓ tags: ${tags.slice(0, 80)}${tags.length > 80 ? "…" : ""}`);
          success++;
        } else {
          console.log(`  – no tags produced`);
          failed++;
        }
      } catch (err) {
        console.error(`  ✗ error: ${err.message}`);
        failed++;
      }
    }),
  );
  // Brief pause between batches to respect F0 rate limits (20 TPS)
  if (i + BATCH_SIZE < rows.length) await new Promise((r) => setTimeout(r, 500));
}

await dbClient.end();
console.log(`\nDone. ${success} tagged, ${failed} failed/skipped.`);
