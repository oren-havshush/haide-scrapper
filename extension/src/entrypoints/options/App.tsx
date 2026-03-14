import { useState, useEffect } from "react";
import { getToken, setToken, hasToken } from "../../lib/auth";
import { apiFetch, AuthError } from "../../lib/api";
import type { ApiListResponse } from "../../lib/types";

export default function App() {
  const [tokenValue, setTokenValue] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testMessage, setTestMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    async function checkToken() {
      const configured = await hasToken();
      setIsConfigured(configured);
      if (configured) {
        const token = await getToken();
        if (token) {
          setTokenValue(token);
        }
      }
    }
    checkToken();
  }, []);

  async function handleSave() {
    setSaveMessage(null);
    setTestMessage(null);

    if (!tokenValue.trim()) {
      setSaveMessage({ type: "error", text: "Token cannot be empty" });
      return;
    }

    try {
      await setToken(tokenValue.trim());
      setIsConfigured(true);
      setSaveMessage({ type: "success", text: "Token saved successfully" });
    } catch {
      setSaveMessage({ type: "error", text: "Failed to save token" });
    }
  }

  async function handleTestConnection() {
    setTestMessage(null);
    setIsTesting(true);

    try {
      await apiFetch<ApiListResponse<unknown>>("/api/sites?pageSize=1");
      setTestMessage({ type: "success", text: "Connected successfully" });
    } catch (error) {
      if (error instanceof AuthError) {
        setTestMessage({ type: "error", text: error.message });
      } else if (error instanceof Error) {
        setTestMessage({ type: "error", text: `Connection failed: ${error.message}` });
      } else {
        setTestMessage({ type: "error", text: "Connection failed: Unknown error" });
      }
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="max-w-lg mx-auto p-8">
        <h1 className="text-2xl font-bold mb-2">scrapnew Settings</h1>
        <p className="text-muted-foreground mb-8">
          Configure your API token to connect the extension to your scrapnew backend.
        </p>

        {/* Status indicator */}
        <div className="mb-6 flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${isConfigured ? "bg-success" : "bg-error"}`}
          />
          <span className="text-sm text-muted-foreground">
            {isConfigured ? "Token configured" : "Token not configured"}
          </span>
        </div>

        {/* Token input */}
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-foreground mb-1 block">
              API Bearer Token
            </span>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={tokenValue}
                onChange={(e) => setTokenValue(e.target.value)}
                placeholder="Enter your API token"
                className="w-full px-3 py-2 bg-card border border-border rounded-md text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-warning/50 focus:border-warning pr-20"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-foreground text-background rounded-md text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Save Token
            </button>
            <button
              onClick={handleTestConnection}
              disabled={isTesting || !isConfigured}
              className="px-4 py-2 bg-card border border-border text-foreground rounded-md text-sm font-medium hover:bg-border/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </button>
          </div>

          {/* Save message */}
          {saveMessage && (
            <div
              className={`text-sm px-3 py-2 rounded-md ${
                saveMessage.type === "success"
                  ? "bg-success/10 text-success"
                  : "bg-error/10 text-error"
              }`}
            >
              {saveMessage.text}
            </div>
          )}

          {/* Test message */}
          {testMessage && (
            <div
              className={`text-sm px-3 py-2 rounded-md ${
                testMessage.type === "success"
                  ? "bg-success/10 text-success"
                  : "bg-error/10 text-error"
              }`}
            >
              {testMessage.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
