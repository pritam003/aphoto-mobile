#!/usr/bin/env node
// Polyfill util.isNullOrUndefined removed in Node 22+ but still used by tfjs-node
import util from "node:util";
if (!util.isNullOrUndefined) util.isNullOrUndefined = (v) => v == null;

import * as tf from "@tensorflow/tfjs-node";
import "@tensorflow/tfjs-node";
/**
 * Backfill face detection on all existing photos using local face-api.js.
 * No Azure Face API approval needed.
 *
 * Run from: scripts/
 *   DATABASE_URL=... AZURE_STORAGE_ACCOUNT_NAME=... AZURE_STORAGE_CONTAINER_NAME=... node backfill-faces.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createCanvas } from "canvas";
import * as faceapi from "@vladmandic/face-api";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = path.resolve(__dirname, "../node_modules/.pnpm/@vladmandic+face-api@1.7.15/node_modules/@vladmandic/face-api/model");
const THRESHOLD   = parseFloat(process.env.FACE_SIMILARITY_THRESHOLD ?? "0.5");
const CONCURRENCY = 2;

// ── DB ────────────────────────────────────────────────────────────────────────
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL required");
const { Client } = pg;
const db = new Client({ connectionString: DB_URL });
await db.connect();
console.log("Connected to DB");

// ── Blob Storage ──────────────────────────────────────────────────────────────
const accountName   = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
if (!accountName || !containerName) throw new Error("AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_CONTAINER_NAME required");

const blobClient = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  new DefaultAzureCredential(),
);
const containerClient = blobClient.getContainerClient(containerName);

async function downloadBlob(blobName) {
  const client = containerClient.getBlockBlobClient(blobName);
  const res = await client.download(0);
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

// ── Load face-api models ──────────────────────────────────────────────────────
console.log(`Loading models from ${MODEL_PATH}…`);
(global).HTMLVideoElement = class {};
(faceapi).env.monkeyPatch({ Canvas: createCanvas });
await Promise.all([
  faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH),
  faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
  faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH),
]);
console.log("Models loaded\n");

// ── Helpers ───────────────────────────────────────────────────────────────────
const serialize = (d) => Array.from(d).join(",");
const deserialize = (s) => new Float32Array(s.split(",").map(Number));

async function detectFaces(buffer) {
  // Decode image buffer to a tf.Tensor3D — face-api.js accepts it natively
  const tensor = tf.node.decodeImage(buffer, 3);
  try {
    const detections = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    return detections.map(d => ({
      descriptor: d.descriptor,
      box: d.detection.box,
      imageWidth: tensor.shape[1],
      imageHeight: tensor.shape[0],
    }));
  } finally {
    tensor.dispose();
  }
}

async function cropFace(buffer, box) {
  const tensor = tf.node.decodeImage(buffer, 3);
  const [h, w] = tensor.shape;
  const pad = Math.round(box.width * 0.2);
  const y1 = Math.max(0, Math.round(box.y - pad));
  const x1 = Math.max(0, Math.round(box.x - pad));
  const y2 = Math.min(h, Math.round(box.y + box.height + pad));
  const x2 = Math.min(w, Math.round(box.x + box.width  + pad));
  const cropped = tf.slice3d(tensor, [y1, x1, 0], [y2 - y1, x2 - x1, 3]);
  tensor.dispose();
  const jpegData = await tf.node.encodeJpeg(cropped, "rgb", 85);
  cropped.dispose();
  return Buffer.from(jpegData);
}

// Per-user in-memory cache of { personId, descriptor } so we don't re-query DB for every face
const userCache = {};

async function loadUserCache(userId) {
  if (userCache[userId]) return userCache[userId];
  const res = await db.query(
    `SELECT person_id, azure_persisted_face_id AS descriptor_str
     FROM photo_faces WHERE user_id=$1 AND person_id IS NOT NULL LIMIT 2000`,
    [userId],
  );
  userCache[userId] = res.rows
    .filter(r => r.descriptor_str)
    .map(r => ({ personId: r.person_id, descriptor: deserialize(r.descriptor_str) }));
  return userCache[userId];
}

async function findOrCreatePerson(userId, descriptor, box, buffer) {
  const cached = await loadUserCache(userId);
  let bestId = null, bestDist = Infinity;
  for (const { personId, descriptor: stored } of cached) {
    const dist = faceapi.euclideanDistance(descriptor, stored);
    if (dist < bestDist) { bestDist = dist; bestId = personId; }
  }

  if (bestId && bestDist <= THRESHOLD) return bestId;

  // New person
  const id = randomUUID();
  await db.query(
    `INSERT INTO people (id, user_id, created_at) VALUES ($1,$2,NOW())`,
    [id, userId],
  );

  // Cover image
  try {
    const crop = await cropFace(buffer, box);
    const blobName = `${userId}/faces/${randomUUID()}.jpg`;
    await uploadBlob(blobName, crop, "image/jpeg");
    await db.query(`UPDATE people SET cover_face_blob=$1 WHERE id=$2`, [blobName, id]);
  } catch { /* non-fatal */ }

  // Add to cache so subsequent photos in same run match it
  cached.push({ personId: id, descriptor });
  return id;
}

// ── Fetch unprocessed photos ──────────────────────────────────────────────────
const photosRes = await db.query(`
  SELECT p.id, p.user_id, p.blob_name, p.content_type, p.filename
  FROM photos p
  WHERE p.content_type LIKE 'image/%'
    AND p.trashed = false
    AND NOT EXISTS (SELECT 1 FROM photo_faces pf WHERE pf.photo_id = p.id)
  ORDER BY p.uploaded_at DESC
`);
const photos = photosRes.rows;
console.log(`Found ${photos.length} unprocessed photos\n`);

let done = 0, totalFaces = 0, errors = 0;

async function processPhoto(photo) {
  const buffer = await downloadBlob(photo.blob_name);
  const faces  = await detectFaces(buffer);

  for (const face of faces) {
    const personId = await findOrCreatePerson(photo.user_id, face.descriptor, face.box, buffer);
    const bb = JSON.stringify({
      top:    face.box.y / face.imageHeight,
      left:   face.box.x / face.imageWidth,
      width:  face.box.width  / face.imageWidth,
      height: face.box.height / face.imageHeight,
    });
    await db.query(
      `INSERT INTO photo_faces (id, photo_id, user_id, person_id, azure_persisted_face_id, bounding_box, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
      [randomUUID(), photo.id, photo.user_id, personId, serialize(face.descriptor), bb],
    );
  }
  return faces.length;
}

for (let i = 0; i < photos.length; i += CONCURRENCY) {
  const batch = photos.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(batch.map(p => processPhoto(p)));
  for (let j = 0; j < results.length; j++) {
    done++;
    const r = results[j];
    if (r.status === "fulfilled") {
      totalFaces += r.value;
      if (r.value > 0) {
        console.log(`[${done}/${photos.length}] ✓ ${batch[j].filename} — ${r.value} face(s)`);
      }
    } else {
      errors++;
      console.log(`[${done}/${photos.length}] ✗ ${batch[j].filename} — ${r.reason?.message}`);
    }
  }
}

// Summary
const peopleRes = await db.query(`SELECT COUNT(*) FROM people`);
const facesRes  = await db.query(`SELECT COUNT(*) FROM photo_faces`);
console.log(`\n✅ Done: ${done - errors} processed, ${totalFaces} faces detected, ${errors} errors`);
console.log(`   People in DB: ${peopleRes.rows[0].count}`);
console.log(`   Face records: ${facesRes.rows[0].count}`);
await db.end();
