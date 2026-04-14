import { Router } from "express";
import { db, albumsTable, albumPhotosTable, photosTable } from "@workspace/db";
import { eq, and, desc, inArray, ne, sql } from "drizzle-orm";
import { generateSasUrl, deleteBlob } from "../lib/azure-storage.js";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const user = ((req as Record<string, unknown>).user || (req.session as Record<string, unknown>)?.user) as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

router.use(requireAuth);

router.get("/albums/trashed", async (req: any, res) => {
  const userId = req.currentUser.id;
  const albums = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.userId, userId), eq(albumsTable.trashed, true)))
    .orderBy(desc(albumsTable.trashedAt));
  res.json(albums);
});

router.post("/albums/:id/restore", async (req: any, res) => {
  const userId = req.currentUser.id;
  const albumId = req.params.id;

  // Un-trash all photos that belong to this album and are currently trashed
  const links = await db
    .select({ photoId: albumPhotosTable.photoId })
    .from(albumPhotosTable)
    .where(eq(albumPhotosTable.albumId, albumId));
  const photoIds = links.map((l: { photoId: string }) => l.photoId);
  if (photoIds.length > 0) {
    await db
      .update(photosTable)
      .set({ trashed: false, trashedAt: null })
      .where(and(inArray(photosTable.id, photoIds), eq(photosTable.trashed, true)));
  }

  const [album] = await db
    .update(albumsTable)
    .set({ trashed: false, trashedAt: null })
    .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)))
    .returning();
  if (!album) return res.status(404).json({ error: "Not found" });
  res.json(album);
});

router.get("/albums", async (req: any, res) => {
  const userId = req.currentUser.id;

  // Single query: count non-trashed photos and pick a cover blob per album
  const rows = await db
    .select({
      id: albumsTable.id,
      name: albumsTable.name,
      description: albumsTable.description,
      createdAt: albumsTable.createdAt,
      photoCount: sql<number>`COUNT(${photosTable.id}) FILTER (WHERE ${photosTable.trashed} = false AND ${photosTable.hidden} = false)`,
      coverBlobName: sql<string | null>`MIN(CASE WHEN ${photosTable.trashed} = false AND ${photosTable.hidden} = false AND ${photosTable.contentType} NOT LIKE 'video/%' THEN ${photosTable.blobName} END)`,
    })
    .from(albumsTable)
    .leftJoin(albumPhotosTable, eq(albumPhotosTable.albumId, albumsTable.id))
    .leftJoin(photosTable, eq(photosTable.id, albumPhotosTable.photoId))
    .where(and(eq(albumsTable.userId, userId), eq(albumsTable.trashed, false)))
    .groupBy(albumsTable.id)
    .orderBy(desc(albumsTable.createdAt));

  const albumsWithCounts = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    photoCount: Number(r.photoCount ?? 0),
    coverUrl: r.coverBlobName ? generateSasUrl(r.coverBlobName, 3600) : undefined,
    createdAt: r.createdAt,
  }));

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
  const { permanent } = req.query as Record<string, string>;
  if (permanent === "true") {
    const albumId = req.params.id;
    // Only delete photos that belong exclusively to this album (not shared with others)
    const links = await db
      .select({ photoId: albumPhotosTable.photoId })
      .from(albumPhotosTable)
      .where(eq(albumPhotosTable.albumId, albumId));
    const photoIds = links.map((l: { photoId: string }) => l.photoId);

    if (photoIds.length > 0) {
      // Find photos that also exist in other albums
      const sharedLinks = await db
        .selectDistinct({ photoId: albumPhotosTable.photoId })
        .from(albumPhotosTable)
        .where(and(inArray(albumPhotosTable.photoId, photoIds), ne(albumPhotosTable.albumId, albumId)));
      const sharedIds = new Set(sharedLinks.map((r: { photoId: string }) => r.photoId));

      // Photos only in this album → delete blob + DB row
      const exclusiveIds = photoIds.filter((id: string) => !sharedIds.has(id));
      if (exclusiveIds.length > 0) {
        const photosToDelete = await db
          .select({ id: photosTable.id, blobName: photosTable.blobName })
          .from(photosTable)
          .where(inArray(photosTable.id, exclusiveIds));
        await Promise.all(photosToDelete.map((p: { id: string; blobName: string }) => deleteBlob(p.blobName).catch(() => {})));
        await db.delete(photosTable).where(inArray(photosTable.id, exclusiveIds));
      }
    }

    await db.delete(albumsTable).where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
  } else {
    const albumId = req.params.id;
    // Cascade: soft-trash photos that are exclusively in this album (not in any other non-trashed album)
    const links = await db
      .select({ photoId: albumPhotosTable.photoId })
      .from(albumPhotosTable)
      .where(eq(albumPhotosTable.albumId, albumId));
    const photoIds = links.map((l: { photoId: string }) => l.photoId);

    if (photoIds.length > 0) {
      // Photos also linked to another non-trashed album must NOT be trashed
      const sharedLinks = await db
        .selectDistinct({ photoId: albumPhotosTable.photoId })
        .from(albumPhotosTable)
        .innerJoin(albumsTable, eq(albumsTable.id, albumPhotosTable.albumId))
        .where(and(
          inArray(albumPhotosTable.photoId, photoIds),
          ne(albumPhotosTable.albumId, albumId),
          eq(albumsTable.trashed, false),
        ));
      const sharedIds = new Set(sharedLinks.map((r: { photoId: string }) => r.photoId));
      const exclusiveIds = photoIds.filter((id: string) => !sharedIds.has(id));
      if (exclusiveIds.length > 0) {
        await db
          .update(photosTable)
          .set({ trashed: true, trashedAt: new Date() })
          .where(inArray(photosTable.id, exclusiveIds));
      }
    }

    await db
      .update(albumsTable)
      .set({ trashed: true, trashedAt: new Date() })
      .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
  }
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

  // Single JOIN query instead of N+1 individual photo queries
  const rows = await db
    .select({ photo: photosTable })
    .from(photosTable)
    .innerJoin(albumPhotosTable, eq(albumPhotosTable.photoId, photosTable.id))
    .where(
      and(
        eq(albumPhotosTable.albumId, req.params.id),
        eq(photosTable.trashed, false),
        eq(photosTable.hidden, false),
      ),
    );

  const photos = rows.map(r => {
    const url = generateSasUrl(r.photo.blobName, 3600);
    return { ...r.photo, url, thumbnailUrl: url, albums: [req.params.id] };
  });

  photos.sort((a: any, b: any) => {
    if (orderBy === "uploaded") {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    }
    const da = new Date(a.takenAt ?? a.uploadedAt).getTime();
    const db2 = new Date(b.takenAt ?? b.uploadedAt).getTime();
    return db2 - da;
  });
  res.json({ photos, total: photos.length });
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
