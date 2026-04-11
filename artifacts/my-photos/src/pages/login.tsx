import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [isLoadingMs, setIsLoadingMs] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Poll for device code status
  useEffect(() => {
    if (!deviceCode) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/auth/device-code-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: deviceCode }),
          credentials: "include",
        });

        const data = await response.json() as { status?: string; error?: string };

        if (response.ok && data.status === "success") {
          // User authenticated successfully
          clearInterval(interval);
          setDeviceCode(null);
          navigate("/");
        } else if (response.status === 410) {
          // Device code expired
          clearInterval(interval);
          setPollError("Device code expired. Please try again.");
          setDeviceCode(null);
          setUserCode(null);
          setVerificationUri(null);
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [deviceCode, navigate]);

  const handleMicrosoftLogin = async () => {
    setIsLoadingMs(true);
    setPollError(null);
    try {
      const response = await fetch("/api/auth/login", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to start login");
      }

      const data = await response.json() as {
        device_code: string;
        user_code: string;
        verification_uri: string;
      };

      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
    } catch (err) {
      setPollError(`Login failed: ${String(err)}`);
      console.error("Microsoft login error:", err);
    } finally {
      setIsLoadingMs(false);
    }
  };



  // Show device code flow UI if waiting for authentication
  if (deviceCode && userCode && verificationUri) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm px-6">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
              <svg
                className="w-8 h-8 text-primary animate-spin"
                viewBox="0 0 24 24"
              >
                <path
                  fill="#0078D4"
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
                  opacity=".3"
                />
                <path
                  fill="#0078D4"
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-semibold text-foreground tracking-tight">
              Sign in with Microsoft
            </h1>
            <p className="mt-4 text-muted-foreground text-sm">
              Follow these steps to sign in:
            </p>
          </div>

          <div className="space-y-6 mb-8">
            <div className="bg-muted p-6 rounded-lg border border-border">
              <div className="text-sm font-medium text-foreground mb-2">
                Step 1: Copy your code
              </div>
              <div className="bg-background p-4 rounded text-center font-mono text-2xl font-bold text-primary tracking-widest border-2 border-primary/30">
                {userCode}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(userCode || "");
                }}
                className="w-full mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Copy code
              </button>
            </div>

            <div className="bg-muted p-6 rounded-lg border border-border">
              <div className="text-sm font-medium text-foreground mb-2">
                Step 2: Go to this URL
              </div>
              <a
                href={verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-center font-medium transition-colors"
              >
                Open Microsoft Login →
              </a>
              <p className="text-xs text-muted-foreground mt-2">
                Opens in a new window
              </p>
            </div>

            <div className="text-center text-sm text-muted-foreground">
              Waiting for your sign in...
            </div>
          </div>

          <button
            onClick={() => {
              setDeviceCode(null);
              setUserCode(null);
              setVerificationUri(null);
              setPollError(null);
            }}
            className="w-full px-4 py-2 text-sm font-medium text-foreground hover:bg-muted rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-primary fill-current">
              <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zm-9 9h7v7H4v-7zm9 0h7v7h-7v-7z" opacity=".3"/>
              <path d="M4 2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4zm0 2h7v7H4V4zm9-2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-7zm0 2h7v7h-7V4zM4 13a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H4zm0 2h7v5H4v-5zm9-2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-7zm0 2h7v5h-7v-5z"/>
            </svg>
          </div>
          <h1 className="text-3xl font-semibold text-foreground tracking-tight">My Photos</h1>
          <p className="mt-2 text-muted-foreground text-sm">Your personal photo library, backed by Azure</p>
        </div>

        {pollError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
            {pollError}
          </div>
        )}

        <button
          onClick={handleMicrosoftLogin}
          disabled={isLoadingMs}
          data-testid="button-microsoft-login"
          className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-[#0078D4] hover:bg-[#106EBE] active:bg-[#005A9E] disabled:opacity-50 text-white font-medium rounded-lg transition-colors duration-150 shadow-sm"
        >
          <svg viewBox="0 0 23 23" className="w-5 h-5" fill="none">
            <path fill="#f35325" d="M1 1h10v10H1z"/>
            <path fill="#81bc06" d="M12 1h10v10H12z"/>
            <path fill="#05a6f0" d="M1 12h10v10H1z"/>
            <path fill="#ffba08" d="M12 12h10v10H12z"/>
          </svg>
          {isLoadingMs ? "Starting sign in..." : "Sign in with Microsoft"}
        </button>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sign in with your organization account to access your photos
        </p>
      </div>
    </div>
  );
}
