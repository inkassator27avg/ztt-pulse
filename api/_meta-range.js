import { creativeKeyFromAdName } from "./_creative-key.js";
import { resolveCreativeDestination } from "./_meta-destination.js";

const META_VERSION = "v20.0";
const AD_ACCOUNT_ID = "act_1038880678191397";
const DEFAULT_PAGE_ID = "104558388753626";
const DEFAULT_INSTAGRAM_ACCOUNT_ID = "17841461871497307";

function normalizeId(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function moneyNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function fetchJson(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `meta_http_${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getAdInsightsRange(from, to) {
  const rows = [];
  let nextUrl = new URL(`https://graph.facebook.com/${META_VERSION}/${AD_ACCOUNT_ID}/insights`);
  nextUrl.searchParams.set(
    "fields",
    "date_start,date_stop,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks",
  );
  nextUrl.searchParams.set("level", "ad");
  nextUrl.searchParams.set("time_increment", "1");
  nextUrl.searchParams.set("time_range", JSON.stringify({ since: from, until: to }));
  nextUrl.searchParams.set("limit", "500");
  nextUrl.searchParams.set("access_token", process.env.META_ACCESS_TOKEN);

  while (nextUrl) {
    const payload = await fetchJson(nextUrl);
    rows.push(...(payload?.data || []));
    nextUrl = payload?.paging?.next ? new URL(payload.paging.next) : null;
  }
  return rows.filter((row) => Number(row.spend || 0) > 0);
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function getAdCreatives(adIds) {
  const creatives = new Map();
  const uniqueIds = [...new Set(adIds.filter(Boolean))];
  for (const group of chunks(uniqueIds, 50)) {
    const body = new URLSearchParams();
    body.set("access_token", process.env.META_ACCESS_TOKEN);
    body.set("batch", JSON.stringify(group.map((adId) => ({
      method: "GET",
      relative_url: `${adId}?fields=creative%7Bid,name,actor_id,object_id,instagram_actor_id,link_url,url_tags,call_to_action,object_story_spec,asset_feed_spec,effective_object_story_id,instagram_permalink_url%7D`,
    }))));
    const batch = await fetchJson(`https://graph.facebook.com/${META_VERSION}/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, 20_000);
    group.forEach((adId, index) => {
      const item = batch?.[index];
      if (!item || item.code < 200 || item.code >= 300) return creatives.set(adId, null);
      const parsed = JSON.parse(item.body || "{}");
      creatives.set(adId, parsed.creative || null);
    });
  }
  return creatives;
}

function hasIdentityValue(value, keyNames, targetId) {
  if (!targetId || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => hasIdentityValue(item, keyNames, targetId));
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const cleanKey = key.toLowerCase();
    if (keyNames.has(cleanKey)) {
      const raw = String(nestedValue || "");
      if (normalizeId(raw) === targetId || raw.includes(targetId)) return true;
    }
    return hasIdentityValue(nestedValue, keyNames, targetId);
  });
}

function creativeMatchesTarget(creative, target) {
  if (!creative) return false;
  return (
    hasIdentityValue(creative, new Set(["page_id", "actor_id", "object_id"]), target.pageId)
    || hasIdentityValue(
      creative,
      new Set(["instagram_actor_id", "instagram_user_id", "instagram_id", "ig_user_id", "instagram_business_account_id"]),
      target.instagramAccountId,
    )
  );
}

export async function loadMetaRange(from, to) {
  if (!process.env.META_ACCESS_TOKEN) throw new Error("meta_not_configured");
  const target = {
    pageId: normalizeId(process.env.META_PAGE_ID || DEFAULT_PAGE_ID),
    instagramAccountId: normalizeId(process.env.INSTAGRAM_ACCOUNT_ID || DEFAULT_INSTAGRAM_ACCOUNT_ID),
  };
  const rows = await getAdInsightsRange(from, to);
  const creatives = await getAdCreatives(rows.map((row) => row.ad_id));
  const matched = [];
  let excludedSpendUsd = 0;
  for (const row of rows) {
    const creative = creatives.get(row.ad_id);
    if (!creativeMatchesTarget(creative, target)) {
      excludedSpendUsd += Number(row.spend || 0);
      continue;
    }
    const declared = creativeKeyFromAdName(row.ad_name);
    const destination = resolveCreativeDestination(creative, declared.creativeKey);
    matched.push({
      date: row.date_start || from,
      adId: String(row.ad_id || ""),
      adName: String(row.ad_name || "Без названия"),
      campaignId: row.campaign_id ? String(row.campaign_id) : null,
      campaignName: row.campaign_name ? String(row.campaign_name) : null,
      adsetId: row.adset_id ? String(row.adset_id) : null,
      adsetName: row.adset_name ? String(row.adset_name) : null,
      spendUsd: moneyNumber(row.spend),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      creativeKey: destination.creativeKey || declared.creativeKey || "unmapped",
      destinationSlug: destination.destinationSlug || null,
      destinationTerm: destination.destinationTerm || null,
      mappingMethod: destination.mappingMethod || declared.mappingMethod || "unmapped",
      mappingConflict: destination.mappingConflict === true,
    });
  }
  return {
    rows: matched,
    diagnostics: {
      account: AD_ACCOUNT_ID,
      totalAds: rows.length,
      matchedAds: matched.length,
      excludedAds: rows.length - matched.length,
      excludedSpendUsd: moneyNumber(excludedSpendUsd),
    },
  };
}

