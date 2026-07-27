import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTelegramActivity } from "../api/sync-telegram.js";
import { findFirstJoin } from "../api/tg-members-lookup.js";


test("partial TGTrack gross is rejected when official totals disagree", () => {
  const activity = {
    joined: 20,
    left: 3,
    growth: 17,
    diagnostics: { matchedRows: 2 },
  };
  const normalized = normalizeTelegramActivity(
    activity,
    { telegram_joined: 20, telegram_left: 3, telegram_growth: 17 },
    3229,
    { telegram: 3132 },
  );

  assert.equal(normalized.joined, 0);
  assert.equal(normalized.left, 0);
  assert.equal(normalized.growth, 97);
  assert.equal(normalized.activitySource, "official_net_reconciliation");
  assert.equal(normalized.diagnostics.tgTrackGrowth, 17);
  assert.equal(normalized.diagnostics.officialNet, 97);
  assert.equal(normalized.diagnostics.reconciled, false);
});

test("reconciled TGTrack gross is preserved", () => {
  const normalized = normalizeTelegramActivity(
    { joined: 9, left: 2, growth: 7, diagnostics: { matchedRows: 2 } },
    {},
    3236,
    { telegram: 3229 },
  );

  assert.equal(normalized.joined, 9);
  assert.equal(normalized.left, 2);
  assert.equal(normalized.growth, 7);
  assert.equal(normalized.activitySource, "tgtrack_reconciled");
  assert.equal(normalized.diagnostics.reconciled, true);
});

test("TGTrack chatMembers lookup uses earliest public-channel date", () => {
  const rows = [
    { chatTitle: "закрытая тусовка трафогонов", userId: "268311546", joinDate: "2026-07-26" },
    { chatTitle: "Даниил Романов", userId: "268311546", joinDate: "2024-09-03" },
  ];
  const result = findFirstJoin(rows, { telegram_user_id: "268311546" }, "tgtrack_chat_members");

  assert.equal(result.status, "matched");
  assert.equal(result.first_joined_at, "2024-09-03");
  assert.equal(result.precision, "date");
  assert.equal(result.source, "tgtrack_chat_members");
});

test("initial-audience duration becomes an explicit lower-bound date", () => {
  const rows = [{
    chatTitle: "Даниил Романов",
    userId: "870199995",
    daysInChannel: ">691",
  }];
  const result = findFirstJoin(
    rows,
    { telegram_user_id: "870199995" },
    "tgtrack_chat_members",
    new Date("2026-07-27T00:00:00Z"),
  );

  assert.equal(result.status, "matched");
  assert.equal(result.first_joined_at, "2024-09-04");
  assert.equal(result.precision, "lower_bound_date");
  assert.equal(result.lower_bound_days, 691);
});
