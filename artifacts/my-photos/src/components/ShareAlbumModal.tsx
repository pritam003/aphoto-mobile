import { useState, useEffect, useCallback } from "react";
import { X, Link2, Copy, Check, Trash2, Eye, Users, ShieldCheck, KeyRound } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface ShareLink {
  token: string;
  name: string;
  permission: "view" | "contribute";
  createdAt: string;
  url: string;
}

interface Props {
  albumId: string;
  albumName: string;
  onClose: () => void;
}

type ModalStep =
  | { step: "form" }
  | { step: "code"; token: string; url: string; name: string; accessCode: string };

export default function ShareAlbumModal({ albumId, albumName, onClose }: Props) {
  const [permission, setPermission] = useState<"view" | "contribute">("view");
  const [linkName, setLinkName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [loadingRevoke, setLoadingRevoke] = useState<string | null>(null);
  const [modalStep, setModalStep] = useState<ModalStep>({ step: "form" });

  const loadShares = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/albums/${albumId}/shares`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setShares(data.shares ?? []);
      }
    } catch {
      // silently ignore
    }
  }, [albumId]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  const createLink = async () => {
    if (!linkName.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/albums/${albumId}/share`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission, name: linkName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        await loadShares();
        // Show the access code once
        setModalStep({
          step: "code",
          token: created.token,
          url: created.url,
          name: created.name,
          accessCode: created.accessCode,
        });
        setLinkName("");
      }
    } finally {
      setCreating(false);
    }
  };

  const revokeLink = async (token: string) => {
    setLoadingRevoke(token);
    try {
      await fetch(`${API_BASE}/album-shares/${token}`, {
        method: "DELETE",
        credentials: "include",
      });
      setShares(s => s.filter(x => x.token !== token));
    } finally {
      setLoadingRevoke(null);
    }
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToken(key);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  // ── Access code reveal step ────────────────────────────────────────────────
  if (modalStep.step === "code") {
    const { url, name, accessCode } = modalStep;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-green-500" />
              <h2 className="font-semibold text-foreground">Link created</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Your share link <span className="font-medium text-foreground">&ldquo;{name}&rdquo;</span> is ready.
              Share the link AND the access code — recipients need both to view the album.
            </p>

            {/* Link row */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Share link</p>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/60 border border-border">
                <span className="flex-1 text-xs text-foreground truncate font-mono">{url}</span>
                <button
                  onClick={() => copyText(url, "url")}
                  className="p-1.5 rounded-lg hover:bg-background text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Copy link"
                >
                  {copiedToken === "url" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Access code row */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" />
                Access code — save this now, it won&apos;t be shown again
              </p>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/8 border border-primary/30">
                <span className="flex-1 text-lg font-mono font-bold tracking-widest text-primary select-all">{accessCode}</span>
                <button
                  onClick={() => copyText(accessCode, "code")}
                  className="p-1.5 rounded-lg hover:bg-primary/15 text-primary transition-colors shrink-0"
                  title="Copy code"
                >
                  {copiedToken === "code" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                This code is shown only once. Copy it before closing.
              </p>
            </div>

            <button
              onClick={onClose}
              className="mt-1 w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form step ─────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Link2 className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground">Share album</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Album name */}
        <div className="px-5 pt-4 pb-1">
          <p className="text-sm text-muted-foreground">
            Create a shareable link for <span className="font-medium text-foreground">{albumName}</span>
          </p>
        </div>

        {/* Link name input */}
        <div className="px-5 pt-3 pb-1">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Link name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={linkName}
            onChange={e => { setLinkName(e.target.value); setNameError(false); }}
            placeholder="e.g. Trip with Sarah, Family share…"
            className={`w-full px-3 py-2 text-sm rounded-xl border bg-background outline-none transition-colors ${
              nameError ? "border-destructive" : "border-border focus:border-primary"
            }`}
          />
          {nameError && (
            <p className="text-xs text-destructive mt-1">Please give this link a name.</p>
          )}
        </div>

        {/* Permission picker */}
        <div className="px-5 pt-3 pb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setPermission("view")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                permission === "view"
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              View only
            </button>
            <button
              onClick={() => setPermission("contribute")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                permission === "contribute"
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Can contribute
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {permission === "view"
              ? "Recipients can browse and download photos."
              : "Recipients can view and add new photos to this album."}
          </p>
        </div>

        {/* Create button */}
        <div className="px-5 pb-4">
          <button
            onClick={createLink}
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            {creating ? "Creating…" : "Create share link"}
          </button>
        </div>

        {/* Active links */}
        {shares.length > 0 && (
          <div className="border-t border-border px-5 py-4 flex flex-col gap-3 max-h-64 overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active links</p>
            {shares.map(share => (
              <div
                key={share.token}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-muted/50 border border-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {share.permission === "contribute" ? (
                      <Users className="w-3 h-3 text-primary shrink-0" />
                    ) : (
                      <Eye className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-xs font-medium text-foreground truncate">
                      {share.name || share.permission}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{share.url}</p>
                </div>
                <button
                  onClick={() => copyText(share.url, share.token)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Copy link"
                >
                  {copiedToken === share.token ? (
                    <Check className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={() => revokeLink(share.token)}
                  disabled={loadingRevoke === share.token}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0 disabled:opacity-40"
                  title="Revoke link"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
