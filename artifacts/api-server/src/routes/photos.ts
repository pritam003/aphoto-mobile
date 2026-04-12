import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { db, photosTable, albumPhotosTable, albumsTable, shareLinksTable } from "@workspace/db";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { uploadBlob, deleteBlob, generateSasUrl, generateUploadSasUrl } from "../lib/azure-storage.js";

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
  const [all, favorites, trashed, albumCount] = await Promise.all([
    db.select({ size: photosTable.size }).from(photosTable).where(and(eq(photosTable.userId, userId), eq(photosTable.trashed, false))),
    db.select({ id: photosTable.id }).from(photosTable).where(and(eq(photosTable.userId, userId), eq(photosTable.favorite, true), eq(photosTable.trashed, false))),
    db.select({ id: photosTable.id }).from(photosTable).where(and(eq(photosTable.userId, userId), eq(photosTable.trashed, true))),
    db.execute(`SELECT COUNT(DISTINCT album_id) AS cnt FROM albums WHERE user_id = $1`, [userId]).catch(() => ({ rows: [{ cnt: 0 }] })),
  ]);
  const totalSize = all.reduce((acc: number, p: { size: number }) => acc + (p.size || 0), 0);
  res.json({
    total: all.length,
    favorites: favorites.length,
    trashed: trashed.length,
    albums: Number((albumCount as any).rows?.[0]?.cnt ?? 0),
    totalSize,
  });
});

router.get("/photos", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { search, album, favorite, trashed, limit = "100" } = req.query as Record<string, string>;

  const conditions = [eq(photosTable.userId, userId)];

  if (trashed === "true") {
    conditions.push(eq(photosTable.trashed, true));
  } else {
    conditions.push(eq(photosTable.trashed, false));
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
      return res.json({ photos: [], total: 0 });
    }
    photos = await db
      .select()
      .from(photosTable)
      .where(and(...conditions))
      .orderBy(desc(photosTable.uploadedAt))
      .limit(parseInt(limit));
    photos = photos.filter((p: { id: string }) => photoIds.includes(p.id));
  } else {
    photos = await db
      .select()
      .from(photosTable)
      .where(and(...conditions))
      .orderBy(desc(photosTable.uploadedAt))
      .limit(parseInt(limit));
  }

  const photosWithUrls = await Promise.all(
    photos.map(async (photo: any) => ({
      id: photo.id,
      filename: photo.filename,
      description: photo.description,
      contentType: photo.contentType,
      size: photo.size,
      width: photo.width,
      height: photo.height,
      url: await generateSasUrl(photo.blobName, 3600),
      thumbnailUrl: await generateSasUrl(photo.blobName, 3600),
      favorite: photo.favorite,
      trashed: photo.trashed,
      trashedAt: photo.trashedAt,
      uploadedAt: photo.uploadedAt,
      takenAt: photo.takenAt,
      albums: [],
    })),
  );

  res.json({ photos: photosWithUrls, total: photosWithUrls.length });
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
  res.json({ uploadUrl: uploadUrl || null, blobName });
});

// Saves photo metadata after a direct browser→blob upload.
router.post("/photos/register", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { blobName, filename, contentType, size, albumId } = req.body as {
    blobName: string;
    filename: string;
    contentType: string;
    size: number;
    albumId?: string;
  };
  if (!blobName || !filename || !contentType) return res.status(400).json({ error: "blobName, filename and contentType required" });

  const [photo] = await db
    .insert(photosTable)
    .values({ userId, filename, blobName, contentType, size: size || 0 })
    .returning();

  if (albumId) {
    const [album] = await db.select().from(albumsTable)
      .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
    if (album) {
      await db.insert(albumPhotosTable).values({ albumId, photoId: photo.id }).onConflictDoNothing();
    }
  }

  const url = await generateSasUrl(blobName);
  res.status(201).json({ ...photo, url, thumbnailUrl: url, albums: albumId ? [albumId] : [] });
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

  const [photo] = await db
    .insert(photosTable)
    .values({
      userId,
      filename: req.file.originalname,
      blobName,
      description: req.body.description || null,
      contentType: req.file.mimetype,
      size: req.file.size,
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

  const url = await generateSasUrl(blobName, 3600);
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
  const url = await generateSasUrl(photo.blobName, 3600);
  res.json({ url });
});

router.get("/photos/:id", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [photo] = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.id, req.params.id), eq(photosTable.userId, userId)));

  if (!photo) return res.status(404).json({ error: "Not found" });

  const url = await generateSasUrl(photo.blobName, 3600);
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

  const url = await generateSasUrl(photo.blobName, 3600);
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

  const url = await generateSasUrl(photo.blobName, 3600);
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
