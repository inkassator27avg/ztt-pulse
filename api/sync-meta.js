const metaVersion = "v20.0";
const adAccountId = "act_1038880678191397";

const requiredEnv = ["META_ACCESS_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"];

function sendJson(res, status, response) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response, null, 2));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function yesterday() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}

function getDate(req) {
  const value = Array.isArray(req.query?.date) ? req.query.date[0] : req.query?.date;
  if (!value) return yesterday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }
  return value;
}

function checkEnv() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

function checkSecret(req) {
  if (!process.env.SYNC_SECRET) return;

  const querySecret = Array.isArray(req.query?.secret) ? req.query.secret[0] : req.query?.secret;
  const headerSecret = req.headers["x-sync-secret"];

  if (querySecret !== process.env.SYNC_SECRET && headerSecret !== process.env.SYNC_SECRET) {
    throw new Error("Wrong sync secret.");
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getMetaInsights(date) {
  const url = new URL(`https://graph.facebook.com/${metaVersion}/${adAccountId}/insights`);
  url.searchParams.set("fields", "spend,impressions,clicks");
  url.searchParams.set("time_range", JSON.stringify({ since: date, until: date }));
  url.searchParams.set("access_token", process.env.META_ACCESS_TOKEN);

  const response = await fetchWithTimeout(url);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message || "Meta request failed.");
  }

  const row = body?.data?.[0] || {};
  return {
    date,
    adSpend: Number(row.spend || 0),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
  };
}

async function upsertDailyEntry(insights) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/daily_entries?on_conflict=date`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      date: insights.date,
      ad_spend: insights.adSpend,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || "Supabase request failed.");
  }

  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }

    checkEnv();
    checkSecret(req);

    const date = getDate(req);
    const insights = await getMetaInsights(date);
    const saved = await upsertDailyEntry(insights);

    return sendJson(res, 200, {
      ok: true,
      date,
      adAccountId,
      meta: insights,
      saved,
    });
  } catch (error) {
    const isAbort = error.name === "AbortError";
    return sendJson(res, isAbort ? 504 : 500, {
      ok: false,
      error: isAbort ? "Sync request timed out." : error.message,
    });
  }
}
