function sendJson(res, status, response) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response, null, 2));
}

function checkSecret(req) {
  if (!process.env.SYNC_SECRET) throw new Error("SYNC_SECRET is not configured.");
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

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body?.description || `${method} failed.`);
  }
  return body;
}

export default async function handler(req, res) {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
    checkSecret(req);

    const webhookUrl = `${baseUrl(req)}/api/telegram-bot`;
    const webhook = await telegram("setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "edited_message"],
      ...(process.env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET } : {}),
    });

    const commands = await telegram("setMyCommands", {
      commands: [
        { command: "today", description: "Статистика за сегодня" },
        { command: "yesterday", description: "Статистика за вчера" },
        { command: "all", description: "Статистика за все время" },
        { command: "help", description: "Как пользоваться ботом" },
      ],
    });

    return sendJson(res, 200, {
      ok: true,
      webhookUrl,
      webhook,
      commands,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message,
      source: "setup-telegram-bot",
    });
  }
}
