const tgtrackVersion = "2.20";

const requiredEnv = ["TGTRACK_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];

function sendJson(res, status, response) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `TgTrack request failed: ${response.status}`);
  }

  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quote && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quote = !quote;
      continue;
    }

    if (char === "," && !quote) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quote) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function dayNumToDate(dayNum) {
  const date = new Date(Date.UTC(1970, 0, 1));
  date.setUTCDate(date.getUTCDate() + Number(dayNum));
  return isoDate(date);
}

function tgtrackUrl(report) {
  const url = new URL(`https://report.tgtrack.ru/pro/${report}.php`);
  url.searchParams.set("ver", tgtrackVersion);
  url.searchParams.set("platform", "google");
  url.searchParams.set("apiKey", process.env.TGTRACK_API_KEY);
  url.searchParams.set("refresh", "2");
  return url.toString();
}

async function getTelegramActivity(date) {
  const text = await fetchText(tgtrackUrl("join_left_by_date"));
  const rows = rowsToObjects(parseCsv(text));
  const totals = rows.reduce((acc, row) => {
    if (dayNumToDate(row.dayNum) !== date) return acc;
    acc.joined += Number(row.joinCount || 0);
    acc.left += Number(row.leftCount || 0);
    return acc;
  }, { joined: 0, left: 0 });

  return {
    joined: totals.joined,
    left: totals.left,
    growth: totals.joined - totals.left,
  };
}

async function getTelegramMembersCount() {
  const text = await fetchText(tgtrackUrl("chatMembers"));
  const rows = rowsToObjects(parseCsv(text));
  return rows.filter((row) => row.status === "1").length;
}

async function selectExistingDailyEntry(date) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/daily_entries?date=eq.${date}&select=*`;
  const response = await fetchWithTimeout(url, {
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || "Supabase select failed.");
  }

  const rows = text ? JSON.parse(text) : [];
  return rows[0] || null;
}

async function upsertDailyEntry(date, telegram) {
  const existing = await selectExistingDailyEntry(date);
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
      date,
      ad_spend: Number(existing?.ad_spend || 0),
      leads: Number(existing?.leads || 0),
      telegram: telegram.total,
      telegram_joined: telegram.joined,
      telegram_left: telegram.left,
      telegram_growth: telegram.growth,
      instagram: Number(existing?.instagram || 0),
      tiktok_followers: Number(existing?.tiktok_followers || 0),
      reels: Number(existing?.reels || 0),
      tiktoks: Number(existing?.tiktoks || 0),
      ig_views: Number(existing?.ig_views || 0),
      tt_views: Number(existing?.tt_views || 0),
      sales_29: Number(existing?.sales_29 || 0),
      sales_49: Number(existing?.sales_49 || 0),
      sales_99: Number(existing?.sales_99 || 0),
      renewals_29: Number(existing?.renewals_29 || 0),
      renewals_49: Number(existing?.renewals_49 || 0),
      renewals_99: Number(existing?.renewals_99 || 0),
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || "Supabase upsert failed.");
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
    const [activity, total] = await Promise.all([
      getTelegramActivity(date),
      getTelegramMembersCount(),
    ]);
    const telegram = { date, total, ...activity };
    const saved = await upsertDailyEntry(date, telegram);

    return sendJson(res, 200, {
      ok: true,
      date,
      telegram,
      saved,
    });
  } catch (error) {
    const isAbort = error.name === "AbortError";
    return sendJson(res, isAbort ? 504 : 500, {
      ok: false,
      error: isAbort ? "Sync request timed out." : error.message,
      source: "sync-telegram",
    });
  }
}
