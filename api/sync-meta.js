const metaVersion = "v20.0";
const adAccountId = "act_1038880678191397";
const defaultPageId = "104558388753626";
const defaultInstagramAccountId = "17841461871497307";

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
  if (!process.env.SYNC_SECRET) {
    throw new Error("Sync secret is not configured.");
  }
  if (req.headers["x-vercel-cron"]) return;

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

function normalizeId(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function moneyNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function addMetric(total, row) {
  total.adSpend = moneyNumber(total.adSpend + Number(row.spend || 0));
  total.impressions += Number(row.impressions || 0);
  total.clicks += Number(row.clicks || 0);
}

async function fetchMetaJson(url, options = {}, timeoutMs = 12000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.error?.message || "Meta request failed.");
  }

  return body;
}

async function getAdInsights(date) {
  const rows = [];
  let nextUrl = new URL(`https://graph.facebook.com/${metaVersion}/${adAccountId}/insights`);
  nextUrl.searchParams.set("fields", "ad_id,ad_name,spend,impressions,clicks");
  nextUrl.searchParams.set("level", "ad");
  nextUrl.searchParams.set("time_range", JSON.stringify({ since: date, until: date }));
  nextUrl.searchParams.set("limit", "500");
  nextUrl.searchParams.set("access_token", process.env.META_ACCESS_TOKEN);

  while (nextUrl) {
    const body = await fetchMetaJson(nextUrl);
    rows.push(...(body?.data || []));
    nextUrl = body?.paging?.next ? new URL(body.paging.next) : null;
  }

  return rows.filter((row) => Number(row.spend || 0) > 0);
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function getAdCreatives(adIds) {
  const creatives = new Map();
  const uniqueIds = [...new Set(adIds.filter(Boolean))];

  for (const group of chunks(uniqueIds, 50)) {
    const body = new URLSearchParams();
    body.set("access_token", process.env.META_ACCESS_TOKEN);
    body.set("batch", JSON.stringify(group.map((adId) => ({
      method: "GET",
      relative_url: `${adId}?fields=creative%7Bobject_story_spec%7D`,
    }))));

    const batch = await fetchMetaJson(`https://graph.facebook.com/${metaVersion}/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, 20000);

    group.forEach((adId, index) => {
      const item = batch?.[index];
      if (!item || item.code < 200 || item.code >= 300) {
        creatives.set(adId, null);
        return;
      }

      const parsed = JSON.parse(item.body || "{}");
      creatives.set(adId, parsed.creative || null);
    });
  }

  return creatives;
}

function hasIdentityValue(value, keyNames, targetId) {
  if (!targetId || value === null || value === undefined) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasIdentityValue(item, keyNames, targetId));
  }

  if (typeof value !== "object") return false;

  return Object.entries(value).some(([key, nestedValue]) => {
    const cleanKey = key.toLowerCase();
    if (keyNames.has(cleanKey) && normalizeId(nestedValue) === targetId) return true;
    return hasIdentityValue(nestedValue, keyNames, targetId);
  });
}

function creativeMatchesTarget(creative, target) {
  if (!creative) return false;

  const pageKeys = new Set(["page_id"]);
  const instagramKeys = new Set(["instagram_actor_id", "instagram_user_id", "instagram_id", "ig_user_id"]);

  return (
    hasIdentityValue(creative.object_story_spec || creative, pageKeys, target.pageId) ||
    hasIdentityValue(creative.object_story_spec || creative, instagramKeys, target.instagramAccountId)
  );
}

async function getMetaInsights(date) {
  const target = {
    pageId: normalizeId(process.env.META_PAGE_ID || defaultPageId),
    instagramAccountId: normalizeId(process.env.INSTAGRAM_ACCOUNT_ID || defaultInstagramAccountId),
  };
  const rows = await getAdInsights(date);
  const creatives = await getAdCreatives(rows.map((row) => row.ad_id));
  const totals = { adSpend: 0, impressions: 0, clicks: 0 };
  const matchedAds = [];
  const excludedAds = [];

  for (const row of rows) {
    const creative = creatives.get(row.ad_id);
    const matched = creativeMatchesTarget(creative, target);
    const ad = {
      adId: row.ad_id,
      adName: row.ad_name,
      spend: moneyNumber(row.spend),
    };

    if (matched) {
      addMetric(totals, row);
      matchedAds.push(ad);
    } else {
      excludedAds.push(ad);
    }
  }

  return {
    date,
    adSpend: totals.adSpend,
    impressions: totals.impressions,
    clicks: totals.clicks,
    filter: {
      mode: "creative_identity",
      pageId: target.pageId,
      instagramAccountId: target.instagramAccountId,
      totalAds: rows.length,
      matchedAds: matchedAds.length,
      excludedAds: excludedAds.length,
      matchedAdSpend: totals.adSpend,
    },
    matchedAds,
    excludedAds,
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
