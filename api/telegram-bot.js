const requiredEnv = ["SUPABASE_URL", "SUPABASE_KEY", "TELEGRAM_BOT_TOKEN"];
const defaultOpenAiModel = "gpt-4.1-mini";

function sendJson(res, status, response) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response, null, 2));
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

async function telegram(method, payload, timeoutMs = 15000) {
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, timeoutMs);
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.ok === false) {
    throw new Error(body?.description || `Telegram ${method} failed.`);
  }

  return body;
}

async function sendTelegram(chatId, text, replyToMessageId = null) {
  const chunks = splitTelegramMessage(text);
  let result = null;

  for (const chunk of chunks) {
    result = await telegram("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    });
  }

  return result;
}

async function sendTyping(chatId) {
  try {
    await telegram("sendChatAction", { chat_id: chatId, action: "typing" }, 5000);
  } catch {
    // Typing indicator is cosmetic; ignore failures.
  }
}

function splitTelegramMessage(text) {
  const maxLength = 3900;
  if (String(text).length <= maxLength) return [String(text)];

  const chunks = [];
  let rest = String(text);
  while (rest.length > maxLength) {
    const cut = rest.lastIndexOf("\n", maxLength);
    const index = cut > 1000 ? cut : maxLength;
    chunks.push(rest.slice(0, index));
    rest = rest.slice(index).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getOpenAiKey() {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env.OPENAI_TOKEN ||
    process.env.OPENAI_API_TOKEN ||
    ""
  );
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

async function getEntries(limit = 30, order = "desc") {
  return supabaseRequest(`daily_entries?select=*&order=date.${order}&limit=${limit}`);
}

async function getAllEntries() {
  return supabaseRequest("daily_entries?select=*&order=date.asc");
}

function summarizeRows(rows = []) {
  return rows.reduce((acc, row) => {
    acc.revenue += revenue(row);
    acc.adSpend += Number(row.ad_spend || 0);
    acc.sales += sales(row);
    acc.igViews += Number(row.ig_views || 0);
    acc.ttViews += Number(row.tt_views || 0);
    acc.tgGrowth += Number(row.telegram_growth ?? row.telegram_joined ?? 0);
    acc.tgJoined += Number(row.telegram_joined || 0);
    acc.tgLeft += Number(row.telegram_left || 0);
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
    tgJoined: 0,
    tgLeft: 0,
    reels: 0,
    tiktoks: 0,
  });
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
  const totals = summarizeRows(rows || []);

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
  const matchedText = result.matched ? "нашел в базе" : "не нашел в базе";
  const daysText = Number.isFinite(Number(days)) ? `${days} дн.` : "не посчиталось";
  const averageText = Number.isFinite(Number(result.averageDaysToPurchase))
    ? `\nСреднее до покупки сейчас: <b>${result.averageDaysToPurchase} дн.</b>`
    : "";

  return [
    "<b>Готово, продажу занес.</b>",
    `${escapeHtml(username)}: ${matchedText}`,
    `Время в TG до покупки: <b>${daysText}</b>`,
    result.daily?.updated ? `Дневная продажа обновлена: ${result.daily.column}` : `Дневная продажа не обновлена: ${result.daily?.reason || "тариф не понял"}`,
    averageText,
  ].filter(Boolean).join("\n");
}

function helpMessage(chatId) {
  return [
    "<b>Карина, ЗТТ-бот</b>",
    "",
    "Я умею отвечать как ассистент и доставать статистику.",
    "",
    "<b>Команды:</b>",
    "/today — статистика за сегодня",
    "/yesterday — статистика за вчера",
    "/all — статистика за все время",
    "",
    "<b>Продажу кидай так:</b>",
    "купил @username 29",
    "купил 123456789 49",
    "",
    "Обычным текстом можешь спрашивать что угодно по ЗТТ, рекламе, контенту и продажам.",
    "",
    `ID этого чата: <code>${chatId}</code>`,
  ].join("\n");
}

function karinaInstructions() {
  return [
    "Ты Карина — Telegram-ассистент Даниила по проекту ЗТТ.",
    "ЗТТ — закрытая тусовка трафагонов, подписочный продукт.",
    "Отвечай по-русски, на ты, коротко и по делу.",
    "Стиль живой, спокойный, без канцелярита. Можно быть прямой, но не груби без причины.",
    "Главная задача: помогать Даниилу понимать статистику, продажи, рекламу, контент и следующие действия.",
    "Если данных не хватает, честно скажи, чего не хватает.",
    "Не выдумывай цифры: используй только контекст из дашборда или явно говори, что это предположение.",
    "Если видишь проблему в данных, назови ее и предложи простой следующий шаг.",
  ].join("\n");
}

async function buildAssistantContext() {
  const rows = await getEntries(30, "desc").catch(() => []);
  const latest = rows?.[0] || null;
  const yesterday = await getDailyEntry(dateInYekaterinburg(-1)).catch(() => null);
  const totals7 = summarizeRows((rows || []).slice(0, 7));
  const totals30 = summarizeRows(rows || []);
  const attribution = await getAttributionSummary().catch(() => null);

  return [
    "Контекст дашборда ЗТТ:",
    `Сегодня по Екатеринбургу: ${dateInYekaterinburg()}`,
    latest ? `Последняя строка: ${latest.date}, выручка ${money(revenue(latest))}, реклама ${money(latest.ad_spend)}, IG views ${number(latest.ig_views)}, TG прирост +${number(latest.telegram_growth ?? latest.telegram_joined ?? 0)}, продажи ${number(sales(latest))}.` : "Последней строки в базе нет.",
    yesterday ? `Вчера: ${yesterday.date}, выручка ${money(revenue(yesterday))}, реклама ${money(yesterday.ad_spend)}, IG views ${number(yesterday.ig_views)}, TG прирост +${number(yesterday.telegram_growth ?? yesterday.telegram_joined ?? 0)}, продажи ${number(sales(yesterday))}.` : "Строки за вчера нет.",
    `За 7 последних строк: выручка ${money(totals7.revenue)}, реклама ${money(totals7.adSpend)}, чистые ${money(totals7.revenue - totals7.adSpend)}, Reels ${number(totals7.reels)}, TikTok ${number(totals7.tiktoks)}, IG views ${number(totals7.igViews)}, TT views ${number(totals7.ttViews)}, TG прирост +${number(totals7.tgGrowth)}, продажи ${number(totals7.sales)}.`,
    `За 30 последних строк: выручка ${money(totals30.revenue)}, реклама ${money(totals30.adSpend)}, чистые ${money(totals30.revenue - totals30.adSpend)}, Reels ${number(totals30.reels)}, TikTok ${number(totals30.tiktoks)}, IG views ${number(totals30.igViews)}, TT views ${number(totals30.ttViews)}, TG прирост +${number(totals30.tgGrowth)}, продажи ${number(totals30.sales)}.`,
    attribution?.average !== null && attribution?.average !== undefined
      ? `Атрибуция продаж: ${number(attribution.salesCount)} продаж, найдено в TG-базе ${number(attribution.matchedSalesCount)}, среднее время до покупки ${attribution.average} дн.`
      : "Атрибуция продаж пока без среднего времени до покупки.",
  ].join("\n");
}

function extractOpenAiText(body) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) return body.output_text.trim();

  const chunks = [];
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
      if (typeof content?.output_text === "string") chunks.push(content.output_text);
    }
  }

  return chunks.join("\n").trim();
}

async function askKarina(text) {
  const openAiKey = getOpenAiKey();

  if (!openAiKey) {
    return [
      "<b>AI-режим еще не включен.</b>",
      "В Vercel нужно добавить переменную <code>OPENAI_API_KEY</code>.",
      "Статистика и запись продаж при этом уже работают.",
    ].join("\n");
  }

  const context = await buildAssistantContext();
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || defaultOpenAiModel,
      instructions: karinaInstructions(),
      input: `${context}\n\nСообщение Даниила:\n${String(text || "").slice(0, 3000)}`,
      max_output_tokens: 900,
    }),
  }, 30000);

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `OpenAI error ${response.status}`;
    return `<b>AI сейчас не ответил.</b>\n${escapeHtml(message)}`;
  }

  const answer = extractOpenAiText(body);
  if (!answer) return "AI ответил пусто. Попробуй переформулировать.";

  return escapeHtml(answer);
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

  await sendTyping(chatId);
  return askKarina(text);
}

function hasValidSetupSecret(req) {
  const querySecret = Array.isArray(req.query?.secret) ? req.query.secret[0] : req.query?.secret;
  const headerSecret = req.headers["x-sync-secret"];
  return Boolean(process.env.SYNC_SECRET && (querySecret === process.env.SYNC_SECRET || headerSecret === process.env.SYNC_SECRET));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 200, {
        ok: true,
        message: "Telegram bot endpoint is ready.",
        ...(hasValidSetupSecret(req)
          ? {
              telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
              openAiConfigured: Boolean(getOpenAiKey()),
              model: process.env.OPENAI_MODEL || defaultOpenAiModel,
            }
          : {}),
      });
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
