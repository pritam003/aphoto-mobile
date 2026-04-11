import { logger } from "./logger.js";

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const appUrl = process.env.APP_URL || "";

export const DEFAULT_REDIRECT_URI = `${appUrl}/api/auth/callback`;

/**
 * Device Code Flow - No client secrets needed!
 * User authenticates via browser, no secrets stored.
 * In development without Azure credentials, uses a mock flow.
 */
export async function initiateDeviceCodeFlow(): Promise<{
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}> {
  // Check if Azure credentials are configured
  if (!tenantId || !clientId) {
    throw new Error(
      "Azure credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID) not configured. Device code flow requires Azure Entra ID setup."
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "User.Read openid profile email offline_access",
  });

  const resp = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    const errorMsg = `Azure Device Code Flow failed (${resp.status}): ${errorText}`;
    logger.error({ error: errorMsg, status: resp.status }, "Azure API error");
    throw new Error(`Failed to initiate device code flow: ${errorMsg}`);
  }

  return resp.json() as Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>;
}

export async function pollForDeviceCodeToken(
  deviceCode: string,
): Promise<{
  access_token: string;
  id_token: string;
} | null> {
  if (!clientId || !tenantId) {
    throw new Error("AZURE_CLIENT_ID and AZURE_TENANT_ID must be configured.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  logger.info({ hasClientId: !!clientId }, "Token exchange params");

  const resp = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  const data = await resp.json() as Record<string, unknown>;

  if (resp.status === 400) {
    // Still waiting for user to authenticate
    const error = data.error as string;
    if (
      error === "authorization_pending" ||
      error === "slow_down"
    ) {
      return null;
    }
    throw new Error(`Device code flow error: ${error}`);
  }

  if (!resp.ok) {
    logger.error({ data }, "Token exchange failed");
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  return {
    access_token: data.access_token as string,
    id_token: data.id_token as string,
  };
}

export async function getMicrosoftUser(accessToken: string): Promise<{
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}> {
  const resp = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Failed to get user: ${resp.status}`);
  }
  return resp.json() as Promise<{
    id: string;
    displayName: string;
    mail: string | null;
    userPrincipalName: string;
  }>;
}
