const REPORT_BASE = "https://report.tgtrack.ru/api";
const REPORT_VERSION = "1.0";
const REPORT_LIMIT = 10_000;
const KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;
const BUSINESS_TIME_ZONE = "Asia/Almaty";

function cleanHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[@_\-\s./\\:;()[\]{}]+/g, "");
}

function valueByAliases(row, aliases) {
  const normalized = Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [cleanHeader(key), value]),
  );
  for (const alias of aliases) {
    const value = normalized[cleanHeader(alias)];
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export function parseCsv(text) {
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

export function rowsToObjects(rows) {
  const headers = (rows[0] || []).map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((row) => Object.fromEntries(
    headers.map((header, index) => [header, row[index] || ""]),
  ));
}

function businessDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function safeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{10}$/.test(raw)) return businessDate(new Date(Number(raw) * 1000));
  if (/^\d{13}$/.test(raw)) return businessDate(new Date(Number(raw)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    return hasExplicitZone ? businessDate(new Date(raw)) : raw.slice(0, 10);
  }
  return "";
}

function safeTimestamp(value) {
  const raw = String(value || "").trim();
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  return "";
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeInteger(value) {
  const number = Number(String(value || "").trim());
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeUserId(value) {
  const raw = String(value || "").trim();
  return /^\d{5,20}$/.test(raw) ? raw : "";
}

function safeDimension(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, 160);
}

function creativeKey(dimensions) {
  const term = safeDimension(dimensions.term);
  if (KEY_RE.test(term)) return term;
  const campaign = safeDimension(dimensions.campaign);
  if (campaign === "ztt_bio") return "bio";
  if (campaign.startsWith("ztt_lm_") && KEY_RE.test(campaign.slice(7))) return campaign.slice(7);
  const content = safeDimension(dimensions.content);
  if (content.startsWith("link_") && KEY_RE.test(content.slice(5))) return content.slice(5);
  return "";
}

export function unixSeconds(dateValue, endOfDay = false) {
  const suffix = endOfDay ? "T23:59:59+05:00" : "T00:00:00+05:00";
  return Math.floor(new Date(`${dateValue}${suffix}`).getTime() / 1000);
}

function reportUrl(method, apiKey, fromValue, toValue) {
  const url = new URL(`${REPORT_BASE}/${method}.php`);
  url.searchParams.set("ver", REPORT_VERSION);
  url.searchParams.set("platform", "api");
  url.searchParams.set("format", "csv");
  url.searchParams.set("apiKey", apiKey);
  if (fromValue) url.searchParams.set("date_from", String(unixSeconds(fromValue)));
  if (toValue) url.searchParams.set("date_to", String(unixSeconds(toValue, true)));
  if (method !== "get_tags") url.searchParams.set("limit", String(REPORT_LIMIT));
  return url;
}

async function fetchCsv(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "ZTT-Attribution/1.0" },
    });
    const text = await response.text();
    if (!response.ok) {
      const rateLimited = response.status === 429 || response.status === 452 || /too many requests/i.test(text);
      const error = new Error(rateLimited ? "tgtrack_rate_limited" : "tgtrack_reports_unavailable");
      const retryHeader = Number(response.headers.get("retry-after") || 0);
      const retryMinutes = Number(text.match(/(?:after|через)\s+(\d+)\s*(?:min|мин)/i)?.[1] || 0);
      error.retryAfterSeconds = Math.max(3600, retryHeader, retryMinutes * 60);
      throw error;
    }
    if (text.length > 16 * 1024 * 1024) throw new Error("tgtrack_report_too_large");
    return rowsToObjects(parseCsv(text));
  } finally {
    clearTimeout(timer);
  }
}

function tagMap(rows) {
  const result = new Map();
  for (const row of rows) {
    const id = valueByAliases(row, ["labelID", "label_id", "tagID", "id"]);
    const name = valueByAliases(row, ["name", "label", "value"]);
    if (id && name) result.set(id, name);
  }
  return result;
}

function resolveDimension(row, aliases, tags) {
  const raw = valueByAliases(row, aliases);
  return safeDimension(tags.get(raw) || raw);
}

export function normalizeMemberRows(rows, tagRows = []) {
  const tags = tagMap(tagRows);
  return rows.map((row) => {
    const subscribersRaw = valueByAliases(row, ["subscribersCount", "subscribers_count"]);
    const unsubscribersRaw = valueByAliases(row, ["unsubscribersCount", "unsubscribers_count"]);
    const statusRaw = valueByAliases(row, ["status"]);
    const parsedStatus = Number(statusRaw);
    const status = statusRaw !== "" && Number.isFinite(parsedStatus) ? parsedStatus : null;
    const leaveStatus = status === 0 || status === -1;
    const joinValue = valueByAliases(row, ["joinDate", "join_date"]);
    const leftValue = valueByAliases(row, ["leftDate", "left_date"]);
    const eventValue = valueByAliases(row, ["eventDate", "event_date"]);
    const effectiveLeftValue = leftValue || (leaveStatus ? eventValue : "");
    const dimensions = {
      source: resolveDimension(row, ["utm_source", "utm_source_id"], tags),
      medium: resolveDimension(row, ["utm_medium", "utm_medium_id"], tags),
      campaign: resolveDimension(row, ["utm_campaign", "utm_campaign_id"], tags),
      content: resolveDimension(row, ["utm_content", "utm_content_id"], tags),
      term: resolveDimension(row, ["utm_term", "utm_term_id"], tags),
    };
    return {
      userId: safeUserId(valueByAliases(row, ["userID", "user_id", "telegram_user_id"])),
      status,
      joinedAt: safeDate(joinValue),
      joinedAtTimestamp: safeTimestamp(joinValue),
      eventAt: safeDate(eventValue),
      leftAt: safeDate(effectiveLeftValue),
      leftAtTimestamp: safeTimestamp(effectiveLeftValue),
      subscribers: subscribersRaw === "" ? (status === 1 ? 1 : 0) : safeInteger(subscribersRaw),
      unsubscribers: unsubscribersRaw === "" ? (leaveStatus ? 1 : 0) : safeInteger(unsubscribersRaw),
      ...dimensions,
      creativeKey: creativeKey(dimensions),
    };
  }).filter((row) => row.userId && row.joinedAt);
}

function clearAttribution(event) {
  return {
    ...event, source: "", medium: "", campaign: "", content: "", term: "", creativeKey: "",
    attributionAmbiguous: true,
  };
}

function mergeAttribution(existing, incoming) {
  if (existing.attributionAmbiguous) return { event: existing, ambiguous: false };
  const fields = ["source", "medium", "campaign", "content", "term", "creativeKey"];
  const conflict = fields.some((field) => (
    String(existing[field] || "")
    && String(incoming[field] || "")
    && String(existing[field]) !== String(incoming[field])
  ));
  if (conflict) return { event: clearAttribution(existing), ambiguous: true };
  const merged = { ...existing };
  for (const field of fields) {
    if (!merged[field] && incoming[field]) merged[field] = incoming[field];
  }
  return { event: merged, ambiguous: false };
}

function deduplicateLifecycleEvents(members, diagnostics = null) {
  const joins = new Map();
  const leaves = new Map();
  let ambiguousJoinKeys = 0;
  for (const member of members) {
    if (member.subscribers > 0 && member.joinedAt) {
      const eventKey = `${member.userId}\u001f${member.joinedAtTimestamp || member.joinedAt}`;
      const existing = joins.get(eventKey);
      if (!existing) {
        joins.set(eventKey, { ...member });
      } else {
        existing.subscribers = Math.max(existing.subscribers, member.subscribers);
        const merged = mergeAttribution(existing, member);
        joins.set(eventKey, merged.event);
        if (merged.ambiguous) ambiguousJoinKeys += 1;
      }
    }
    if (member.unsubscribers > 0 && member.leftAt) {
      const eventKey = `${member.userId}\u001f${member.leftAtTimestamp || member.leftAt}`;
      const existing = leaves.get(eventKey);
      if (!existing) {
        leaves.set(eventKey, { ...member });
      } else {
        existing.unsubscribers = Math.max(existing.unsubscribers, member.unsubscribers);
        leaves.set(eventKey, mergeAttribution(existing, member).event);
      }
    }
  }
  if (diagnostics && typeof diagnostics === "object") {
    diagnostics.lifecycle = {
      inputRows: members.length,
      joinEvents: joins.size,
      leaveEvents: leaves.size,
      duplicateJoinRows: Math.max(0, members.filter((row) => row.subscribers > 0).length - joins.size),
      duplicateLeaveRows: Math.max(0, members.filter((row) => row.unsubscribers > 0 && row.leftAt).length - leaves.size),
      ambiguousJoinKeys,
    };
  }
  return { joins: [...joins.values()], leaves: [...leaves.values()] };
}

export function attributionReport(members, lookups, fromValue, toValue, diagnostics = null) {
  const lifecycle = deduplicateLifecycleEvents(members, diagnostics);
  const byUser = new Map();
  for (const member of lifecycle.joins) {
    const values = byUser.get(member.userId) || [];
    values.push(member);
    byUser.set(member.userId, values);
  }
  const results = lookups.map((lookup) => {
    const userId = safeUserId(lookup?.telegram_user_id);
    const cutoff = safeDate(lookup?.attribution_date);
    const allMembers = (byUser.get(userId) || [])
      .sort((left, right) => (
        (left.joinedAtTimestamp || left.joinedAt).localeCompare(right.joinedAtTimestamp || right.joinedAt)
      ));
    const firstMember = allMembers[0];
    if (!firstMember) return { key: String(lookup?.key || "").slice(0, 128), status: "not_found" };
    const attributedMember = allMembers
      .filter((member) => member.creativeKey && (!cutoff || member.joinedAt <= cutoff))
      .at(-1) || null;
    const result = {
      key: String(lookup?.key || "").slice(0, 128),
      status: "matched",
      match_method: "telegram_user_id",
      first_joined_at: firstMember.joinedAt,
      first_joined_at_timestamp: firstMember.joinedAtTimestamp || null,
      precision: "date",
      source: "tgtrack_reports_api",
    };
    if (attributedMember) Object.assign(result, {
      attribution_joined_at: attributedMember.joinedAt,
      creativeKey: attributedMember.creativeKey,
      utmSource: attributedMember.source,
      utmMedium: attributedMember.medium,
      utmCampaign: attributedMember.campaign,
      utmContent: attributedMember.content,
      utmTerm: attributedMember.term || attributedMember.creativeKey,
    });
    return result;
  });

  const groups = new Map();
  const dailyGroups = new Map();
  const addEvent = (member, activityDate, field, count) => {
    if (activityDate < fromValue || activityDate > toValue) return;
    const reportKey = member.creativeKey || "unattributed";
    const key = [reportKey, member.source, member.medium, member.campaign, member.content, member.term].join("\u001f");
    const group = groups.get(key) || {
      creativeKey: reportKey,
      source: member.source,
      medium: member.medium,
      campaign: member.campaign,
      content: member.content,
      term: member.term || (reportKey === "unattributed" ? "" : reportKey),
      subscribers: 0,
      unsubscribers: 0,
    };
    group[field] += count;
    groups.set(key, group);
    const dailyKey = `${activityDate}\u001f${key}`;
    const daily = dailyGroups.get(dailyKey) || { date: activityDate, ...group, subscribers: 0, unsubscribers: 0 };
    daily[field] += count;
    dailyGroups.set(dailyKey, daily);
  };
  for (const member of lifecycle.joins) {
    addEvent(member, member.joinedAt, "subscribers", member.subscribers);
  }
  for (const member of lifecycle.leaves) {
    addEvent(member, member.leftAt, "unsubscribers", member.unsubscribers);
  }
  return {
    results,
    aggregates: [...groups.values()].sort((left, right) => (
      right.subscribers - left.subscribers || left.creativeKey.localeCompare(right.creativeKey)
    )),
    dailyAggregates: [...dailyGroups.values()].sort((left, right) => (
      left.date.localeCompare(right.date) || left.creativeKey.localeCompare(right.creativeKey)
    )),
  };
}

export async function loadTgTrackAttribution(apiKey, historyFrom, toValue, lookups, periodFrom) {
  if (!apiKey) throw new Error("tgtrack_api_not_configured");
  const memberRows = await fetchCsv(reportUrl("get_chat_members", apiKey, historyFrom, toValue));
  if (memberRows.length >= REPORT_LIMIT) throw new Error("tgtrack_report_truncated");
  // Keep the two provider calls safely below the documented 3 req/s burst limit.
  await wait(1500);
  const tagRows = await fetchCsv(reportUrl("get_tags", apiKey));
  const lifecycleDiagnostics = {};
  const members = normalizeMemberRows(memberRows, tagRows);
  return {
    ...attributionReport(members, lookups, periodFrom, toValue, lifecycleDiagnostics),
    diagnostics: {
      memberRows: memberRows.length,
      normalizedMembers: members.length,
      tagRows: tagRows.length,
      historyFrom,
      periodFrom,
      to: toValue,
      ...lifecycleDiagnostics,
    },
  };
}
