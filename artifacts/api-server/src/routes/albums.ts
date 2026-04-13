import { Router } from "express";
import { db, albumsTable, albumPhotosTable, photosTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { generateSasUrl } from "../lib/azure-storage.js";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const user = ((req as Record<string, unknown>).user || (req.session as Record<string, unknown>)?.user) as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

router.use(requireAuth);

router.get("/albums", async (req: any, res) => {
  const userId = req.currentUser.id;
  const albums = await db
    .select()
    .from(albumsTable)
    .where(eq(albumsTable.userId, userId))
    .orderBy(desc(albumsTable.createdAt));

  const albumsWithCounts = await Promise.all(
    albums.map(async (album: any) => {
      const albumPhotos = await db
        .select({ photoId: albumPhotosTable.photoId })
        .from(albumPhotosTable)
        .where(eq(albumPhotosTable.albumId, album.id));

      const photoIds = albumPhotos.map((ap: { photoId: string }) => ap.photoId);

      // Only count and use non-trashed photos
      let coverUrl: string | undefined;
      let photoCount = 0;
      if (photoIds.length > 0) {
        const activePhotos = await db
          .select()
          .from(photosTable)
          .where(and(eq(photosTable.trashed, false)))
          .then((rows: any[]) => rows.filter((p) => photoIds.includes(p.id)));

        photoCount = activePhotos.length;
        if (activePhotos.length > 0) {
          coverUrl = generateSasUrl(activePhotos[0].blobName, 3600);
        }
      }

      return {
        id: album.id,
        name: album.name,
        description: album.description,
        photoCount,
        coverUrl,
        createdAt: album.createdAt,
      };
    }),
  );

  res.json(albumsWithCounts);
});

router.post("/albums", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { name, description } = req.body as { name: string; description?: string };

  const [album] = await db
    .insert(albumsTable)
    .values({ userId, name, description: description || null })
    .returning();

  res.status(201).json({ ...album, photoCount: 0 });
});

router.get("/albums/:id", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.id, req.params.id), eq(albumsTable.userId, userId)));

  if (!album) return res.status(404).json({ error: "Not found" });

  const albumPhotos = await db
    .select({ photoId: albumPhotosTable.photoId })
    .from(albumPhotosTable)
    .where(eq(albumPhotosTable.albumId, album.id));

  res.json({ ...album, photoCount: albumPhotos.length });
});

router.patch("/albums/:id", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { name, description } = req.body as { name?: string; description?: string };

  const [album] = await db
    .update(albumsTable)
    .set({ ...(name && { name }), ...(description !== undefined && { description }) })
    .where(and(eq(albumsTable.id, req.params.id), eq(albumsTable.userId, userId)))
    .returning();

  if (!album) return res.status(404).json({ error: "Not found" });

  const albumPhotos = await db
    .select({ photoId: albumPhotosTable.photoId })
    .from(albumPhotosTable)
    .where(eq(albumPhotosTable.albumId, album.id));

  res.json({ ...album, photoCount: albumPhotos.length });
});

router.delete("/albums/:id", async (req: any, res) => {
  const userId = req.currentUser.id;
  await db
    .delete(albumsTable)
    .where(and(eq(albumsTable.id, req.params.id), eq(albumsTable.userId, userId)));
  res.status(204).send();
});

router.get("/albums/:id/photos", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { orderBy = "taken" } = req.query as Record<string, string>;
  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.id, req.params.id), eq(albumsTable.userId, userId)));

  if (!album) return res.status(404).json({ error: "Not found" });

  const albumPhotoLinks = await db
    .select({ photoId: albumPhotosTable.photoId })
    .from(albumPhotosTable)
    .where(eq(albumPhotosTable.albumId, req.params.id));

  const photoIds = albumPhotoLinks.map((ap: { photoId: string }) => ap.photoId);
  if (photoIds.length === 0) return res.json({ photos: [], total: 0 });

  const photos = await Promise.all(
    photoIds.map(async (photoId: string) => {
      const [photo] = await db.select().from(photosTable).where(and(eq(photosTable.id, photoId), eq(photosTable.trashed, false)));
      if (!photo) return null;
      const url = generateSasUrl(photo.blobName, 3600);
      return { ...photo, url, thumbnailUrl: url, albums: [req.params.id] };
    }),
  );

  const validPhotos = photos.filter(Boolean) as any[];
  validPhotos.sort((a, b) => {
    if (orderBy === "uploaded") {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    }
    const da = new Date(a.takenAt ?? a.uploadedAt).getTime();
    const db2 = new Date(b.takenAt ?? b.uploadedAt).getTime();
    return db2 - da;
  });
  res.json({ photos: validPhotos, total: validPhotos.length });
});

router.post("/albums/:id/photos", async (req: any, res) => {
  const { photoId } = req.body as { photoId: string };
  const userId = req.currentUser.id;

  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.id, req.params.id), eq(albumsTable.userId, userId)));

  if (!album) return res.status(404).json({ error: "Not found" });

  const existing = await db
    .select()
    .from(albumPhotosTable)
    .where(and(eq(albumPhotosTable.albumId, req.params.id), eq(albumPhotosTable.photoId, photoId)));

  if (existing.length === 0) {
    await db.insert(albumPhotosTable).values({ albumId: req.params.id, photoId });
  }

  res.status(204).send();
});

router.delete("/albums/:id/photos/:photoId", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.id, req.params.id), eq(albumsTable.userId, userId)));

  if (!album) return res.status(404).json({ error: "Not found" });

  await db
    .delete(albumPhotosTable)
    .where(and(eq(albumPhotosTable.albumId, req.params.id), eq(albumPhotosTable.photoId, req.params.photoId)));

  res.status(204).send();
});

export default router;
