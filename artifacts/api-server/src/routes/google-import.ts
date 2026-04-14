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

// In-memory state store: stateKey -> { userId, redirectUri, albumName, targetAlbumId?, noAlbum? }
const pendingStates = new Map<string, { userId: string; redirectUri: string; albumName: string; targetAlbumId?: string; noAlbum?: boolean }>();

// Map state -> importId, written after OAuth callback so the originating tab can resolve it
const stateToImportId = new Map<string, string>();

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
  /** true when the import errored mid-way and can be resumed */
  resumable?: boolean;
}
const importStatuses = new Map<string, ImportStatus>();
const cancelledImports = new Set<string>();

// Resume data stored per importId so the user can restart from where it failed
interface ResumeData {
  items: any[];
  processedIds: Set<string>;
  accessToken: string;
  userId: string;
  albumId?: string;
  noAlbum?: boolean;
}
const resumeDataStore = new Map<string, ResumeData>();

function requireAuth(req: any, res: any, next: any) {
  const user = (req as Record<string, unknown>).user as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

async function runImport(importId: string, sessionId: string, userId: string, accessToken: string, targetAlbumId?: string, noAlbum?: boolean) {
  const status = importStatuses.get(importId)!;

  try {
    // Phase 1: Poll picker session until user selects photos (mediaItemsSet=true)
    const pollIntervalMs = 5000;
    const deadline = Date.now() + 60 * 60 * 1000; // 1 hour

    while (Date.now() < deadline) {
      if (cancelledImports.has(importId)) {
        cancelledImports.delete(importId);
        status.status = "error";
        status.message = "Cancelled by user";
        return;
      }
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

    // Resolve album: use existing, create new, or import to library only
    let albumId: string | undefined;
    if (targetAlbumId) {
      albumId = targetAlbumId;
      status.albumId = targetAlbumId;
    } else if (!noAlbum) {
      const [newAlbum] = await db
        .insert(albumsTable)
        .values({ userId, name: status.albumName || "Google Photos Import" })
        .returning();
      albumId = newAlbum.id;
      status.albumId = albumId;
    }

    // Save resume data so we can restart from where it fails
    const processedIds = new Set<string>();
    resumeDataStore.set(importId, { items, processedIds, accessToken, userId, albumId, noAlbum });

    await processItems(importId, items, processedIds, status, accessToken, userId, albumId);

    if (status.status !== "error") {
      status.status = "done";
      resumeDataStore.delete(importId);
      // Clean up picker session
      await fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }

  } catch (err: any) {
    status.status = "error";
    status.message = String(err?.message ?? err);
    status.resumable = resumeDataStore.has(importId);
    logger.error({ err: String(err) }, "Google Photos import failed");
  }
}

/** Process a list of items, skipping already-processed IDs. Shared by initial run and resume. */
async function processItems(
  importId: string,
  items: any[],
  processedIds: Set<string>,
  status: ImportStatus,
  accessToken: string,
  userId: string,
  albumId: string | undefined,
) {
  for (const item of items) {
    const itemId: string = item.id || item.mediaFile?.filename || "";
    if (processedIds.has(itemId)) continue; // already done (resume skip)

    if (cancelledImports.has(importId)) {
      cancelledImports.delete(importId);
      status.status = "error";
      status.message = "Cancelled by user";
      status.resumable = resumeDataStore.has(importId);
      return;
    }
    try {
      const mimeType: string = item.mediaFile?.mimeType || "image/jpeg";
      const isVideo = mimeType.startsWith("video/");
      const ext = isVideo ? ".mp4" : ".jpg";
      const baseUrl: string = item.mediaFile?.baseUrl || "";
      const downloadUrl = isVideo ? `${baseUrl}=dv` : `${baseUrl}=d`;
      const photoRes = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!photoRes.ok) throw new Error(`Download failed: ${photoRes.status} ${await photoRes.text()}`);

      const buffer = Buffer.from(await photoRes.arrayBuffer());
      const blobName = `${userId}/${albumId ?? "library"}/${randomUUID()}${ext}`;
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

      if (albumId) {
        await db
          .insert(albumPhotosTable)
          .values({ albumId, photoId: photo.id })
          .onConflictDoNothing();
      }

      processedIds.add(itemId);
      status.imported++;
    } catch (err: any) {
      logger.error({ err: String(err), itemId }, "Failed to import photo");
      status.errors++;
      // If Azure storage or DB fails consistently, bubble up to mark as resumable
      if (String(err).includes("ECONNREFUSED") || String(err).includes("ETIMEDOUT")) {
        throw err; // stop the loop — outer catch will mark resumable
      }
    }
  }
}

// POST /api/google/auth-url — return Google OAuth URL
router.post("/google/auth-url", requireAuth, async (req: any, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: "Google import not configured." });
  }

  const albumName: string = (req.body as any)?.albumName?.trim() || "Google Photos Import";
  const targetAlbumId: string | undefined = (req.body as any)?.targetAlbumId || undefined;
  const noAlbum: boolean = !!(req.body as any)?.noAlbum;
  const redirectUri = `${apiOrigin(req)}/api/google/callback`;
  const state = randomUUID();
  pendingStates.set(state, { userId: req.currentUser.id, redirectUri, albumName, targetAlbumId, noAlbum });
  setTimeout(() => { pendingStates.delete(state); stateToImportId.delete(state); }, 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
    access_type: "offline",
    state,
    prompt: "select_account consent",
  });

  res.json({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state });
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
    albumName: pending.albumName,
    total: 0,
    imported: 0,
    errors: 0,
    pickerUri: session.pickerUri,
  });

  // Allow originating tab to resolve importId by state
  stateToImportId.set(state, importId);

  runImport(importId, session.id, pending.userId, access_token, pending.targetAlbumId, pending.noAlbum).catch(console.error);

  // Redirect this tab (the OAuth tab) straight to the picker so the user
  // only ever sees 2 tabs: APhoto + picker.
  return res.redirect(session.pickerUri);
});

// GET /api/google/import-by-state/:state — called by originating tab to get importId after new-tab OAuth
router.get("/google/import-by-state/:state", requireAuth, (req, res) => {
  const importId = stateToImportId.get(req.params.state);
  if (!importId) return res.status(202).json({ pending: true });
  res.json({ importId });
});

// GET /api/google/import/:id — poll import progress
router.get("/google/import/:id", requireAuth, (req, res) => {
  const status = importStatuses.get(req.params.id);
  if (!status) return res.status(404).json({ error: "Import not found" });
  res.json(status);
});

// DELETE /api/google/import/:id — cancel an in-progress import
router.delete("/google/import/:id", requireAuth, (req, res) => {
  const status = importStatuses.get(req.params.id);
  if (!status) return res.status(404).json({ error: "Import not found" });
  if (status.status === "done" || status.status === "error") {
    return res.json({ cancelled: false, message: "Import already finished" });
  }
  cancelledImports.add(req.params.id);
  status.status = "error";
  status.message = "Cancelled by user";
  res.json({ cancelled: true });
});

// POST /api/google/import/:id/resume — restart from where it left off
router.post("/google/import/:id/resume", requireAuth, async (req: any, res) => {
  const importId = req.params.id;
  const status = importStatuses.get(importId);
  const resume = resumeDataStore.get(importId);

  if (!status) return res.status(404).json({ error: "Import not found" });
  if (!resume) return res.status(409).json({ error: "No resume data available — please start a new import" });
  if (status.status === "importing") return res.status(409).json({ error: "Import is already running" });
  if (resume.userId !== req.currentUser.id) return res.status(403).json({ error: "Forbidden" });

  // Reset to importing state (keep imported/errors counts so progress is accurate)
  status.status = "importing";
  status.message = undefined;
  status.resumable = false;

  const remaining = resume.items.filter(item => {
    const id: string = item.id || item.mediaFile?.filename || "";
    return !resume.processedIds.has(id);
  });

  const skipped = resume.items.length - remaining.length;
  logger.info({ importId, total: resume.items.length, skipped, remaining: remaining.length }, "Resuming import");

  res.json({ resumed: true, remaining: remaining.length, skipped });

  // Run async
  (async () => {
    try {
      await processItems(importId, remaining, resume.processedIds, status, resume.accessToken, resume.userId, resume.albumId);
      if (status.status !== "error") {
        status.status = "done";
        resumeDataStore.delete(importId);
      }
    } catch (err: any) {
      status.status = "error";
      status.message = String(err?.message ?? err);
      status.resumable = resumeDataStore.has(importId);
      logger.error({ err: String(err) }, "Google Photos resume failed");
    }
  })().catch(console.error);
});

export default router;
