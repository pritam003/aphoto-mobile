import { Router } from "express";
import { randomUUID } from "crypto";
import https from "https";
import http from "http";
import { db, photosTable, albumsTable, albumPhotosTable } from "@workspace/db";
import { uploadBlob } from "../lib/azure-storage.js";
import { logger } from "../lib/logger.js";

const router = Router();

// In-memory import status: importId → status
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

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Short URLs like photos.app.goo.gl redirect to an app-interstitial page
 * (DurableDeepLink) when followed automatically. We resolve ONE hop manually
 * to get the real photos.google.com/share/... URL.
 *
 * Uses Node.js https/http directly because Node's native fetch returns
 * status=0 for opaqueredirect responses (redirect:"manual"), making the
 * Location header inaccessible.
 */
function resolveUrl(url: string): Promise<string> {
  return new Promise((resolve) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": BROWSER_UA } }, (res) => {
      req.destroy(); // don't download the body
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

/**
 * Fetch a public Google Photos shared album page and extract photo base-URLs.
 * Google embeds all photo data in the page HTML as lh3.googleusercontent.com/pw/... URLs.
 */
async function scrapePublicAlbum(albumUrl: string): Promise<{ title: string; photoUrls: string[] }> {
  // Resolve short URLs (photos.app.goo.gl) to the real photos.google.com URL
  const resolvedUrl = await resolveUrl(albumUrl);

  const res = await fetch(resolvedUrl, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Could not fetch album page: HTTP ${res.status}. Make sure the album is publicly shared.`);
  }
  const html = await res.text();

  // Page title (strip " - Google Photos" suffix)
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  let title = titleMatch ? titleMatch[1].replace(/ ?[-–] ?Google Photos$/i, "").trim() : "";
  if (!title) title = "Google Photos Import";

  // Google Photos embeds image base-URLs as lh3.googleusercontent.com/pw/... in the page source
  const urlPattern = /https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_\-]+/g;
  const found = new Set(html.match(urlPattern) ?? []);

  // Filter out small thumbnail variants already in the HTML (they often appear with size params inline)
  // We keep just the base URLs; we'll append =d0 when downloading
  const photoUrls = Array.from(found);

  return { title, photoUrls };
}

async function runImport(importId: string, albumUrl: string, userId: string) {
  const status: ImportStatus = { status: "running", albumName: "Google Photos Import", total: 0, imported: 0, errors: 0 };
  importStatuses.set(importId, status);

  try {
    const { title, photoUrls } = await scrapePublicAlbum(albumUrl);
    status.albumName = title;
    status.total = photoUrls.length;

    if (photoUrls.length === 0) {
      status.status = "error";
      status.message = "No photos found. Make sure the album is publicly shared and try again.";
      return;
    }

    // Create album in our app
    const [newAlbum] = await db
      .insert(albumsTable)
      .values({ userId, name: title })
      .returning();
    status.albumId = newAlbum.id;

    for (let i = 0; i < photoUrls.length; i++) {
      try {
        // Append =d0 for full-resolution download
        const downloadUrl = `${photoUrls[i]}=d0`;
        const photoRes = await fetch(downloadUrl, {
          headers: { "User-Agent": BROWSER_UA },
        });
        if (!photoRes.ok) throw new Error(`Download failed: ${photoRes.status}`);

        const contentType = photoRes.headers.get("content-type") ?? "image/jpeg";
        const isVideo = contentType.startsWith("video/");
        const ext = isVideo ? ".mp4" : ".jpg";
        const buffer = Buffer.from(await photoRes.arrayBuffer());
        const blobName = `${userId}/${newAlbum.id}/${randomUUID()}${ext}`;

        await uploadBlob(blobName, buffer, contentType);

        const [photo] = await db
          .insert(photosTable)
          .values({
            userId,
            filename: `photo_${i + 1}${ext}`,
            blobName,
            contentType,
            size: buffer.byteLength,
          })
          .returning();

        await db
          .insert(albumPhotosTable)
          .values({ albumId: newAlbum.id, photoId: photo.id })
          .onConflictDoNothing();

        status.imported++;
      } catch (err: any) {
        logger.error({ err: String(err), url: photoUrls[i] }, "Failed to import photo");
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

// POST /api/google/import — start a no-OAuth import from a public shared album
router.post("/google/import", requireAuth, async (req: any, res) => {
  const { albumUrl } = req.body as { albumUrl?: string };
  if (!albumUrl?.trim()) return res.status(400).json({ error: "albumUrl required" });
  if (!isGooglePhotosUrl(albumUrl.trim())) {
    return res.status(400).json({
      error: "Invalid URL. Paste a Google Photos shared album link (photos.app.goo.gl/... or photos.google.com/...).",
    });
  }

  const importId = randomUUID();
  runImport(importId, albumUrl.trim(), req.currentUser.id).catch(console.error);
  res.json({ importId });
});

// GET /api/google/import/:id — poll import progress
router.get("/google/import/:id", requireAuth, (req, res) => {
  const status = importStatuses.get(req.params.id);
  if (!status) return res.status(404).json({ error: "Import not found" });
  res.json(status);
});

export default router;
