import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import {
  initiateDeviceCodeFlow,
  pollForDeviceCodeToken,
  getMicrosoftUser,
} from "../lib/auth.js";

const router = Router();

// JWT secret - same as app.ts
const JWT_SECRET = process.env.JWT_SECRET || "your-app-id-or-realm-identifier";

const isDev = process.env.NODE_ENV !== "production";
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `${APP_URL}/api/auth/google/callback`;

// In-memory OAuth state store (state → redirect-to-path), auto-expires after 10 min
const googleStates = new Map<string, { redirectTo: string }>();

// Helper to create JWT token
function createToken(user: {
  id: string;
  name: string;
  email: string;
}): string {
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setCookieAndRedirect(res: any, token: string, redirectTo: string) {
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: true,
    sameSite: isDev ? "lax" : "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.redirect(redirectTo);
}

// ─── Google SSO ──────────────────────────────────────────────────────────────

// GET /api/auth/google — start Google OAuth2 PKCE-less flow (server-side)
router.get("/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      error: "Google SSO not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    });
  }
  const state = randomUUID();
  googleStates.set(state, { redirectTo: "/" });
  setTimeout(() => googleStates.delete(state), 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid profile email",
    access_type: "online",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback — Google redirects here after user consents
router.get("/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = (APP_URL || "http://localhost:5173").replace(/\/api$/, "");

  if (error || !code || !state) {
    return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error ?? "cancelled")}`);
  }

  const pending = googleStates.get(state);
  if (!pending) {
    return res.redirect(`${frontendUrl}/login?error=expired`);
  }
  googleStates.delete(state);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenRes.ok) {
      const e = await tokenRes.text();
      req.log.error({ e }, "Google token exchange failed");
      return res.redirect(`${frontendUrl}/login?error=auth_failed`);
    }

    const { id_token } = await tokenRes.json() as { id_token: string };

    // Decode the id_token (we trust Google's issuer; no need to verify sig here
    // since we received it directly from google.com over TLS)
    const payload = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString()) as {
      sub: string; name: string; email: string; picture?: string;
    };

    const token = createToken({ id: payload.sub, name: payload.name, email: payload.email });

    req.log.info({ userId: payload.sub }, "User authenticated via Google SSO");
    setCookieAndRedirect(res, token, frontendUrl + pending.redirectTo);
  } catch (err) {
    req.log.error({ err }, "Google SSO callback failed");
    res.redirect(`${frontendUrl}/login?error=server_error`);
  }
});

// ─── Microsoft Device Code (kept for fallback) ───────────────────────────────
  try {
    const deviceFlow = await initiateDeviceCodeFlow();
    req.log.info(
      { userCode: deviceFlow.user_code },
      "Device code flow initiated",
    );

    return res.json({
      device_code: deviceFlow.device_code,
      user_code: deviceFlow.user_code,
      verification_uri: deviceFlow.verification_uri,
      expires_in: deviceFlow.expires_in,
      interval: deviceFlow.interval,
      message: `Visit ${deviceFlow.verification_uri} and enter code ${deviceFlow.user_code}`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to initiate device code flow");
    return res.status(500).json({
      error: "Failed to start login",
      detail: String(err),
    });
  }
});

/**
 * Poll for device code token
 * Frontend calls this with device_code to check if user has authenticated
 */
router.post("/auth/device-code-status", async (req, res) => {
  const { device_code } = req.body as Record<string, unknown>;

  if (!device_code || typeof device_code !== "string") {
    return res.status(400).json({ error: "device_code required" });
  }

  try {
    const tokens = await pollForDeviceCodeToken(device_code);

    // tokens is null if still waiting for user auth
    if (!tokens) {
      return res.json({ status: "pending" });
    }

    // User authenticated! Get their info and create JWT
    const msUser = await getMicrosoftUser(tokens.access_token);

    const token = createToken({
      id: msUser.id,
      name: msUser.displayName,
      email: msUser.mail || msUser.userPrincipalName,
    });

    // Set secure HTTP-only cookie with JWT
    // cross-site (SWA -> Container App) requires SameSite=None + Secure
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: isDev ? "lax" : "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    req.log.info({ userId: msUser.id }, "User authenticated via device code");
    return res.json({ status: "success", token });
  } catch (err: unknown) {
    req.log.error({ err, device_code }, "Device code poll failed");
    // expired_token / invalid_grant → device code has expired
    if (err instanceof Error && (err as Error & { code?: string }).code === "expired_token") {
      return res.status(410).json({ status: "expired", error: "Device code expired. Please try again." });
    }
    return res.status(500).json({
      status: "error",
      detail: String(err),
    });
  }
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: true,
    sameSite: isDev ? "lax" : "none",
  });
  res.json({ ok: true });
});

router.get("/auth/me", (req, res) => {
  const user = (req as Record<string, unknown>).user as
    | Record<string, string>
    | undefined;
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({
    id: user.sub,
    name: user.name,
    email: user.email,
  });
});

export default router;
