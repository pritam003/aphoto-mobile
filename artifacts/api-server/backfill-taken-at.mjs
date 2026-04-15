#!/usr/bin/env node
/**
 * One-shot backfill: read EXIF from uploaded blobs and populate taken_at for photos where it's null.
 * Run from the api-server directory: node backfill-taken-at.mjs
 */
import exifr from "exifr";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import pg from "pg";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL env var required");

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
if (!accountName || !containerName) throw new Error("AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_CONTAINER_NAME required");

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

function parseRawDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "string") {
    const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T");
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const { Client } = pg;
const client = new Client({ connectionString: DB_URL });
await client.connect();

const res = await client.query(`
  SELECT id, filename, blob_name, content_type FROM public.photos
  WHERE taken_at IS NULL AND content_type LIKE 'image/%'
  ORDER BY uploaded_at DESC
`);
console.log(`Found ${res.rows.length} photos with null taken_at`);

let fixed = 0, noExif = 0, errors = 0;
for (const photo of res.rows) {
  try {
    const buf = await downloadBlob(photo.blob_name);
    const exif = await exifr.parse(buf, { pick: ["DateTimeOriginal", "DateTimeDigitized", "CreateDate", "DateTime"] });
    const raw = exif?.DateTimeOriginal ?? exif?.DateTimeDigitized ?? exif?.CreateDate ?? exif?.DateTime;
    const d = parseRawDate(raw);
    if (d) {
      await client.query("UPDATE public.photos SET taken_at = $1 WHERE id = $2", [d, photo.id]);
      console.log(`✓ ${photo.filename} → ${d.toISOString()}`);
      fixed++;
    } else {
      console.log(`- ${photo.filename} → no EXIF date`);
      noExif++;
    }
  } catch (e) {
    console.log(`✗ ${photo.filename} → ${e.message}`);
    errors++;
  }
}

console.log(`\nDone: ${fixed} backfilled, ${noExif} no-EXIF, ${errors} errors`);
await client.end();
