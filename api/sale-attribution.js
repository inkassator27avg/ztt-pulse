const requiredEnv = ["SUPABASE_URL", "SUPABASE_KEY"];

function sendJson(res, status, response) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response, null, 2));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function todayYekaterinburg() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function checkEnv() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}

function checkSecret(req) {
  const secret = process.env.SALES_BOT_SECRET || process.env.SYNC_SECRET;
  if (!secret) throw new Error("Sales bot secret is not configured.");

  const querySecret = Array.isArray(req.query?.secret) ? req.query.secret[0] : req.query?.secret;
  const headerSecret = req.headers["x-sales-secret"] || req.headers["x-sync-secret"];
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (querySecret !== secret && headerSecret !== secret && bearer !== secret) {
    throw new Error("Wrong sales bot secret.");
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
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

function cleanHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[@_\-\s./\\:;()[\]{}]+/g, "");
}

function valueByAliases(row, aliases) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [cleanHeader(key), value]));
  for (const alias of aliases) {
    const value = normalized[cleanHeader(alias)];
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "")
    .toLowerCase();
}

function normalizeId(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function parseDateValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const ru = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (ru) {
    const day = ru[1].padStart(2, "0");
    const month = ru[2].padStart(2, "0");
    const year = ru[3].length === 2 ? `20${ru[3]}` : ru[3];
    return `${year}-${month}-${day}`;
  }

  const serial = Number(raw.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + serial);
    return isoDate(date);
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return isoDate(date);
  return null;
}

function diffDays(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  const days = Math.floor((to - from) / 86400000);
  return Number.isFinite(days) ? Math.max(days, 0) : null;
}

function membersCsvUrl() {
  if (process.env.TG_MEMBERS_CSV_URL) return process.env.TG_MEMBERS_CSV_URL;
  if (!process.env.TG_MEMBERS_SHEET_ID) return "";
  const gid = process.env.TG_MEMBERS_SHEET_GID || "0";
  return `https://docs.google.com/spreadsheets/d/${process.env.TG_MEMBERS_SHEET_ID}/export?format=csv&gid=${gid}`;
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

async function loadMembers() {
  const url = membersCsvUrl();
  if (!url) return [];

  const response = await fetchWithTimeout(url);
  const text = await response.text();
  if (!response.ok) throw new Error(text || "Telegram members sheet request failed.");
  return rowsToObjects(parseCsv(text));
}

function saleInput(payload) {
  const rawText = String(payload.raw_text || payload.text || "").trim();
  const textUser = rawText.match(/@[\w\d_]{3,}/)?.[0] || "";
  const textId = rawText.match(/\b\d{5,}\b/)?.[0] || "";
  const explicitUser = payload.user || payload.username || payload.telegram_username || payload.telegram_user_id || payload.tg_id || "";
  const lookupKey = String(explicitUser || textUser || textId).trim();

  if (!lookupKey) {
    throw new Error("Send telegram username or user id.");
  }

  const amount = payload.amount === undefined ? null : Number(payload.amount);
  const saleDate = payload.sale_date || payload.date || todayYekaterinburg();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) throw new Error("Sale date must be YYYY-MM-DD.");

  return {
    lookupKey,
    username: normalizeUsername(payload.username || payload.telegram_username || textUser || explicitUser),
    userId: normalizeId(payload.telegram_user_id || payload.tg_id || textId || explicitUser),
    amount: Number.isFinite(amount) ? amount : null,
    tariff: payload.tariff ? String(payload.tariff) : "",
    saleDate,
    rawText,
    sourceMessageId: payload.source_message_id || payload.message_id || payload.sale_id || null,
  };
}

function memberInfo(row) {
  const userId = normalizeId(valueByAliases(row, [
    "telegram_user_id", "telegram id", "tg id", "user id", "userid", "id", "айди", "тг айди",
  ]));
  const username = normalizeUsername(valueByAliases(row, [
    "username", "telegram_username", "telegram username", "user", "tag", "тег", "юзер", "ник",
  ]));
  const joinedRaw = valueByAliases(row, [
    "joined_at", "join_date", "joined date", "date joined", "subscribed_at", "subscription date",
    "дата подписки", "дата входа", "дата вступления", "подписался", "добавлен", "date",
  ]);
  const daysRaw = valueByAliases(row, [
    "days", "days_in_channel", "days subscribed", "days in tg", "сколько дней", "дней в канале",
    "сколько находится", "дней подписан", "время в канале",
  ]);

  return {
    userId,
    username,
    joinedAt: parseDateValue(joinedRaw),
    daysInChannel: Number(String(daysRaw).replace(",", ".")),
  };
}

function findMember(rows, input) {
  const targetId = normalizeId(input.userId || input.lookupKey);
  const targetUsername = normalizeUsername(input.username || input.lookupKey);

  for (const row of rows) {
    const info = memberInfo(row);
    if (targetId && info.userId && targetId === info.userId) return { row, info };
    if (targetUsername && info.username && targetUsername === info.username) return { row, info };
  }

  return null;
}

function classifyTariff(input) {
  const text = `${input.tariff} ${input.amount || ""}`.toLowerCase();
  if (text.includes("29")) return { column: "sales_29", tariff: input.tariff || "29" };
  if (text.includes("49")) return { column: "sales_49", tariff: input.tariff || "49" };
  if (text.includes("99")) return { column: "sales_99", tariff: input.tariff || "99" };
  return { column: null, tariff: input.tariff || "" };
}

async function supabaseRequest(path, options = {}) {
  const response = await fetchWithTimeout(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();

  if (!response.ok) throw new Error(text || `Supabase error ${response.status}`);
  return text ? JSON.parse(text) : null;
}

async function insertAttribution(input, match) {
  const info = match?.info || {};
  const joinedAt = info.joinedAt || null;
  const daysToPurchase = joinedAt
    ? diffDays(joinedAt, input.saleDate)
    : (Number.isFinite(info.daysInChannel) ? Math.max(Math.round(info.daysInChannel), 0) : null);
  const tariff = classifyTariff(input).tariff;

  const rows = await supabaseRequest("sales_attribution", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      sale_date: input.saleDate,
      source_message_id: input.sourceMessageId,
      lookup_key: input.lookupKey,
      telegram_user_id: info.userId || input.userId || null,
      telegram_username: info.username || input.username || null,
      tariff,
      amount: input.amount,
      joined_at: joinedAt,
      days_to_purchase: daysToPurchase,
      raw_text: input.rawText,
      member_payload: match?.row || {},
      source: "telegram_bot",
    }),
  });

  return rows?.[0] || null;
}

async function selectDailyEntry(date) {
  const rows = await supabaseRequest(`daily_entries?date=eq.${date}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function incrementDailySales(input) {
  const { column } = classifyTariff(input);
  if (!column) return { updated: false, reason: "Unknown tariff." };

  const existing = await selectDailyEntry(input.saleDate);
  const row = {
    date: input.saleDate,
    ad_spend: Number(existing?.ad_spend || 0),
    leads: Number(existing?.leads || 0),
    telegram: Number(existing?.telegram || 0),
    telegram_joined: Number(existing?.telegram_joined || 0),
    telegram_left: Number(existing?.telegram_left || 0),
    telegram_growth: Number(existing?.telegram_growth || 0),
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
  };
  row[column] += 1;

  const rows = await supabaseRequest("daily_entries?on_conflict=date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });

  return { updated: true, column, row: rows?.[0] || null };
}

function average(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

async function getSummary() {
  const rows = await supabaseRequest("sales_attribution?select=*&order=sale_date.desc,created_at.desc");
  const matchedDays = (rows || [])
    .map((row) => Number(row.days_to_purchase))
    .filter((value) => Number.isFinite(value));

  return {
    salesCount: rows.length,
    matchedSalesCount: matchedDays.length,
    averageDaysToPurchase: average(matchedDays),
    medianDaysToPurchase: median(matchedDays),
    recent: rows.slice(0, 20),
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }

    checkEnv();
    checkSecret(req);

    if (req.method === "GET") {
      const summary = await getSummary();
      return sendJson(res, 200, { ok: true, ...summary });
    }

    const payload = await readBody(req);
    const input = saleInput(payload);
    const members = await loadMembers();
    const match = findMember(members, input);
    const sale = await insertAttribution(input, match);
    const daily = payload.increment_daily === false ? { updated: false, reason: "Skipped by request." } : await incrementDailySales(input);
    const summary = await getSummary();

    return sendJson(res, 200, {
      ok: true,
      matched: Boolean(match),
      sale,
      daily,
      averageDaysToPurchase: summary.averageDaysToPurchase,
      medianDaysToPurchase: summary.medianDaysToPurchase,
      matchedSalesCount: summary.matchedSalesCount,
    });
  } catch (error) {
    const status = error.name === "AbortError" ? 504 : 500;
    return sendJson(res, status, {
      ok: false,
      error: error.name === "AbortError" ? "Sale attribution request timed out." : error.message,
      source: "sale-attribution",
    });
  }
}
