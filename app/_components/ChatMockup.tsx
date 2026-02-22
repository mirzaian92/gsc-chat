"use client";

import React, { useEffect, useState } from "react";

const messages = [
  { role: "user" as const, text: "What are my top-performing pages this month?" },
  {
    role: "assistant" as const,
    text: "Your top 3 pages by clicks this month:\n\n1. `/blog/seo-guide` — 2,847 clicks (+34%)\n2. `/tools/keyword-research` — 1,923 clicks (+12%)\n3. `/pricing` — 1,456 clicks (+8%)\n\nNotably, your SEO guide saw a significant CTR improvement from 3.2% → 4.7% after the title tag update on Feb 3rd.",
  },
  { role: "user" as const, text: "Any quick wins I should focus on?" },
  {
    role: "assistant" as const,
    text: "I found 4 quick wins based on your data:\n\n• **12 pages** ranking positions 4-10 with high impressions — small content updates could push them to top 3\n• Your `/features` page has a 1.2% CTR despite 8.4K impressions — rewrite the meta description\n• 3 new queries are trending for your brand — consider dedicated landing pages",
  },
];

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M16.25 16.25 21 21"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ChatMockup() {
  const [visibleMessages, setVisibleMessages] = useState(0);

  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    messages.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleMessages(i + 1), 600 + i * 900));
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <div className="glass overflow-hidden rounded-2xl shadow-2xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
        </div>
        <span className="ml-2 font-mono text-xs text-white/50">consolemind.ai</span>
      </div>

      <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
        {messages.slice(0, visibleMessages).map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={[
                "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed",
                msg.role === "user"
                  ? "border border-emerald-400/20 bg-emerald-400/10 text-white"
                  : "bg-white/5 text-white/85",
              ].join(" ")}
              style={{ animation: "fade-in-up 0.4s ease-out forwards" }}
            >
              {msg.text.split("\n").map((line, j) => (
                <span key={j}>
                  {line.split(/(\*\*.*?\*\*)/).map((part, k) =>
                    part.startsWith("**") && part.endsWith("**") ? (
                      <strong key={k} className="font-semibold text-emerald-300">
                        {part.slice(2, -2)}
                      </strong>
                    ) : (
                      part
                    ),
                  )}
                  {j < msg.text.split("\n").length - 1 && <br />}
                </span>
              ))}
            </div>
          </div>
        ))}

        {visibleMessages >= messages.length && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-white/45">
              <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" />
              <span
                className="h-1 w-1 animate-pulse rounded-full bg-emerald-400"
                style={{ animationDelay: "0.2s" }}
              />
              <span
                className="h-1 w-1 animate-pulse rounded-full bg-emerald-400"
                style={{ animationDelay: "0.4s" }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <SearchIcon className="h-4 w-4 text-white/45" />
          <span className="text-sm text-white/45">Ask about your search data...</span>
          <span className="animate-blink ml-0.5 text-emerald-400">|</span>
        </div>
      </div>
    </div>
  );
}

