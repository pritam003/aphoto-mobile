#!/usr/bin/env node
/**
 * One-shot backfill:
 *   1. AI Vision (Tags + OCR) for photos without tags
 *   2. GPS reverse-geocoding for photos without location_name
 * Run from the api-server directory:
 *   AZURE_VISION_ENDPOINT=https://... AZURE_VISION_KEY=... node backfill-vision.mjs
 *
 * Optional env vars:
 *   BATCH_SIZE   - photos processed in each batch for vision (default 3)
 *   MAX_PHOTOS   - stop after this many (default unlimited)
 */
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import pg from "pg";
import exifr from "exifr";

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
const ANALYZE_URL = `${ENDPOINT.replace(/\/$/, "")}/computervision/imageanalysis:analyze?api-version=${API_VERSION}&features=Tags,Read&language=en`;

async function analyzeBuffer(buffer, mimeType) {
  // Retry up to 3 times on 429 with the Retry-After delay
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Ocp-Apim-Subscription-Key": KEY,
      },
      body: buffer,
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10) + 1;
      console.warn(`  429 — waiting ${retryAfter}s before retry …`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      console.warn(`  Vision API error ${res.status}: ${text}`);
      return "";
    }

    const body = await res.json();
    const parts = [];

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
  return "";
}

// ── Main ────────────────────────────────────────────────────────────────────
const { Client } = pg;
const dbClient = new Client({ connectionString: DB_URL });
await dbClient.connect();

// Ensure columns exist
await dbClient.query("ALTER TABLE photos ADD COLUMN IF NOT EXISTS tags TEXT");
await dbClient.query("ALTER TABLE photos ADD COLUMN IF NOT EXISTS location_name TEXT");

// ── Phase 1: AI Vision tagging ───────────────────────────────────────────────
const result = await dbClient.query(`
  SELECT id, blob_name, content_type
  FROM public.photos
  WHERE tags IS NULL AND content_type LIKE 'image/%'
  ORDER BY uploaded_at DESC
`);

const rows = result.rows.slice(0, MAX_PHOTOS);
console.log(`\n── Phase 1: AI Vision ──────────────────────────────────────────`);
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
  // 3 seconds per photo keeps us well under the F0 limit of 20 calls/min
  if (i + BATCH_SIZE < rows.length) await new Promise((r) => setTimeout(r, 3200 * BATCH_SIZE));
}

console.log(`\nPhase 1 done. ${success} tagged, ${failed} failed/skipped.`);

// ── Phase 2: GPS reverse-geocoding ──────────────────────────────────────────
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "PhotoMasterBackfill/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const addr = data.address ?? {};
    const parts = [
      addr.suburb || addr.neighbourhood || addr.village || addr.town,
      addr.city || addr.municipality || addr.county,
      addr.state,
      addr.country,
    ].filter(Boolean);
    return parts.join(", ");
  } catch {
    return "";
  }
}

const gpsResult = await dbClient.query(`
  SELECT id, blob_name, content_type
  FROM public.photos
  WHERE location_name IS NULL AND content_type LIKE 'image/%'
  ORDER BY uploaded_at DESC
`);

const gpsRows = gpsResult.rows.slice(0, MAX_PHOTOS);
console.log(`\n── Phase 2: GPS reverse-geocoding ──────────────────────────────`);
console.log(`Found ${gpsRows.length} photos without location.\n`);

let gpsSuccess = 0;
let gpsNoData = 0;

for (let i = 0; i < gpsRows.length; i++) {
  const row = gpsRows[i];
  try {
    const buffer = await downloadBlob(row.blob_name);
    const gps = await exifr.gps(buffer).catch(() => null);
    if (gps?.latitude != null && gps?.longitude != null) {
      const location = await reverseGeocode(gps.latitude, gps.longitude);
      if (location) {
        await dbClient.query("UPDATE public.photos SET location_name = $1 WHERE id = $2", [location, row.id]);
        console.log(`  [${i + 1}/${gpsRows.length}] ✓ ${location}`);
        gpsSuccess++;
      } else {
        await dbClient.query("UPDATE public.photos SET location_name = $1 WHERE id = $2", ["", row.id]);
        gpsNoData++;
      }
    } else {
      // Mark as processed (no GPS) to skip on next run
      await dbClient.query("UPDATE public.photos SET location_name = $1 WHERE id = $2", ["", row.id]);
      gpsNoData++;
    }
    // Nominatim allows max 1 req/s
    if (i < gpsRows.length - 1) await new Promise((r) => setTimeout(r, 1100));
  } catch (err) {
    console.error(`  [${i + 1}/${gpsRows.length}] ✗ ${err.message}`);
  }
}

console.log(`\nPhase 2 done. ${gpsSuccess} locations found, ${gpsNoData} without GPS.`);

await dbClient.end();
console.log(`\nAll done.`);
