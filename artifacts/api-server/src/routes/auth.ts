import { Router } from "express";
import jwt from "jsonwebtoken";
import {
  initiateDeviceCodeFlow,
  pollForDeviceCodeToken,
  getMicrosoftUser,
} from "../lib/auth.js";

const router = Router();

// JWT secret - same as app.ts
const JWT_SECRET = process.env.JWT_SECRET || "your-app-id-or-realm-identifier";

const isDev = process.env.NODE_ENV !== "production";

// Helper to create JWT token
function createToken(user: {
  id: string;
  name: string;
  email: string;
  accessToken: string;
}): string {
  return jwt.sign(
    {
      sub: user.id,
      name: user.name,
      email: user.email,
      // Note: don't include accessToken in JWT - it's sensitive
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * Start device code flow
 * Returns device_code, user_code, and verification_uri to user
 */
router.get("/auth/login", async (req, res) => {
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

    const user = {
      id: msUser.id,
      name: msUser.displayName,
      email: msUser.mail || msUser.userPrincipalName,
      accessToken: tokens.access_token,
    };

    const token = createToken(user);

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
  res.clearCookie("auth_token");
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
