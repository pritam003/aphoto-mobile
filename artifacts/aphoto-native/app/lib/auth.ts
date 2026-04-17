import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";

WebBrowser.maybeCompleteAuthSession();

const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  "";

const MSAL_CLIENT_ID = (Constants.expoConfig?.extra?.msalClientId as string) ?? "";
const MSAL_TENANT_ID = (Constants.expoConfig?.extra?.msalTenantId as string) ?? "";
const GOOGLE_CLIENT_ID = (Constants.expoConfig?.extra?.googleClientId as string) ?? "";

const TOKEN_KEY = "aphoto_jwt";

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Exchange code at server
// ---------------------------------------------------------------------------

async function exchangeCodeAtServer(
  provider: "google" | "microsoft",
  code: string,
  redirectUri: string,
  codeVerifier?: string
): Promise<{ token: string; user: { id: string; name: string; email: string } }> {
  const res = await fetch(`${API_URL}/api/auth/mobile/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, code, redirectUri, codeVerifier }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Exchange failed (${res.status})`);
  }
  return res.json() as Promise<{ token: string; user: { id: string; name: string; email: string } }>;
}

// ---------------------------------------------------------------------------
// Microsoft login (PKCE via expo-auth-session)
// ---------------------------------------------------------------------------

export async function loginWithMicrosoft(): Promise<{
  token: string;
  user: { id: string; name: string; email: string };
}> {
  if (!MSAL_CLIENT_ID || !MSAL_TENANT_ID) {
    throw new Error("Microsoft login not configured. Set EXPO_PUBLIC_MSAL_CLIENT_ID and EXPO_PUBLIC_MSAL_TENANT_ID.");
  }

  const redirectUri = AuthSession.makeRedirectUri({ scheme: "aphoto", path: "auth" });
  const discovery = await AuthSession.fetchDiscoveryAsync(
    `https://login.microsoftonline.com/${MSAL_TENANT_ID}/v2.0`
  );

  const request = new AuthSession.AuthRequest({
    clientId: MSAL_CLIENT_ID,
    scopes: ["openid", "profile", "email", "User.Read"],
    redirectUri,
    usePKCE: true,
    extraParams: { prompt: "select_account" },
  });

  const result = await request.promptAsync(discovery);

  if (result.type !== "success" || !result.params.code) {
    throw new Error(result.type === "cancel" ? "Login cancelled" : "Login failed");
  }

  return exchangeCodeAtServer(
    "microsoft",
    result.params.code,
    redirectUri,
    request.codeVerifier
  );
}

// ---------------------------------------------------------------------------
// Google login (PKCE via expo-auth-session)
// ---------------------------------------------------------------------------

export async function loginWithGoogle(): Promise<{
  token: string;
  user: { id: string; name: string; email: string };
}> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google login not configured. Set EXPO_PUBLIC_GOOGLE_CLIENT_ID.");
  }

  const redirectUri = AuthSession.makeRedirectUri({ scheme: "aphoto", path: "auth" });
  const discovery = await AuthSession.fetchDiscoveryAsync(
    "https://accounts.google.com"
  );

  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: ["openid", "profile", "email"],
    redirectUri,
    usePKCE: true,
    extraParams: { access_type: "online", prompt: "select_account" },
  });

  const result = await request.promptAsync(discovery);

  if (result.type !== "success" || !result.params.code) {
    throw new Error(result.type === "cancel" ? "Login cancelled" : "Login failed");
  }

  return exchangeCodeAtServer(
    "google",
    result.params.code,
    redirectUri,
    request.codeVerifier
  );
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logout(token: string | null): Promise<void> {
  if (token) {
    // Best-effort server logout
    fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  await clearToken();
}
