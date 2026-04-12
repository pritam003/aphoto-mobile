import { Router } from "express";
import { randomUUID } from "crypto";
import { db, photosTable, albumsTable, albumPhotosTable } from "@workspace/db";
import { uploadBlob } from "../lib/azure-storage.js";
import { logger } from "../lib/logger.js";

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// APP_URL is the *frontend* SWA URL — used for post-callback redirects to /albums
const APP_URL = process.env.APP_URL || "http://localhost:5173";

/** Returns the API's own origin so REDIRECT_URI always points at the API, not the SWA frontend. */
function apiOrigin(req: any): string {
  const proto = (req.get("x-forwarded-proto") as string | undefined) || req.protocol || "https";
  const host = req.get("host") as string;
  return `${proto}://${host}`;
}

// In-memory state store: stateKey -> { userId, redirectUri }
const pendingStates = new Map<string, { userId: string; redirectUri: string }>();

// In-memory import status: importId -> status
interface ImportStatus {
  status: "picking" | "importing" | "done" | "error";
  albumName: string;
  albumId?: string;
  total: number;
  imported: number;
  errors: number;
  message?: string;
  pickerUri?: string;
}
const importStatuses = new Map<string, ImportStatus>();

function requireAuth(req: any, res: any, next: any) {
  const user = (req as Record<string, unknown>).user as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

async function runImport(importId: string, sessionId: string, userId: string, accessToken: string) {
  const status = importStatuses.get(importId)!;

  try {
    // Phase 1: Poll picker session until user selects photos (mediaItemsSet=true)
    const pollIntervalMs = 5000;
    const deadline = Date.now() + 60 * 60 * 1000; // 1 hour

    while (Date.now() < deadline) {
      const sessRes = await fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!sessRes.ok) throw new Error(`Session poll error (${sessRes.status}): ${await sessRes.text()}`);
      const sess = await sessRes.json() as { mediaItemsSet?: boolean };
      if (sess.mediaItemsSet) break;
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (Date.now() >= deadline) throw new Error("Timed out waiting for photo selection");

    status.status = "importing";
    status.pickerUri = undefined; // no longer needed

    // Phase 2: Fetch all selected media items
    const items: any[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL("https://photospicker.googleapis.com/v1/mediaItems");
      url.searchParams.set("sessionId", sessionId);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Fetch media items error (${res.status}): ${await res.text()}`);
      const data = await res.json() as { mediaItems?: any[]; nextPageToken?: string };
      if (data.mediaItems) items.push(...data.mediaItems);
      pageToken = data.nextPageToken;
    } while (pageToken);

    status.total = items.length;

    if (items.length === 0) {
      status.status = "done";
      status.message = "No photos were selected.";
      return;
    }

    const [newAlbum] = await db
      .insert(albumsTable)
      .values({ userId, name: "Imported from Google Photos" })
      .returning();
    status.albumId = newAlbum.id;
    status.albumName = "Imported from Google Photos";

    for (const item of items) {
      try {
        const mimeType: string = item.mediaFile?.mimeType || "image/jpeg";
        const isVideo = mimeType.startsWith("video/");
        const ext = isVideo ? ".mp4" : ".jpg";
        const baseUrl: string = item.mediaFile?.baseUrl || "";

        const photoRes = await fetch(`${baseUrl}=d0`);
        if (!photoRes.ok) throw new Error(`Download failed: ${photoRes.status}`);

        const buffer = Buffer.from(await photoRes.arrayBuffer());
        const blobName = `${userId}/${newAlbum.id}/${randomUUID()}${ext}`;
        await uploadBlob(blobName, buffer, mimeType);

        const meta = item.mediaFile?.mediaFileMetadata;
        const [photo] = await db
          .insert(photosTable)
          .values({
            userId,
            filename: item.mediaFile?.filename || `photo${ext}`,
            blobName,
            contentType: mimeType,
            size: buffer.byteLength,
            width: meta?.width ? Number(meta.width) : null,
            height: meta?.height ? Number(meta.height) : null,
            takenAt: item.createTime ? new Date(item.createTime) : null,
          })
          .returning();

        await db
          .insert(albumPhotosTable)
          .values({ albumId: newAlbum.id, photoId: photo.id })
          .onConflictDoNothing();

        status.imported++;
      } catch (err: any) {
        logger.error({ err: String(err), itemId: item.id }, "Failed to import photo");
        status.errors++;
      }
    }

    status.status = "done";

    // Clean up picker session
    await fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});

  } catch (err: any) {
    status.status = "error";
    status.message = String(err?.message ?? err);
    logger.error({ err: String(err) }, "Google Photos import failed");
  }
}

// POST /api/google/auth-url — return Google OAuth URL (no album URL needed)
router.post("/google/auth-url", requireAuth, async (req: any, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: "Google import not configured." });
  }

  const redirectUri = `${apiOrigin(req)}/api/google/callback`;
  const state = randomUUID();
  pendingStates.set(state, { userId: req.currentUser.id, redirectUri });
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/photospicker",
    access_type: "offline",
    state,
    prompt: "select_account consent",
  });

  res.json({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// GET /api/google/callback — exchange code, create picker session, start background import
router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = APP_URL;

  if (error || !code || !state) {
    return res.redirect(`${frontendUrl}/albums?import_error=${encodeURIComponent(error ?? "cancelled")}`);
  }
  const pending = pendingStates.get(state);
  if (!pending) {
    return res.redirect(`${frontendUrl}/albums?import_error=expired`);
  }
  pendingStates.delete(state);

  // Exchange auth code for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      redirect_uri: pending.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    logger.error({ err: await tokenRes.text() }, "Google token exchange failed");
    return res.redirect(`${frontendUrl}/albums?import_error=auth_failed`);
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  // Create a Photos Picker session
  const sessRes = await fetch("https://photospicker.googleapis.com/v1/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: "{}",
  });

  if (!sessRes.ok) {
    logger.error({ err: await sessRes.text() }, "Failed to create picker session");
    return res.redirect(`${frontendUrl}/albums?import_error=picker_failed`);
  }

  const session = await sessRes.json() as { id: string; pickerUri: string };
  const importId = randomUUID();

  importStatuses.set(importId, {
    status: "picking",
    albumName: "Google Photos Import",
    total: 0,
    imported: 0,
    errors: 0,
    pickerUri: session.pickerUri,
  });

  runImport(importId, session.id, pending.userId, access_token).catch(console.error);

  return res.redirect(`${frontendUrl}/albums?import_id=${importId}`);
});

// GET /api/google/import/:id — poll import progress
router.get("/google/import/:id", requireAuth, (req, res) => {
  const status = importStatuses.get(req.params.id);
  if (!status) return res.status(404).json({ error: "Import not found" });
  res.json(status);
});

export default router;
