import { loadMetaRange } from "./_meta-range.js";
import { loadTgTrackAttribution } from "./_tgtrack-reports.js";
import { buildDashboardReport } from "./dashboard-v2-core.js";

const HISTORY_FROM = "2026-01-01";
const RATE_CACHE = globalThis.__zttNbtRates || new Map();
globalThis.__zttNbtRates = RATE_CACHE;

function sendJson(res, status, payload) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function allowedOrigin(req) {
  const origin = String(req.headers?.origin || "");
  const allowed = new Set(["https://ztt.kz", "https://www.ztt.kz", "http://127.0.0.1:4173"]);
  return allowed.has(origin) ? origin : "";
}

function dateValue(value, fallback) {
  const raw = Array.isArray(value) ? value[0] : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(raw || "")) ? String(raw) : fallback;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayAlmaty() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateRange(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (!Number.isInteger(days) || days < 1) throw Object.assign(new Error("invalid_date_range"), { statusCode: 400 });
  if (days > 92) throw Object.assign(new Error("date_range_too_large"), { statusCode: 400 });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseRows(path) {
  const response = await fetchWithTimeout(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`supabase_http_${response.status}`);
  return text ? JSON.parse(text) : [];
}

function xmlUsdRate(xml) {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    if (!/<title>\s*USD\s*<\/title>/i.test(item)) continue;
    const value = item.match(/<description>\s*([0-9.,]+)\s*<\/description>/i)?.[1];
    const quantity = item.match(/<quant>\s*([0-9.,]+)\s*<\/quant>/i)?.[1] || "1";
    const rate = Number(String(value || "").replace(",", ".")) / Number(String(quantity).replace(",", "."));
    if (rate >= 100 && rate <= 2000) return rate;
  }
  throw new Error("nbk_usd_rate_missing");
}

async function usdKztRate(date) {
  if (RATE_CACHE.has(date)) return RATE_CACHE.get(date);
  const [year, month, day] = date.split("-");
  const url = `https://nationalbank.kz/rss/get_rates.cfm?fdate=${day}.${month}.${year}`;
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": "ZTT-Analytics/2.0" } }, 8_000);
  const text = await response.text();
  if (!response.ok) throw new Error(`nbk_http_${response.status}`);
  const rate = xmlUsdRate(text);
  RATE_CACHE.set(date, rate);
  return rate;
}

function datesBetween(from, to) {
  const values = [];
  for (let value = from; value <= to; value = shiftDate(value, 1)) values.push(value);
  return values;
}

export default async function handler(req, res) {
  const origin = allowedOrigin(req);
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  try {
    const missing = ["SUPABASE_URL", "SUPABASE_KEY", "META_ACCESS_TOKEN", "TGTRACK_API_KEY"].filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`missing_configuration_${missing.join("_").toLowerCase()}`);
    const today = todayAlmaty();
    const to = dateValue(req.query?.to, today);
    const from = dateValue(req.query?.from, shiftDate(to, -6));
    validateRange(from, to);

    const dailyPath = `daily_entries?date=gte.${from}&date=lte.${to}&select=*&order=date.asc`;
    const salesPath = `sales_attribution?sale_date=gte.${from}&sale_date=lte.${to}&select=*&order=sale_date.asc`;
    const [dailyResult, salesResult, metaResult] = await Promise.allSettled([
      supabaseRows(dailyPath),
      supabaseRows(salesPath),
      loadMetaRange(from, to),
    ]);
    if (dailyResult.status === "rejected" || salesResult.status === "rejected") {
      console.warn("[dashboard-v2] supabase_sources", {
        daily: dailyResult.status === "fulfilled" ? "ok" : String(dailyResult.reason?.message || "error"),
        sales: salesResult.status === "fulfilled" ? "ok" : String(salesResult.reason?.message || "error"),
      });
    }
    const dailyEntries = dailyResult.status === "fulfilled" ? dailyResult.value : [];
    const salesRows = salesResult.status === "fulfilled" ? salesResult.value : [];
    const lookups = salesRows.map((row, index) => ({ key: `sale:${index}`, telegram_user_id: row.telegram_user_id, attribution_date: row.sale_date }));
    const tgtrackResult = await Promise.allSettled([
      loadTgTrackAttribution(process.env.TGTRACK_API_KEY, HISTORY_FROM, to, lookups, from),
    ]);
    const tgtrack = tgtrackResult[0].status === "fulfilled" ? tgtrackResult[0].value : null;
    const ratePairs = await Promise.all(datesBetween(from, to).map(async (date) => {
      try { return [date, await usdKztRate(date)]; } catch { return [date, null]; }
    }));
    const rates = Object.fromEntries(ratePairs.filter(([, rate]) => rate !== null));
    const providers = {
      supabase: dailyResult.status === "fulfilled" && salesResult.status === "fulfilled" ? "ok" : "error",
      meta: metaResult.status === "fulfilled" ? "ok" : "error",
      tgtrack: tgtrack ? "ok" : "error",
      nbk: Object.keys(rates).length === datesBetween(from, to).length ? "ok" : "partial",
    };
    const report = buildDashboardReport({
      from, to,
      metaRows: metaResult.status === "fulfilled" ? metaResult.value.rows : [],
      metaDiagnostics: metaResult.status === "fulfilled" ? metaResult.value.diagnostics : null,
      tgtrack, salesRows, dailyEntries, rates, providers,
    });
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
    return sendJson(res, 200, { ok: true, report });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { ok: false, error: String(error.message || "dashboard_failed").split(":")[0] });
  }
}
