function sendJson(res, status, response) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response, null, 2));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function todayYekaterinburg() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function yesterdayYekaterinburg() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getDate(req) {
  const value = Array.isArray(req.query?.date) ? req.query.date[0] : req.query?.date;
  if (!value) return req.headers["x-vercel-cron"] ? yesterdayYekaterinburg() : todayYekaterinburg();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }
  return value;
}

function checkSecret(req) {
  if (!process.env.SYNC_SECRET) {
    throw new Error("Sync secret is not configured.");
  }
  if (req.headers["x-vercel-cron"]) return;

  const querySecret = Array.isArray(req.query?.secret) ? req.query.secret[0] : req.query?.secret;
  const headerSecret = req.headers["x-sync-secret"];

  if (querySecret !== process.env.SYNC_SECRET && headerSecret !== process.env.SYNC_SECRET) {
    throw new Error("Wrong sync secret.");
  }
}

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("temporarily") ||
    text.includes("rate") ||
    text.includes("network") ||
    text.includes("fetch failed")
  );
}

async function runSource(req, source, date) {
  const url = new URL(`${baseUrl(req)}${source.path}`);
  url.searchParams.set("date", date);

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "x-sync-secret": process.env.SYNC_SECRET,
          "x-refresh-source": "refresh-stats",
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.ok === false) {
        const message = payload.error || `${source.name} failed with status ${response.status}`;
        throw new Error(message);
      }

      return {
        name: source.name,
        ok: true,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 3 || !shouldRetry(error.message)) break;
      await sleep(600 * attempt);
    }
  }

  return {
    name: source.name,
    ok: false,
    error: lastError?.message || `${source.name} failed.`,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }

    checkSecret(req);

    const date = getDate(req);
    const sources = [
      { name: "Meta", path: "/api/sync-meta" },
      { name: "Instagram", path: "/api/sync-instagram" },
      { name: "Telegram", path: "/api/sync-telegram" },
    ];

    const results = [];
    for (const source of sources) {
      results.push(await runSource(req, source, date));
    }

    const failed = results.filter((result) => !result.ok);

    return sendJson(res, 200, {
      ok: true,
      complete: failed.length === 0,
      date,
      results,
      warning: failed.length ? `Updated partially: ${sources.length - failed.length}/${sources.length}` : null,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message,
      source: "refresh-stats",
    });
  }
}
