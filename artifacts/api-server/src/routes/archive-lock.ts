import { Router } from "express";
import { createHmac, randomBytes, randomInt } from "crypto";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
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
  return `otpauth://totp/${encodeURIComponent("APhoto Archive")}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent("APhoto Archive")}`;
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
  // Unlocked via TOTP — clear any recovery flag so manage-lock uses normal TOTP verify
  (req.session as any).archiveUnlocked = true;
  (req.session as any).archiveRecoveredViaEmail = undefined;
  res.json({ success: true });
});

router.get("/archive-lock/session", (req: any, res) => {
  res.json({
    unlocked: !!(req.session as any)?.archiveUnlocked,
    recoveredViaEmail: !!(req.session as any)?.archiveRecoveredViaEmail,
  });
});

router.delete("/archive-lock/setup", async (req: any, res) => {
  const userId = req.currentUser.id;
  await db.update(userSettingsTable).set({ archiveTotpSecret: null }).where(eq(userSettingsTable.userId, userId));
  (req.session as any).archiveUnlocked = undefined;
  (req.session as any).archiveRecoveredViaEmail = undefined;
  res.json({ success: true });
});

// ─── Email recovery ───────────────────────────────────────────────────────────

// In-memory OTP store: userId → { otp, expiresAt }
const recoveryOtps = new Map<string, { otp: string; expiresAt: number }>();

function createMailTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

/** POST /api/archive-lock/send-recovery — email a 6-digit OTP to the user's account email */
router.post("/archive-lock/send-recovery", async (req: any, res) => {
  const userId = req.currentUser.id;
  const userEmail: string | undefined = req.currentUser.email;
  if (!userEmail) return res.status(400).json({ error: "No email on your account" });

  // Rate-limit: one OTP per 60 s
  const existing = recoveryOtps.get(userId);
  if (existing && existing.expiresAt - 9 * 60 * 1000 > Date.now()) {
    return res.status(429).json({ error: "Please wait 60 seconds before requesting another code" });
  }

  const otp = randomInt(100000, 999999).toString();
  recoveryOtps.set(userId, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });
  setTimeout(() => recoveryOtps.delete(userId), 10 * 60 * 1000);

  const transport = createMailTransport();
  if (!transport) {
    return res.status(503).json({ error: "Email service not configured. Contact the administrator." });
  }

  try {
    await transport.sendMail({
      from: `"APhoto" <${process.env.SMTP_USER}>`,
      to: userEmail,
      subject: "Your Archive recovery code",
      text: `Your APhoto Archive recovery code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
      html: `<p>Your <strong>APhoto Archive</strong> recovery code is:</p>
             <h2 style="letter-spacing:0.3em;font-family:monospace">${otp}</h2>
             <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>`,
    });
    // Return masked email so UI can show "sent to pr****@gmail.com"
    const [local, domain] = userEmail.split("@");
    const masked = `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 2))}@${domain}`;
    res.json({ sent: true, maskedEmail: masked });
  } catch (err: any) {
    recoveryOtps.delete(userId);
    res.status(500).json({ error: "Failed to send email. Please try again." });
  }
});

/** POST /api/archive-lock/verify-recovery — verify the emailed OTP, unlock session */
router.post("/archive-lock/verify-recovery", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { token } = req.body as { token?: string };
  if (!token || !/^\d{6}$/.test(token)) return res.status(400).json({ error: "Invalid token format" });

  const entry = recoveryOtps.get(userId);
  if (!entry || Date.now() > entry.expiresAt) {
    recoveryOtps.delete(userId);
    return res.status(401).json({ error: "Code expired or not requested. Please send a new one." });
  }
  if (entry.otp !== token) return res.status(401).json({ error: "Invalid recovery code." });

  recoveryOtps.delete(userId);
  (req.session as any).archiveUnlocked = true;
  (req.session as any).archiveRecoveredViaEmail = true;
  res.json({ success: true });
});

export default router;
