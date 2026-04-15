import { Router } from "express";
import { randomBytes } from "crypto";
import multer from "multer";
import { randomUUID } from "crypto";
import { db, albumsTable, albumPhotosTable, photosTable, albumSharesTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { generateSasUrl, uploadBlob } from "../lib/azure-storage.js";
import exifr from "exifr";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function requireAuth(req: any, res: any, next: any) {
  const user = ((req as Record<string, unknown>).user || (req.session as Record<string, unknown>)?.user) as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

function parseExifDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "string") {
    const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T");
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function extractTakenAt(buffer: Buffer, mimeType: string): Promise<Date | null> {
  if (!mimeType.startsWith("image/")) return null;
  try {
    const exif = await exifr.parse(buffer, {
      pick: ["DateTimeOriginal", "DateTimeDigitized", "CreateDate", "DateTime"],
    });
    const raw = exif?.DateTimeOriginal ?? exif?.DateTimeDigitized ?? exif?.CreateDate ?? exif?.DateTime;
    return parseExifDate(raw);
  } catch {
    return null;
  }
}

// ── Owner: create a share link for an album ────────────────────────────────
router.post("/albums/:id/share", requireAuth, async (req: any, res) => {
  const userId = req.currentUser.id;
  const albumId = req.params.id;
  const { permission = "view" } = req.body as { permission?: "view" | "contribute" };

  if (!["view", "contribute"].includes(permission)) {
    return res.status(400).json({ error: "permission must be 'view' or 'contribute'" });
  }

  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
  if (!album) return res.status(404).json({ error: "Album not found" });

  const token = randomBytes(24).toString("hex");
  await db.insert(albumSharesTable).values({ token, albumId, createdBy: userId, permission });

  const appUrl = process.env.APP_URL || "";
  res.status(201).json({ token, url: `${appUrl}/shared/album/${token}`, permission });
});

// ── Owner: list active shares for an album ────────────────────────────────
router.get("/albums/:id/shares", requireAuth, async (req: any, res) => {
  const userId = req.currentUser.id;
  const albumId = req.params.id;

  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
  if (!album) return res.status(404).json({ error: "Album not found" });

  const shares = await db
    .select()
    .from(albumSharesTable)
    .where(and(eq(albumSharesTable.albumId, albumId), isNull(albumSharesTable.revokedAt)));

  const appUrl = process.env.APP_URL || "";
  res.json(shares.map(s => ({
    ...s,
    url: `${appUrl}/shared/album/${s.token}`,
  })));
});

// ── Owner: revoke a share link ─────────────────────────────────────────────
router.delete("/album-shares/:token", requireAuth, async (req: any, res) => {
  const userId = req.currentUser.id;
  const [share] = await db
    .select({ albumId: albumSharesTable.albumId, createdBy: albumSharesTable.createdBy })
    .from(albumSharesTable)
    .where(eq(albumSharesTable.token, req.params.token));
  if (!share || share.createdBy !== userId) return res.status(404).json({ error: "Not found" });

  await db
    .update(albumSharesTable)
    .set({ revokedAt: new Date() })
    .where(eq(albumSharesTable.token, req.params.token));
  res.json({ ok: true });
});

// ── Public: view shared album (no auth required) ───────────────────────────
router.get("/shared/albums/:token", async (req, res) => {
  const [share] = await db
    .select()
    .from(albumSharesTable)
    .where(and(eq(albumSharesTable.token, req.params.token), isNull(albumSharesTable.revokedAt)));
  if (!share) return res.status(404).json({ error: "Share link not found or revoked" });

  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, share.albumId));
  if (!album) return res.status(404).json({ error: "Album not found" });

  const rows = await db
    .select({ photo: photosTable })
    .from(albumPhotosTable)
    .innerJoin(photosTable, eq(photosTable.id, albumPhotosTable.photoId))
    .where(eq(albumPhotosTable.albumId, album.id));

  const photos = rows.map(r => ({
    ...r.photo,
    url: generateSasUrl(r.photo.blobName, 3600),
    thumbnailUrl: generateSasUrl(r.photo.blobName, 3600),
  }));

  res.json({ album: { id: album.id, name: album.name, description: album.description }, photos, permission: share.permission });
});

// ── Public: guest upload to a contribute-mode shared album ─────────────────
router.post("/shared/albums/:token/photos", upload.single("file"), async (req: any, res) => {
  const [share] = await db
    .select()
    .from(albumSharesTable)
    .where(and(eq(albumSharesTable.token, req.params.token), isNull(albumSharesTable.revokedAt)));
  if (!share) return res.status(404).json({ error: "Share link not found or revoked" });
  if (share.permission !== "contribute") return res.status(403).json({ error: "This link is view-only" });

  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });

  const ext = file.originalname.split(".").pop() ?? "jpg";
  const blobName = `shared/${share.token}/${randomUUID()}.${ext}`;
  await uploadBlob(blobName, file.buffer, file.mimetype);

  const takenAt = await extractTakenAt(file.buffer, file.mimetype);
  const guestUserId = `guest:${share.token}`;

  const [photo] = await db.insert(photosTable).values({
    userId: guestUserId,
    filename: file.originalname,
    blobName,
    contentType: file.mimetype,
    size: file.size,
    takenAt: takenAt ?? undefined,
  }).returning();

  await db.insert(albumPhotosTable).values({ albumId: share.albumId, photoId: photo.id });

  res.status(201).json({
    ...photo,
    url: generateSasUrl(blobName, 3600),
    thumbnailUrl: generateSasUrl(blobName, 3600),
  });
});

export default router;
