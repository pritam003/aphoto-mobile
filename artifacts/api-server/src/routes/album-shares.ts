import { Router } from "express";
import { randomBytes, createHash } from "crypto";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import multer from "multer";
import { db, albumsTable, albumPhotosTable, photosTable, albumSharesTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { generateSasUrl, uploadBlob, downloadBlob } from "../lib/azure-storage.js";
import archiver from "archiver";
import exifr from "exifr";

// ── Access-code helpers ────────────────────────────────────────────────────────
/** Generate a Microsoft-style access code like "ABCD-EF23" */
function generateAccessCode(): string {
  // Exclude visually ambiguous chars: 0/O, 1/I
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let raw = "";
  for (let i = 0; i < 8; i++) raw += chars[bytes[i] % chars.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Hash a code (normalised: uppercase, dash removed) with SHA-256 */
function hashAccessCode(code: string): string {
  const normalised = code.toUpperCase().replace(/-/g, "");
  return createHash("sha256").update(normalised).digest("hex");
}

/** Read x-access-code header, verify against stored hash. Returns true if OK. */
function verifyAccessCode(req: any, res: any, share: any): boolean {
  const raw = ((req.headers["x-access-code"] as string) ?? "").trim();
  if (!raw) {
    res.status(401).json({ error: "Access code required", shareType: "code" });
    return false;
  }
  if (hashAccessCode(raw) !== share.accessCodeHash) {
    res.status(403).json({ error: "Invalid access code" });
    return false;
  }
  return true;
}

const JWT_SECRET = process.env.JWT_SECRET || "your-app-id-or-realm-identifier";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

/** Verify a Bearer share-access JWT (for email-based shares). */
function verifyEmailAccess(req: any, res: any, share: any): boolean {
  const auth = ((req.headers["authorization"] as string) ?? "").trim();
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearerToken) {
    res.status(401).json({ error: "Sign in required", shareType: "email" });
    return false;
  }
  try {
    const payload = jwt.verify(bearerToken, JWT_SECRET) as { email: string; shareToken: string };
    const allowed: string[] = JSON.parse(share.allowedEmails || "[]");
    if (!allowed.map((e: string) => e.toLowerCase()).includes(payload.email.toLowerCase())) {
      res.status(403).json({ error: "Your email does not have access to this album" });
      return false;
    }
    if (payload.shareToken !== share.token) {
      res.status(403).json({ error: "Access token is not valid for this link" });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: "Invalid or expired access. Please sign in again.", shareType: "email" });
    return false;
  }
}

/** Dispatch to correct verifier based on share type. */
function verifyShareAccess(req: any, res: any, share: any): boolean {
  return (share.shareType ?? "code") === "email"
    ? verifyEmailAccess(req, res, share)
    : verifyAccessCode(req, res, share);
}

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
  const { permission = "view", name, shareType = "code", allowedEmails } = req.body as {
    permission?: "view" | "contribute";
    name?: string;
    shareType?: "code" | "email";
    allowedEmails?: string[];
  };

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "A name for this share link is required" });
  }
  if (!["view", "contribute"].includes(permission)) {
    return res.status(400).json({ error: "permission must be 'view' or 'contribute'" });
  }
  if (!["code", "email"].includes(shareType)) {
    return res.status(400).json({ error: "shareType must be 'code' or 'email'" });
  }
  if (shareType === "email") {
    if (!allowedEmails || allowedEmails.length === 0) {
      return res.status(400).json({ error: "At least one email address is required" });
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const e of allowedEmails) {
      if (!emailRe.test(e)) return res.status(400).json({ error: `Invalid email: ${e}` });
    }
  }

  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.id, albumId), eq(albumsTable.userId, userId)));
  if (!album) return res.status(404).json({ error: "Album not found" });

  const token = randomBytes(24).toString("hex");
  const appUrl = process.env.APP_URL || "";

  if (shareType === "email") {
    const emails = allowedEmails!.map(e => e.toLowerCase().trim());
    await db.insert(albumSharesTable).values({
      token, albumId, createdBy: userId,
      name: name.trim(), shareType: "email",
      allowedEmails: JSON.stringify(emails),
      permission, accessCodeHash: "",
    });
    return res.status(201).json({
      token, url: `${appUrl}/shared/album/${token}`,
      permission, name: name.trim(), shareType: "email", allowedEmails: emails,
    });
  }

  // Code-based share
  const accessCode = generateAccessCode();
  const accessCodeHash = hashAccessCode(accessCode);
  await db.insert(albumSharesTable).values({
    token, albumId, createdBy: userId,
    name: name.trim(), shareType: "code",
    permission, accessCodeHash,
  });
  // accessCode is returned ONCE — never stored in plaintext
  res.status(201).json({
    token, url: `${appUrl}/shared/album/${token}`,
    permission, name: name.trim(), shareType: "code", accessCode,
  });
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
  res.json({ shares: shares.map(s => ({
    token: s.token,
    albumId: s.albumId,
    createdBy: s.createdBy,
    name: s.name,
    shareType: s.shareType ?? "code",
    permission: s.permission,
    allowedEmails: (s.shareType ?? "code") === "email" ? JSON.parse(s.allowedEmails || "[]") : undefined,
    createdAt: s.createdAt,
    url: `${appUrl}/shared/album/${s.token}`,
  })) });
});

// ── Public: get share metadata (type, album name) — no auth required ────────
router.get("/shared/albums/:token/meta", async (req, res) => {
  const [share] = await db
    .select({ shareType: albumSharesTable.shareType, name: albumSharesTable.name, albumId: albumSharesTable.albumId })
    .from(albumSharesTable)
    .where(and(eq(albumSharesTable.token, req.params.token), isNull(albumSharesTable.revokedAt)));
  if (!share) return res.status(404).json({ error: "Share link not found or revoked" });

  const [album] = await db
    .select({ name: albumsTable.name })
    .from(albumsTable)
    .where(eq(albumsTable.id, share.albumId));

  res.json({
    shareType: share.shareType ?? "code",
    shareName: share.name,
    albumName: album?.name ?? "",
    googleClientId: (share.shareType ?? "code") === "email" ? (GOOGLE_CLIENT_ID ?? null) : null,
  });
});

// ── Public: check if an email is on the allowed list (no auth required) ──────
router.post("/shared/albums/:token/check-email", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email required" });

  const [share] = await db
    .select()
    .from(albumSharesTable)
    .where(and(eq(albumSharesTable.token, req.params.token), isNull(albumSharesTable.revokedAt)));
  if (!share) return res.status(404).json({ error: "Share link not found" });
  if ((share.shareType ?? "code") !== "email") {
    return res.status(400).json({ error: "This share link does not use email access" });
  }

  const allowed: string[] = JSON.parse(share.allowedEmails || "[]");
  if (!allowed.map((e: string) => e.toLowerCase()).includes(email.toLowerCase().trim())) {
    return res.status(403).json({
      error: "This email address does not have access to this album",
    });
  }

  res.json({ allowed: true });
});

// ── Public: verify Google credential for email-based share access ────────────
router.post("/shared/albums/:token/google-verify", async (req, res) => {
  const { credential } = req.body as { credential?: string };
  if (!credential) return res.status(400).json({ error: "credential required" });

  const [share] = await db
    .select()
    .from(albumSharesTable)
    .where(and(eq(albumSharesTable.token, req.params.token), isNull(albumSharesTable.revokedAt)));
  if (!share) return res.status(404).json({ error: "Share link not found" });
  if ((share.shareType ?? "code") !== "email") {
    return res.status(400).json({ error: "This share link does not use email access" });
  }

  // Verify Google ID token via Google's tokeninfo endpoint
  const googleRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );
  if (!googleRes.ok) return res.status(401).json({ error: "Invalid Google credential" });

  const googleData = await googleRes.json() as {
    email?: string; email_verified?: string; aud?: string;
  };
  if (!googleData.email || googleData.email_verified !== "true") {
    return res.status(401).json({ error: "Google account email is not verified" });
  }
  if (GOOGLE_CLIENT_ID && googleData.aud !== GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: "Credential is not intended for this application" });
  }

  const allowed: string[] = JSON.parse(share.allowedEmails || "[]");
  if (!allowed.map(e => e.toLowerCase()).includes(googleData.email.toLowerCase())) {
    return res.status(403).json({
      error: "Your Google account is not on the access list for this album",
    });
  }

  // Issue a 30-day share-specific JWT — Google credential is never stored
  const accessToken = jwt.sign(
    { email: googleData.email, shareToken: share.token },
    JWT_SECRET,
    { expiresIn: "30d" },
  );
  res.json({ accessToken, email: googleData.email });
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
  if (!verifyShareAccess(req, res, share)) return;

  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, share.albumId));
  if (!album) return res.status(404).json({ error: "Album not found" });

  const rows = await db
    .select({ photo: photosTable })
    .from(albumPhotosTable)
    .innerJoin(photosTable, eq(photosTable.id, albumPhotosTable.photoId))
    .where(eq(albumPhotosTable.albumId, album.id));

  const photos = rows.map(r => ({
    ...r.photo,
    url: generateSasUrl(r.photo.blobName),
    thumbnailUrl: generateSasUrl(r.photo.blobName),
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
  if (!verifyShareAccess(req, res, share)) return;
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
    url: generateSasUrl(blobName),
    thumbnailUrl: generateSasUrl(blobName),
  });
});

// ── Public: download selected photos as a ZIP ─────────────────────────────
router.post("/shared/albums/:token/download-zip", async (req, res) => {
  const [share] = await db
    .select()
    .from(albumSharesTable)
    .where(and(eq(albumSharesTable.token, req.params.token), isNull(albumSharesTable.revokedAt)));
  if (!share) return res.status(404).json({ error: "Share link not found or revoked" });
  if (!verifyShareAccess(req, res, share)) return;

  const [album] = await db.select().from(albumsTable).where(eq(albumsTable.id, share.albumId));
  if (!album) return res.status(404).json({ error: "Album not found" });

  const { photoIds } = req.body as { photoIds?: string[] };

  let rows = await db
    .select({ photo: photosTable })
    .from(albumPhotosTable)
    .innerJoin(photosTable, eq(photosTable.id, albumPhotosTable.photoId))
    .where(eq(albumPhotosTable.albumId, album.id));

  if (photoIds && photoIds.length > 0) {
    rows = rows.filter(r => photoIds.includes(r.photo.id));
  }

  if (rows.length === 0) return res.status(400).json({ error: "No photos to download" });

  const safeName = album.name.replace(/[^\w\s-]/g, "").trim() || "album";
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);
  res.setHeader("Cache-Control", "no-store");

  const archive = archiver("zip", { zlib: { level: 0 } });
  archive.on("error", () => res.end());
  archive.pipe(res);

  // Track used filenames to avoid collisions
  const used = new Map<string, number>();
  for (const { photo } of rows) {
    try {
      const buf = await downloadBlob(photo.blobName);
      const base = photo.filename;
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const name = count === 0 ? base : `${base.replace(/(\.[^.]+)$/, "")}_${count}$1`;
      archive.append(buf, { name });
    } catch {
      // skip unreadable blobs silently
    }
  }

  await archive.finalize();
});

export default router;
