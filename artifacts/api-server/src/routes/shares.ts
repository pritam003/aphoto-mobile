import { Router } from "express";
import { randomBytes } from "crypto";
import { db, shareLinksTable, photosTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateSasUrl } from "../lib/azure-storage.js";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const user = ((req as Record<string, unknown>).user || (req.session as Record<string, unknown>)?.user) as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

router.post("/shares", requireAuth, async (req: any, res) => {
  const userId = req.currentUser.id;
  const { photoId, expiresInHours = 24 } = req.body as { photoId: string; expiresInHours?: number };

  const [photo] = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.id, photoId), eq(photosTable.userId, userId)));

  if (!photo) return res.status(404).json({ error: "Photo not found" });

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await db.insert(shareLinksTable).values({ token, photoId, userId, expiresAt });

  const appUrl = process.env.APP_URL || "";
  res.status(201).json({
    token,
    url: `${appUrl}/share/${token}`,
    expiresAt,
  });
});

router.get("/shares/:token", async (req, res) => {
  const [link] = await db
    .select()
    .from(shareLinksTable)
    .where(eq(shareLinksTable.token, req.params.token));

  if (!link || link.expiresAt < new Date()) {
    return res.status(404).json({ error: "Share link not found or expired" });
  }

  const [photo] = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.id, link.photoId));

  if (!photo) return res.status(404).json({ error: "Photo not found" });

  const url = generateSasUrl(photo.blobName, 3600);
  res.json({
    photo: { ...photo, url, thumbnailUrl: url, albums: [] },
    expiresAt: link.expiresAt,
  });
});

export default router;
