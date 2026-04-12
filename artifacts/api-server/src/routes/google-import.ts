import { Router } from "express";
import { randomUUID } from "crypto";
import https from "https";
import http from "http";
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

// In-memory state store: stateKey -> { albumUrl (resolved), userId, redirectUri }
const pendingStates = new Map<string, { albumUrl: string; userId: string; redirectUri: string }>();

// In-memory import status: importId -> status
interface ImportStatus {
  status: "running" | "done" | "error";
  albumName: string;
  albumId?: string;
  total: number;
  imported: number;
  errors: number;
  message?: string;
}
const importStatuses = new Map<string, ImportStatus>();

function requireAuth(req: any, res: any, next: any) {
  const user = (req as Record<string, unknown>).user as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

function isGooglePhotosUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "photos.app.goo.gl" ||
      u.hostname === "photos.google.com" ||
      u.hostname === "goo.gl"
    );
  } catch {
    return false;
  }
}

/**
 * Resolve one redirect hop for photos.app.goo.gl short links.
 * Uses Node.js https directly — native fetch returns status=0 for opaqueredirect.
 */
function resolveUrl(url: string): Promise<string> {
  return new Promise((resolve) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      req.destroy();
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(res.headers.location);
      } else {
        resolve(url);
      }
    });
    req.on("error", () => resolve(url));
    req.setTimeout(8000, () => { req.destroy(); resolve(url); });
  });
}

function parseGoogleAlbumUrl(url: string): { type: "album" | "shared"; id: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("google.com")) return null;
    const albumMatch = u.pathname.match(/\/album\/([^/?#]+)/);
    if (albumMatch) return { type: "album", id: albumMatch[1] };
    const shareMatch = u.pathname.match(/\/share(?:\/album)?\/([^/?#]+)/);
    if (shareMatch) return { type: "shared", id: shareMatch[1] };
    return null;
  } catch {
    return null;
  }
}

async function fetchAllMediaItems(albumId: string, accessToken: string): Promise<any[]> {
  const items: any[] = [];
  let pageToken: string | undefined;
  do {
    const body: Record<string, unknown> = { albumId, pageSize: 100 };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:search", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Google Photos API error (${res.status}): ${await res.text()}`);
    const data = await res.json() as { mediaItems?: any[]; nextPageToken?: string };
    if (data.mediaItems) items.push(...data.mediaItems);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

async function runImport(importId: string, albumUrl: string, userId: string, accessToken: string) {
  const status: ImportStatus = { status: "running", albumName: "Google Photos Import", total: 0, imported: 0, errors: 0 };
  importStatuses.set(importId, status);

  try {
    const parsed = parseGoogleAlbumUrl(albumUrl);
    if (!parsed) throw new Error("Could not parse album URL: " + albumUrl);

    let resolvedAlbumId = parsed.id;
    let albumTitle = "Google Photos Import";

    if (parsed.type === "shared") {
      // Join shared album to get real albumId
      const joinRes = await fetch("https://photoslibrary.googleapis.com/v1/sharedAlbums:join", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ shareToken: parsed.id }),
      });
      if (joinRes.ok) {
        const joined = await joinRes.json() as { album?: { id: string; title?: string } };
        if (joined.album) {
          resolvedAlbumId = joined.album.id;
          albumTitle = joined.album.title || albumTitle;
        }
      } else {
        const sharedRes = await fetch(
          `https://photoslibrary.googleapis.com/v1/sharedAlbums/${parsed.id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (sharedRes.ok) {
          const shared = await sharedRes.json() as { id: string; title?: string };
          resolvedAlbumId = shared.id;
          albumTitle = shared.title || albumTitle;
        }
      }
    } else {
      const albumRes = await fetch(
        `https://photoslibrary.googleapis.com/v1/albums/${parsed.id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (albumRes.ok) {
        const albumData = await albumRes.json() as { title?: string };
        albumTitle = albumData.title || albumTitle;
      }
    }

    status.albumName = albumTitle;
    const items = await fetchAllMediaItems(resolvedAlbumId, accessToken);
    status.total = items.length;

    if (items.length === 0) {
      status.status = "done";
      status.message = "No media items found in this album.";
      return;
    }

    const [newAlbum] = await db
      .insert(albumsTable)
      .values({ userId, name: albumTitle })
      .returning();
    status.albumId = newAlbum.id;

    for (const item of items) {
      try {
        const isVideo = !!item.mediaMetadata?.video;
        const contentType = isVideo ? "video/mp4" : "image/jpeg";
        const ext = isVideo ? ".mp4" : ".jpg";
        const photoRes = await fetch(`${item.baseUrl}=d0`);
        if (!photoRes.ok) throw new Error(`Download failed: ${photoRes.status}`);

        const buffer = Buffer.from(await photoRes.arrayBuffer());
        const blobName = `${userId}/${newAlbum.id}/${randomUUID()}${ext}`;
        await uploadBlob(blobName, buffer, contentType);

        const [photo] = await db
          .insert(photosTable)
          .values({
            userId,
            filename: item.filename || `photo${ext}`,
            blobName,
            contentType,
            size: buffer.byteLength,
            width: item.mediaMetadata?.width ? Number(item.mediaMetadata.width) : null,
            height: item.mediaMetadata?.height ? Number(item.mediaMetadata.height) : null,
            takenAt: item.mediaMetadata?.creationTime ? new Date(item.mediaMetadata.creationTime) : null,
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
  } catch (err: any) {
    status.status = "error";
    status.message = String(err?.message ?? err);
    logger.error({ err: String(err) }, "Google Photos import failed");
  }
}

// POST /api/google/auth-url — validate album URL, return Google OAuth URL
router.post("/google/auth-url", requireAuth, async (req: any, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: "Google import not configured." });
  }

  const { albumUrl } = req.body as { albumUrl?: string };
  if (!albumUrl?.trim()) return res.status(400).json({ error: "albumUrl required" });
  if (!isGooglePhotosUrl(albumUrl.trim())) {
    return res.status(400).json({ error: "Invalid URL. Paste a Google Photos album link." });
  }

  // Resolve short URLs (photos.app.goo.gl) before storing
  const resolved = await resolveUrl(albumUrl.trim());
  const redirectUri = `${apiOrigin(req)}/api/google/callback`;

  const state = randomUUID();
  pendingStates.set(state, { albumUrl: resolved, userId: req.currentUser.id, redirectUri });
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/photoslibrary.readonly",
      "https://www.googleapis.com/auth/photoslibrary.sharing",
    ].join(" "),
    access_type: "offline",
    state,
    prompt: "select_account consent",
  });

  res.json({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// GET /api/google/callback — exchange code, start import, redirect to frontend
router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = APP_URL || "http://localhost:5173";

  if (error || !code || !state) {
    return res.redirect(`${frontendUrl}/albums?import_error=${encodeURIComponent(error ?? "cancelled")}`);
  }
  const pending = pendingStates.get(state);
  if (!pending) {
    return res.redirect(`${frontendUrl}/albums?import_error=expired`);
  }
  pendingStates.delete(state);

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

  const tokenData = await tokenRes.json() as { access_token: string; scope?: string; token_type?: string };
  const { access_token } = tokenData;
  // Log granted scopes so we can diagnose scope issues
  logger.info({ grantedScopes: tokenData.scope }, "Google OAuth token received");

  const importId = randomUUID();
  runImport(importId, pending.albumUrl, pending.userId, access_token).catch(console.error);

  return res.redirect(`${frontendUrl}/albums?import_id=${importId}`);
});

// GET /api/google/import/:id — poll import progress
router.get("/google/import/:id", requireAuth, (req, res) => {
  const status = importStatuses.get(req.params.id);
  if (!status) return res.status(404).json({ error: "Import not found" });
  res.json(status);
});

export default router;
