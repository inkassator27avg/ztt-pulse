const requiredEnv = ["SUPABASE_URL", "SUPABASE_KEY", "TELEGRAM_BOT_TOKEN"];

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

function getReportChatId() {
  return process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_ALLOWED_CHAT_ID || "";
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

async function getEntry(date) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/daily_entries`);
  url.searchParams.set("select", "*");
  url.searchParams.set("date", `eq.${date}`);
  url.searchParams.set("limit", "1");

  const response = await fetchWithTimeout(url, {
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || "Supabase request failed.");
  }

  const rows = text ? JSON.parse(text) : [];
  return rows[0] || null;
}

function money(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

function number(value) {
  return Math.round(Number(value || 0)).toLocaleString("ru-RU");
}

function revenue(row) {
  return (
    Number(row.sales_29 || 0) * 29 +
    Number(row.sales_49 || 0) * 49 +
    Number(row.sales_99 || 0) * 99 +
    Number(row.renewals_29 || 0) * 29 +
    Number(row.renewals_49 || 0) * 49 +
    Number(row.renewals_99 || 0) * 99
  );
}

function sales(row) {
  return (
    Number(row.sales_29 || 0) +
    Number(row.sales_49 || 0) +
    Number(row.sales_99 || 0) +
    Number(row.renewals_29 || 0) +
    Number(row.renewals_49 || 0) +
    Number(row.renewals_99 || 0)
  );
}

function formatDate(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function buildMessage(row) {
  const totalRevenue = revenue(row);
  const profit = totalRevenue - Number(row.ad_spend || 0);
  const tgGrowth = row.telegram_growth ?? row.telegram_joined ?? 0;

  return [
    `ЗТТ: статистика за ${formatDate(row.date)}`,
    "",
    `Выручка: ${money(totalRevenue)}`,
    `Реклама: ${money(row.ad_spend)}`,
    `Чистые: ${money(profit)}`,
    "",
    `Reels: ${number(row.reels)}`,
    `IG views: ${number(row.ig_views)}`,
    `Instagram подписчики: ${number(row.instagram)}`,
    "",
    `TikTok: ${number(row.tiktoks)}`,
    `TT views: ${number(row.tt_views)}`,
    `TG прирост: +${number(tgGrowth)}`,
    "",
    `Продажи ЗТТ: ${number(sales(row))}`,
  ].join("\n");
}

async function sendTelegram(message) {
  const chatId = getReportChatId();
  if (!chatId) {
    throw new Error("TELEGRAM_CHAT_ID or TELEGRAM_ALLOWED_CHAT_ID is not configured.");
  }

  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.ok === false) {
    throw new Error(body?.description || "Telegram request failed.");
  }

  return body;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }

    checkEnv();
    checkSecret(req);

    const date = getDate(req);
    const row = await getEntry(date);
    if (!row) {
      return sendJson(res, 404, { ok: false, error: `No daily entry for ${date}.` });
    }

    const message = buildMessage(row);
    const telegram = await sendTelegram(message);

    return sendJson(res, 200, {
      ok: true,
      date,
      sent: true,
      message,
      telegramMessageId: telegram?.result?.message_id,
    });
  } catch (error) {
    const isAbort = error.name === "AbortError";
    return sendJson(res, isAbort ? 504 : 500, {
      ok: false,
      error: isAbort ? "Daily report request timed out." : error.message,
      source: "send-daily-report",
    });
  }
}
