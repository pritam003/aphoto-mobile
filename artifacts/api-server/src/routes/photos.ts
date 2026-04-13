import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { db, photosTable, albumPhotosTable, albumsTable, shareLinksTable } from "@workspace/db";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { uploadBlob, deleteBlob, generateSasUrl, generateUploadSasUrl, downloadBlob } from "../lib/azure-storage.js";
import exifr from "exifr";

/** Parse an EXIF date value which may be a Date object or the non-standard "YYYY:MM:DD HH:MM:SS" string. */
function parseExifDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "string") {
    // EXIF uses colons as date separators: "2021:03:15 14:22:10" → must become "2021-03-15T14:22:10"
    const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T");
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Extract the capture date from an image buffer. Returns null for videos or images without EXIF. */
async function extractTakenAt(buffer: Buffer, mimeType: string): Promise<Date | null> {
  if (!mimeType.startsWith("image/")) return null;
  try {
    // Try all common EXIF/XMP date tags in order of preference
    const exif = await exifr.parse(buffer, {
      pick: ["DateTimeOriginal", "DateTimeDigitized", "CreateDate", "DateTime"],
    });
    const raw = exif?.DateTimeOriginal ?? exif?.DateTimeDigitized ?? exif?.CreateDate ?? exif?.DateTime;
    return parseExifDate(raw);
  } catch {
    return null;
  }
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function requireAuth(req: any, res: any, next: any) {
  const user = (req as Record<string, unknown>).user as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

router.use(requireAuth);

router.get("/photos/stats", async (req: any, res) => {
  const userId = req.currentUser.id;
  // Single query replaces 4 separate COUNT queries — saves 3× round-trip latency
  const [statsRow, albumCount] = await Promise.all([
    db.execute(
      sql`SELECT
         COUNT(*) FILTER (WHERE NOT trashed AND NOT hidden) AS total,
         COALESCE(SUM(size) FILTER (WHERE NOT trashed AND NOT hidden), 0) AS total_size,
         COUNT(*) FILTER (WHERE favorite AND NOT trashed AND NOT hidden) AS favorites,
         COUNT(*) FILTER (WHERE trashed) AS trashed,
         COUNT(*) FILTER (WHERE hidden AND NOT trashed) AS hidden
       FROM photos WHERE user_id = ${userId}`,
    ),
    db.execute(sql`SELECT COUNT(DISTINCT album_id) AS cnt FROM album_photos ap JOIN albums a ON a.id = ap.album_id WHERE a.user_id = ${userId}`)
      .catch(() => ({ rows: [{ cnt: 0 }] })),
  ]);
  const r = (statsRow as any).rows?.[0] ?? {};
  res.json({
    total: Number(r.total ?? 0),
    favorites: Number(r.favorites ?? 0),
    trashed: Number(r.trashed ?? 0),
    hidden: Number(r.hidden ?? 0),
    albums: Number((albumCount as any).rows?.[0]?.cnt ?? 0),
    totalSize: Number(r.total_size ?? 0),
  });
});

router.get("/photos", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { search, album, favorite, trashed, hidden, limit = "50", offset = "0", orderBy = "taken" } = req.query as Record<string, string>;

  const conditions = [eq(photosTable.userId, userId)];

  if (trashed === "true") {
    conditions.push(eq(photosTable.trashed, true));
  } else {
    conditions.push(eq(photosTable.trashed, false));
  }

  if (hidden === "true") {
    conditions.push(eq(photosTable.hidden, true));
  } else {
    conditions.push(eq(photosTable.hidden, false));
  }

  if (favorite === "true") {
    conditions.push(eq(photosTable.favorite, true));
  }

  if (search) {
    conditions.push(
      or(
        ilike(photosTable.filename, `%${search}%`),
        ilike(photosTable.description, `%${search}%`),
      )!,
    );
  }

  let photos;
  if (album) {
    const albumPhotos = await db
      .select({ photoId: albumPhotosTable.photoId })
      .from(albumPhotosTable)
      .where(eq(albumPhotosTable.albumId, album));
    const photoIds = albumPhotos.map((ap: { photoId: string }) => ap.photoId);
    if (photoIds.length === 0) {
      return res.json({ photos: [], total: 0, hasMore: false });
    }
    const orderExpr = orderBy === "uploaded"
      ? desc(photosTable.uploadedAt)
      : desc(sql`COALESCE(${photosTable.takenAt}, ${photosTable.uploadedAt})`);
    photos = await db
      .select()
      .from(photosTable)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    photos = photos.filter((p: { id: string }) => photoIds.includes(p.id));
  } else {
    const orderExpr = orderBy === "uploaded"
      ? desc(photosTable.uploadedAt)
      : desc(sql`COALESCE(${photosTable.takenAt}, ${photosTable.uploadedAt})`);
    photos = await db
      .select()
      .from(photosTable)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(parseInt(limit))
      .offset(parseInt(offset));
  }

  const photosWithUrls = photos.map((photo: any) => {
      const url = generateSasUrl(photo.blobName);
      return {
        id: photo.id,
        filename: photo.filename,
        description: photo.description,
        contentType: photo.contentType,
        size: photo.size,
        width: photo.width,
        height: photo.height,
        url,
        thumbnailUrl: url,
        favorite: photo.favorite,
        trashed: photo.trashed,
        trashedAt: photo.trashedAt,
        uploadedAt: photo.uploadedAt,
        takenAt: photo.takenAt,
        albums: [],
      };
    });

  res.json({ photos: photosWithUrls, total: photosWithUrls.length, hasMore: photosWithUrls.length === parseInt(limit) });
});

// Returns a write SAS URL so the browser can upload directly to Blob Storage.
// In dev (no SAS), returns null and the client falls back to the multipart POST.
router.post("/photos/presign", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { filename, contentType, albumId } = req.body as {
    filename: string;
    contentType: string;
    albumId?: string;
  };
  if (!filename || !contentType) return res.status(400).json({ error: "filename and contentType required" });

  const ext = path.extname(filename);
  const blobName = albumId
    ? `${userId}/${albumId}/${randomUUID()}${ext}`
    : `${userId}/${randomUUID()}${ext}`;

  const uploadUrl = await generateUploadSasUrl(blobName, contentType);
  // Client must set x-ms-blob-cache-control on the PUT so browsers cache images long-term
  res.json({ uploadUrl: uploadUrl || null, blobName, cacheControl: "public, max-age=31536000, immutable" });
});

// Saves photo metadata after a direct browser→blob upload.
router.post("/photos/register", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { blobName, filename, contentType, size, albumId, takenAt: takenAtStr } = req.body as {
    blobName: string;
    filename: string;
    contentType: string;
    size: number;
    albumId?: string;
    takenAt?: string;
  };
  if (!blobName || !filename || !contentType) return res.status(400).json({ error: "blobName, filename and contentType required" });

  const takenAt = takenAtStr ? new Date(takenAtStr) : null;

  const [photo] = await db
    .insert(photosTable)
    .values({ userId, filename, blobName, contentType, size: size || 0, takenAt })
    .returning();

  if (albumId) {
    const [album] = await db.select().from(albumsTable)
      .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
    if (album) {
      await db.insert(albumPhotosTable).values({ albumId, photoId: photo.id }).onConflictDoNothing();
    }
  }

  const url = generateSasUrl(blobName);
  res.status(201).json({ ...photo, url, thumbnailUrl: url, albums: albumId ? [albumId] : [] });

  // Async EXIF backfill: if client didn't provide takenAt, download the blob and extract ourselves
  if (!takenAt && contentType.startsWith("image/")) {
    downloadBlob(blobName)
      .then(buf => extractTakenAt(buf, contentType))
      .then(extracted => {
        if (extracted) return db.update(photosTable).set({ takenAt: extracted }).where(eq(photosTable.id, photo.id));
      })
      .catch(() => {});
  }
});

router.post("/photos", upload.single("file"), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const userId = req.currentUser.id;
  const albumId: string | undefined = req.body.albumId || undefined;
  const ext = path.extname(req.file.originalname);

  // Store under userId/albumId/uuid.jpg when album is specified, else userId/uuid.jpg
  const blobName = albumId
    ? `${userId}/${albumId}/${randomUUID()}${ext}`
    : `${userId}/${randomUUID()}${ext}`;

  await uploadBlob(blobName, req.file.buffer, req.file.mimetype);

  const takenAt = await extractTakenAt(req.file.buffer, req.file.mimetype);

  const [photo] = await db
    .insert(photosTable)
    .values({
      userId,
      filename: req.file.originalname,
      blobName,
      description: req.body.description || null,
      contentType: req.file.mimetype,
      size: req.file.size,
      takenAt,
    })
    .returning();

  // Auto-link to album if albumId provided
  if (albumId) {
    const [album] = await db
      .select()
      .from(albumsTable)
      .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
    if (album) {
      await db.insert(albumPhotosTable).values({ albumId, photoId: photo.id }).onConflictDoNothing();
    }
  }

  const url = generateSasUrl(blobName);
  res.status(201).json({
    ...photo,
    url,
    thumbnailUrl: url,
    albums: albumId ? [albumId] : [],
  });
});

router.get("/photos/:id/url", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [photo] = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.id, req.params.id), eq(photosTable.userId, userId)));

  if (!photo) return res.status(404).json({ error: "Not found" });
  const url = generateSasUrl(photo.blobName);
  res.json({ url });
});

router.get("/photos/:id", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [photo] = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.id, req.params.id), eq(photosTable.userId, userId)));

  if (!photo) return res.status(404).json({ error: "Not found" });

  const url = generateSasUrl(photo.blobName);
  res.json({ ...photo, url, thumbnailUrl: url, albums: [] });
});

router.patch("/photos/:id/favorite", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { favorite } = req.body as { favorite: boolean };

  const [photo] = await db
    .update(photosTable)
    .set({ favorite })
    .where(and(eq(photosTable.id, req.params.id), eq(photosTable.userId, userId)))
    .returning();

  if (!photo) return res.status(404).json({ error: "Not found" });

  const url = generateSasUrl(photo.blobName);
  res.json({ ...photo, url, thumbnailUrl: url, albums: [] });
});

router.patch("/photos/:id/trash", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { trashed } = req.body as { trashed: boolean };

  const [photo] = await db
    .update(photosTable)
    .set({ trashed, trashedAt: trashed ? new Date() : null })
    .where(and(eq(photosTable.id, req.params.id), eq(photosTable.userId, userId)))
    .returning();

  if (!photo) return res.status(404).json({ error: "Not found" });

  const url = generateSasUrl(photo.blobName);
  res.json({ ...photo, url, thumbnailUrl: url, albums: [] });
});

router.patch("/photos/:id/hide", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { hidden } = req.body as { hidden: boolean };

  const [photo] = await db
    .update(photosTable)
    .set({ hidden })
    .where(and(eq(photosTable.id, req.params.id), eq(photosTable.userId, userId)))
    .returning();

  if (!photo) return res.status(404).json({ error: "Not found" });

  const url = generateSasUrl(photo.blobName);
  res.json({ ...photo, url, thumbnailUrl: url, albums: [] });
});

router.delete("/photos/:id", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [photo] = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.id, req.params.id), eq(photosTable.userId, userId)));

  if (!photo) return res.status(404).json({ error: "Not found" });

  await deleteBlob(photo.blobName);
  await db.delete(photosTable).where(eq(photosTable.id, req.params.id));
  res.status(204).send();
});

export default router;
