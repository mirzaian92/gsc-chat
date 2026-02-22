"use client";

import React, { useEffect, useMemo, useState } from "react";

type SiteEntry = {
  siteUrl: string;
  permissionLevel: string;
};

type Entitlements = {
  isPro: boolean;
  questionsUsed: number;
  remainingFree: number;
  pendingQuestion: string | null;
  planLabel: "Free" | "Pro";
  subscription?: { status: string; currentPeriodEnd: string | null };
};

type ChatAnswer = {
  type: "answer";
  answer: string;
  entitlements: Entitlements;
};

type ChatPaywall = {
  type: "paywall";
  entitlements: Entitlements;
  paywall: {
    reason: string;
    questionsUsed: number;
    freeLimit: number;
    pendingSaved: boolean;
    checkoutPath: string;
  };
};

type CheckoutResponse = { url: string | null; id: string };
type ChatErr = { error: string };

export default function AppPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [siteUrl, setSiteUrl] = useState<string>("");
  const [loadingSites, setLoadingSites] = useState(false);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [paywall, setPaywall] = useState<ChatPaywall["paywall"] | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [syncingCheckout, setSyncingCheckout] = useState(false);
  const [ranPending, setRanPending] = useState(false);

  const usageBadge = useMemo(() => {
    if (!entitlements) return "—";
    if (entitlements.isPro) return "Pro: Active";
    return `Free: ${entitlements.questionsUsed}/3 used`;
  }, [entitlements]);

  const canAsk = useMemo(() => {
    const msgOk = message.trim().length > 0;
    const siteOk = siteUrl.length > 0;
    const notBusy = !sending;
    const usageOk = entitlements ? entitlements.isPro || entitlements.remainingFree > 0 : true;
    return connected === true && siteOk && msgOk && notBusy && usageOk;
  }, [connected, siteUrl, message, sending, entitlements]);

  async function loadEntitlements() {
    try {
      const res = await fetch("/api/entitlements", { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Entitlements | ChatErr;
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/";
          return;
        }
        if ("error" in json && typeof json.error === "string") throw new Error(json.error);
        throw new Error(`Failed to load entitlements (${res.status}).`);
      }
      setEntitlements(json as Entitlements);
    } catch (e) {
      setEntitlements(null);
      setError(e instanceof Error ? e.message : "Failed to load entitlements.");
    }
  }

  async function loadSites() {
    setLoadingSites(true);
    setError("");
    try {
      const res = await fetch("/api/gsc/sites", { method: "GET", cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/";
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

  async function startCheckout() {
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as CheckoutResponse | ChatErr;
      if (!res.ok) {
        if ("error" in json && typeof json.error === "string") throw new Error(json.error);
        throw new Error(`Checkout failed (${res.status}).`);
      }
      if (!("url" in json) || typeof json.url !== "string" || !json.url) throw new Error("Missing checkout URL.");
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed.");
    }
  }

  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

  async function syncCheckoutIfNeeded() {
    const url = new URL(window.location.href);
    if (url.searchParams.get("checkout") !== "success") return;
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return;

    setSyncingCheckout(true);
    try {
      await fetch("/api/stripe/checkout-success", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } finally {
      setSyncingCheckout(false);
      await loadEntitlements();
    }
  }

  async function askWithMessage(text: string) {
    setSending(true);
    setError("");
    setAnswer("");
    setPaywall(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteUrl, message: text.trim() }),
      });

      const raw = await res.text().catch(() => "");
      const json = (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return undefined;
        }
      })();

      const payload = (json ?? {}) as ChatAnswer | ChatPaywall | ChatErr;
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/";
          return;
        }
        if ("error" in payload && typeof payload.error === "string") throw new Error(payload.error);
        if (raw.trim()) throw new Error(raw.trim().slice(0, 300));
        throw new Error(`Chat failed (${res.status}).`);
      }
      if ("error" in payload) throw new Error(payload.error);

      if (payload.type === "paywall") {
        setPaywall(payload.paywall);
        setEntitlements(payload.entitlements);
        return;
      }

      setAnswer(payload.answer ?? "");
      setEntitlements(payload.entitlements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
    } finally {
      setSending(false);
    }
  }

  async function ask() {
    await askWithMessage(message);
  }

  useEffect(() => {
    void loadEntitlements();
    void loadSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void syncCheckoutIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ranPending) return;
    if (!entitlements?.isPro) return;
    if (!entitlements.pendingQuestion) return;
    if (!siteUrl) return;
    setRanPending(true);
    const pending = entitlements.pendingQuestion;
    setMessage(pending);
    void askWithMessage(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranPending, entitlements?.isPro, entitlements?.pendingQuestion, siteUrl]);

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
      <div style={{ marginBottom: 12 }}>
        <a href="/" style={{ color: "#444", textDecoration: "none" }}>
          ← Home
        </a>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: "8px 0 16px" }}>GSC Chat</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #e5e5e5",
              background: "#fff",
              color: "#111",
            }}
          >
            {usageBadge}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            style={{
              fontSize: 12,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #e5e5e5",
              background: "#fff",
              color: "#111",
              cursor: "pointer",
            }}
          >
            Log out
          </button>
          {!entitlements?.isPro && (
            <button
              type="button"
              onClick={() => void startCheckout()}
              style={{
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Upgrade ($9/mo)
            </button>
          )}
        </div>
      </div>

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
          Continue with Google
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
      {syncingCheckout && <div style={{ marginBottom: 12, color: "#444" }}>Syncing subscription…</div>}

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
            width: 180,
            padding: "10px 14px",
            border: "1px solid #ddd",
            borderRadius: 6,
            background: canAsk ? "#111" : "#f3f3f3",
            color: canAsk ? "#fff" : "#888",
            cursor: canAsk ? "pointer" : "not-allowed",
          }}
        >
          {sending ? "Asking..." : entitlements?.isPro ? "Ask" : `Ask (${entitlements?.remainingFree ?? 3} free left)`}
        </button>
      </div>

      <h2 style={{ margin: "16px 0 8px", fontSize: 16 }}>Answer</h2>
      {paywall ? (
        <div
          style={{
            margin: 0,
            padding: 14,
            border: "1px solid #ddd",
            borderRadius: 8,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Upgrade to keep chatting</div>
          <div style={{ color: "#444", fontSize: 13, lineHeight: 1.45 }}>
            You&apos;ve used {paywall.questionsUsed}/{paywall.freeLimit} free questions. We saved your last question and
            will run it automatically after upgrade.
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void startCheckout()}
              style={{
                padding: "10px 14px",
                border: "1px solid #111",
                borderRadius: 8,
                background: "#111",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Upgrade ($9/mo)
            </button>
            <a href="/api/auth/google" style={{ alignSelf: "center", color: "#444", textDecoration: "none" }}>
              Switch Google account
            </a>
          </div>
        </div>
      ) : (
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
      )}
    </main>
  );
}
