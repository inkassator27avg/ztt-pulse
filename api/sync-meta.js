const metaVersion = "v20.0";
const adAccountId = "act_1038880678191397";

const requiredEnv = ["META_ACCESS_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"];

function json(response, status = 200) {
  return new Response(JSON.stringify(response, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function yesterday() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}

function getDate(requestUrl) {
  const url = new URL(requestUrl);
  const value = url.searchParams.get("date");
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

function checkSecret(request) {
  if (!process.env.SYNC_SECRET) return;

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const headerSecret = request.headers.get("x-sync-secret");

  if (querySecret !== process.env.SYNC_SECRET && headerSecret !== process.env.SYNC_SECRET) {
    throw new Error("Wrong sync secret.");
  }
}

async function getMetaInsights(date) {
  const url = new URL(`https://graph.facebook.com/${metaVersion}/${adAccountId}/insights`);
  url.searchParams.set("fields", "spend,impressions,clicks");
  url.searchParams.set("time_range", JSON.stringify({ since: date, until: date }));
  url.searchParams.set("access_token", process.env.META_ACCESS_TOKEN);

  const response = await fetch(url);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message || "Meta request failed.");
  }

  const row = body?.data?.[0] || {};
  return {
    date,
    adSpend: Number(row.spend || 0),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
  };
}

async function upsertDailyEntry(insights) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/daily_entries?on_conflict=date`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      date: insights.date,
      ad_spend: insights.adSpend,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || "Supabase request failed.");
  }

  return text ? JSON.parse(text) : null;
}

export default async function handler(request) {
  try {
    checkEnv();
    checkSecret(request);

    const date = getDate(request.url);
    const insights = await getMetaInsights(date);
    const saved = await upsertDailyEntry(insights);

    return json({
      ok: true,
      date,
      adAccountId,
      meta: insights,
      saved,
    });
  } catch (error) {
    return json({ ok: false, error: error.message }, 500);
  }
}
