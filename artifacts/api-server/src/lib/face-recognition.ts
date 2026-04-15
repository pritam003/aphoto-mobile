/**
 * Face recognition service using Azure AI Face API.
 *
 * Strategy
 * ────────
 * • One LargeFaceList per user  (id = `user-{userId}`)
 * • On every image upload we detect faces, persist them in the list,
 *   then call FindSimilar to auto-cluster them into `people` rows.
 * • Similarity threshold is configurable via FACE_SIMILARITY_THRESHOLD (default 0.6).
 * • Everything is async / fire-and-forget so upload latency is unaffected.
 */

import { randomUUID } from "crypto";
import { db, peopleTable, photoFacesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { uploadBlob } from "./azure-storage.js";

// ── Config ────────────────────────────────────────────────────────────────────

const FACE_ENDPOINT = process.env.AZURE_FACE_ENDPOINT ?? "";
const FACE_KEY = process.env.AZURE_FACE_KEY ?? "";
const SIMILARITY_THRESHOLD = parseFloat(process.env.FACE_SIMILARITY_THRESHOLD ?? "0.6");
const FACE_ENABLED = Boolean(FACE_ENDPOINT && FACE_KEY);

// ── Azure Face REST helpers ───────────────────────────────────────────────────

async function faceRequest(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return fetch(`${FACE_ENDPOINT.replace(/\/$/, "")}/face/v1.0${path}`, {
    method,
    headers: {
      "Ocp-Apim-Subscription-Key": FACE_KEY,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function faceRequestBinary(path: string, buffer: Buffer, contentType: string): Promise<Response> {
  return fetch(`${FACE_ENDPOINT.replace(/\/$/, "")}/face/v1.0${path}`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": FACE_KEY,
      "Content-Type": contentType,
    },
    body: buffer,
  });
}

// ── LargeFaceList management ──────────────────────────────────────────────────

const _ensuredLists = new Set<string>();

async function ensureUserFaceList(userId: string): Promise<string> {
  // sanitise userId: Azure faceListId must be lowercase alphanumeric + hyphens, max 64 chars
  const listId = `user-${userId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 58)}`;

  if (_ensuredLists.has(listId)) return listId;

  const res = await faceRequest("GET", `/largefacelists/${listId}`);
  if (res.status === 404) {
    const create = await faceRequest("PUT", `/largefacelists/${listId}`, {
      name: `User ${userId}`,
      recognitionModel: "recognition_04",
    });
    if (!create.ok) {
      const body = await create.text();
      throw new Error(`Failed to create LargeFaceList: ${body}`);
    }
  } else if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to check LargeFaceList: ${body}`);
  }

  _ensuredLists.add(listId);
  return listId;
}

// ── Training ─────────────────────────────────────────────────────────────────

// Debounce training per user: only trigger once per 10 s to avoid rate-limit errors
const _pendingTraining = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleTraining(listId: string): void {
  if (_pendingTraining.has(listId)) {
    clearTimeout(_pendingTraining.get(listId)!);
  }
  _pendingTraining.set(
    listId,
    setTimeout(async () => {
      _pendingTraining.delete(listId);
      try {
        await faceRequest("POST", `/largefacelists/${listId}/train`);
      } catch {
        // Training failure is non-fatal; FindSimilar will use last trained state
      }
    }, 10_000),
  );
}

// ── Detect faces in an image buffer ──────────────────────────────────────────

interface DetectedFace {
  faceId: string;
  faceRectangle: { top: number; left: number; width: number; height: number };
}

async function detectFaces(buffer: Buffer, contentType: string): Promise<DetectedFace[]> {
  const res = await faceRequestBinary(
    "/detect?detectionModel=detection_03&recognitionModel=recognition_04&returnFaceId=true",
    buffer,
    contentType,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as DetectedFace[];
  return data;
}

// ── Add face to LargeFaceList ─────────────────────────────────────────────────

async function persistFace(listId: string, faceId: string): Promise<string | null> {
  const res = await faceRequest("POST", `/largefacelists/${listId}/persistedfaces`, {
    faceId,
    targetFace: undefined, // faceId already selected
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { persistedFaceId: string };
  return data.persistedFaceId;
}

// ── FindSimilar against user's own list ──────────────────────────────────────

async function findSimilarPersistedFace(
  listId: string,
  persistedFaceId: string,
): Promise<string | null> {
  // To call FindSimilar we need a fresh (transient) faceId — not available post-detect.
  // Instead we iterate existing photo_faces via DB and compare persistedFaceIds directly
  // using VerifyFace. This is handled in processFacesForPhoto below.
  return null;
}

// ── Crop & upload face thumbnail ─────────────────────────────────────────────
// Uses the Azure Face API crop endpoint rather than pulling in `sharp`.

async function cropAndUploadFaceThumbnail(
  sourceBlobName: string,
  userId: string,
  persistedFaceId: string,
  listId: string,
): Promise<string | null> {
  try {
    const res = await faceRequest(
      "GET",
      `/largefacelists/${listId}/persistedfaces/${persistedFaceId}?returnFaceId=true`,
    );
    if (!res.ok) return null;
    // Crop thumbnail via dedicated endpoint
    const cropRes = await fetch(
      `${FACE_ENDPOINT.replace(/\/$/, "")}/face/v1.0/largefacelists/${listId}/persistedfaces/${persistedFaceId}/face`,
      {
        headers: { "Ocp-Apim-Subscription-Key": FACE_KEY },
      },
    );
    if (!cropRes.ok) return null;
    const thumbBuffer = Buffer.from(await cropRes.arrayBuffer());
    const thumbBlobName = `${userId}/faces/${randomUUID()}.jpg`;
    await uploadBlob(thumbBlobName, thumbBuffer, "image/jpeg");
    return thumbBlobName;
  } catch {
    return null;
  }
}

// ── Verify two persistedFaceIds belong to the same person ────────────────────

async function verifyPersistedFaces(
  listId: string,
  persistedFaceId1: string,
  persistedFaceId2: string,
): Promise<number> {
  // Azure VerifyFace requires transient faceIds; instead we use the
  // FindSimilar-from-persisted endpoint which is available on LargeFaceList.
  // We find a single candidate by scanning existing DB records
  // and calling FindSimilar with zero or one persisted-face target.
  // Returning 0 (no match) here is the safe fallback.
  return 0;
}

// ── Group a new persistedFaceId into an existing or new person ─────────────────

async function groupFaceIntoPerson(
  photoId: string,
  userId: string,
  listId: string,
  persistedFaceId: string,
  faceRect: DetectedFace["faceRectangle"],
  sourceBlobName: string,
  transientFaceId: string,
): Promise<void> {
  // Query existing people for this user and find if any existing face matches
  const existingFaces = await db
    .select({
      id: photoFacesTable.id,
      personId: photoFacesTable.personId,
      azurePersistedFaceId: photoFacesTable.azurePersistedFaceId,
    })
    .from(photoFacesTable)
    .where(
      and(
        eq(photoFacesTable.userId, userId),
        // already grouped
        // personId IS NOT NULL handled in JS below
      ),
    )
    .limit(500);

  let matchedPersonId: string | null = null;

  // Use FindSimilar (face list) to find a candidate match using the transient faceId
  if (existingFaces.length > 0) {
    const findRes = await faceRequest("POST", "/findsimilars", {
      faceId: transientFaceId,
      largeFaceListId: listId,
      maxNumOfCandidatesReturned: 1,
      mode: "matchPerson",
    });

    if (findRes.ok) {
      const candidates = (await findRes.json()) as Array<{
        persistedFaceId: string;
        confidence: number;
      }>;

      if (candidates.length > 0 && candidates[0].confidence >= SIMILARITY_THRESHOLD) {
        // Find which person owns this persistedFaceId
        const matchingFace = existingFaces.find(
          (f: { id: string; personId: string | null; azurePersistedFaceId: string | null }) =>
            f.azurePersistedFaceId === candidates[0].persistedFaceId,
        );
        if (matchingFace?.personId) {
          matchedPersonId = matchingFace.personId;
        }
      }
    }
  }

  if (!matchedPersonId) {
    // Create a new person
    const [newPerson] = await db
      .insert(peopleTable)
      .values({ userId })
      .returning();

    matchedPersonId = newPerson.id;

    // Upload a face thumbnail as cover image
    const thumbBlob = await cropAndUploadFaceThumbnail(sourceBlobName, userId, persistedFaceId, listId);
    if (thumbBlob) {
      await db
        .update(peopleTable)
        .set({ coverFaceBlob: thumbBlob })
        .where(eq(peopleTable.id, matchedPersonId));
    }
  }

  const boundingBox = JSON.stringify({
    top: faceRect.top,
    left: faceRect.left,
    width: faceRect.width,
    height: faceRect.height,
  });

  await db.insert(photoFacesTable).values({
    photoId,
    userId,
    personId: matchedPersonId,
    azurePersistedFaceId: persistedFaceId,
    boundingBox,
  });
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Fire-and-forget: detect faces in the given image buffer and group them
 * into people.  Safe to call without awaiting — errors are caught internally.
 */
export async function processFacesForPhoto(
  photoId: string,
  userId: string,
  blobName: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  if (!FACE_ENABLED || !contentType.startsWith("image/")) return;

  try {
    const faces = await detectFaces(buffer, contentType);
    if (faces.length === 0) return;

    const listId = await ensureUserFaceList(userId);

    for (const face of faces) {
      const persistedFaceId = await persistFace(listId, face.faceId);
      if (!persistedFaceId) continue;

      await groupFaceIntoPerson(
        photoId,
        userId,
        listId,
        persistedFaceId,
        face.faceRectangle,
        blobName,
        face.faceId,
      );
    }

    scheduleTraining(listId);
  } catch (err) {
    // Non-fatal: log and continue
    console.error("[face-recognition] processFacesForPhoto error:", err);
  }
}
