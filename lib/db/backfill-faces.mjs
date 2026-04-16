#!/usr/bin/env node
/**
 * One-shot backfill: run face detection on all existing photos that haven't been processed yet.
 * Run from the api-server directory with env vars set:
 *   DATABASE_URL, AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_CONTAINER_NAME,
 *   AZURE_FACE_ENDPOINT, AZURE_FACE_KEY, FACE_SIMILARITY_THRESHOLD (optional, default 0.6)
 */
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "crypto";
import pg from "pg";

// ── Config ────────────────────────────────────────────────────────────────────

const DB_URL            = process.env.DATABASE_URL;
const accountName       = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerName     = process.env.AZURE_STORAGE_CONTAINER_NAME;
const FACE_ENDPOINT     = (process.env.AZURE_FACE_ENDPOINT ?? "").replace(/\/$/, "");
const FACE_KEY          = process.env.AZURE_FACE_KEY ?? "";
const THRESHOLD         = parseFloat(process.env.FACE_SIMILARITY_THRESHOLD ?? "0.6");
const CONCURRENCY       = 3; // parallel downloads

if (!DB_URL)          throw new Error("DATABASE_URL required");
if (!accountName)     throw new Error("AZURE_STORAGE_ACCOUNT_NAME required");
if (!containerName)   throw new Error("AZURE_STORAGE_CONTAINER_NAME required");
if (!FACE_ENDPOINT)   throw new Error("AZURE_FACE_ENDPOINT required");
if (!FACE_KEY)        throw new Error("AZURE_FACE_KEY required");

// ── Azure Blob ────────────────────────────────────────────────────────────────

const credential       = new DefaultAzureCredential();
const blobServiceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
const containerClient  = blobServiceClient.getContainerClient(containerName);

async function downloadBlob(blobName) {
  const client = containerClient.getBlockBlobClient(blobName);
  const res    = await client.download(0);
  const chunks = [];
  for await (const chunk of res.readableStreamBody) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function uploadBlob(blobName, buffer, contentType) {
  const client = containerClient.getBlockBlobClient(blobName);
  await client.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: "public, max-age=31536000, immutable" },
  });
}

// ── Face API helpers ──────────────────────────────────────────────────────────

async function faceReq(method, path, body) {
  const res = await fetch(`${FACE_ENDPOINT}/face/v1.0${path}`, {
    method,
    headers: { "Ocp-Apim-Subscription-Key": FACE_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function faceReqBinary(path, buffer, contentType) {
  return fetch(`${FACE_ENDPOINT}/face/v1.0${path}`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": FACE_KEY, "Content-Type": contentType },
    body: buffer,
  });
}

const _ensured = new Set();
async function ensureList(listId) {
  if (_ensured.has(listId)) return;
  const r = await faceReq("GET", `/largefacelists/${listId}`);
  if (r.status === 404) {
    const c = await faceReq("PUT", `/largefacelists/${listId}`, { name: listId, recognitionModel: "recognition_04" });
    if (!c.ok) throw new Error(`Create list failed: ${await c.text()}`);
  }
  _ensured.add(listId);
}

async function detectFaces(buffer, contentType) {
  const r = await faceReqBinary(
    "/detect?detectionModel=detection_03&recognitionModel=recognition_04&returnFaceId=true",
    buffer, contentType,
  );
  if (!r.ok) return [];
  return r.json();
}

async function persistFace(listId, faceId) {
  const r = await faceReq("POST", `/largefacelists/${listId}/persistedfaces`, { faceId });
  if (!r.ok) return null;
  return (await r.json()).persistedFaceId;
}

async function findSimilar(listId, transientFaceId) {
  const r = await faceReq("POST", "/findsimilars", {
    faceId: transientFaceId,
    largeFaceListId: listId,
    maxNumOfCandidatesReturned: 1,
    mode: "matchPerson",
  });
  if (!r.ok) return [];
  return r.json();
}

async function triggerTraining(listId) {
  await faceReq("POST", `/largefacelists/${listId}/train`);
}

// ── Per-photo processing ──────────────────────────────────────────────────────

async function processPhoto(dbClient, photo) {
  const listId = `user-${photo.user_id.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 58)}`;

  const buffer = await downloadBlob(photo.blob_name);
  const faces  = await detectFaces(buffer, photo.content_type);

  if (faces.length === 0) return { detected: 0, persisted: 0 };

  await ensureList(listId);

  // Load existing faces for this user (for FindSimilar matching)
  const existingRes = await dbClient.query(
    `SELECT id, person_id, azure_persisted_face_id FROM photo_faces WHERE user_id = $1 AND person_id IS NOT NULL LIMIT 500`,
    [photo.user_id],
  );
  const existing = existingRes.rows;

  let persisted = 0;
  for (const face of faces) {
    const persistedFaceId = await persistFace(listId, face.faceId);
    if (!persistedFaceId) continue;
    persisted++;

    // FindSimilar needs the list to be trained at least once
    let personId = null;
    const candidates = await findSimilar(listId, face.faceId);
    if (candidates.length > 0 && candidates[0].confidence >= THRESHOLD) {
      const match = existing.find(e => e.azure_persisted_face_id === candidates[0].persistedFaceId);
      if (match?.person_id) personId = match.person_id;
    }

    if (!personId) {
      // Create new person
      const pr = await dbClient.query(
        `INSERT INTO people (id, user_id, created_at) VALUES ($1, $2, NOW()) RETURNING id`,
        [randomUUID(), photo.user_id],
      );
      personId = pr.rows[0].id;

      // Upload face thumbnail as cover
      try {
        const thumbRes = await fetch(
          `${FACE_ENDPOINT}/face/v1.0/largefacelists/${listId}/persistedfaces/${persistedFaceId}/face`,
          { headers: { "Ocp-Apim-Subscription-Key": FACE_KEY } },
        );
        if (thumbRes.ok) {
          const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
          const thumbBlob = `${photo.user_id}/faces/${randomUUID()}.jpg`;
          await uploadBlob(thumbBlob, thumbBuf, "image/jpeg");
          await dbClient.query(`UPDATE people SET cover_face_blob = $1 WHERE id = $2`, [thumbBlob, personId]);
        }
      } catch { /* non-fatal */ }
    }

    const bb = JSON.stringify({
      top: face.faceRectangle.top, left: face.faceRectangle.left,
      width: face.faceRectangle.width, height: face.faceRectangle.height,
    });
    await dbClient.query(
      `INSERT INTO photo_faces (id, photo_id, user_id, person_id, azure_persisted_face_id, bounding_box, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), photo.id, photo.user_id, personId, persistedFaceId, bb],
    );

    // Keep existing list up-to-date for subsequent photos in the same run
    existing.push({ id: randomUUID(), person_id: personId, azure_persisted_face_id: persistedFaceId });
  }

  return { detected: faces.length, persisted };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { Client } = pg;
const dbClient   = new Client({ connectionString: DB_URL });
await dbClient.connect();

// Only process images that haven't been face-scanned yet
const photosRes = await dbClient.query(`
  SELECT p.id, p.user_id, p.blob_name, p.content_type, p.filename
  FROM photos p
  WHERE p.content_type LIKE 'image/%'
    AND p.trashed = false
    AND NOT EXISTS (SELECT 1 FROM photo_faces pf WHERE pf.photo_id = p.id)
  ORDER BY p.uploaded_at DESC
`);

const photos = photosRes.rows;
console.log(`Found ${photos.length} photos to process\n`);

let done = 0, totalFaces = 0, errors = 0;
const userTraining = new Set();

// Process in small batches of CONCURRENCY
for (let i = 0; i < photos.length; i += CONCURRENCY) {
  const batch = photos.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(batch.map(p => processPhoto(dbClient, p)));

  for (let j = 0; j < results.length; j++) {
    const photo = batch[j];
    const r     = results[j];
    done++;
    if (r.status === "fulfilled") {
      const { detected, persisted } = r.value;
      totalFaces += detected;
      userTraining.add(photo.user_id);
      console.log(`[${done}/${photos.length}] ✓ ${photo.filename} — ${detected} face(s) detected, ${persisted} persisted`);
    } else {
      errors++;
      console.log(`[${done}/${photos.length}] ✗ ${photo.filename} — ${r.reason?.message ?? r.reason}`);
    }
  }
}

// Train all affected user lists so FindSimilar works on future uploads
console.log(`\nTraining ${userTraining.size} face list(s)…`);
for (const userId of userTraining) {
  const listId = `user-${userId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 58)}`;
  try { await triggerTraining(listId); console.log(`  trained: ${listId}`); }
  catch (e) { console.log(`  train failed: ${listId} — ${e.message}`); }
}

console.log(`\nDone: ${photos.length - errors} processed, ${totalFaces} faces found, ${errors} errors`);
await dbClient.end();
