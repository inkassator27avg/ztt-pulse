const tgtrackVersion = "2.20";

const requiredEnv = ["TGTRACK_API_KEY", "SUPABASE_URL", "SUPABASE_KEY", "TELEGRAM_BOT_TOKEN"];
const publicChannel = process.env.TELEGRAM_PUBLIC_CHANNEL || "@danyaromanov1";

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
  const headers = (rows[0] || []).map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function todayAlmaty() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function dayNumToDate(dayNum) {
  const raw = String(dayNum || "").trim();
  if (!raw) return "";
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) return "";
  const date = value >= 30_000
    ? new Date(Date.UTC(1899, 11, 30))
    : new Date(Date.UTC(1970, 0, 1));
  date.setUTCDate(date.getUTCDate() + value);
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
  const parsedDates = [];
  const totals = rows.reduce((acc, row) => {
    const rowDate = dayNumToDate(row.dayNum);
    if (rowDate) parsedDates.push(rowDate);
    if (rowDate !== date) return acc;
    acc.matchedRows += 1;
    acc.joined += Number(row.joinCount || 0);
    acc.left += Number(row.leftCount || 0);
    return acc;
  }, { joined: 0, left: 0, matchedRows: 0 });
  parsedDates.sort();

  return {
    joined: totals.joined,
    left: totals.left,
    growth: totals.joined - totals.left,
    diagnostics: {
      reportRows: rows.length,
      matchedRows: totals.matchedRows,
      firstDate: parsedDates[0] || null,
      lastDate: parsedDates.at(-1) || null,
      columns: Object.keys(rows[0] || {}).slice(0, 12),
    },
  };
}

async function getTelegramMembersCount() {
  const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMemberCount`);
  url.searchParams.set("chat_id", publicChannel);
  const response = await fetchWithTimeout(url.toString());
  const payload = await response.json().catch(() => ({}));
  const count = Number(payload?.result);

  if (response.ok && payload?.ok === true && Number.isInteger(count) && count >= 0) {
    return { count, source: "telegram_bot_api" };
  }

  const publicUrl = `https://t.me/${publicChannel.replace(/^@/, "")}`;
  const html = await fetchText(publicUrl);
  const match = html.match(/<div class="tgme_page_extra">\s*([^<]+subscriber[^<]*)<\/div>/i);
  const publicCount = Number(String(match?.[1] || "").replace(/\D/g, ""));
  if (!Number.isInteger(publicCount) || publicCount < 1) {
    throw new Error("Telegram member count is unavailable for the public channel.");
  }
  return { count: publicCount, source: "telegram_public_page" };
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

async function upsertDailyEntry(date, telegram, existing) {
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

export function normalizeTelegramActivity(activity, existing, total, previous) {
  const previousTotal = Number(previous?.telegram || 0);
  const hasOfficialNet = previousTotal > 0;
  const officialNet = hasOfficialNet ? total - previousTotal : null;
  const hasTgTrackGross = Number(activity?.diagnostics?.matchedRows || 0) > 0;
  const tgTrackReconciles = !hasOfficialNet || activity.growth === officialNet;

  if (hasTgTrackGross && !tgTrackReconciles) {
    // TGTrack can return a partial join/left split while its export is still
    // catching up. The official Telegram totals are authoritative for net
    // growth, but they cannot prove the gross joins and leaves separately.
    return {
      ...activity,
      joined: 0,
      left: 0,
      growth: officialNet,
      activitySource: "official_net_reconciliation",
      diagnostics: {
        ...activity.diagnostics,
        tgTrackGrowth: activity.growth,
        officialNet,
        reconciled: false,
      },
    };
  }

  if (!hasTgTrackGross) {
    const storedJoined = Number(existing?.telegram_joined || 0);
    const storedLeft = Number(existing?.telegram_left || 0);
    const storedGrowth = Number(existing?.telegram_growth ?? storedJoined - storedLeft);
    const storedReconciles = !hasOfficialNet || storedGrowth === officialNet;
    if ((storedJoined !== 0 || storedLeft !== 0) && storedReconciles) {
      return {
        ...activity,
        joined: storedJoined,
        left: storedLeft,
        growth: storedGrowth,
        activitySource: "stored_fallback",
      };
    }
    if (hasOfficialNet) {
      return {
        ...activity,
        joined: 0,
        left: 0,
        growth: officialNet,
        activitySource: "official_net_fallback",
        diagnostics: {
          ...activity.diagnostics,
          officialNet,
          reconciled: false,
        },
      };
    }
  }

  if (hasTgTrackGross) {
    return {
      ...activity,
      activitySource: "tgtrack_reconciled",
      diagnostics: {
        ...activity.diagnostics,
        officialNet,
        reconciled: true,
      },
    };
  }
  return { ...activity, activitySource: "unavailable" };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }

    checkEnv();
    checkSecret(req);

    const date = getDate(req);
    const [activity, members, existing, previous] = await Promise.all([
      getTelegramActivity(date),
      getTelegramMembersCount(),
      selectExistingDailyEntry(date),
      selectExistingDailyEntry(shiftDate(date, -1)),
    ]);
    const historicalTotal = date < todayAlmaty() ? Number(existing?.telegram || 0) : 0;
    const total = historicalTotal > 0 ? historicalTotal : members.count;
    const normalizedActivity = normalizeTelegramActivity(activity, existing, total, previous);
    const telegram = {
      date,
      total,
      ...normalizedActivity,
      totalSource: historicalTotal > 0 ? "stored_historical_total" : members.source,
      channel: publicChannel,
    };
    const saved = await upsertDailyEntry(date, telegram, existing);

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
