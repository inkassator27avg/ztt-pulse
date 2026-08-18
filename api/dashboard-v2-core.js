function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function normalizeKey(value) {
  return String(value || "")
    .trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function payloadCreativeKey(payload) {
  if (!payload || typeof payload !== "object") return "";
  const clean = Object.fromEntries(Object.entries(payload).map(([key, value]) => [normalizeKey(key), value]));
  const term = normalizeKey(clean.utm_term || clean.utmterm);
  if (term) return term;
  const campaign = normalizeKey(clean.utm_campaign || clean.utmcampaign);
  if (campaign.startsWith("ztt_lm_")) return campaign.slice(7);
  const content = normalizeKey(clean.utm_content || clean.utmcontent);
  if (content.startsWith("link_")) return content.slice(5);
  return "";
}

function saleIdentity(row, index) {
  return String(row.buyer_hash || row.telegram_user_id || row.telegram_username || `sale-${index}`);
}

function resolveRevenueKzt(row, rate) {
  const amount = number(row.amount);
  if (amount >= 1000) return amount;
  if (amount > 0 && rate > 0) return amount * rate;
  const tariff = number(String(row.tariff || "").match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", "."));
  return tariff > 0 && rate > 0 ? tariff * rate : 0;
}

function ensureCreative(map, key) {
  const normalized = normalizeKey(key) || "unattributed";
  if (!map.has(normalized)) {
    map.set(normalized, {
      creativeKey: normalized, ads: new Set(), campaigns: new Map(), spendKzt: 0, spendUsd: 0,
      impressions: 0, clicks: 0, subscribers: 0, sales: 0, buyers: new Set(), revenueKzt: 0,
      dealCycleValues: [],
    });
  }
  return map.get(normalized);
}

function dateRange(from, to) {
  const result = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function buildDashboardReport({
  from, to, metaRows = [], metaDiagnostics = null, tgtrack = null, salesRows = [], dailyEntries = [], rates = {}, providers = {},
}) {
  const creativeMap = new Map();
  const dailyMap = new Map(dateRange(from, to).map((date) => [date, {
    date, spendKzt: 0, spendUsd: 0, impressions: 0, clicks: 0, subscribers: 0, sales: 0, buyers: new Set(), revenueKzt: 0,
  }]));

  for (const row of metaRows) {
    const rate = number(rates[row.date]);
    const spendUsd = number(row.spendUsd);
    const spendKzt = rate > 0 ? spendUsd * rate : 0;
    const creative = ensureCreative(creativeMap, row.creativeKey);
    creative.ads.add(row.adId);
    creative.spendUsd += spendUsd;
    creative.spendKzt += spendKzt;
    creative.impressions += number(row.impressions);
    creative.clicks += number(row.clicks);
    const campaignKey = `${row.campaignId || row.campaignName || "campaign"}\u001f${row.adsetId || row.adsetName || "adset"}`;
    const campaign = creative.campaigns.get(campaignKey) || {
      name: row.campaignName || "Без названия", adset: row.adsetName || "Без названия", spendKzt: 0, spendUsd: 0, sales: 0,
    };
    campaign.spendUsd += spendUsd;
    campaign.spendKzt += spendKzt;
    creative.campaigns.set(campaignKey, campaign);
    const daily = dailyMap.get(row.date);
    if (daily) {
      daily.spendUsd += spendUsd;
      daily.spendKzt += spendKzt;
      daily.impressions += number(row.impressions);
      daily.clicks += number(row.clicks);
    }
  }

  for (const row of tgtrack?.aggregates || []) ensureCreative(creativeMap, row.creativeKey).subscribers += number(row.subscribers);
  for (const row of tgtrack?.dailyAggregates || []) {
    const daily = dailyMap.get(row.date);
    if (daily) daily.subscribers += number(row.subscribers);
  }

  const attributionByKey = new Map((tgtrack?.results || []).map((row) => [String(row.key), row]));
  salesRows.forEach((row, index) => {
    const attribution = attributionByKey.get(`sale:${index}`) || null;
    const creativeKey = attribution?.creativeKey || payloadCreativeKey(row.member_payload) || "unattributed";
    const creative = ensureCreative(creativeMap, creativeKey);
    const identity = saleIdentity(row, index);
    const rate = number(rates[row.sale_date]);
    const revenueKzt = resolveRevenueKzt(row, rate);
    const joinedAt = attribution?.attribution_joined_at || row.joined_at || null;
    const cycle = Number.isFinite(Number(row.days_to_purchase))
      ? number(row.days_to_purchase)
      : (joinedAt ? Math.max(0, Math.floor((new Date(`${row.sale_date}T00:00:00Z`) - new Date(`${joinedAt}T00:00:00Z`)) / 86_400_000)) : null);
    creative.sales += 1;
    creative.buyers.add(identity);
    creative.revenueKzt += revenueKzt;
    if (cycle !== null) creative.dealCycleValues.push(cycle);
    const daily = dailyMap.get(row.sale_date);
    if (daily) {
      daily.sales += 1;
      daily.buyers.add(identity);
      daily.revenueKzt += revenueKzt;
    }
  });

  if (!metaRows.length) {
    for (const row of dailyEntries) {
      const daily = dailyMap.get(row.date);
      if (!daily) continue;
      daily.spendUsd = number(row.ad_spend);
      daily.spendKzt = number(rates[row.date]) * daily.spendUsd;
    }
  }
  if (!(tgtrack?.dailyAggregates || []).length) {
    for (const row of dailyEntries) {
      const daily = dailyMap.get(row.date);
      if (daily) daily.subscribers = number(row.telegram_joined);
    }
  }

  const creatives = [...creativeMap.values()].map((row) => ({
    creativeKey: row.creativeKey,
    ads: row.ads.size,
    spendKzt: round(row.spendKzt), spendUsd: round(row.spendUsd), impressions: row.impressions, clicks: row.clicks,
    subscribers: row.subscribers, sales: row.sales, buyers: row.buyers.size, revenueKzt: round(row.revenueKzt),
    cplKzt: row.subscribers ? round(row.spendKzt / row.subscribers) : null,
    cpaKzt: row.sales ? round(row.spendKzt / row.sales) : null,
    roas: row.spendKzt ? round(row.revenueKzt / row.spendKzt, 4) : null,
    averageDealCycleDays: row.dealCycleValues.length ? round(row.dealCycleValues.reduce((sum, value) => sum + value, 0) / row.dealCycleValues.length, 1) : null,
    campaigns: [...row.campaigns.values()].map((campaign) => ({ ...campaign, spendKzt: round(campaign.spendKzt), spendUsd: round(campaign.spendUsd) })),
  })).sort((left, right) => right.revenueKzt - left.revenueKzt || right.spendKzt - left.spendKzt);

  const daily = [...dailyMap.values()].map((row) => ({
    ...row, buyers: row.buyers.size, spendKzt: round(row.spendKzt), spendUsd: round(row.spendUsd), revenueKzt: round(row.revenueKzt),
  }));
  const total = daily.reduce((acc, row) => ({
    spendKzt: acc.spendKzt + row.spendKzt, spendUsd: acc.spendUsd + row.spendUsd,
    impressions: acc.impressions + row.impressions, clicks: acc.clicks + row.clicks,
    subscribers: acc.subscribers + row.subscribers, sales: acc.sales + row.sales,
    revenueKzt: acc.revenueKzt + row.revenueKzt,
  }), { spendKzt: 0, spendUsd: 0, impressions: 0, clicks: 0, subscribers: 0, sales: 0, revenueKzt: 0 });
  const buyerSet = new Set(salesRows.map(saleIdentity));
  const cycleValues = creatives.flatMap((row) => row.averageDealCycleDays === null ? [] : [row.averageDealCycleDays]);
  const unmatchedSales = creatives.find((row) => row.creativeKey === "unattributed")?.sales || 0;
  const unmappedSpendKzt = creatives.find((row) => row.creativeKey === "unmapped")?.spendKzt || 0;

  return {
    contractVersion: "2026-08-18.v2",
    generatedAt: new Date().toISOString(),
    from, to,
    summary: {
      spendKzt: round(total.spendKzt), spendUsd: round(total.spendUsd), impressions: total.impressions, clicks: total.clicks,
      subscribers: total.subscribers, buyers: buyerSet.size, sales: total.sales, revenueKzt: round(total.revenueKzt),
      grossRoas: total.spendKzt ? round(total.revenueKzt / total.spendKzt, 4) : null,
      grossAfterAdsKzt: round(total.revenueKzt - total.spendKzt),
      averageCheckKzt: total.sales ? round(total.revenueKzt / total.sales) : null,
      averageDealCycleDays: cycleValues.length ? round(cycleValues.reduce((sum, value) => sum + value, 0) / cycleValues.length, 1) : null,
    },
    daily,
    creatives,
    coverage: { unmatchedSales, unmappedSpendKzt, providers, meta: metaDiagnostics },
  };
}
