const requiredEnv = ["SUPABASE_URL", "SUPABASE_KEY", "TELEGRAM_BOT_TOKEN"];

function sendJson(res, status, response) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response, null, 2));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateInYekaterinburg(offsetDays = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function checkEnv() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}

function checkWebhookSecret(req) {
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) return;
  if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error("Wrong Telegram webhook secret.");
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

async function sendTelegram(chatId, text, replyToMessageId = null) {
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.ok === false) {
    throw new Error(body?.description || "Telegram sendMessage failed.");
  }

  return body;
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

async function getDailyEntry(date) {
  const rows = await supabaseRequest(`daily_entries?date=eq.${date}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function getAllEntries() {
  return supabaseRequest("daily_entries?select=*&order=date.asc");
}

function buildDailyStats(row) {
  if (!row) return "За эту дату строки пока нет.";

  const totalRevenue = revenue(row);
  const profit = totalRevenue - Number(row.ad_spend || 0);
  const tgGrowth = Number(row.telegram_growth ?? row.telegram_joined ?? 0);

  return [
    `<b>ЗТТ: статистика за ${formatDate(row.date)}</b>`,
    "",
    `Выручка: <b>${money(totalRevenue)}</b>`,
    `Реклама: ${money(row.ad_spend)}`,
    `Чистые: <b>${money(profit)}</b>`,
    "",
    `Reels: ${number(row.reels)}`,
    `IG views: ${number(row.ig_views)}`,
    `Instagram подписчики: ${number(row.instagram)}`,
    "",
    `TikTok: ${number(row.tiktoks)}`,
    `TT views: ${number(row.tt_views)}`,
    `TG прирост: +${number(tgGrowth)}`,
    "",
    `Продажи ЗТТ: <b>${number(sales(row))}</b>`,
  ].join("\n");
}

async function getAttributionSummary() {
  const rows = await supabaseRequest("sales_attribution?select=days_to_purchase&order=sale_date.desc");
  const days = (rows || [])
    .map((row) => Number(row.days_to_purchase))
    .filter((value) => Number.isFinite(value));

  if (!days.length) {
    return {
      salesCount: rows?.length || 0,
      matchedSalesCount: 0,
      average: null,
    };
  }

  return {
    salesCount: rows.length,
    matchedSalesCount: days.length,
    average: Math.round((days.reduce((sum, value) => sum + value, 0) / days.length) * 10) / 10,
  };
}

async function buildAllTimeStats() {
  const rows = await getAllEntries();
  const summary = await getAttributionSummary().catch(() => null);

  const totals = (rows || []).reduce((acc, row) => {
    acc.revenue += revenue(row);
    acc.adSpend += Number(row.ad_spend || 0);
    acc.sales += sales(row);
    acc.igViews += Number(row.ig_views || 0);
    acc.ttViews += Number(row.tt_views || 0);
    acc.tgGrowth += Number(row.telegram_growth ?? row.telegram_joined ?? 0);
    acc.reels += Number(row.reels || 0);
    acc.tiktoks += Number(row.tiktoks || 0);
    return acc;
  }, {
    revenue: 0,
    adSpend: 0,
    sales: 0,
    igViews: 0,
    ttViews: 0,
    tgGrowth: 0,
    reels: 0,
    tiktoks: 0,
  });

  const lines = [
    "<b>ЗТТ: статистика за все время</b>",
    "",
    `Выручка: <b>${money(totals.revenue)}</b>`,
    `Реклама: ${money(totals.adSpend)}`,
    `Чистые: <b>${money(totals.revenue - totals.adSpend)}</b>`,
    "",
    `Reels: ${number(totals.reels)}`,
    `TikTok: ${number(totals.tiktoks)}`,
    `IG views: ${number(totals.igViews)}`,
    `TT views: ${number(totals.ttViews)}`,
    `TG прирост: +${number(totals.tgGrowth)}`,
    "",
    `Продажи ЗТТ: <b>${number(totals.sales)}</b>`,
  ];

  if (summary?.average !== null && summary?.average !== undefined) {
    lines.push("", `Среднее время до покупки: <b>${summary.average} дн.</b>`);
  }

  return lines.join("\n");
}

function parseSaleText(text) {
  const normalized = String(text || "").trim();
  const username = normalized.match(/@[\w\d_]{3,}/)?.[0] || "";
  const id = normalized.match(/\b\d{5,}\b/)?.[0] || "";
  const tariff = normalized.match(/\b(29|49|99)\b/)?.[1] || "";

  const hasPurchaseWord = /(купил|купила|покупка|продажа|оплатил|оплатила|продал|залетел|зашел|зашёл)/i.test(normalized);
  if (!hasPurchaseWord || (!username && !id)) return null;

  return {
    user: username || id,
    tariff,
    amount: tariff ? Number(tariff) : null,
    sale_date: dateInYekaterinburg(),
    raw_text: normalized,
  };
}

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

async function sendSaleToAttribution(req, sale, messageId) {
  const secret = process.env.SALES_BOT_SECRET || process.env.SYNC_SECRET;
  if (!secret) throw new Error("SALES_BOT_SECRET or SYNC_SECRET is not configured.");

  const url = new URL(`${baseUrl(req)}/api/sale-attribution`);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sales-secret": secret,
    },
    body: JSON.stringify({
      ...sale,
      source_message_id: messageId ? String(messageId) : undefined,
    }),
  }, 25000);
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.ok === false) {
    throw new Error(body?.error || "Sale attribution failed.");
  }

  return body;
}

function buildSaleReply(result) {
  const sale = result.sale || {};
  const days = sale.days_to_purchase;
  const username = sale.telegram_username ? `@${sale.telegram_username}` : sale.lookup_key;
  const matchedText = result.matched ? "нашёл в базе" : "не нашёл в базе";
  const daysText = Number.isFinite(Number(days)) ? `${days} дн.` : "не посчиталось";
  const averageText = Number.isFinite(Number(result.averageDaysToPurchase))
    ? `\nСреднее до покупки сейчас: <b>${result.averageDaysToPurchase} дн.</b>`
    : "";

  return [
    `<b>Готово, продажу занёс.</b>`,
    `${username}: ${matchedText}`,
    `Время в TG до покупки: <b>${daysText}</b>`,
    result.daily?.updated ? `Дневная продажа обновлена: ${result.daily.column}` : `Дневная продажа не обновлена: ${result.daily?.reason || "тариф не понял"}`,
    averageText,
  ].filter(Boolean).join("\n");
}

function helpMessage(chatId) {
  return [
    "<b>Команды ЗТТ-бота</b>",
    "",
    "статистика за сегодня",
    "статистика за вчера",
    "статистика за все время",
    "",
    "Продажу кидай так:",
    "купил @username 29",
    "купил 123456789 49",
    "",
    `ID этого чата: <code>${chatId}</code>`,
  ].join("\n");
}

async function handleText(req, chatId, messageId, text) {
  const lower = String(text || "").trim().toLowerCase().replace(/ё/g, "е");

  if (!lower || lower === "/start" || lower === "/help" || lower === "помощь") {
    return helpMessage(chatId);
  }

  if (lower === "/today" || lower.includes("статистика за сегодня")) {
    return buildDailyStats(await getDailyEntry(dateInYekaterinburg()));
  }

  if (lower === "/yesterday" || lower.includes("статистика за вчера")) {
    return buildDailyStats(await getDailyEntry(dateInYekaterinburg(-1)));
  }

  if (lower === "/all" || lower.includes("статистика за все время") || lower.includes("статистика за всё время")) {
    return buildAllTimeStats();
  }

  const sale = parseSaleText(text);
  if (sale) {
    const result = await sendSaleToAttribution(req, sale, messageId);
    return buildSaleReply(result);
  }

  return "Не понял сообщение. Напиши /help или кинь продажу в формате: купил @username 29";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 200, { ok: true, message: "Telegram bot endpoint is ready." });
    }

    checkEnv();
    checkWebhookSecret(req);

    const update = await readBody(req);
    const message = update.message || update.edited_message;
    if (!message?.chat?.id) return sendJson(res, 200, { ok: true, ignored: true });

    const chatId = String(message.chat.id);
    const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
    if (allowedChatId && chatId !== String(allowedChatId)) {
      return sendJson(res, 200, { ok: true, ignored: true, reason: "chat_not_allowed" });
    }

    const text = message.text || message.caption || "";
    const reply = await handleText(req, chatId, message.message_id, text);
    await sendTelegram(chatId, reply, message.message_id);

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 200, {
      ok: false,
      error: error.message,
      source: "telegram-bot",
    });
  }
}
