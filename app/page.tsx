import Link from "next/link";
import ChatMockup from "@/app/_components/ChatMockup";

type Feature = { title: string; description: string; icon: "chat" | "trend" | "spark" | "report" | "sync" | "shield" };

function Icon({ name }: { name: Feature["icon"] }) {
  const common = "h-5 w-5 text-emerald-300";
  switch (name) {
    case "chat":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path
            d="M8 10.5h8M8 14h5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M20 12c0 4.418-3.582 8-8 8-1.15 0-2.244-.243-3.232-.68L4 20l.85-3.4A7.967 7.967 0 0 1 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "trend":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path
            d="M4 16l6-6 4 4 6-6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 8h6v6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "spark":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path
            d="M12 2l1.3 5.2L18 8.5l-4.7 1.3L12 15l-1.3-5.2L6 8.5l4.7-1.3L12 2Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M5 16l.6 2.2L8 19l-2.4.8L5 22l-.6-2.2L2 19l2.4-.8L5 16Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "report":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path
            d="M6 20V8M12 20V4M18 20v-6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M4 20h16"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case "sync":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path
            d="M21 12a9 9 0 0 1-15.5 6.4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M3 12a9 9 0 0 1 15.5-6.4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M7 19H5v-2M17 5h2v2"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path
            d="M12 3 19 6v6c0 5-3.5 9-7 9s-7-4-7-9V6l7-3Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 12.5 11 14l3.5-4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

const features: Feature[] = [
  {
    title: "Natural Language Queries",
    description: "Ask questions in plain English. No more deciphering complex dashboards or exporting CSVs.",
    icon: "chat",
  },
  {
    title: "Trend Detection",
    description: "Quickly spot rising and declining keywords, pages, and queries before you even ask.",
    icon: "trend",
  },
  {
    title: "Actionable Recommendations",
    description: "Get specific, data-backed suggestions to improve rankings, CTR, and organic traffic.",
    icon: "spark",
  },
  {
    title: "Performance Reports",
    description: "Generate detailed breakdowns in seconds. Compare periods and filter by query or page.",
    icon: "report",
  },
  {
    title: "Real-time Sync",
    description: "Your data stays fresh. Connect once and keep insights current as Search Console updates.",
    icon: "sync",
  },
  {
    title: "Privacy First",
    description: "Read-only access. Your data stays encrypted and we never modify your Search Console settings.",
    icon: "shield",
  },
];

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(16,185,129,0.35), rgba(16,185,129,0.0))",
        }}
      />

      <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-xs font-semibold tracking-wide text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            AI-Powered SEO Intelligence
          </div>

          <h1 className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Talk to your{" "}
            <span className="bg-gradient-to-b from-emerald-200 to-emerald-400 bg-clip-text text-transparent">
              Google Search Console
            </span>{" "}
            like never before
          </h1>

          <p className="mt-6 max-w-xl text-base leading-7 text-white/60">
            Connect your GSC data and chat with an AI that truly understands your search performance. Get insights,
            ideas, and strategies — just by asking.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="/api/auth/google"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-neutral-950 shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_12px_40px_rgba(16,185,129,0.18)] hover:bg-emerald-300"
            >
              Continue with Google <span className="ml-2">→</span>
            </a>
            <Link
              href="#features"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
            >
              See features
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap gap-6 text-xs text-white/45">
            <div className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
              No credit card required
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
              5-second setup
            </div>
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-10 rounded-[32px] opacity-60 blur-2xl"
            style={{
              background:
                "radial-gradient(closest-side, rgba(16,185,129,0.25), rgba(0,0,0,0))",
            }}
          />
          <ChatMockup />
        </div>
      </section>

      <section id="features" className="relative mx-auto max-w-6xl px-6 pb-16 lg:pb-24">
        <div className="text-center">
          <div className="text-xs font-semibold tracking-[0.25em] text-emerald-300/80">FEATURES</div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight">Everything your SEO workflow needs</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-white/55">
            Powered by your real Google Search Console data — not generic advice.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_1px_0_rgba(255,255,255,0.06)]"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 ring-1 ring-emerald-400/20">
                <Icon name={f.icon} />
              </div>
              <div className="text-base font-semibold">{f.title}</div>
              <p className="mt-2 text-sm leading-7 text-white/55">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 pb-16 lg:pb-24">
        <div className="text-center">
          <div className="text-xs font-semibold tracking-[0.25em] text-emerald-300/80">HOW IT WORKS</div>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight">Three steps to SEO clarity</h2>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Connect your GSC",
              desc: "One-click Google OAuth. We request read-only access to your Search Console data.",
              icon: "sync" as const,
            },
            {
              n: "02",
              title: "AI learns your data",
              desc: "Your queries, pages, clicks, impressions, and positions become your SEO context.",
              icon: "spark" as const,
            },
            {
              n: "03",
              title: "Start chatting",
              desc: "Ask anything — from quick stats to deep-dive analysis. Get answers grounded in your actual data.",
              icon: "chat" as const,
            },
          ].map((s) => (
            <div key={s.n} className="text-center">
              <div className="mx-auto inline-flex items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
                <div className="relative">
                  <Icon name={s.icon} />
                  <div className="absolute -right-3 -top-3 rounded-full bg-neutral-950 px-2 py-1 text-[10px] font-semibold text-emerald-200 ring-1 ring-emerald-400/25">
                    {s.n}
                  </div>
                </div>
              </div>
              <div className="mt-6 text-lg font-semibold">{s.title}</div>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-7 text-white/55">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 pb-20 lg:pb-28">
        <div className="glass rounded-3xl px-6 py-14 text-center md:px-12">
          <h2 className="text-4xl font-semibold tracking-tight">
            Ready to unlock your <span className="text-emerald-300">SEO insights</span>?
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-white/55">
            Connect your Google Search Console and start chatting with your real search data in minutes.
          </p>
          <div className="mt-8">
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-emerald-300"
            >
              Get Early Access <span className="ml-2">→</span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
