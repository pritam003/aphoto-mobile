import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import Constants from "expo-constants";
import { loadToken } from "./auth";

const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  "";

export function initializeApiClient(): void {
  setBaseUrl(API_URL);
  setAuthTokenGetter(loadToken);
}
