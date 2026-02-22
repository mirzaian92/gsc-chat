export type Preset = "last7" | "last28" | "last90";

export type NormalizedGscRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number; // decimal 0..1
  position: number;
};

export type GscTotals = {
  clicks: number;
  impressions: number;
  ctr: number; // decimal 0..1
  position: number;
};

export type GscRange = { startDate: string; endDate: string };

export type V2Priority = "High impact" | "Medium impact" | "Low impact";
export type V2ConfidenceLevel = "High" | "Medium" | "Low";

export type V2Answer = {
  summary: string;
  keyFindings: string[];
  likelyCauses: string[];
  recommendedActions: { step: string; priority: V2Priority }[];
  whatStandsOut: string;
  confidence: { level: V2ConfidenceLevel; reason: string };
  debug?: { comparisonsUsed: string[]; microInsights: string[] };
};

export type V2IntentResult =
  | {
      intent: string;
      preset: Preset;
      rowLimit: number;
      range: { current: GscRange; previous: GscRange };
      totals: { current: GscTotals; previous: GscTotals };
      kind:
        | "query_deltas"
        | "page_deltas"
        | "query_list"
        | "page_list"
        | "query_page_cannibalization"
        | "brand_vs_nonbrand"
        | "page_drilldown";
      items: unknown;
      context?: { pageUrl?: string; brandTerms?: string[] };
    }
  | {
      intent: string;
      preset: Preset;
      rowLimit: number;
      range: { current: GscRange; previous: GscRange };
      totals: { current: GscTotals; previous: GscTotals };
      kind: "empty";
      items: [];
      context?: { pageUrl?: string; brandTerms?: string[] };
    };

export type V2GscData = {
  siteUrl: string;
  preset: Preset;
  results: V2IntentResult[];
};

function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

function formatCtr(ctrDecimal: number): string {
  const pct = (Number.isFinite(ctrDecimal) ? ctrDecimal : 0) * 100;
  return `${round(pct, 1)}%`;
}

function formatSignedPct(pctDecimal: number): string {
  const pct = round(pctDecimal * 100, 1);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

function safeDiv(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

function pctChange(current: number, previous: number): number {
  return safeDiv(current - previous, Math.max(previous, 1));
}

function positionDelta(previous: number, current: number): number {
  // Positive means position improved (moved closer to 1).
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  return previous - current;
}

export function normalizeGscRow(raw: unknown): NormalizedGscRow | undefined {
  const obj = raw as {
    keys?: unknown;
    clicks?: unknown;
    impressions?: unknown;
    ctr?: unknown;
    position?: unknown;
  };

  const keys = Array.isArray(obj.keys) ? obj.keys.filter((k): k is string => typeof k === "string") : [];
  if (keys.length === 0) return undefined;

  const clicks = typeof obj.clicks === "number" ? obj.clicks : 0;
  const impressions = typeof obj.impressions === "number" ? obj.impressions : 0;
  const ctrRaw = typeof obj.ctr === "number" ? obj.ctr : 0;
  const ctr = ctrRaw > 1 ? ctrRaw / 100 : ctrRaw;
  const position = typeof obj.position === "number" ? obj.position : 0;

  return { keys, clicks, impressions, ctr, position };
}

function ensureBetween<T>(items: T[], min: number, max: number, filler: () => T): T[] {
  const out = [...items];
  while (out.length < min) out.push(filler());
  return out.slice(0, max);
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const idx = trimmed.search(/[.!?]\s/);
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx + 1).trim();
}

type TotalsDelta = {
  clicksPct: number;
  impressionsPct: number;
  ctrAbs: number;
  positionImprovement: number;
};

function computeTotalsDelta(current: GscTotals, previous: GscTotals): TotalsDelta {
  return {
    clicksPct: pctChange(current.clicks, previous.clicks),
    impressionsPct: pctChange(current.impressions, previous.impressions),
    ctrAbs: (current.ctr ?? 0) - (previous.ctr ?? 0),
    positionImprovement: positionDelta(previous.position ?? 0, current.position ?? 0),
  };
}

function pickExampleFromResults(
  results: V2IntentResult[],
): { query?: string; pageUrl?: string; extra?: string } {
  for (const r of results) {
    if (r.context?.pageUrl) return { pageUrl: r.context.pageUrl };
    if (r.kind === "query_deltas" || r.kind === "query_list" || r.kind === "page_drilldown") {
      const items = r.items as Array<{ query?: string }>;
      const q = items?.[0]?.query;
      if (typeof q === "string" && q.trim()) return { query: q.trim() };
    }
    if (r.kind === "page_deltas" || r.kind === "page_list") {
      const items = r.items as Array<{ page?: string }>;
      const p = items?.[0]?.page;
      if (typeof p === "string" && p.trim()) return { pageUrl: p.trim() };
    }
    if (r.kind === "query_page_cannibalization") {
      const items = r.items as Array<{ query?: string; topPages?: Array<{ page: string }> }>;
      const q = items?.[0]?.query;
      const p = items?.[0]?.topPages?.[0]?.page;
      if (typeof q === "string" && q.trim()) return { query: q.trim(), pageUrl: p };
    }
    if (r.kind === "brand_vs_nonbrand") {
      const items = r.items as { brand?: { topQueries?: Array<{ query: string }> }; nonBrand?: { topQueries?: Array<{ query: string }> } };
      const q = items?.nonBrand?.topQueries?.[0]?.query ?? items?.brand?.topQueries?.[0]?.query;
      if (typeof q === "string" && q.trim()) return { query: q.trim() };
    }
  }
  return {};
}

function deriveMicroInsights(input: {
  intent?: string;
  totalsDelta?: TotalsDelta;
  results: V2IntentResult[];
}): string[] {
  const insights: string[] = [];
  const d = input.totalsDelta;

  if (d) {
    if (d.positionImprovement > 0.3 && d.clicksPct < -0.05) {
      insights.push("Average position improved, but clicks fell — that often points to lower CTR or reduced demand.");
    }
    if (d.impressionsPct > 0.05 && d.ctrAbs < -0.002) {
      insights.push("Impressions rose while CTR fell — increased visibility with weaker snippet/intent match can depress clicks.");
    }
    if (insights.length < 2 && d.impressionsPct < -0.05 && d.positionImprovement >= 0) {
      insights.push("Visibility dropped (impressions down) even though average position didn’t worsen — demand/seasonality or coverage changes may be at play.");
    }
    if (insights.length < 2 && d.clicksPct > 0.05 && d.ctrAbs > 0.002) {
      insights.push("Clicks grew alongside CTR — improvements are likely coming from snippet relevance or better alignment with search intent.");
    }
  }

  const hasCannibal = input.results.some((r) => r.kind === "query_page_cannibalization" && Array.isArray(r.items) && r.items.length > 0);
  if (hasCannibal && insights.length < 3) {
    insights.push("Potential cannibalization is present: the same query is earning clicks across multiple pages.");
  }

  const brandResult = input.results.find((r) => r.kind === "brand_vs_nonbrand");
  if (brandResult && insights.length < 3) {
    insights.push("Brand and non-brand performance can move in opposite directions; treat them as separate funnels when diagnosing changes.");
  }

  // Ensure at least 2 when data allows (i.e. we have deltas).
  if (d && insights.length < 2) {
    insights.push("Most performance shifts tend to concentrate in a small set of queries/pages; focus on the top movers first.");
    insights.push("Small CTR changes can have outsized click impact when impressions are large — prioritize high-impression items.");
  }

  return insights.slice(0, 3);
}

function chooseConfidence(input: {
  hasData: boolean;
  currentImpressions: number;
  previousImpressions: number;
  itemsCount: number;
}): { level: V2ConfidenceLevel; reason: string } {
  if (!input.hasData || input.itemsCount === 0) {
    return { level: "Low", reason: "No (or too little) Search Console data was returned for the selected ranges." };
  }
  const minImpr = Math.min(input.currentImpressions, input.previousImpressions);
  if (minImpr >= 5000) {
    return { level: "High", reason: "The comparison is based on substantial impression volume across both periods." };
  }
  if (minImpr >= 500) {
    return { level: "Medium", reason: "There’s enough volume to see directionally useful trends, but smaller moves may be noisy." };
  }
  return { level: "Low", reason: "Low impression volume makes the deltas volatile and harder to interpret confidently." };
}

function describeIntent(intent?: string): string {
  switch (intent) {
    case "TOP_WINNERS_QUERIES":
      return "top winning queries";
    case "TOP_LOSERS_QUERIES":
      return "top losing queries";
    case "TOP_WINNERS_PAGES":
      return "top winning pages";
    case "TOP_LOSERS_PAGES":
      return "top losing pages";
    case "HIGH_IMPRESS_LOW_CTR_PAGES":
      return "high-impression, low-CTR pages";
    case "POSITION_UP_CLICKS_DOWN_QUERIES":
      return "queries where position improved but clicks fell";
    case "CTR_OPPORTUNITIES_QUERIES":
      return "CTR opportunity queries";
    case "BRAND_VS_NONBRAND":
      return "brand vs non-brand performance";
    case "CANNIBALIZATION_QUERIES":
      return "potential cannibalization queries";
    case "DRILLDOWN_PAGE_TO_QUERIES":
      return "page-level query drilldown";
    default:
      return "Search Console performance";
  }
}

function buildRecommendedActions(input: {
  intent?: string;
  example: { query?: string; pageUrl?: string };
  totalsDelta?: TotalsDelta;
  hasData: boolean;
  siteUrl: string;
}): { step: string; priority: V2Priority }[] {
  const query = input.example.query ? `"${input.example.query}"` : undefined;
  const page = input.example.pageUrl ? input.example.pageUrl : undefined;

  const clicksDown = (input.totalsDelta?.clicksPct ?? 0) < -0.1;
  const clicksUp = (input.totalsDelta?.clicksPct ?? 0) > 0.1;

  const high: V2Priority = "High impact";
  const med: V2Priority = "Medium impact";
  const low: V2Priority = "Low impact";

  const action1Target =
    page && query
      ? `for ${page} (focused on ${query})`
      : page
        ? `for ${page}`
        : query
          ? `for ${query}`
          : "for the top affected queries/pages";

  const base: Array<{ step: string; priority: V2Priority }> = [
    {
      step: `Validate the main landing page and snippet alignment ${action1Target}: review title/meta, intent match, and whether the page answers the query clearly.`,
      priority: clicksDown ? high : med,
    },
    {
      step: `Inspect SERP changes and competitors for the biggest movers (features, intent shift, new entrants), then update content depth and internal linking to defend/expand rankings.`,
      priority: clicksDown ? high : med,
    },
    {
      step: `Improve CTR on high-impression items: test more specific titles, add value props, and align on-brand messaging; prioritize items with large impressions where small CTR gains matter.`,
      priority: clicksDown ? med : med,
    },
    {
      step: `Check technical and coverage basics for the affected URLs (indexing, canonical, redirects, structured data where relevant) to ensure changes aren’t caused by crawl/index issues.`,
      priority: clicksDown ? med : low,
    },
  ];

  if (!input.hasData) {
    return [
      { step: `Confirm you selected the correct Search Console property (${input.siteUrl}) and that the date range contains data.`, priority: med },
      { step: `Ask a more specific question (e.g., “winning queries” or a specific page URL) to narrow the analysis.`, priority: med },
      { step: `If you expect data but see none, verify the property is verified and that you have sufficient permissions.`, priority: low },
    ];
  }

  // Light intent-specific tightening (no new features).
  if (input.intent === "CANNIBALIZATION_QUERIES") {
    base.unshift({
      step: `For the top cannibalized query ${query ?? ""}, consolidate overlapping pages (merge content or differentiate intent) and apply canonical/redirects where appropriate to reduce dilution.`,
      priority: high,
    });
  }
  if (input.intent === "DRILLDOWN_PAGE_TO_QUERIES" && page) {
    base.unshift({
      step: `On ${page}, prioritize on-page sections and internal links that directly address the highest-impression queries (starting with ${query ?? "the top query"}) to capture more clicks.`,
      priority: high,
    });
  }
  if (clicksUp) {
    base.unshift({
      step: `Double down on what’s working: expand content and add internal links around the biggest winners to sustain momentum (start with ${query ?? "the top winner"}).`,
      priority: high,
    });
  }

  return ensureBetween(base, 3, 7, () => ({
    step: "Re-check the top movers after changes (same ranges) to confirm the direction improves.",
    priority: low,
  }));
}

export function buildV2Answer(input: {
  userMessage: string;
  siteUrl: string;
  preset: Preset;
  intent?: string;
  gscData?: V2GscData;
}): V2Answer {
  const results = input.gscData?.results ?? [];
  const primary = results.find((r) => r.kind !== "empty") ?? results[0];
  const hasData = Boolean(primary && primary.kind !== "empty");

  const currentRange = primary?.range.current;
  const previousRange = primary?.range.previous;

  const summaryParts: string[] = [];
  const intentLabels = Array.from(
    new Set(results.map((r) => describeIntent(r.intent)).filter((s) => s !== describeIntent(undefined))),
  );
  const analysisLabel =
    intentLabels.length > 0 ? intentLabels.join(", ") : describeIntent(input.intent ?? primary?.intent);

  if (currentRange && previousRange) {
    summaryParts.push(
      `Analyzed ${analysisLabel} for ${input.siteUrl} (${currentRange.startDate} to ${currentRange.endDate}) vs the previous period (${previousRange.startDate} to ${previousRange.endDate}).`,
    );
  } else {
    summaryParts.push(`Provided guidance for ${describeIntent(input.intent)} for ${input.siteUrl} (no GSC data was pulled).`);
  }
  summaryParts.push("The notes below highlight the biggest deltas and the next actions that are most likely to move results.");
  const summary = summaryParts.join(" ");

  const example = pickExampleFromResults(results);
  const totalsDelta =
    primary && primary.totals
      ? computeTotalsDelta(primary.totals.current, primary.totals.previous)
      : undefined;

  const microInsights = hasData ? deriveMicroInsights({ intent: input.intent, totalsDelta, results }) : [];

  const keyFindingsBase: string[] = [];
  if (!hasData && currentRange && previousRange) {
    keyFindingsBase.push(
      `No rows were returned for ${input.siteUrl} in ${currentRange.startDate} to ${currentRange.endDate} (and the previous period ${previousRange.startDate} to ${previousRange.endDate}).`,
    );
    keyFindingsBase.push("This usually means very low search volume, a newly verified property, or a mismatch between the selected property and the site being searched.");
    keyFindingsBase.push("If you expected data, double-check the property type (Domain vs URL-prefix) and verify it matches your canonical site URLs.");
    keyFindingsBase.push("If you asked about a specific page, confirm the exact URL (http/https, trailing slash) matches what GSC reports.");
  } else if (primary?.kind === "brand_vs_nonbrand") {
    const items = primary.items as {
      brand: { totals: { current: GscTotals; previous: GscTotals } };
      nonBrand: { totals: { current: GscTotals; previous: GscTotals } };
    };

    const b = items.brand.totals;
    const nb = items.nonBrand.totals;
    keyFindingsBase.push(
      `Brand clicks ${formatSignedPct(pctChange(b.current.clicks, b.previous.clicks))} vs previous (${formatInt(b.previous.clicks)} → ${formatInt(b.current.clicks)}).`,
    );
    keyFindingsBase.push(
      `Non-brand clicks ${formatSignedPct(pctChange(nb.current.clicks, nb.previous.clicks))} vs previous (${formatInt(nb.previous.clicks)} → ${formatInt(nb.current.clicks)}).`,
    );
    keyFindingsBase.push(
      `Brand CTR changed by ${round((b.current.ctr - b.previous.ctr) * 100, 1)}pp (${formatCtr(b.previous.ctr)} → ${formatCtr(b.current.ctr)}).`,
    );
    keyFindingsBase.push(
      `Non-brand CTR changed by ${round((nb.current.ctr - nb.previous.ctr) * 100, 1)}pp (${formatCtr(nb.previous.ctr)} → ${formatCtr(nb.current.ctr)}).`,
    );
  } else if (primary?.totals) {
    const c = primary.totals.current;
    const p = primary.totals.previous;
    const d = computeTotalsDelta(c, p);
    keyFindingsBase.push(
      `Clicks ${formatSignedPct(d.clicksPct)} vs previous (${formatInt(p.clicks)} → ${formatInt(c.clicks)}).`,
    );
    keyFindingsBase.push(
      `Impressions ${formatSignedPct(d.impressionsPct)} vs previous (${formatInt(p.impressions)} → ${formatInt(c.impressions)}).`,
    );
    keyFindingsBase.push(`CTR changed by ${round(d.ctrAbs * 100, 1)}pp (${formatCtr(p.ctr)} → ${formatCtr(c.ctr)}).`);
    keyFindingsBase.push(
      `Average position ${d.positionImprovement >= 0 ? "improved" : "worsened"} by ${round(Math.abs(d.positionImprovement), 2)} (${round(p.position, 2)} → ${round(c.position, 2)}).`,
    );
  } else {
    keyFindingsBase.push("No Search Console comparison data was available to compute period-over-period deltas.");
  }

  // Add a specific “top mover” when available.
  if (primary && Array.isArray(primary.items) && primary.items.length > 0) {
    const first = primary.items[0] as { query?: string; page?: string; deltaClicks?: number };
    if (typeof first.query === "string") {
      const dc = typeof first.deltaClicks === "number" ? first.deltaClicks : undefined;
      keyFindingsBase.push(
        `Top focus query: "${first.query}"${dc !== undefined ? ` (${dc >= 0 ? "+" : ""}${round(dc, 0)} clicks vs previous)` : ""}.`,
      );
    } else if (typeof first.page === "string") {
      const dc = typeof first.deltaClicks === "number" ? first.deltaClicks : undefined;
      keyFindingsBase.push(
        `Top focus page: ${first.page}${dc !== undefined ? ` (${dc >= 0 ? "+" : ""}${round(dc, 0)} clicks vs previous)` : ""}.`,
      );
    }
  } else if (example.query) {
    keyFindingsBase.push(`A concrete starting point is the query "${example.query}", since small CTR improvements can compound quickly.`);
  } else if (example.pageUrl) {
    keyFindingsBase.push(`A concrete starting point is the page ${example.pageUrl}, since it anchors the most relevant changes here.`);
  }

  const additionalFindings: string[] = [];
  for (const r of results) {
    if (r === primary) continue;
    if (additionalFindings.length >= 2) break;

    if (r.kind === "brand_vs_nonbrand") {
      additionalFindings.push("Brand vs non-brand was also analyzed; if they diverge, prioritize non-brand fixes first because they usually drive net-new demand.");
      continue;
    }
    if (r.kind === "query_page_cannibalization" && Array.isArray(r.items) && r.items.length > 0) {
      const first = r.items[0] as { query?: string; current?: { pageCount?: number } };
      if (typeof first.query === "string") {
        additionalFindings.push(
          `Potential cannibalization signal: query "${first.query}" is spread across ${first.current?.pageCount ?? 2} pages.`,
        );
      }
      continue;
    }
    if (Array.isArray(r.items) && r.items.length > 0) {
      const first = r.items[0] as { query?: string; page?: string; deltaClicks?: number };
      if (typeof first.query === "string") {
        additionalFindings.push(
          `Also notable: "${first.query}" is a top mover (${typeof first.deltaClicks === "number" ? `${first.deltaClicks >= 0 ? "+" : ""}${round(first.deltaClicks, 0)} clicks vs previous` : "not enough data for a delta"}).`,
        );
        continue;
      }
      if (typeof first.page === "string") {
        additionalFindings.push(
          `Also notable: ${first.page} is a top mover (${typeof first.deltaClicks === "number" ? `${first.deltaClicks >= 0 ? "+" : ""}${round(first.deltaClicks, 0)} clicks vs previous` : "not enough data for a delta"}).`,
        );
      }
    }
  }

  const keyFindings = ensureBetween(
    [...keyFindingsBase, ...additionalFindings, ...microInsights].filter((s) => s.trim().length > 0),
    4,
    8,
    () => "No additional findings were available from the returned dataset.",
  );

  const likelyCausesBase: string[] = [];
  if (!hasData && currentRange && previousRange) {
    likelyCausesBase.push("The property may be correct but search demand is too low in these windows to produce rows (especially for smaller sites or narrow page filters).");
    likelyCausesBase.push("The selected property might not match the live canonical URLs (Domain vs URL-prefix mismatch, http/https mismatch, trailing slash differences).");
    likelyCausesBase.push("If filters were applied (brand terms or page URL), they may be too strict or not matching how queries/pages appear in GSC.");
  }
  if (hasData && totalsDelta) {
    if (totalsDelta.impressionsPct > 0.05 && totalsDelta.ctrAbs < -0.002) {
      likelyCausesBase.push("Snippet/intent mismatch: more impressions are coming from broader queries where the listing is less compelling.");
    }
    if (totalsDelta.positionImprovement > 0.3 && totalsDelta.clicksPct < -0.05) {
      likelyCausesBase.push("SERP layout changes (features/ads) or lower brand demand can reduce clicks even when ranking improves.");
    }
    if (totalsDelta.impressionsPct < -0.05) {
      likelyCausesBase.push("Demand/seasonality shifts or reduced query coverage (indexing/crawl/canonical changes) can pull impressions down.");
    }
  }
  if (input.intent === "CANNIBALIZATION_QUERIES") {
    likelyCausesBase.push("Overlapping pages compete for the same intent, splitting clicks across URLs and weakening the strongest page signal.");
  }
  if (input.intent === "BRAND_VS_NONBRAND") {
    likelyCausesBase.push("Brand and non-brand behave differently: non-brand is more sensitive to competitors and SERP features, while brand depends on awareness and navigational intent.");
  }
  likelyCausesBase.push("Measurement caveat: low-volume queries/pages can swing sharply between periods due to sampling and natural volatility.");

  const likelyCauses = ensureBetween(
    likelyCausesBase,
    3,
    6,
    () => "Additional diagnostics may be needed to isolate the primary driver.",
  );

  const recommendedActions = buildRecommendedActions({
    intent: input.intent ?? primary?.intent,
    example: { query: example.query, pageUrl: example.pageUrl },
    totalsDelta,
    hasData,
    siteUrl: input.siteUrl,
  });

  const itemsCount = results.reduce((sum, r) => (Array.isArray(r.items) ? sum + r.items.length : sum), 0);
  const confidence: { level: V2ConfidenceLevel; reason: string } = primary?.totals
    ? chooseConfidence({
        hasData,
        currentImpressions: primary.totals.current.impressions,
        previousImpressions: primary.totals.previous.impressions,
        itemsCount,
      })
    : { level: "Medium", reason: "No comparison totals were available, so guidance is directional." };

  const whatStandsOut =
    microInsights.length > 0 ? firstSentence(microInsights[0] ?? "") : "The biggest changes appear concentrated in the top movers.";

  return {
    summary,
    keyFindings,
    likelyCauses,
    recommendedActions,
    whatStandsOut,
    confidence,
    debug: input.gscData
      ? { comparisonsUsed: results.map((r) => `${r.intent}:${r.range.current.startDate}..${r.range.current.endDate} vs ${r.range.previous.startDate}..${r.range.previous.endDate}`), microInsights }
      : { comparisonsUsed: [], microInsights },
  };
}

export function renderV2AnswerMarkdown(answer: V2Answer): string {
  const summary = answer.summary.trim();

  const keyFindings = ensureBetween(answer.keyFindings.map((s) => s.trim()).filter(Boolean), 4, 8, () => "—");
  const likelyCauses = ensureBetween(answer.likelyCauses.map((s) => s.trim()).filter(Boolean), 3, 6, () => "—");
  const recommended = ensureBetween(answer.recommendedActions, 3, 7, () => ({
    step: "Review and iterate based on the biggest movers.",
    priority: "Low impact",
  }));

  const lines: string[] = [];
  lines.push("## Summary");
  lines.push(summary);
  lines.push("");
  lines.push("## Key findings");
  for (const b of keyFindings) lines.push(`• ${b}`);
  lines.push("");
  lines.push("## Likely causes");
  for (const b of likelyCauses) lines.push(`• ${b}`);
  lines.push("");
  lines.push("## Recommended actions");
  recommended.forEach((a, i) => {
    lines.push(`${i + 1}. ${a.step.trim()} [${a.priority}]`);
  });
  lines.push("");
  lines.push(`What stands out: ${firstSentence(answer.whatStandsOut)}`);
  lines.push("");
  lines.push("## Confidence");
  lines.push(`${answer.confidence.level} — ${firstSentence(answer.confidence.reason)}`);
  return lines.join("\n").trim() + "\n";
}
