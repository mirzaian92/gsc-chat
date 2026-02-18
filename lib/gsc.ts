import "server-only";

import { z } from "zod";
import type { searchconsole_v1 } from "googleapis";
import { getAuthedClients } from "./google";

const ymdDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const dimensionEnum = z.enum(["query", "page", "country", "device", "date"]);

const searchTypeEnum = z.enum(["web", "image", "video", "news", "discover"]);

const filterOperatorEnum = z.enum([
  "contains",
  "equals",
  "notContains",
  "notEquals",
  "includingRegex",
  "excludingRegex",
]);

const dimensionFilterSchema = z.object({
  dimension: dimensionEnum,
  operator: filterOperatorEnum,
  expression: z.string().min(1),
});

const dimensionFilterGroupSchema = z.object({
  groupType: z.enum(["and", "or"]).optional(),
  filters: z.array(dimensionFilterSchema).min(1),
});

export const GscQuerySchema = z.object({
  siteUrl: z.string().min(1),
  startDate: ymdDate,
  endDate: ymdDate,
  dimensions: z.array(dimensionEnum).optional(),
  rowLimit: z.number().int().min(1).max(25000).optional(),
  startRow: z.number().int().min(0).optional(),
  searchType: searchTypeEnum.optional(),
  dimensionFilterGroups: z.array(dimensionFilterGroupSchema).optional(),
});

export type GscQueryInput = z.infer<typeof GscQuerySchema>;

function formatYmdUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function rangePreset(
  preset: "last7" | "last28" | "last90",
): { startDate: string; endDate: string } {
  const days = preset === "last7" ? 7 : preset === "last28" ? 28 : 90;

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1); // yesterday (UTC)

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  return { startDate: formatYmdUtc(start), endDate: formatYmdUtc(end) };
}

export async function gscSearchAnalyticsQuery(
  userId: string,
  input: GscQueryInput,
): Promise<searchconsole_v1.Schema$SearchAnalyticsQueryResponse> {
  const { searchconsole } = await getAuthedClients(userId);
  const { siteUrl, ...requestBody } = input;

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: requestBody as searchconsole_v1.Schema$SearchAnalyticsQueryRequest,
  });

  return res.data;
}

export async function gscSitesList(userId: string): Promise<searchconsole_v1.Schema$WmxSite[]> {
  const { searchconsole } = await getAuthedClients(userId);
  const res = await searchconsole.sites.list();
  return res.data.siteEntry ?? [];
}

