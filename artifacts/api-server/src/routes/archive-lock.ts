import { Router } from "express";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { db, userSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const user = ((req as Record<string, unknown>).user ||
    (req.session as Record<string, unknown>)?.user) as Record<string, string> | undefined;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.currentUser = { ...user, id: user.id || user.sub };
  next();
}

router.use(requireAuth);

/** GET /api/archive-lock/status — is lock enabled for this user? */
router.get("/archive-lock/status", async (req: any, res) => {
  const userId = req.currentUser.id;
  const [settings] = await db
    .select({ hasSecret: userSettingsTable.archiveTotpSecret })
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));

  res.json({ locked: !!(settings?.hasSecret) });
});

/** POST /api/archive-lock/setup — generate a new TOTP secret + QR code URI */
router.post("/archive-lock/setup", async (req: any, res) => {
  const userId = req.currentUser.id;
  const email: string = req.currentUser.email ?? req.currentUser.name ?? userId;

  const secret = authenticator.generateSecret();
  const otpAuthUrl = authenticator.keyuri(email, "APhoto Archive", secret);
  const qrDataUrl = await QRCode.toDataURL(otpAuthUrl);

  // Persist as pending (not yet confirmed) — store it directly; user must confirm next
  await db
    .insert(userSettingsTable)
    .values({ userId, archiveTotpSecret: secret })
    .onConflictDoUpdate({
      target: userSettingsTable.userId,
      set: { archiveTotpSecret: secret },
    });

  res.json({ qrDataUrl, otpAuthUrl, secret });
});

/** POST /api/archive-lock/verify — verify a TOTP token (unlock session) */
router.post("/archive-lock/verify", async (req: any, res) => {
  const userId = req.currentUser.id;
  const { token } = req.body as { token?: string };

  if (!token || !/^\d{6}$/.test(token)) {
    return res.status(400).json({ error: "Invalid token format" });
  }

  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId));

  if (!settings?.archiveTotpSecret) {
    return res.status(404).json({ error: "Archive lock not set up" });
  }

  const valid = authenticator.verify({ token, secret: settings.archiveTotpSecret });
  if (!valid) {
    return res.status(401).json({ error: "Invalid code. Please try again." });
  }

  // Store unlock flag in session (expires with session)
  (req.session as any).archiveUnlocked = true;
  res.json({ success: true });
});

/** GET /api/archive-lock/session — is this session currently unlocked? */
router.get("/archive-lock/session", (req: any, res) => {
  res.json({ unlocked: !!(req.session as any)?.archiveUnlocked });
});

/** DELETE /api/archive-lock/setup — remove the lock */
router.delete("/archive-lock/setup", async (req: any, res) => {
  const userId = req.currentUser.id;
  await db
    .update(userSettingsTable)
    .set({ archiveTotpSecret: null })
    .where(eq(userSettingsTable.userId, userId));
  (req.session as any).archiveUnlocked = undefined;
  res.json({ success: true });
});

export default router;
