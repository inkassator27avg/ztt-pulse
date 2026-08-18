import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardReport } from "../api/dashboard-v2-core.js";

test("dashboard v2 joins Meta, TGTrack and sales without exposing identities", () => {
  const report = buildDashboardReport({
    from: "2026-08-17",
    to: "2026-08-18",
    rates: { "2026-08-17": 500, "2026-08-18": 500 },
    metaRows: [
      { date: "2026-08-17", adId: "1", campaignId: "c1", campaignName: "Core", adsetId: "a1", adsetName: "Broad", creativeKey: "dashboard", spendUsd: 10, impressions: 1000, clicks: 30 },
      { date: "2026-08-18", adId: "2", campaignId: "c2", campaignName: "Scale", adsetId: "a2", adsetName: "Warm", creativeKey: "dashboard", spendUsd: 5, impressions: 500, clicks: 10 },
    ],
    tgtrack: {
      aggregates: [{ creativeKey: "dashboard", subscribers: 20 }],
      dailyAggregates: [{ date: "2026-08-17", creativeKey: "dashboard", subscribers: 12 }, { date: "2026-08-18", creativeKey: "dashboard", subscribers: 8 }],
      results: [{ key: "sale:0", creativeKey: "dashboard", attribution_joined_at: "2026-08-15" }],
    },
    salesRows: [{ sale_date: "2026-08-18", telegram_user_id: "123456", amount: 20_000, days_to_purchase: 3, member_payload: {} }],
    providers: { meta: "ok", tgtrack: "ok", supabase: "ok", nbk: "ok" },
  });
  assert.equal(report.summary.spendKzt, 7_500);
  assert.equal(report.summary.impressions, 1_500);
  assert.equal(report.summary.subscribers, 20);
  assert.equal(report.summary.sales, 1);
  assert.equal(report.summary.buyers, 1);
  assert.equal(report.summary.revenueKzt, 20_000);
  assert.equal(report.creatives[0].creativeKey, "dashboard");
  assert.equal(report.creatives[0].ads, 2);
  assert.equal(JSON.stringify(report).includes("123456"), false);
});

test("dashboard v2 keeps unattributed sales and stored provider fallbacks explicit", () => {
  const report = buildDashboardReport({
    from: "2026-08-18",
    to: "2026-08-18",
    rates: { "2026-08-18": 500 },
    dailyEntries: [{ date: "2026-08-18", ad_spend: 2, telegram_joined: 3 }],
    salesRows: [{ sale_date: "2026-08-18", telegram_username: "buyer", tariff: "29", amount: null, member_payload: {} }],
  });
  assert.equal(report.summary.spendKzt, 1000);
  assert.equal(report.summary.subscribers, 3);
  assert.equal(report.summary.revenueKzt, 14_500);
  assert.equal(report.coverage.unmatchedSales, 1);
});

