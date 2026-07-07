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
  const result = await graphRequest(`${instagramAccountId}/media`, {
    fields: "id,media_product_type,timestamp,permalink",
    limit: "100",
  });

  return Array.isArray(result.data) ? result.data : [];
}

async function getDailyAccountViews(date) {
  const result = await graphRequest(`${instagramAccountId}/insights`, {
    metric: "views",
    period: "day",
    metric_type: "total_value",
    since: date,
    until: nextDate(date),
  });

  const row = (result.data || []).find((item) => item.name === "views");
  return Number(row?.total_value?.value || 0);
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

async function upsertDailyEntry(date, instagram) {
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
      telegram: Number(existing?.telegram || 0),
      instagram: instagram.followers,
      tiktok_followers: Number(existing?.tiktok_followers || 0),
      reels: instagram.reels,
      tiktoks: Number(existing?.tiktoks || 0),
      ig_views: instagram.views,
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

async function getInstagramStats(date) {
  const profile = await getInstagramProfile();
  const media = await getRecentMedia();
  const views = await getDailyAccountViews(date);
  const reels = media.filter((item) => item.media_product_type === "REELS" && localDay(item.timestamp) === date);

  return {
    date,
    username: profile.username,
    followers: Number(profile.followers_count || 0),
    mediaCount: Number(profile.media_count || 0),
    reels: reels.length,
    views,
    viewsSource: "account_daily_total",
    media: reels.map((item) => ({
      id: item.id,
      permalink: item.permalink,
      timestamp: item.timestamp,
    })),
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }

    checkEnv();
    checkSecret(req);

    const date = getDate(req);
    const instagram = await getInstagramStats(date);
    const saved = await upsertDailyEntry(date, instagram);

    return sendJson(res, 200, {
      ok: true,
      date,
      instagramAccountId,
      instagram,
      saved,
    });
  } catch (error) {
    const isAbort = error.name === "AbortError";
    return sendJson(res, isAbort ? 504 : 500, {
      ok: false,
      error: isAbort ? "Sync request timed out." : error.message,
      source: "sync-instagram",
    });
  }
}
