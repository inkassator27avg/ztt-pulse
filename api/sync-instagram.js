}

async function getMediaInsights(mediaId) {
  const result = await graphRequest(`${mediaId}/insights`, {
    metric: "views,reach,total_interactions,saved,shares,likes,comments",
  });

  return (result.data || []).reduce((acc, item) => {
    acc[item.name] = Number(item.values?.[0]?.value || 0);
    return acc;
  }, {});
}

async function getDailyAccountViews(date) {
  const nextDate = new Date(`${date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  const result = await graphRequest(`${process.env.INSTAGRAM_ACCOUNT_ID}/insights`, {
    metric: "views",
    period: "day",
    metric_type: "total_value",
    since: date,
    until: nextDate.toISOString().slice(0, 10),
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
  const dailyViews = await getDailyAccountViews(date);
  const reels = media.filter((item) => (
    item.media_product_type === "REELS" &&
    localDate(new Date(item.timestamp)) === date
  ));

  const insightRows = await Promise.all(reels.map(async (item) => ({
    id: item.id,
    permalink: item.permalink,
    timestamp: item.timestamp,
    insights: await getMediaInsights(item.id),
  })));

  return {
    date,
    username: profile.username,
    followers: Number(profile.followers_count || 0),
    mediaCount: Number(profile.media_count || 0),
    reels: reels.length,
    views: dailyViews,
    viewsSource: "account_daily_total",
    reach: insightRows.reduce((sum, item) => sum + Number(item.insights.reach || 0), 0),
    interactions: insightRows.reduce((sum, item) => sum + Number(item.insights.total_interactions || 0), 0),
    media: insightRows,
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
    const isAbort = error.name === "AbortError";
    return sendJson(res, isAbort ? 504 : 500, {
      ok: false,
      error: isAbort ? "Sync request timed out." : error.message,
    });
  }
}
