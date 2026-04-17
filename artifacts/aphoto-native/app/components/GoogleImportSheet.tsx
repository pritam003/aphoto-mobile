import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthContext } from "../context/AuthContext";
import Constants from "expo-constants";

interface Props {
  visible: boolean;
  targetAlbumId?: string;
  albumDisplayName?: string;
  onClose: () => void;
  onDone: (albumId?: string) => void;
}

interface ImportStatus {
  status: "picking" | "importing" | "done" | "error";
  albumName: string;
  albumId?: string;
  total: number;
  imported: number;
  errors: number;
  message?: string;
  pickerUri?: string;
  resumable?: boolean;
}

type Destination = "new" | "current" | "library";

export default function GoogleImportSheet({
  visible,
  targetAlbumId,
  albumDisplayName,
  onClose,
  onDone,
}: Props) {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"setup" | "progress">("setup");
  const [destination, setDestination] = useState<Destination>(
    targetAlbumId ? "current" : "new"
  );
  const [albumName, setAlbumName] = useState("");
  const [starting, setStarting] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiUrl = (Constants.expoConfig?.extra?.apiUrl as string) ?? "";

  // Stop all polling on close
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (statePollRef.current) { clearInterval(statePollRef.current); statePollRef.current = null; }
  }, []);

  useEffect(() => {
    if (!visible) {
      stopPolling();
    }
  }, [visible, stopPolling]);

  // Poll import progress once we have an importId
  useEffect(() => {
    if (!importId || !token) return;
    const poll = async () => {
      const res = await fetch(`${apiUrl}/api/google/import/${importId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as ImportStatus;
      setStatus(data);
      if (data.status === "done") {
        stopPolling();
        queryClient.invalidateQueries();
        setTimeout(() => onDone(data.albumId), 1500);
      } else if (data.status === "error") {
        stopPolling();
      }
    };
    pollRef.current = setInterval(poll, 2000);
    poll();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [importId, token, apiUrl, queryClient, onDone, stopPolling]);

  const handleStart = useCallback(async () => {
    if (!token) return;
    setStarting(true);
    try {
      const body: Record<string, any> = {};
      if (destination === "new") body.albumName = albumName.trim() || "Google Photos Import";
      if (destination === "current" && targetAlbumId) body.targetAlbumId = targetAlbumId;
      if (destination === "library") body.noAlbum = true;

      const authRes = await fetch(`${apiUrl}/api/google/auth-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!authRes.ok) {
        const err = await authRes.json().catch(() => ({})) as { error?: string };
        Alert.alert("Error", err.error ?? "Failed to start import");
        return;
      }

      const { authUrl, state } = await authRes.json() as { authUrl: string; state: string };

      setPhase("progress");
      setStatus({ status: "picking", albumName: body.albumName ?? albumDisplayName ?? "", total: 0, imported: 0, errors: 0 });

      // Open Google OAuth in in-app browser
      WebBrowser.openBrowserAsync(authUrl);

      // Poll for importId by state
      const stateCheck = async () => {
        const res = await fetch(`${apiUrl}/api/google/import-by-state/${state}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json() as { importId?: string; pending?: boolean };
        if (data.importId) {
          clearInterval(statePollRef.current!);
          statePollRef.current = null;
          setImportId(data.importId);
        }
      };
      statePollRef.current = setInterval(stateCheck, 2000);
    } finally {
      setStarting(false);
    }
  }, [token, destination, albumName, targetAlbumId, albumDisplayName, apiUrl]);

  const handleCancel = useCallback(async () => {
    if (importId && token) {
      await fetch(`${apiUrl}/api/google/import/${importId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    stopPolling();
    setPhase("setup");
    setImportId(null);
    setStatus(null);
    onClose();
  }, [importId, token, apiUrl, stopPolling, onClose]);

  const handleResume = useCallback(async () => {
    if (!importId || !token) return;
    await fetch(`${apiUrl}/api/google/import/${importId}/resume`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    // Restart progress polling
    const poll = async () => {
      const res = await fetch(`${apiUrl}/api/google/import/${importId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as ImportStatus;
      setStatus(data);
      if (data.status === "done" || data.status === "error") stopPolling();
    };
    pollRef.current = setInterval(poll, 2000);
    poll();
  }, [importId, token, apiUrl, stopPolling]);

  function handleClose() {
    if (phase === "progress" && status?.status === "importing") {
      Alert.alert("Cancel import?", undefined, [
        { text: "Keep importing", style: "cancel" },
        { text: "Cancel", style: "destructive", onPress: handleCancel },
      ]);
    } else {
      stopPolling();
      setPhase("setup");
      setImportId(null);
      setStatus(null);
      onClose();
    }
  }

  const progressPct =
    status && status.total > 0 ? (status.imported / status.total) * 100 : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-surface rounded-t-2xl p-5 gap-4">
          {/* Handle */}
          <View className="w-10 h-1 bg-border rounded-full self-center" />

          <View className="flex-row items-center justify-between">
            <Text className="text-foreground text-lg font-semibold">
              {phase === "setup" ? "Import from Google Photos" : "Importing…"}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {phase === "setup" ? (
            <>
              {/* Destination options */}
              <View className="gap-2">
                {targetAlbumId && (
                  <TouchableOpacity
                    onPress={() => setDestination("current")}
                    className={`flex-row items-center gap-3 rounded-xl px-4 py-3 border ${destination === "current" ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                  >
                    <Ionicons name="albums-outline" size={18} color={destination === "current" ? "#3b82f6" : "#6b7280"} />
                    <Text className="text-foreground text-sm">
                      Add to "{albumDisplayName ?? "current album"}"
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setDestination("new")}
                  className={`flex-row items-center gap-3 rounded-xl px-4 py-3 border ${destination === "new" ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                >
                  <Ionicons name="add-circle-outline" size={18} color={destination === "new" ? "#3b82f6" : "#6b7280"} />
                  <Text className="text-foreground text-sm">Create new album</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDestination("library")}
                  className={`flex-row items-center gap-3 rounded-xl px-4 py-3 border ${destination === "library" ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                >
                  <Ionicons name="images-outline" size={18} color={destination === "library" ? "#3b82f6" : "#6b7280"} />
                  <Text className="text-foreground text-sm">Add to library only (no album)</Text>
                </TouchableOpacity>
              </View>

              {destination === "new" && (
                <TextInput
                  value={albumName}
                  onChangeText={setAlbumName}
                  placeholder="Album name (optional)"
                  placeholderTextColor="#6b7280"
                  className="bg-background text-foreground rounded-xl px-4 py-3 border border-border"
                />
              )}

              <TouchableOpacity
                onPress={handleStart}
                disabled={starting}
                className="bg-primary rounded-xl py-3 items-center flex-row justify-center gap-2"
              >
                {starting ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={18} color="white" />
                    <Text className="text-white font-semibold">Connect Google Photos</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <View className="gap-4 py-2">
              {/* Status message */}
              {status?.status === "picking" && (
                <View className="items-center gap-2">
                  <ActivityIndicator color="#3b82f6" />
                  <Text className="text-muted text-sm text-center">
                    Waiting for you to select photos in Google…
                  </Text>
                  <Text className="text-muted text-xs text-center">
                    Complete your selection in the Google browser tab, then return here.
                  </Text>
                </View>
              )}

              {(status?.status === "importing") && (
                <>
                  <View className="gap-2">
                    <View className="flex-row justify-between">
                      <Text className="text-foreground text-sm font-medium">
                        {status.imported} / {status.total} imported
                      </Text>
                      {status.errors > 0 && (
                        <Text className="text-destructive text-xs">{status.errors} errors</Text>
                      )}
                    </View>
                    <View className="w-full bg-border rounded-full h-2">
                      <View
                        className="bg-primary rounded-full h-2"
                        style={{ width: `${progressPct}%` }}
                      />
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={handleCancel}
                    className="bg-destructive/10 border border-destructive/30 rounded-xl py-3 items-center"
                  >
                    <Text className="text-destructive text-sm font-medium">Cancel</Text>
                  </TouchableOpacity>
                </>
              )}

              {status?.status === "done" && (
                <View className="items-center gap-2 py-2">
                  <Ionicons name="checkmark-circle" size={44} color="#22c55e" />
                  <Text className="text-foreground font-semibold">Import complete!</Text>
                  <Text className="text-muted text-sm">{status.imported} photos imported.</Text>
                </View>
              )}

              {status?.status === "error" && (
                <View className="gap-3">
                  <View className="items-center gap-2">
                    <Ionicons name="alert-circle" size={36} color="#ef4444" />
                    <Text className="text-foreground font-semibold">Import failed</Text>
                    <Text className="text-muted text-xs text-center">{status.message}</Text>
                  </View>
                  {status.resumable && (
                    <TouchableOpacity
                      onPress={handleResume}
                      className="bg-primary rounded-xl py-3 items-center"
                    >
                      <Text className="text-white font-semibold">Resume</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={handleClose}
                    className="bg-border rounded-xl py-3 items-center"
                  >
                    <Text className="text-foreground text-sm">Close</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
