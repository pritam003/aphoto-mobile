#!/usr/bin/env node
/**
 * GPS reverse-geocoding backfill.
 * Reads EXIF GPS from each photo blob and updates location_name using Nominatim.
 * Rate-limited to 1 req/sec per Nominatim ToS.
 *
 * Usage (run from repo root):
 *   DATABASE_URL=... AZURE_STORAGE_ACCOUNT_NAME=... AZURE_STORAGE_CONTAINER_NAME=... node scripts/backfill-gps.mjs
 */
import pg from "pg";
import exifr from "exifr";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL env var required");

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "photos";
if (!accountName) throw new Error("AZURE_STORAGE_ACCOUNT_NAME required");

const DELAY_MS = 1100; // Nominatim: max 1 req/sec
const MAX_PHOTOS = process.env.MAX_PHOTOS ? parseInt(process.env.MAX_PHOTOS, 10) : Infinity;

// ── Download blob via SAS / managed identity ─────────────────────────────────
// Use Azure Storage REST directly with DefaultAzureCredential token
async function getAccessToken() {
  // Try workload identity / managed identity via IMDS
  const res = await fetch(
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://storage.azure.com/",
    { headers: { "Metadata": "true" } }
  ).catch(() => null);
  if (res?.ok) {
    const data = await res.json();
    return data.access_token;
  }
  return null;
}

async function downloadBlob(blobName) {
  // Use Azure AD token via DefaultAzureCredential (az login / managed identity)
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const cred = new DefaultAzureCredential();
  const blobService = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, cred);
  const cc = blobService.getContainerClient(containerName);
  const bc = cc.getBlockBlobClient(blobName);
  const dl = await bc.download(0);
  const chunks = [];
  for await (const chunk of dl.readableStreamBody) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// ── Nominatim reverse geocode ─────────────────────────────────────────────────
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PhotoMasterApp/1.0 (backfill-gps-script)" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.address) return null;
    const a = data.address;
    // Build a human-readable label: City, State, Country
    const parts = [
      a.city || a.town || a.village || a.county || a.municipality,
      a.state,
      a.country,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : (data.display_name?.split(",").slice(0, 2).join(",").trim() || null);
  } catch {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────
const dbClient = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();
console.log("Connected to DB");

const result = await dbClient.query(`
  SELECT id, blob_name, content_type FROM photos
  WHERE location_name IS NULL AND content_type LIKE 'image/%' AND trashed = false
  ORDER BY uploaded_at DESC
`);
const rows = result.rows.slice(0, MAX_PHOTOS);
console.log(`Found ${rows.length} photos without location.\n`);

let success = 0;
let noGps = 0;
let errors = 0;

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  process.stdout.write(`[${i + 1}/${rows.length}] ${row.blob_name} ... `);
  try {
    const buffer = await downloadBlob(row.blob_name);
    const gps = await exifr.gps(buffer).catch(() => null);
    if (gps?.latitude != null && gps?.longitude != null) {
      const location = await reverseGeocode(gps.latitude, gps.longitude);
      if (location) {
        await dbClient.query("UPDATE photos SET location_name = $1 WHERE id = $2", [location, row.id]);
        console.log(`✓ ${location}`);
        success++;
        await sleep(DELAY_MS); // rate limit Nominatim
      } else {
        console.log("no location from geocoder");
        // Mark as processed with empty string so we skip next time
        await dbClient.query("UPDATE photos SET location_name = '' WHERE id = $1", [row.id]);
        noGps++;
      }
    } else {
      console.log("no GPS");
      await dbClient.query("UPDATE photos SET location_name = '' WHERE id = $1", [row.id]);
      noGps++;
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    errors++;
  }
}

await dbClient.end();
console.log(`\nDone. ${success} geocoded, ${noGps} no GPS, ${errors} errors.`);
