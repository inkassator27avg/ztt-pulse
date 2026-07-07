  return body;
}

async function graphRequest(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${metaVersion}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  url.searchParams.set("access_token", process.env.META_ACCESS_TOKEN);

  const response = await fetchWithTimeout(url);
  return readJsonResponse(response, "Instagram request failed.");
}

async function supabaseRequest(path, options = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  return readJsonResponse(response, "Supabase request failed.");
}

async function getInstagramProfile() {
  return graphRequest(process.env.INSTAGRAM_ACCOUNT_ID, {
    fields: "username,followers_count,media_count",
  });
}

async function getRecentMedia() {
  const result = await graphRequest(`${process.env.INSTAGRAM_ACCOUNT_ID}/media`, {
    fields: "id,media_type,media_product_type,timestamp,permalink",
    limit: 100,
  });

  return Array.isArray(result?.data) ? result.data : [];
}

async function getDailyAccountViews(date) {
  const result = await graphRequest(`${process.env.INSTAGRAM_ACCOUNT_ID}/insights`, {
    metric: "views",
    period: "day",
    metric_type: "total_value",
    since: date,
    until: nextDate(date),
  });

  const row = (result?.data || []).find((item) => item.name === "views");
  return Number(row?.total_value?.value || 0);
}

async function selectExistingDailyEntry(date) {
  const rows = await supabaseRequest(`daily_entries?date=eq.${date}&select=*`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertDailyEntry(date, instagram) {
  const existing = await selectExistingDailyEntry(date);
  const saved = await supabaseRequest("daily_entries?on_conflict=date", {
    method: "POST",
    headers: {
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

  return saved;
}

async function getInstagramStats(date) {
  const [profile, media, dailyViews] = await Promise.all([
    getInstagramProfile(),
    getRecentMedia(),
    getDailyAccountViews(date),
  ]);

  const reels = media.filter((item) => (
    item.media_product_type === "REELS" &&
    localDate(new Date(item.timestamp)) === date
  ));

  return {
    date,
    username: profile.username,
    followers: Number(profile.followers_count || 0),
    mediaCount: Number(profile.media_count || 0),
    reels: reels.length,
    views: dailyViews,
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
      instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID,
      instagram,
      saved,
    });
  } catch (error) {
    return sendJson(res, error.name === "AbortError" ? 504 : 500, {
      ok: false,
      error: error.name === "AbortError" ? "Sync request timed out." : error.message,
      source: "sync-instagram",
    });
  }
}
