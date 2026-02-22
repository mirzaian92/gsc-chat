import "server-only";

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { INTENTS, type Intent } from "@/lib/intents";
import { requireEnv, getSession } from "@/lib/session";
import { rangePreset } from "@/lib/gsc";
import {
  buildV2Answer,
  normalizeGscRow,
  renderV2AnswerMarkdown,
  type GscTotals,
  type Preset,
  type V2IntentResult,
  type V2GscData,
} from "@/lib/answerFramework";
import { getUserEntitlements } from "@/lib/entitlements";
import { clearPendingQuestion, incrementQuestionsUsed, setPendingQuestion } from "@/lib/appDb";
import { getValidatedUserIdForRoute } from "@/lib/auth";

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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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

function normalizeCtr(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return raw > 1 ? raw / 100 : raw;
}

async function runIntent(
  req: NextRequest,
  input: { siteUrl: string; message: string; args: ToolArgs },
  opts?: { rowLimitCap?: number },
): Promise<V2IntentResult> {
  const preset: Preset = input.args.preset ?? "last28";
  const rowLimitRequested = clampRowLimit(input.message, input.args.rowLimit);
  const rowLimit = Math.max(1, Math.min(rowLimitRequested, opts?.rowLimitCap ?? rowLimitRequested));

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

  const queryRows = async (payload: Record<string, unknown>) => {
    const data = await callInternalGscQuery(req, payload);
    return (data.rows ?? []).map(normalizeGscRow).filter((r): r is NonNullable<ReturnType<typeof normalizeGscRow>> =>
      Boolean(r),
    );
  };

  const queryTotals = async (payload: Record<string, unknown>): Promise<GscTotals> => {
    const data = await callInternalGscQuery(req, { ...payload, rowLimit: 1, startRow: 0 });
    const r: unknown = data.rows?.[0];
    const row = (r ?? {}) as { clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown };

    const clicks = typeof row.clicks === "number" ? row.clicks : 0;
    const impressions = typeof row.impressions === "number" ? row.impressions : 0;
    const ctr = typeof row.ctr === "number" ? normalizeCtr(row.ctr) : 0;
    const position = typeof row.position === "number" ? row.position : 0;
    return { clicks, impressions, ctr, position };
  };

  type DeltaMetrics = {
    clicksCurrent: number;
    clicksPrevious: number;
    deltaClicks: number;
    impressionsCurrent: number;
    impressionsPrevious: number;
    deltaImpressions: number;
    ctrCurrent: number;
    ctrPrevious: number;
    deltaCtr: number;
    positionCurrent: number;
    positionPrevious: number;
    deltaPosition: number; // positive means improved
  };

  type QueryDeltaRow = DeltaMetrics & { query: string };
  type PageDeltaRow = DeltaMetrics & { page: string };

  function mergeDeltas(
    currRows: Array<NonNullable<ReturnType<typeof normalizeGscRow>>>,
    prevRows: Array<NonNullable<ReturnType<typeof normalizeGscRow>>>,
    keyName: "query",
  ): QueryDeltaRow[];
  function mergeDeltas(
    currRows: Array<NonNullable<ReturnType<typeof normalizeGscRow>>>,
    prevRows: Array<NonNullable<ReturnType<typeof normalizeGscRow>>>,
    keyName: "page",
  ): PageDeltaRow[];
  function mergeDeltas(
    currRows: Array<NonNullable<ReturnType<typeof normalizeGscRow>>>,
    prevRows: Array<NonNullable<ReturnType<typeof normalizeGscRow>>>,
    keyName: "query" | "page",
  ): Array<QueryDeltaRow | PageDeltaRow> {
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

      const base: DeltaMetrics = {
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
      };

      return keyName === "query" ? ({ query: k, ...base } as const) : ({ page: k, ...base } as const);
    });

    return merged;
  }

  const siteUrl = input.siteUrl;
  const totals = await Promise.all([queryTotals({ siteUrl, ...current }), queryTotals({ siteUrl, ...previous })]);
  const totalsCurrent = totals[0];
  const totalsPrevious = totals[1];

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

    const items = merged.slice(0, rowLimit);
    if (items.length === 0) {
      return {
        intent: args.intent,
        preset,
        rowLimit,
        range: { current, previous },
        totals: { current: totalsCurrent, previous: totalsPrevious },
        kind: "empty",
        items: [],
      };
    }

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: totalsCurrent, previous: totalsPrevious },
      kind: "query_deltas",
      items,
    };
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

    const items = merged.slice(0, rowLimit);
    if (items.length === 0) {
      return {
        intent: args.intent,
        preset,
        rowLimit,
        range: { current, previous },
        totals: { current: totalsCurrent, previous: totalsPrevious },
        kind: "empty",
        items: [],
      };
    }

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: totalsCurrent, previous: totalsPrevious },
      kind: "page_deltas",
      items,
    };
  }

  if (args.intent === "HIGH_IMPRESS_LOW_CTR_PAGES") {
    const [currRows, prevRows] = await Promise.all([
      queryRows({ siteUrl, ...current, dimensions: ["page"], rowLimit, startRow: 0 }),
      queryRows({ siteUrl, ...previous, dimensions: ["page"], rowLimit, startRow: 0 }),
    ]);

    const merged = mergeDeltas(currRows, prevRows, "page")
      .map((r) => ({
        ...r,
        score: r.impressionsCurrent * (1 - r.ctrCurrent),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.impressionsCurrent - a.impressionsCurrent ||
          a.ctrCurrent - b.ctrCurrent ||
          String(a.page).localeCompare(String(b.page)),
      );

    const items = merged.slice(0, rowLimit);
    if (items.length === 0) {
      return {
        intent: args.intent,
        preset,
        rowLimit,
        range: { current, previous },
        totals: { current: totalsCurrent, previous: totalsPrevious },
        kind: "empty",
        items: [],
      };
    }

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: totalsCurrent, previous: totalsPrevious },
      kind: "page_deltas",
      items,
    };
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

    const items = merged.slice(0, rowLimit);
    if (items.length === 0) {
      return {
        intent: args.intent,
        preset,
        rowLimit,
        range: { current, previous },
        totals: { current: totalsCurrent, previous: totalsPrevious },
        kind: "empty",
        items: [],
      };
    }

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: totalsCurrent, previous: totalsPrevious },
      kind: "query_deltas",
      items,
    };
  }

  if (args.intent === "CTR_OPPORTUNITIES_QUERIES") {
    const [currRows, prevRows] = await Promise.all([
      queryRows({ siteUrl, ...current, dimensions: ["query"], rowLimit, startRow: 0 }),
      queryRows({ siteUrl, ...previous, dimensions: ["query"], rowLimit, startRow: 0 }),
    ]);

    const merged = mergeDeltas(currRows, prevRows, "query")
      .filter(
        (r) =>
          r.impressionsCurrent >= 100 &&
          r.positionCurrent > 0 &&
          r.positionCurrent <= 10 &&
          r.ctrCurrent <= 0.03,
      )
      .sort(
        (a, b) =>
          b.impressionsCurrent - a.impressionsCurrent ||
          a.ctrCurrent - b.ctrCurrent ||
          a.positionCurrent - b.positionCurrent ||
          String(a.query).localeCompare(String(b.query)),
      );

    const items = merged.slice(0, rowLimit);
    if (items.length === 0) {
      return {
        intent: args.intent,
        preset,
        rowLimit,
        range: { current, previous },
        totals: { current: totalsCurrent, previous: totalsPrevious },
        kind: "empty",
        items: [],
      };
    }

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: totalsCurrent, previous: totalsPrevious },
      kind: "query_deltas",
      items,
    };
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

    const topLimit = Math.min(rowLimit, 250);
    const [
      brandCurrentTotals,
      brandPreviousTotals,
      nonBrandCurrentTotals,
      nonBrandPreviousTotals,
      brandCurrentTop,
      brandPreviousTop,
      nonBrandCurrentTop,
      nonBrandPreviousTop,
    ] = await Promise.all([
      queryTotals({ siteUrl, ...current, dimensionFilterGroups: brandFilters }),
      queryTotals({ siteUrl, ...previous, dimensionFilterGroups: brandFilters }),
      queryTotals({ siteUrl, ...current, dimensionFilterGroups: nonBrandFilters }),
      queryTotals({ siteUrl, ...previous, dimensionFilterGroups: nonBrandFilters }),
      queryRows({
        siteUrl,
        ...current,
        dimensions: ["query"],
        rowLimit: topLimit,
        startRow: 0,
        dimensionFilterGroups: brandFilters,
      }),
      queryRows({
        siteUrl,
        ...previous,
        dimensions: ["query"],
        rowLimit: topLimit,
        startRow: 0,
        dimensionFilterGroups: brandFilters,
      }),
      queryRows({
        siteUrl,
        ...current,
        dimensions: ["query"],
        rowLimit: topLimit,
        startRow: 0,
        dimensionFilterGroups: nonBrandFilters,
      }),
      queryRows({
        siteUrl,
        ...previous,
        dimensions: ["query"],
        rowLimit: topLimit,
        startRow: 0,
        dimensionFilterGroups: nonBrandFilters,
      }),
    ]);

    const brandMerged = mergeDeltas(brandCurrentTop, brandPreviousTop, "query").slice(0, topLimit);
    const nonBrandMerged = mergeDeltas(nonBrandCurrentTop, nonBrandPreviousTop, "query").slice(0, topLimit);

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: totalsCurrent, previous: totalsPrevious },
      kind: "brand_vs_nonbrand",
      items: {
        brandTerms,
        brand: { totals: { current: brandCurrentTotals, previous: brandPreviousTotals }, topQueries: brandMerged },
        nonBrand: {
          totals: { current: nonBrandCurrentTotals, previous: nonBrandPreviousTotals },
          topQueries: nonBrandMerged,
        },
      },
      context: { brandTerms },
    };
  }

  if (args.intent === "CANNIBALIZATION_QUERIES") {
    const [currRows, prevRows] = await Promise.all([
      queryRows({ siteUrl, ...current, dimensions: ["query", "page"], rowLimit, startRow: 0 }),
      queryRows({ siteUrl, ...previous, dimensions: ["query", "page"], rowLimit, startRow: 0 }),
    ]);

    const toMap = (
      rows: Array<NonNullable<ReturnType<typeof normalizeGscRow>>>,
    ): Map<string, Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>> => {
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
      return byQuery;
    };

    const currMap = toMap(currRows);
    const prevMap = toMap(prevRows);
    const queries = new Set<string>([...currMap.keys(), ...prevMap.keys()].filter(Boolean));

    const out = [...queries]
      .map((query) => {
        const currPages = currMap.get(query) ?? [];
        const prevPages = prevMap.get(query) ?? [];

        const toAgg = (pages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>) => {
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
            pageCount: sorted.length,
            totalClicks,
            totalImpressions,
            concentration,
            topPages: sorted.slice(0, 5),
          } as const;
        };

        const curr = toAgg(currPages);
        const prev = toAgg(prevPages);

        return {
          query,
          current: curr,
          previous: prev,
          deltaClicks: curr.totalClicks - prev.totalClicks,
          deltaImpressions: curr.totalImpressions - prev.totalImpressions,
          deltaConcentration: curr.concentration - prev.concentration,
        } as const;
      })
      .filter((x) => x.current.pageCount >= 2 && x.current.totalClicks > 0 && x.current.concentration < 0.8)
      .sort(
        (a, b) =>
          b.current.totalClicks - a.current.totalClicks ||
          a.current.concentration - b.current.concentration ||
          String(a.query).localeCompare(String(b.query)),
      );

    const items = out.slice(0, rowLimit);
    if (items.length === 0) {
      return {
        intent: args.intent,
        preset,
        rowLimit,
        range: { current, previous },
        totals: { current: totalsCurrent, previous: totalsPrevious },
        kind: "empty",
        items: [],
      };
    }

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: totalsCurrent, previous: totalsPrevious },
      kind: "query_page_cannibalization",
      items,
    };
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

    const [currTotals, prevTotals] = await Promise.all([
      queryTotals({ siteUrl, ...current, dimensionFilterGroups: filters }),
      queryTotals({ siteUrl, ...previous, dimensionFilterGroups: filters }),
    ]);

    const [currRows, prevRows] = await Promise.all([
      queryRows({
        siteUrl,
        ...current,
        dimensions: ["query"],
        rowLimit,
        startRow: 0,
        dimensionFilterGroups: filters,
      }),
      queryRows({
        siteUrl,
        ...previous,
        dimensions: ["query"],
        rowLimit,
        startRow: 0,
        dimensionFilterGroups: filters,
      }),
    ]);

    const merged = mergeDeltas(currRows, prevRows, "query").sort(
      (a, b) =>
        b.clicksCurrent - a.clicksCurrent ||
        b.impressionsCurrent - a.impressionsCurrent ||
        String(a.query).localeCompare(String(b.query)),
    );

    const items = merged.slice(0, rowLimit);
    if (items.length === 0) {
      return {
        intent: args.intent,
        preset,
        rowLimit,
        range: { current, previous },
        totals: { current: currTotals, previous: prevTotals },
        kind: "empty",
        items: [],
        context: { pageUrl },
      };
    }

    return {
      intent: args.intent,
      preset,
      rowLimit,
      range: { current, previous },
      totals: { current: currTotals, previous: prevTotals },
      kind: "page_drilldown",
      items,
      context: { pageUrl },
    };
  }

  throw new Error(`Unsupported intent: ${args.intent satisfies never}`);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = await getValidatedUserIdForRoute(session);
  if (!userId) {
    return NextResponse.json(
      { error: "Session expired or invalid. Please continue with Google again." },
      { status: 401 },
    );
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
    const messageTrimmed = message.trim();

  try {
    const entBefore = await getUserEntitlements(userId);
    const freeLimitReached = !entBefore.isPro && entBefore.questionsUsed >= 3;
    if (freeLimitReached) {
      await setPendingQuestion(userId, messageTrimmed);
      return NextResponse.json({
        type: "paywall" as const,
        paywall: {
          reason: "Free limit reached",
          questionsUsed: entBefore.questionsUsed,
          freeLimit: 3,
          pendingSaved: true,
          checkoutPath: "/api/stripe/checkout",
        },
        entitlements: entBefore,
      });
    }

    const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

    const tool = {
      type: "function" as const,
      function: {
        name: "gsc_query",
        description: "Select an intent and parameters to query Google Search Console.",
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
      "You MAY call the tool `gsc_query` up to 3 times when you need Google Search Console data.",
      "If the user question is explanatory (no GSC data needed), do not call any tools.",
      "Default preset is last28.",
      "Keep rowLimit <= 250 unless the user explicitly asks for more.",
      "If the user asks about a specific page URL, use DRILLDOWN_PAGE_TO_QUERIES and set pageUrl.",
      "Do not ask follow-up questions; choose the best intent based on the user request.",
    ].join("\n");

    const first = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0,
      tools: [tool],
      messages: [
        { role: "system", content: system },
        { role: "user", content: `siteUrl: ${siteUrl}\n\nUser message:\n${messageTrimmed}` },
      ],
    });

    const assistantMsg = first.choices[0]?.message;
    const toolCallsRaw = assistantMsg?.tool_calls ?? [];

    type ToolCall = (typeof toolCallsRaw)[number];
    function isGscQueryToolCall(
      call: ToolCall,
    ): call is ToolCall & { type: "function"; function: { name: "gsc_query"; arguments: string } } {
      const c = call as unknown as { type?: unknown; function?: { name?: unknown; arguments?: unknown } };
      return (
        c.type === "function" &&
        typeof c.function?.name === "string" &&
        c.function.name === "gsc_query" &&
        typeof c.function.arguments === "string"
      );
    }

    const toolCalls = toolCallsRaw.filter(isGscQueryToolCall);

    if (toolCallsRaw.some((c) => !isGscQueryToolCall(c))) {
      return NextResponse.json({ error: "Model called an unsupported tool." }, { status: 500 });
    }

    if (toolCalls.length > 3) {
      return NextResponse.json({ error: "Model requested too many tool calls (max 3)." }, { status: 400 });
    }

    let results: V2IntentResult[] = [];
    let intentForResponse: Intent | "NONE" = "NONE";

    if (toolCalls.length > 0) {
      const parsedArgsList: ToolArgs[] = [];
      for (const call of toolCalls) {
        const rawArgs = safeJsonParse(call.function.arguments);
        const parsedArgs = ToolArgsSchema.safeParse(rawArgs);
        if (!parsedArgs.success) {
          return NextResponse.json(
            { error: "Model produced invalid tool arguments.", issues: parsedArgs.error.issues },
            { status: 500 },
          );
        }
        parsedArgsList.push(parsedArgs.data);
      }

      intentForResponse = parsedArgsList[0]?.intent ?? "NONE";

      const perCallCap = Math.max(1, Math.floor(1000 / (2 * parsedArgsList.length)));

      try {
        results = await Promise.all(
          parsedArgsList.map((args) =>
            runIntent(req, { siteUrl, message: messageTrimmed, args }, { rowLimitCap: perCallCap }),
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        const statusRaw = (err as { status?: unknown } | null | undefined)?.status;
        const status = typeof statusRaw === "number" ? statusRaw : undefined;
        if (status === 401 || msg.toLowerCase().includes("not connected")) {
          return NextResponse.json({ error: msg }, { status: 401 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    const preset: Preset = (results[0]?.preset as Preset | undefined) ?? "last28";
    const intentForAnswer = results.length === 1 ? (results[0]?.intent ?? intentForResponse) : undefined;

    const gscData: V2GscData | undefined =
      results.length > 0
        ? {
            siteUrl,
            preset,
            results,
          }
        : undefined;

    const v2 = buildV2Answer({ userMessage: messageTrimmed, siteUrl, preset, intent: intentForAnswer, gscData });
    const answer = renderV2AnswerMarkdown(v2);

    if (!entBefore.isPro) {
      await incrementQuestionsUsed(userId);
    }

    if (entBefore.pendingQuestion && entBefore.pendingQuestion.trim() === messageTrimmed) {
      await clearPendingQuestion(userId);
    }

    const entAfter = await getUserEntitlements(userId);

    return NextResponse.json({
      type: "answer" as const,
      answer,
      intent: intentForResponse,
      data: gscData ?? null,
      entitlements: entAfter,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/chat] Unhandled error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
