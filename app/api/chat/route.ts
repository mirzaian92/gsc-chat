import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { INTENTS, type Intent } from "@/lib/intents";
import { requireEnv, getSession } from "@/lib/session";
import { rangePreset } from "@/lib/gsc";

export const runtime = "nodejs";

const BodySchema = z.object({
  siteUrl: z.string().min(1),
  message: z.string().min(1).max(4000),
});

const ToolArgsSchema = z.object({
  intent: z.enum(INTENTS),
  preset: z.enum(["last7", "last28", "last90"]).optional(),
  rowLimit: z.number().int().min(1).max(1000).optional(),
  brandTerms: z.array(z.string().min(1)).min(1).optional(),
  pageUrl: z.string().min(1).optional(),
});

type ToolArgs = z.infer<typeof ToolArgsSchema>;

type GscRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function truncateJsonForModel(json: string, maxChars: number): string {
  if (json.length <= maxChars) return json;
  return json.slice(0, maxChars) + "\n...(truncated)";
}

function userAskedForMoreRows(message: string): boolean {
  const nums = message.match(/\d+/g)?.map((n) => Number(n)).filter(Number.isFinite) ?? [];
  if (nums.some((n) => n >= 251)) return true;
  return /\b(row\s*limit|rows|top\s+\d+|show\s+\d+|more\s+results|more\s+rows)\b/i.test(message);
}

function clampRowLimit(message: string, rowLimit?: number): number {
  const value = rowLimit ?? 250;
  const allow = userAskedForMoreRows(message);
  const capped = allow ? Math.min(value, 1000) : Math.min(value, 250);
  return Math.max(1, capped);
}

function extractFirstUrl(message: string): string | undefined {
  const m = message.match(/\bhttps?:\/\/[^\s<>()"]+/i);
  return m?.[0];
}

function toRow(raw: unknown): GscRow | undefined {
  const obj = raw as {
    keys?: unknown;
    clicks?: unknown;
    impressions?: unknown;
    ctr?: unknown;
    position?: unknown;
  };

  const keys = Array.isArray(obj.keys) ? obj.keys.filter((k): k is string => typeof k === "string") : [];
  if (keys.length === 0) return undefined;

  return {
    keys,
    clicks: typeof obj.clicks === "number" ? obj.clicks : 0,
    impressions: typeof obj.impressions === "number" ? obj.impressions : 0,
    ctr: typeof obj.ctr === "number" ? obj.ctr : 0,
    position: typeof obj.position === "number" ? obj.position : 0,
  };
}

function parseYmdToUtcDate(ymd: string): Date {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatYmdUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function computePreviousRange(current: { startDate: string; endDate: string }): { startDate: string; endDate: string } {
  const start = parseYmdToUtcDate(current.startDate);
  const end = parseYmdToUtcDate(current.endDate);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const prevEnd = addUtcDays(start, -1);
  const prevStart = addUtcDays(prevEnd, -(days - 1));

  return { startDate: formatYmdUtc(prevStart), endDate: formatYmdUtc(prevEnd) };
}

async function callInternalGscQuery(req: NextRequest, payload: unknown) {
  const url = new URL("/api/gsc/query", req.url);
  const cookie = req.headers.get("cookie");

  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
  });

  const json: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMessage =
      typeof (json as { error?: unknown } | null | undefined)?.error === "string"
        ? String((json as { error: string }).error)
        : `GSC query failed (${res.status}).`;
    const err = new Error(errorMessage);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return json as { rows?: unknown[] };
}

async function runIntent(req: NextRequest, input: { siteUrl: string; message: string; args: ToolArgs }) {
  const preset = input.args.preset ?? "last28";
  const rowLimit = clampRowLimit(input.message, input.args.rowLimit);

  const pageUrlFromUser = input.args.pageUrl ?? extractFirstUrl(input.message);
  const args: ToolArgs = (() => {
    if (pageUrlFromUser && input.args.intent !== "DRILLDOWN_PAGE_TO_QUERIES") {
      return { ...input.args, intent: "DRILLDOWN_PAGE_TO_QUERIES", pageUrl: pageUrlFromUser };
    }
    if (input.args.intent === "DRILLDOWN_PAGE_TO_QUERIES" && !input.args.pageUrl && pageUrlFromUser) {
      return { ...input.args, pageUrl: pageUrlFromUser };
    }
    return input.args;
  })();

  const current = rangePreset(preset);
  const previous = computePreviousRange(current);

  const meta = {
    intent: args.intent,
    preset,
    rowLimit,
    range: { current, previous },
  } as const;

  const queryRows = async (payload: Record<string, unknown>) => {
    const data = await callInternalGscQuery(req, payload);
    return (data.rows ?? []).map(toRow).filter((r): r is GscRow => Boolean(r));
  };

  const queryTotals = async (payload: Record<string, unknown>) => {
    const data = await callInternalGscQuery(req, { ...payload, rowLimit: 1, startRow: 0 });
    const r: unknown = data.rows?.[0];
    const row = (r ?? {}) as {
      clicks?: unknown;
      impressions?: unknown;
      ctr?: unknown;
      position?: unknown;
    };
    return {
      clicks: typeof row.clicks === "number" ? row.clicks : 0,
      impressions: typeof row.impressions === "number" ? row.impressions : 0,
      ctr: typeof row.ctr === "number" ? row.ctr : 0,
      position: typeof row.position === "number" ? row.position : 0,
    };
  };

  const mergeDeltas = (currRows: GscRow[], prevRows: GscRow[], keyName: "query" | "page") => {
    const curr = new Map(currRows.map((r) => [r.keys[0] ?? "", r]));
    const prv = new Map(prevRows.map((r) => [r.keys[0] ?? "", r]));
    const keys = new Set<string>([...curr.keys(), ...prv.keys()].filter(Boolean));

    const merged = [...keys].map((k) => {
      const c = curr.get(k);
      const p = prv.get(k);
      const clicksCurrent = c?.clicks ?? 0;
      const clicksPrevious = p?.clicks ?? 0;
      const impressionsCurrent = c?.impressions ?? 0;
      const impressionsPrevious = p?.impressions ?? 0;
      const ctrCurrent = c?.ctr ?? 0;
      const ctrPrevious = p?.ctr ?? 0;
      const positionCurrent = c?.position ?? 0;
      const positionPrevious = p?.position ?? 0;

      return {
        [keyName]: k,
        clicksCurrent,
        clicksPrevious,
        deltaClicks: clicksCurrent - clicksPrevious,
        impressionsCurrent,
        impressionsPrevious,
        deltaImpressions: impressionsCurrent - impressionsPrevious,
        ctrCurrent,
        ctrPrevious,
        deltaCtr: ctrCurrent - ctrPrevious,
        positionCurrent,
        positionPrevious,
        deltaPosition: positionPrevious - positionCurrent,
      } as const;
    });

    return merged;
  };

  const siteUrl = input.siteUrl;

  if (args.intent === "TOP_WINNERS_QUERIES" || args.intent === "TOP_LOSERS_QUERIES") {
    const [currRows, prevRows] = await Promise.all([
      queryRows({ siteUrl, ...current, dimensions: ["query"], rowLimit, startRow: 0 }),
      queryRows({ siteUrl, ...previous, dimensions: ["query"], rowLimit, startRow: 0 }),
    ]);

    const merged = mergeDeltas(currRows, prevRows, "query");
    merged.sort((a, b) =>
      args.intent === "TOP_LOSERS_QUERIES"
        ? a.deltaClicks - b.deltaClicks || String(a.query).localeCompare(String(b.query))
        : b.deltaClicks - a.deltaClicks || String(a.query).localeCompare(String(b.query)),
    );

    return { ...meta, data: merged.slice(0, rowLimit) };
  }

  if (args.intent === "TOP_WINNERS_PAGES" || args.intent === "TOP_LOSERS_PAGES") {
    const [currRows, prevRows] = await Promise.all([
      queryRows({ siteUrl, ...current, dimensions: ["page"], rowLimit, startRow: 0 }),
      queryRows({ siteUrl, ...previous, dimensions: ["page"], rowLimit, startRow: 0 }),
    ]);

    const merged = mergeDeltas(currRows, prevRows, "page");
    merged.sort((a, b) =>
      args.intent === "TOP_LOSERS_PAGES"
        ? a.deltaClicks - b.deltaClicks || String(a.page).localeCompare(String(b.page))
        : b.deltaClicks - a.deltaClicks || String(a.page).localeCompare(String(b.page)),
    );

    return { ...meta, data: merged.slice(0, rowLimit) };
  }

  if (args.intent === "HIGH_IMPRESS_LOW_CTR_PAGES") {
    const rows = await queryRows({ siteUrl, ...current, dimensions: ["page"], rowLimit, startRow: 0 });
    const out = rows
      .map((r) => ({
        page: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
        score: r.impressions * (1 - r.ctr),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.impressions - a.impressions ||
          a.ctr - b.ctr ||
          String(a.page).localeCompare(String(b.page)),
      );

    return { ...meta, data: out.slice(0, rowLimit) };
  }

  if (args.intent === "POSITION_UP_CLICKS_DOWN_QUERIES") {
    const [currRows, prevRows] = await Promise.all([
      queryRows({ siteUrl, ...current, dimensions: ["query"], rowLimit, startRow: 0 }),
      queryRows({ siteUrl, ...previous, dimensions: ["query"], rowLimit, startRow: 0 }),
    ]);

    const merged = mergeDeltas(currRows, prevRows, "query").filter(
      (r) => r.deltaClicks < 0 && r.deltaPosition > 0,
    );

    merged.sort(
      (a, b) =>
        a.deltaClicks - b.deltaClicks ||
        b.deltaPosition - a.deltaPosition ||
        String(a.query).localeCompare(String(b.query)),
    );

    return { ...meta, data: merged.slice(0, rowLimit) };
  }

  if (args.intent === "CTR_OPPORTUNITIES_QUERIES") {
    const rows = await queryRows({ siteUrl, ...current, dimensions: ["query"], rowLimit, startRow: 0 });
    const out = rows
      .map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      }))
      .filter((r) => r.impressions >= 100 && r.position > 0 && r.position <= 10 && r.ctr <= 0.03)
      .sort(
        (a, b) =>
          b.impressions - a.impressions ||
          a.ctr - b.ctr ||
          a.position - b.position ||
          String(a.query).localeCompare(String(b.query)),
      );

    return { ...meta, data: out.slice(0, rowLimit) };
  }

  if (args.intent === "BRAND_VS_NONBRAND") {
    const brandTerms = (args.brandTerms ?? []).map((t) => t.trim()).filter(Boolean);
    if (brandTerms.length === 0) {
      throw new Error("BRAND_VS_NONBRAND requires brandTerms (string[]).");
    }

    const brandFilters = [
      {
        groupType: "or",
        filters: brandTerms.map((term) => ({
          dimension: "query",
          operator: "contains",
          expression: term,
        })),
      },
    ];

    const nonBrandFilters = [
      {
        groupType: "and",
        filters: brandTerms.map((term) => ({
          dimension: "query",
          operator: "notContains",
          expression: term,
        })),
      },
    ];

    const [brandTotals, nonBrandTotals, brandTop, nonBrandTop] = await Promise.all([
      queryTotals({ siteUrl, ...current, dimensionFilterGroups: brandFilters }),
      queryTotals({ siteUrl, ...current, dimensionFilterGroups: nonBrandFilters }),
      queryRows({
        siteUrl,
        ...current,
        dimensions: ["query"],
        rowLimit: Math.min(rowLimit, 250),
        startRow: 0,
        dimensionFilterGroups: brandFilters,
      }),
      queryRows({
        siteUrl,
        ...current,
        dimensions: ["query"],
        rowLimit: Math.min(rowLimit, 250),
        startRow: 0,
        dimensionFilterGroups: nonBrandFilters,
      }),
    ]);

    return {
      ...meta,
      data: {
        brandTerms,
        brand: {
          totals: brandTotals,
          topQueries: brandTop.map((r) => ({
            query: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
        },
        nonBrand: {
          totals: nonBrandTotals,
          topQueries: nonBrandTop.map((r) => ({
            query: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
        },
      },
    };
  }

  if (args.intent === "CANNIBALIZATION_QUERIES") {
    const rows = await queryRows({ siteUrl, ...current, dimensions: ["query", "page"], rowLimit, startRow: 0 });

    const byQuery = new Map<
      string,
      Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>
    >();

    for (const r of rows) {
      const query = r.keys[0] ?? "";
      const page = r.keys[1] ?? "";
      if (!query || !page) continue;
      const list = byQuery.get(query) ?? [];
      list.push({ page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
      byQuery.set(query, list);
    }

    const out = [...byQuery.entries()]
      .map(([query, pages]) => {
        const sorted = [...pages].sort(
          (a, b) =>
            b.clicks - a.clicks ||
            b.impressions - a.impressions ||
            String(a.page).localeCompare(String(b.page)),
        );
        const totalClicks = sorted.reduce((s, x) => s + x.clicks, 0);
        const totalImpressions = sorted.reduce((s, x) => s + x.impressions, 0);
        const concentration = totalClicks > 0 ? (sorted[0]?.clicks ?? 0) / totalClicks : 1;
        return {
          query,
          pageCount: sorted.length,
          totalClicks,
          totalImpressions,
          concentration,
          topPages: sorted.slice(0, 5),
        };
      })
      .filter((x) => x.pageCount >= 2 && x.totalClicks > 0 && x.concentration < 0.8)
      .sort(
        (a, b) =>
          b.totalClicks - a.totalClicks ||
          a.concentration - b.concentration ||
          String(a.query).localeCompare(String(b.query)),
      );

    return { ...meta, data: out.slice(0, rowLimit) };
  }

  if (args.intent === "DRILLDOWN_PAGE_TO_QUERIES") {
    const pageUrl = (args.pageUrl ?? "").trim();
    if (!pageUrl) throw new Error("DRILLDOWN_PAGE_TO_QUERIES requires pageUrl.");

    const filters = [
      {
        groupType: "and",
        filters: [{ dimension: "page", operator: "equals", expression: pageUrl }],
      },
    ];

    const rows = await queryRows({
      siteUrl,
      ...current,
      dimensions: ["query"],
      rowLimit,
      startRow: 0,
      dimensionFilterGroups: filters,
    });

    const out = rows
      .map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      }))
      .sort(
        (a, b) =>
          b.clicks - a.clicks ||
          b.impressions - a.impressions ||
          String(a.query).localeCompare(String(b.query)),
      );

    return { ...meta, data: { pageUrl, queries: out.slice(0, rowLimit) } };
  }

  throw new Error(`Unsupported intent: ${args.intent satisfies never}`);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Not connected to Google Search Console." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request body.", issues: parsedBody.error.issues },
      { status: 400 },
    );
  }

  const { siteUrl, message } = parsedBody.data;
  const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

  const tool = {
    type: "function" as const,
    function: {
      name: "gsc_query",
      description: "Select exactly one intent and parameters to query Google Search Console.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: { type: "string", enum: [...INTENTS] },
          preset: { type: "string", enum: ["last7", "last28", "last90"], default: "last28" },
          rowLimit: { type: "integer", minimum: 1, maximum: 1000, default: 250 },
          brandTerms: { type: "array", items: { type: "string" } },
          pageUrl: { type: "string" },
        },
        required: ["intent"],
      },
    },
  };

  const system = [
    "You are a Google Search Console analyst.",
    "You MUST call the tool `gsc_query` exactly once.",
    "Default preset is last28.",
    "Keep rowLimit <= 250 unless the user explicitly asks for more.",
    "If the user asks about a specific page URL, use DRILLDOWN_PAGE_TO_QUERIES and set pageUrl.",
    "Do not ask follow-up questions; choose the best intent based on the user request.",
  ].join("\n");

  const first = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    temperature: 0,
    tools: [tool],
    tool_choice: { type: "function", function: { name: "gsc_query" } },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `siteUrl: ${siteUrl}\n\nUser message:\n${message}` },
    ],
  });

  const assistantMsg = first.choices[0]?.message;
  const toolCalls = assistantMsg?.tool_calls ?? [];
  if (toolCalls.length !== 1) {
    return NextResponse.json({ error: "Model did not produce exactly one gsc_query tool call." }, { status: 500 });
  }

  const toolCall = toolCalls[0];
  if (toolCall.type !== "function" || toolCall.function.name !== "gsc_query") {
    return NextResponse.json({ error: "Model did not call the gsc_query tool." }, { status: 500 });
  }

  const rawArgs = safeJsonParse(toolCall.function.arguments);
  const parsedArgs = ToolArgsSchema.safeParse(rawArgs);
  if (!parsedArgs.success) {
    return NextResponse.json(
      { error: "Model produced invalid tool arguments.", issues: parsedArgs.error.issues },
      { status: 500 },
    );
  }

  let toolResult: unknown;
  try {
    toolResult = await runIntent(req, { siteUrl, message, args: parsedArgs.data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const statusRaw = (err as { status?: unknown } | null | undefined)?.status;
    const status = typeof statusRaw === "number" ? statusRaw : undefined;
    if (status === 401 || msg.toLowerCase().includes("not connected")) {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const toolJson = truncateJsonForModel(JSON.stringify(toolResult), 50_000);

  const second = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `siteUrl: ${siteUrl}\n\nUser message:\n${message}` },
      assistantMsg!,
      { role: "tool", tool_call_id: toolCall.id, content: toolJson },
      {
        role: "system",
        content:
          "Write a clear, concise answer. Mention the date range used. Summarize key findings and list top 5 items with relevant metrics. If there is no data, say so and suggest what to check next.",
      },
    ],
  });

  const answer = second.choices[0]?.message?.content?.trim() ?? "";
  const intent = (toolResult as { intent?: Intent })?.intent ?? parsedArgs.data.intent;

  return NextResponse.json({
    answer,
    intent,
    data: toolResult,
  });
}
