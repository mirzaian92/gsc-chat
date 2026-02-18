"use client";

import React, { useEffect, useMemo, useState } from "react";

type SiteEntry = {
  siteUrl: string;
  permissionLevel: string;
};

type ChatOk = { answer: string; intent: string; data: unknown };
type ChatErr = { error: string };

export default function Home() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [siteUrl, setSiteUrl] = useState<string>("");
  const [loadingSites, setLoadingSites] = useState(false);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  const canAsk = useMemo(() => {
    return connected === true && siteUrl.length > 0 && message.trim().length > 0 && !sending;
  }, [connected, siteUrl, message, sending]);

  async function loadSites() {
    setLoadingSites(true);
    setError("");
    try {
      const res = await fetch("/api/gsc/sites", { method: "GET", cache: "no-store" });
      if (res.status === 401) {
        setConnected(false);
        setSites([]);
        setSiteUrl("");
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to load sites (${res.status}).`);
      }

      const json = (await res.json()) as unknown;
      const list = Array.isArray(json) ? (json as SiteEntry[]) : [];
      setSites(list);
      setConnected(true);
      if (!siteUrl && list.length > 0) setSiteUrl(list[0]?.siteUrl ?? "");
    } catch (e) {
      setConnected(null);
      setError(e instanceof Error ? e.message : "Failed to load sites.");
    } finally {
      setLoadingSites(false);
    }
  }

  async function ask() {
    setSending(true);
    setError("");
    setAnswer("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteUrl, message: message.trim() }),
      });

      const json = (await res.json().catch(() => ({}))) as ChatOk | ChatErr;
      if (!res.ok) {
        if ("error" in json && typeof json.error === "string") throw new Error(json.error);
        throw new Error(`Chat failed (${res.status}).`);
      }
      if ("error" in json) throw new Error(json.error);
      setAnswer(json.answer ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    void loadSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 16,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
      }}
    >
      <h1 style={{ margin: "8px 0 16px" }}>GSC Chat</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <a
          href="/api/auth/google"
          style={{
            padding: "8px 12px",
            border: "1px solid #ddd",
            borderRadius: 6,
            textDecoration: "none",
            color: "#111",
            background: "#fff",
          }}
        >
          Connect GSC
        </a>

        <button
          type="button"
          onClick={() => void loadSites()}
          disabled={loadingSites}
          style={{
            padding: "8px 12px",
            border: "1px solid #ddd",
            borderRadius: 6,
            background: "#fff",
            cursor: loadingSites ? "not-allowed" : "pointer",
          }}
        >
          {loadingSites ? "Loading..." : "Reload properties"}
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 420px" }}>
          <label htmlFor="site" style={{ minWidth: 70 }}>
            Property
          </label>
          <select
            id="site"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            disabled={connected !== true || sites.length === 0}
            style={{ flex: 1, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6 }}
          >
            {sites.length === 0 ? (
              <option value="">{connected === false ? "Not connected" : "No properties loaded"}</option>
            ) : (
              sites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl} ({s.permissionLevel})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {connected === false && <div style={{ marginBottom: 12, color: "#444" }}>Not connected yet.</div>}

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            border: "1px solid #f2c2c2",
            background: "#fff5f5",
            borderRadius: 6,
          }}
        >
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder='e.g. "What are my top winning queries in the last 28 days?"'
          style={{ width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 6 }}
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={!canAsk}
          style={{
            width: 120,
            padding: "10px 14px",
            border: "1px solid #ddd",
            borderRadius: 6,
            background: canAsk ? "#111" : "#f3f3f3",
            color: canAsk ? "#fff" : "#888",
            cursor: canAsk ? "pointer" : "not-allowed",
          }}
        >
          {sending ? "Asking..." : "Ask"}
        </button>
      </div>

      <h2 style={{ margin: "16px 0 8px", fontSize: 16 }}>Answer</h2>
      <pre
        style={{
          margin: 0,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 6,
          background: "#fafafa",
          minHeight: 120,
          whiteSpace: "pre-wrap",
        }}
      >
        {answer || "—"}
      </pre>
    </main>
  );
}
