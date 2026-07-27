import crypto from "node:crypto";

const MAX_LOOKUPS = 100;
const PUBLIC_CHANNEL = "@danyaromanov1";
const PUBLIC_CHANNEL_TITLE = "даниил романов";
const TGTRACK_VERSION = "2.20";

function sendJson(res, status, body) {
  res.status(status);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function checkSecret(req) {
  const expected = process.env.SYNC_SECRET;
  const supplied = req.headers["x-sync-secret"];
  if (!expected || !safeEqual(supplied, expected)) {
    const error = new Error("unauthorized");
    error.status = 401;
    throw error;
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error("request_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  const headers = (rows[0] || []).map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function cleanHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[@_\-\s./\\:;()[\]{}]+/g, "");
}

function valueByAliases(row, aliases) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [cleanHeader(key), value]));
  for (const alias of aliases) {
    const value = normalized[cleanHeader(alias)];
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function normalizeId(value) {
  const raw = String(value || "").trim();
  return /^\d{5,20}$/.test(raw) ? raw : "";
}

function normalizeUsername(value) {
  const normalized = String(value || "").trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,64}$/.test(normalized) ? normalized : "";
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{10}$/.test(raw)) {
    const timestamp = Number(raw) * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (/^\d{13}$/.test(raw)) {
    const date = new Date(Number(raw));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const local = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (local) {
    const year = local[3].length === 2 ? `20${local[3]}` : local[3];
    return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  }
  const serial = Number(raw.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + serial);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function parseDays(value) {
  const match = String(value || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  const days = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) : null;
}

function dateFromDaysAgo(days, asOf = new Date()) {
  const value = new Date(Date.UTC(
    asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(),
  ));
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function channelInfo(row) {
  const username = normalizeUsername(valueByAliases(row, [
    "chat_username", "channel_username", "telegram_channel", "channel", "chat", "username_chat",
  ]));
  const title = valueByAliases(row, [
    "chat_title", "channel_title", "chat_name", "channel_name", "project_name", "название канала",
  ]).toLowerCase();
  const id = String(valueByAliases(row, [
    "chat_id", "channel_id", "telegram_chat_id", "tg_chat_id", "group_id",
  ]) || "").trim();
  return { username, title, id };
}

function publicChannelRow(row) {
  const channel = channelInfo(row);
  const expectedUsername = normalizeUsername(PUBLIC_CHANNEL);
  const expectedId = String(process.env.TGTRACK_PUBLIC_CHANNEL_ID || "").trim();
  if (channel.username) return channel.username === expectedUsername;
  if (channel.title) return channel.title.includes(PUBLIC_CHANNEL_TITLE);
  if (channel.id && expectedId) return channel.id === expectedId;
  // Some TGTrack exports are already scoped to one configured channel and do
  // not include a channel discriminator. In that contract every row is public.
  return !channel.id || !expectedId;
}

function memberInfo(row) {
  const joinedRaw = valueByAliases(row, [
    "joined_at", "join_date", "joined date", "date joined", "subscribed_at", "subscription date",
    "first_joined_at", "first join date", "join_datetime", "joined", "created_at",
    "join_day_num", "day_num", "start_date", "date_start",
    "дата подписки", "дата входа", "дата вступления", "подписался", "добавлен", "date",
  ]);
  const daysRaw = valueByAliases(row, [
    "days", "days_in_channel", "days subscribed", "days in tg", "member_days", "lifetime_days",
    "сколько дней", "дней в канале", "сколько находится", "дней подписан", "время в канале",
  ]);
  return {
    userId: normalizeId(valueByAliases(row, [
      "telegram_user_id", "telegram id", "tg id", "user id", "userid", "user_id", "member_id",
      "telegramuserid", "tg_user_id", "tguserid", "id", "айди", "тг айди",
    ])),
    username: normalizeUsername(valueByAliases(row, [
      "username", "user_name", "telegram_username", "telegram username", "member_username",
      "user", "tag", "тег", "юзер", "ник",
    ])),
    joinedRaw,
    joinedAt: parseDate(joinedRaw),
    daysInChannel: parseDays(daysRaw),
    publicChannel: publicChannelRow(row),
  };
}

function membersCsvUrl() {
  if (process.env.TG_MEMBERS_CSV_URL) return process.env.TG_MEMBERS_CSV_URL;
  if (!process.env.TG_MEMBERS_SHEET_ID) return "";
  const gid = process.env.TG_MEMBERS_SHEET_GID || "0";
  return `https://docs.google.com/spreadsheets/d/${process.env.TG_MEMBERS_SHEET_ID}/export?format=csv&gid=${gid}`;
}

async function loadMembers() {
  const url = membersCsvUrl();
  if (!url) throw new Error("tg_members_sheet_not_configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    if (!response.ok) throw new Error("tg_members_sheet_unavailable");
    return rowsToObjects(parseCsv(text));
  } finally {
    clearTimeout(timer);
  }
}

function tgtrackUrl(report) {
  const url = new URL(`https://report.tgtrack.ru/pro/${report}.php`);
  url.searchParams.set("ver", TGTRACK_VERSION);
  url.searchParams.set("platform", "google");
  url.searchParams.set("apiKey", process.env.TGTRACK_API_KEY);
  url.searchParams.set("refresh", "2");
  return url.toString();
}

async function loadTgTrackMembers() {
  if (!process.env.TGTRACK_API_KEY) throw new Error("tgtrack_api_not_configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(tgtrackUrl("chatMembers"), {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const text = await response.text();
    if (!response.ok) throw new Error("tgtrack_chat_members_unavailable");
    return rowsToObjects(parseCsv(text));
  } finally {
    clearTimeout(timer);
  }
}

export function findFirstJoin(rows, lookup, source = "tg_members_sheet", asOf = new Date()) {
  const targetId = normalizeId(lookup.telegram_user_id);
  const targetUsername = normalizeUsername(lookup.telegram_username);
  const infos = rows.map(memberInfo).filter((item) => item.publicChannel);
  let matches = targetId ? infos.filter((item) => item.userId === targetId) : [];
  let matchMethod = targetId && matches.length ? "telegram_user_id" : "";

  if (!matches.length && targetUsername) {
    matches = infos.filter((item) => item.username === targetUsername);
    const distinctIds = new Set(matches.map((item) => item.userId).filter(Boolean));
    if (distinctIds.size > 1) return { status: "ambiguous" };
    matchMethod = matches.length ? "telegram_username" : "";
  }

  if (!matches.length) return { status: "not_found" };
  const dates = matches.map((item) => item.joinedAt).filter(Boolean).sort();
  if (!dates.length) {
    const lowerBoundDays = matches
      .map((item) => item.daysInChannel)
      .filter((value) => Number.isInteger(value))
      .sort((left, right) => right - left)[0];
    if (Number.isInteger(lowerBoundDays)) {
      return {
        status: "matched",
        match_method: matchMethod,
        first_joined_at: dateFromDaysAgo(lowerBoundDays, asOf),
        precision: "lower_bound_date",
        lower_bound_days: lowerBoundDays,
        source,
      };
    }
    return { status: "identity_found_no_join_date", match_method: matchMethod, source };
  }
  return {
    status: "matched",
    match_method: matchMethod,
    first_joined_at: dates[0],
    precision: "date",
    source,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    checkSecret(req);
    const body = await readBody(req);
    const lookups = Array.isArray(body.lookups) ? body.lookups : [];
    if (!lookups.length || lookups.length > MAX_LOOKUPS) {
      return sendJson(res, 400, { ok: false, error: "invalid_lookups" });
    }
    const [tgtrackResult, sheetResult] = await Promise.allSettled([
      loadTgTrackMembers(),
      loadMembers(),
    ]);
    const tgtrackMembers = tgtrackResult.status === "fulfilled" ? tgtrackResult.value : [];
    const sheetMembers = sheetResult.status === "fulfilled" ? sheetResult.value : [];
    if (!tgtrackMembers.length && !sheetMembers.length) {
      throw new Error("tgtrack_member_sources_unavailable");
    }
    const asOf = new Date();
    const results = lookups.map((lookup) => {
      const key = String(lookup?.key || "").slice(0, 128);
      const tgtrack = findFirstJoin(tgtrackMembers, lookup || {}, "tgtrack_chat_members", asOf);
      if (tgtrack.status === "matched") return { key, ...tgtrack };
      const sheet = findFirstJoin(sheetMembers, lookup || {}, "tg_members_sheet", asOf);
      return { key, ...(sheet.status === "matched" ? sheet : tgtrack.status !== "not_found" ? tgtrack : sheet) };
    });
    return sendJson(res, 200, {
      ok: true,
      channel: PUBLIC_CHANNEL,
      source: "tgtrack_chat_members_with_sheet_fallback",
      data_as_of: asOf.toISOString(),
      diagnostics: {
        tgtrackRows: tgtrackMembers.length,
        tgtrackColumns: Object.keys(tgtrackMembers[0] || {}).slice(0, 20),
        sheetRows: sheetMembers.length,
        sheetColumns: Object.keys(sheetMembers[0] || {}).slice(0, 20),
        tgtrackOk: tgtrackResult.status === "fulfilled",
        sheetOk: sheetResult.status === "fulfilled",
      },
      results,
    });
  } catch (error) {
    const status = error.status || (error.name === "AbortError" ? 504 : 503);
    return sendJson(res, status, {
      ok: false,
      error: error.name === "AbortError" ? "tg_members_sheet_timeout" : error.message,
    });
  }
}
