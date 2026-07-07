const metaVersion = "v25.0";
const instagramAccountId = "17841461871497307";

const requiredEnv = ["META_ACCESS_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"];

function sendJson(res, status, response) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response, null, 2));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function nextDate(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
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

async function graphRequest(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${metaVersion}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  url.searchParams.set("access_token", process.env.META_ACCESS_TOKEN);

  const response = await fetchWithTimeout(url);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message || "Instagram request failed.");
  }

  return body;
}

function localDay(timestamp) {
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

async function getInstagramProfile() {
  return graphRequest(instagramAccountId, {
    fields: "username,followers_count,media_count",
  });
}

async function getRecentMedia() {
