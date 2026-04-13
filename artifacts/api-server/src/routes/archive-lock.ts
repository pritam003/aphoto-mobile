import { Router } from "express";
import { createHmac, randomBytes } from "crypto";
import QRCode from "qrcode";
import { db, userSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// ─── Pure TOTP (RFC 6238) using Node crypto ───────────────────────────────────

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, output = "";
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8) | buf[i];
    bits += 8;
    while (bits >= 5) { output += BASE32_CHARS[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32_CHARS[(val << (5 - bits)) & 31];
  return output;
}

function base32Decode(s: string): Buffer {
  s = s.toUpperCase().replace(/=+$/, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of s) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret(): string { return base32Encode(randomBytes(20)); }

function hotp(secret: string, counter: bigint): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff)
  ) % 1_000_000;
  return code.toString().padStart(6, "0");
}

function totpVerify(secret: string, token: string, window = 1): boolean {
  const step = BigInt(Math.floor(Date.now() / 1000 / 30));
  for (let d = -window; d <= window; d++) {
    if (hotp(secret, step + BigInt(d)) === token) return true;
  }
  return false;
}

function keyUri(secret: string, email: string): string {
  return `otpauth://totp/${encodeURIComponent("APhoto Archive")}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent("APhoto Archive")}&algorithm=SHA1&digits=6&period=30`;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

function requireAuth(req: any, res: any, next: any) {
  const user = ((req as Record<string, unknown>).user ||
    (req.session as Record<string, unknown>)?.user) as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

router.use(requireAuth);

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/archive-lock/status", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [settings] = await db
    .select({ hasSecret: userSettingsTable.archiveTotpSecret })
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));
  res.json({ locked: !!(settings?.hasSecret) });
});

router.post("/archive-lock/setup", async (req: any, res) => {
  const userId = req.currentUser.id;
  const email: string = req.currentUser.email ?? req.currentUser.name ?? userId;
  const secret = generateSecret();
  const qrDataUrl = await QRCode.toDataURL(keyUri(secret, email));
  await db
    .insert(userSettingsTable)
    .values({ userId, archiveTotpSecret: secret })
    .onConflictDoUpdate({ target: userSettingsTable.userId, set: { archiveTotpSecret: secret } });
  res.json({ qrDataUrl, secret });
});

router.post("/archive-lock/verify", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { token } = req.body as { token?: string };
  if (!token || !/^\d{6}$/.test(token)) return res.status(400).json({ error: "Invalid token format" });
  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
  if (!settings?.archiveTotpSecret) return res.status(404).json({ error: "Archive lock not set up" });
  if (!totpVerify(settings.archiveTotpSecret, token)) return res.status(401).json({ error: "Invalid code. Please try again." });
  (req.session as any).archiveUnlocked = true;
  res.json({ success: true });
});

router.get("/archive-lock/session", (req: any, res) => {
  res.json({ unlocked: !!(req.session as any)?.archiveUnlocked });
});

router.delete("/archive-lock/setup", async (req: any, res) => {
  const userId = req.currentUser.id;
  await db.update(userSettingsTable).set({ archiveTotpSecret: null }).where(eq(userSettingsTable.userId, userId));
  (req.session as any).archiveUnlocked = undefined;
  res.json({ success: true });
});

export default router;
