/**
 * Face recognition service using @vladmandic/face-api (fully local — no cloud approval needed).
 *
 * Strategy
 * ────────
 * • Load SSD MobileNet + Landmark + Recognition models once at startup.
 * • On every image upload, detect faces and extract 128-D descriptors.
 * • Compare each descriptor against every stored descriptor for the user (Euclidean distance).
 * • If distance < SIMILARITY_THRESHOLD → assign to matching person.
 * • Otherwise → create a new person row.
 * • Everything runs async / fire-and-forget so upload latency is unaffected.
 */

import { randomUUID } from "crypto";
import path from "path";
import { createCanvas, loadImage, Image } from "canvas";
// Use the native Node.js TensorFlow backend for GPU/CPU acceleration
import "@tensorflow/tfjs-node";
import * as faceapi from "@vladmandic/face-api";
import { db, peopleTable, photoFacesTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { uploadBlob } from "./azure-storage.js";

// ── Config ────────────────────────────────────────────────────────────────────

/** Lower = stricter matching. 0.5 works well for most photos. */
const SIMILARITY_THRESHOLD = parseFloat(process.env.FACE_SIMILARITY_THRESHOLD ?? "0.5");

const MODEL_PATH = path.resolve(
  new URL(import.meta.url).pathname,
  "../../../../node_modules/@vladmandic/face-api/model",
);

// ── Model loading (once per process) ─────────────────────────────────────────

let _loadPromise: Promise<void> | null = null;

function ensureModels(): Promise<void> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    // face-api.js needs a canvas environment in Node
    (global as any).HTMLVideoElement = class {};
    (faceapi as any).env.monkeyPatch({ Canvas: createCanvas as any, Image: Image as any });
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH),
      faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
      faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH),
    ]);
  })();
  return _loadPromise;
}

// ── Detection ─────────────────────────────────────────────────────────────────

interface FaceResult {
  descriptor: Float32Array;
  box: { x: number; y: number; width: number; height: number };
  imageWidth: number;
  imageHeight: number;
}

async function detectFacesInBuffer(buffer: Buffer): Promise<FaceResult[]> {
  const img = await loadImage(buffer as any);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img as any, 0, 0);

  const detections = await faceapi
    .detectAllFaces(canvas as any, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections.map((d) => ({
    descriptor: d.descriptor,
    box: d.detection.box,
    imageWidth: img.width,
    imageHeight: img.height,
  }));
}

// ── Descriptor storage (DB as vector store) ───────────────────────────────────

/** Stored as comma-separated floats in the azurePersistedFaceId column (repurposed). */
function serializeDescriptor(d: Float32Array): string {
  return Array.from(d).join(",");
}

function deserializeDescriptor(s: string): Float32Array {
  return new Float32Array(s.split(",").map(Number));
}

// ── Face crop & thumbnail upload ──────────────────────────────────────────────

async function cropFaceToBlob(
  buffer: Buffer,
  box: { x: number; y: number; width: number; height: number },
  userId: string,
): Promise<string | null> {
  try {
    const img = await loadImage(buffer as any);
    const pad = Math.round(box.width * 0.2);
    const sx = Math.max(0, box.x - pad);
    const sy = Math.max(0, box.y - pad);
    const sw = Math.min(img.width - sx, box.width + pad * 2);
    const sh = Math.min(img.height - sy, box.height + pad * 2);

    const thumb = createCanvas(sw, sh);
    thumb.getContext("2d").drawImage(img as any, sx, sy, sw, sh, 0, 0, sw, sh);

    const thumbBuffer = thumb.toBuffer("image/jpeg", { quality: 0.85 });
    const blobName = \`\${userId}/faces/\${randomUUID()}.jpg\`;
    await uploadBlob(blobName, thumbBuffer, "image/jpeg");
    return blobName;
  } catch {
    return null;
  }
}

// ── Clustering ────────────────────────────────────────────────────────────────

async function findOrCreatePerson(
  userId: string,
  descriptor: Float32Array,
  box: FaceResult["box"],
  photoBuffer: Buffer,
): Promise<string> {
  // Load all stored descriptors for this user that are linked to a person
  const existingFaces = await db
    .select({
      personId: photoFacesTable.personId,
      descriptorStr: photoFacesTable.azurePersistedFaceId,
    })
    .from(photoFacesTable)
    .where(and(eq(photoFacesTable.userId, userId), isNotNull(photoFacesTable.personId)))
    .limit(1000);

  // Find best match by Euclidean distance
  let bestPersonId: string | null = null;
  let bestDist = Infinity;

  for (const face of existingFaces) {
    if (!face.descriptorStr || !face.personId) continue;
    try {
      const stored = deserializeDescriptor(face.descriptorStr);
      const dist = faceapi.euclideanDistance(descriptor, stored);
      if (dist < bestDist) {
        bestDist = dist;
        bestPersonId = face.personId;
      }
    } catch { /* malformed record — skip */ }
  }

  if (bestPersonId && bestDist <= SIMILARITY_THRESHOLD) {
    return bestPersonId;
  }

  // No match → create new person
  const [newPerson] = await db
    .insert(peopleTable)
    .values({ userId })
    .returning();

  // Upload face crop as cover image
  const coverBlob = await cropFaceToBlob(photoBuffer, box, userId);
  if (coverBlob) {
    await db
      .update(peopleTable)
      .set({ coverFaceBlob: coverBlob })
      .where(eq(peopleTable.id, newPerson.id));
  }

  return newPerson.id;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Fire-and-forget: detect faces in the image buffer and cluster them into people.
 * Safe to call without awaiting — all errors are caught internally.
 */
export async function processFacesForPhoto(
  photoId: string,
  userId: string,
  blobName: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  if (!contentType.startsWith("image/")) return;

  try {
    await ensureModels();
    const faces = await detectFacesInBuffer(buffer);
    if (faces.length === 0) return;

    for (const face of faces) {
      const personId = await findOrCreatePerson(userId, face.descriptor, face.box, buffer);

      const boundingBox = JSON.stringify({
        top: face.box.y / face.imageHeight,
        left: face.box.x / face.imageWidth,
        width: face.box.width / face.imageWidth,
        height: face.box.height / face.imageHeight,
      });

      // Store descriptor in azurePersistedFaceId column (repurposed as vector store)
      await db.insert(photoFacesTable).values({
        photoId,
        userId,
        personId,
        azurePersistedFaceId: serializeDescriptor(face.descriptor),
        boundingBox,
      });
    }
  } catch (err) {
    console.error("[face-recognition] processFacesForPhoto error:", err);
  }
}
