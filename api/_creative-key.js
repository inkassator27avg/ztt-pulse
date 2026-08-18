const KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

const ALIASES = new Map([
  ["dashboard", "dashboard"],
  ["8k", "project8k"],
  ["project8k", "project8k"],
  ["project_8k", "project8k"],
  ["voronka_kurs", "voronka_kurs"],
  ["deshevo", "deshevo"],
  ["bio", "bio"],
]);

function normalizeCandidate(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/к/gu, "k")
    .replace(/[\s-]+/gu, "_")
    .replace(/[^a-z0-9_]/gu, "")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

export function creativeKeyFromAdName(adName) {
  const raw = String(adName || "").trim();
  const tagged = raw.match(/\[ztt:([a-z0-9_-]{1,64})\]/iu);
  if (tagged) {
    const candidate = normalizeCandidate(tagged[1]);
    if (!KEY_RE.test(candidate)) return { creativeKey: null, mappingMethod: "invalid_tag" };
    return {
      creativeKey: ALIASES.get(candidate) || candidate,
      mappingMethod: "explicit_tag",
    };
  }

  const candidate = normalizeCandidate(raw);
  const alias = ALIASES.get(candidate) || null;
  return {
    creativeKey: alias,
    mappingMethod: alias ? "exact_ad_name" : "unmapped",
  };
}

