const KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

const ACTIVE_LANDING_TERMS = new Map([
  ["bio", "bio"],
  ["bio-v2", "bio"],
  ["dashboard", "dashboard"],
  ["deshevo", "deshevo"],
  ["project8k", "project8k"],
  ["voronka_kurs", "voronka_kurs"],
]);

function pushUrl(values, value) {
  if (typeof value === "string" && value.trim()) values.push(value.trim());
}

export function creativeDestinationUrls(creative) {
  const values = [];
  const story = creative?.object_story_spec || {};
  const linkData = story.link_data || {};
  pushUrl(values, creative?.link_url);
  pushUrl(values, creative?.call_to_action?.value?.link);
  pushUrl(values, linkData.link);
  pushUrl(values, linkData.call_to_action?.value?.link);
  for (const attachment of linkData.child_attachments || []) pushUrl(values, attachment?.link);
  pushUrl(values, story.video_data?.call_to_action?.value?.link);
  pushUrl(values, story.template_data?.link);
  for (const link of creative?.asset_feed_spec?.link_urls || []) {
    pushUrl(values, link?.website_url);
    pushUrl(values, link?.carousel_see_more_url);
  }
  return [...new Set(values)];
}

function staticTerm(value) {
  const term = String(value || "").trim().toLowerCase();
  return KEY_RE.test(term) && !term.includes("{{") ? term : "";
}

function termFromTags(tags) {
  const raw = String(tags || "").trim().replace(/^\?/, "");
  if (!raw || raw.includes("{{")) return "";
  const terms = new Set(new URLSearchParams(raw).getAll("utm_term").map(staticTerm).filter(Boolean));
  return terms.size === 1 ? [...terms][0] : "";
}

function landingFromUrl(value, urlTags) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "tg.ztt.kz") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const slug = segments[0].toLowerCase();
  const registryTerm = ACTIVE_LANDING_TERMS.get(slug);
  if (!registryTerm) return null;
  const queryTerms = new Set(url.searchParams.getAll("utm_term").map(staticTerm).filter(Boolean));
  if (queryTerms.size > 1) return null;
  const queryTerm = queryTerms.size === 1 ? [...queryTerms][0] : "";
  const tagsTerm = termFromTags(urlTags);
  if (queryTerm && tagsTerm && queryTerm !== tagsTerm) return null;
  return { slug, term: queryTerm || tagsTerm || registryTerm };
}

export function resolveCreativeDestination(creative, declaredCreativeKey) {
  const declared = staticTerm(declaredCreativeKey);
  const landings = creativeDestinationUrls(creative)
    .map((value) => landingFromUrl(value, creative?.url_tags))
    .filter(Boolean);
  const terms = new Set(landings.map((landing) => landing.term));
  const slugs = new Set(landings.map((landing) => landing.slug));
  if (terms.size !== 1) {
    return {
      creativeKey: null,
      declaredCreativeKey: declared || null,
      destinationSlug: null,
      destinationTerm: null,
      mappingMethod: terms.size > 1 ? "unmapped_multi_destination" : "no_direct_tgtrack_path",
      mappingConflict: false,
    };
  }
  const destinationTerm = [...terms][0];
  return {
    creativeKey: destinationTerm,
    declaredCreativeKey: declared || null,
    destinationSlug: slugs.size === 1 ? [...slugs][0] : null,
    destinationTerm,
    mappingMethod: "destination_tgtrack_landing",
    mappingConflict: Boolean(declared && declared !== destinationTerm),
  };
}
