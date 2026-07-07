const prices = {
  sales29: 29,
  sales49: 49,
  sales99: 99,
  renewals29: 29,
  renewals49: 49,
  renewals99: 99,
};

const supabaseConfig = {
  url: "https://caapzeyqgpuyiclpbcvt.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhYXB6ZXlxZ3B1eWljbHBiY3Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MzQ5MTgsImV4cCI6MjA5OTAxMDkxOH0.QQ6XloozbHSDfEOmgLw2dNNAQUhYpNLo2oA9xQRTLGQ",
  table: "daily_entries",
};

const demoEntries = [
  { date: "2026-07-01", adSpend: 21, leads: 13, telegram: 2362, instagram: 4318, tiktokFollowers: 820, reels: 1, tiktoks: 1, views: 7200, sales29: 2, sales49: 0, sales99: 0, renewals29: 0, renewals49: 0, renewals99: 0 },
  { date: "2026-07-02", adSpend: 34, leads: 18, telegram: 2379, instagram: 4332, tiktokFollowers: 829, reels: 2, tiktoks: 0, views: 12800, sales29: 0, sales49: 1, sales99: 0, renewals29: 0, renewals49: 1, renewals99: 0 },
  { date: "2026-07-03", adSpend: 39, leads: 24, telegram: 2401, instagram: 4358, tiktokFollowers: 846, reels: 1, tiktoks: 2, views: 19600, sales29: 3, sales49: 1, sales99: 0, renewals29: 1, renewals49: 0, renewals99: 0 },
  { date: "2026-07-04", adSpend: 28, leads: 11, telegram: 2410, instagram: 4364, tiktokFollowers: 853, reels: 0, tiktoks: 1, views: 4100, sales29: 0, sales49: 1, sales99: 0, renewals29: 0, renewals49: 0, renewals99: 0 },
  { date: "2026-07-05", adSpend: 42, leads: 29, telegram: 2438, instagram: 4392, tiktokFollowers: 874, reels: 2, tiktoks: 1, views: 22400, sales29: 3, sales49: 1, sales99: 1, renewals29: 0, renewals49: 1, renewals99: 0 },
  { date: "2026-07-06", adSpend: 36, leads: 17, telegram: 2451, instagram: 4401, tiktokFollowers: 881, reels: 1, tiktoks: 0, views: 9900, sales29: 2, sales49: 1, sales99: 0, renewals29: 0, renewals49: 0, renewals99: 0 },
  { date: "2026-07-07", adSpend: 38, leads: 21, telegram: 2470, instagram: 4420, tiktokFollowers: 902, reels: 2, tiktoks: 1, views: 18500, sales29: 2, sales49: 1, sales99: 1, renewals29: 1, renewals49: 1, renewals99: 0 },
];

let selectedRange = "7";
let entries = normalizeEntries(loadEntries());
let supabaseReady = false;

const form = document.querySelector("#entryForm");
const compareGrid = document.querySelector("#dashboard");
const historyRows = document.querySelector("#historyRows");
const rangeButtons = document.querySelectorAll("[data-range]");
const resetButton = document.querySelector("#resetData");
const periodSummary = document.querySelector("#periodSummary");
const calculatedRevenue = document.querySelector("#calculatedRevenue");

function loadEntries() {
  const stored = localStorage.getItem("ztt-pulse-entries");
  return stored ? JSON.parse(stored) : demoEntries;
}

function toDbRow(row) {
  return {
    date: row.date,
    ad_spend: Number(row.adSpend || 0),
    leads: Number(row.leads || 0),
    telegram: Number(row.telegram || 0),
    instagram: Number(row.instagram || 0),
    tiktok_followers: Number(row.tiktokFollowers || 0),
    reels: Number(row.reels || 0),
    tiktoks: Number(row.tiktoks || 0),
    ig_views: Number(row.igViews || 0),
    tt_views: Number(row.ttViews || 0),
    sales_29: Number(row.sales29 || 0),
    sales_49: Number(row.sales49 || 0),
    sales_99: Number(row.sales99 || 0),
    renewals_29: Number(row.renewals29 || 0),
    renewals_49: Number(row.renewals49 || 0),
    renewals_99: Number(row.renewals99 || 0),
  };
}

function fromDbRow(row) {
  return {
    date: row.date,
    adSpend: Number(row.ad_spend || 0),
    leads: Number(row.leads || 0),
    telegram: Number(row.telegram || 0),
    instagram: Number(row.instagram || 0),
    tiktokFollowers: Number(row.tiktok_followers || 0),
    reels: Number(row.reels || 0),
    tiktoks: Number(row.tiktoks || 0),
    igViews: Number(row.ig_views || 0),
    ttViews: Number(row.tt_views || 0),
    sales29: Number(row.sales_29 || 0),
    sales49: Number(row.sales_49 || 0),
    sales99: Number(row.sales_99 || 0),
    renewals29: Number(row.renewals_29 || 0),
    renewals49: Number(row.renewals_49 || 0),
    renewals99: Number(row.renewals_99 || 0),
  };
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseConfig.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseConfig.key,
      Authorization: `Bearer ${supabaseConfig.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase error ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function loadEntriesFromSupabase() {
  try {
    const rows = await supabaseRequest(`${supabaseConfig.table}?select=*&order=date.asc`);
    if (Array.isArray(rows) && rows.length) {
      entries = normalizeEntries(rows.map(fromDbRow));
      saveEntries();
    }
    supabaseReady = true;
  } catch (error) {
    supabaseReady = false;
    console.warn("Supabase is not ready yet. Falling back to browser storage.", error);
  }
}

async function saveEntryToSupabase(entry) {
  if (!supabaseReady) return;
  try {
    await supabaseRequest(`${supabaseConfig.table}?on_conflict=date`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(toDbRow(entry)),
    });
  } catch (error) {
    console.warn("Could not save to Supabase. Browser storage still has the entry.", error);
  }
}

function normalizeEntries(rows) {
  return rows.map((row) => {
    const normalized = {
      adSpend: 0,
      leads: 0,
      telegram: 0,
      instagram: 0,
      tiktokFollowers: row.tiktokFollowers ?? 0,
      reels: 0,
      tiktoks: 0,
      views: 0,
      igViews: row.igViews ?? Math.round(Number(row.views || 0) * 0.7),
      ttViews: row.ttViews ?? Math.round(Number(row.views || 0) * 0.3),
      sales29: 0,
      sales49: 0,
      sales99: 0,
      renewals29: 0,
      renewals49: 0,
      renewals99: 0,
      ...row,
    };

    if (!row.sales29 && !row.sales49 && !row.sales99 && row.sales) {
      normalized.sales29 = Number(row.sales || 0);
    }

    if (!row.renewals29 && !row.renewals49 && !row.renewals99 && row.renewals) {
      normalized.renewals29 = Number(row.renewals || 0);
    }

    return normalized;
  });
}

function saveEntries() {
  localStorage.setItem("ztt-pulse-entries", JSON.stringify(entries));
}

function money(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function number(value) {
  return Math.round(value).toLocaleString("ru-RU");
}

function percent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 10) / 10}%`;
}

function rowRevenue(row) {
  return Object.entries(prices).reduce((sum, [key, price]) => sum + Number(row[key] || 0) * price, 0);
}

function rowSales(row) {
  return Number(row.sales29 || 0) + Number(row.sales49 || 0) + Number(row.sales99 || 0);
}

function rowRenewals(row) {
  return Number(row.renewals29 || 0) + Number(row.renewals49 || 0) + Number(row.renewals99 || 0);
}

function rowPayments(row) {
  return rowSales(row) + rowRenewals(row);
}

function rowViews(row) {
  return Number(row.igViews || 0) + Number(row.ttViews || 0);
}

function tariffText(row) {
  const sales = [`29:${row.sales29 || 0}`, `49:${row.sales49 || 0}`, `99:${row.sales99 || 0}`].join(" / ");
  const renewals = [`29:${row.renewals29 || 0}`, `49:${row.renewals49 || 0}`, `99:${row.renewals99 || 0}`].join(" / ");
  return `new ${sales}; ren ${renewals}`;
}

function sortedEntries() {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date));
}

function isSameMonth(dateString, offset = 0) {
  const date = new Date(`${dateString}T00:00:00`);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
}

function scopedEntries() {
  const sorted = sortedEntries();
  if (selectedRange === "thisMonth") return sorted.filter((row) => isSameMonth(row.date, 0));
  if (selectedRange === "lastMonth") return sorted.filter((row) => isSameMonth(row.date, -1));
  return sorted.slice(-Number(selectedRange));
}

function previousFor(row, sorted) {
  const index = sorted.findIndex((item) => item.date === row.date);
  return index > 0 ? sorted[index - 1] : null;
}

function telegramGrowth(row, sorted) {
  const previous = previousFor(row, sorted);
  return previous ? Number(row.telegram || 0) - Number(previous.telegram || 0) : 0;
}

function instagramGrowth(row, sorted) {
  const previous = previousFor(row, sorted);
  return previous ? Number(row.instagram || 0) - Number(previous.instagram || 0) : 0;
}

function tiktokGrowth(row, sorted) {
  const previous = previousFor(row, sorted);
  return previous ? Number(row.tiktokFollowers || 0) - Number(previous.tiktokFollowers || 0) : 0;
}

function total(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function totalRevenue(rows) {
  return rows.reduce((sum, row) => sum + rowRevenue(row), 0);
}

function totalSales(rows) {
  return rows.reduce((sum, row) => sum + rowSales(row), 0);
}

function latest(rows) {
  return rows[rows.length - 1] || {};
}

function summarize(row, sorted) {
  const revenue = rowRevenue(row);
  const tgGrowth = telegramGrowth(row, sorted);
  const igGrowth = instagramGrowth(row, sorted);
  const profit = revenue - Number(row.adSpend || 0);

  return {
    ...row,
    revenue,
    profit,
    tgGrowth,
    igGrowth,
    sales: rowSales(row),
    payments: rowPayments(row),
  };
}

function periodLabel() {
  const labels = {
    "1": "1 день",
    "7": "7 дней",
    "14": "14 дней",
    "30": "30 дней",
    thisMonth: "этот месяц",
    lastMonth: "прошлый месяц",
    all: "всё время",
  };
  return labels[selectedRange] || "период";
}

function renderCompare() {
  const sorted = sortedEntries();
  const lastReport = summarize(latest(sorted), sorted);
  const previousReport = summarize(sorted[sorted.length - 2] || {}, sorted);

  compareGrid.innerHTML = `
    <article class="day-card focus">
      <span class="eyebrow">Последний отчёт</span>
      <div class="day-title">
        <h3>${lastReport.date || "-"}</h3>
        <strong>${money(lastReport.revenue || 0)}</strong>
      </div>
      <div class="metric-strip">
        <span>Reels <b>${number(lastReport.reels || 0)}</b></span>
        <span>TikTok <b>${number(lastReport.tiktoks || 0)}</b></span>
        <span>Views <b>${number(rowViews(lastReport))}</b></span>
        <span>TG + <b class="${lastReport.tgGrowth >= 0 ? "positive" : "negative"}">${number(lastReport.tgGrowth)}</b></span>
        <span>Sales <b>${number(lastReport.sales || 0)}</b></span>
      </div>
      <small>Профит ${money(lastReport.profit || 0)} · реклама ${money(lastReport.adSpend || 0)} · тарифы: ${tariffText(lastReport)}</small>
    </article>

    <article class="day-card">
      <span class="eyebrow">День до этого</span>
      <div class="day-title">
        <h3>${previousReport.date || "-"}</h3>
        <strong>${money(previousReport.revenue || 0)}</strong>
      </div>
      <div class="metric-strip">
        <span>Reels <b>${number(previousReport.reels || 0)}</b></span>
        <span>TikTok <b>${number(previousReport.tiktoks || 0)}</b></span>
        <span>Views <b>${number(rowViews(previousReport))}</b></span>
        <span>TG + <b class="${previousReport.tgGrowth >= 0 ? "positive" : "negative"}">${number(previousReport.tgGrowth)}</b></span>
        <span>Sales <b>${number(previousReport.sales || 0)}</b></span>
      </div>
      <small>Профит ${money(previousReport.profit || 0)} · реклама ${money(previousReport.adSpend || 0)} · тарифы: ${tariffText(previousReport)}</small>
    </article>
  `;

  const signal = document.querySelector("#growthSignal");
  signal.textContent = periodLabel();
}

function drawTelegramChart(canvasId, series, labels, options = {}) {
  const canvas = document.querySelector(canvasId);
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padLeft = 42;
  const padRight = 12;
  const padTop = 14;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const allValues = series.flatMap((item) => item.values.map((value) => Number(value || 0)));
  const rawMax = Math.max(...allValues, 1);
  const rawMin = options.minZero === false ? Math.min(...allValues, 0) : 0;
  const max = rawMax === rawMin ? rawMax + 1 : rawMax;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#252539";
  ctx.lineWidth = 1;
  ctx.font = "11px Inter, sans-serif";

  for (let i = 0; i < 5; i += 1) {
    const y = padTop + (plotHeight / 4) * i;
    const value = max - ((max - rawMin) / 4) * i;

    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();

    ctx.fillStyle = "#91a0ad";
    ctx.fillText(number(value), 4, y + 4);
  }

  series.forEach((item) => {
    const values = item.values;
    const color = item.color;

    if (item.type === "bar") {
      const step = plotWidth / Math.max(values.length, 1);
      const barWidth = Math.max(step * 0.36, 5);
      const offset = item.offset || 0;
      ctx.fillStyle = color;
      values.forEach((value, index) => {
        const x = padLeft + step * index + step * 0.5 + offset;
        const barHeight = ((Number(value || 0) - rawMin) / (max - rawMin)) * plotHeight;
        const y = padTop + plotHeight - barHeight;
        ctx.fillRect(x - barWidth / 2, y, barWidth, barHeight);
      });
      return;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = padLeft + (plotWidth / Math.max(values.length - 1, 1)) * index;
      const y = padTop + plotHeight - ((Number(value || 0) - rawMin) / (max - rawMin)) * plotHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  ctx.fillStyle = "#9b98ae";
  const labelIndexes = labels.length <= 4 ? labels.map((_, index) => index) : [0, Math.floor(labels.length / 2), labels.length - 1];
  labelIndexes.forEach((index) => {
    const x = padLeft + (plotWidth / Math.max(labels.length - 1, 1)) * index;
    ctx.fillText(labels[index]?.slice(5) || "", x - 16, height - 7);
  });
}

function normalizedSeries(values) {
  const max = Math.max(...values, 1);
  return values.map((value) => (value / max) * 100);
}

function renderCharts() {
  const sorted = sortedEntries();
  const rows = scopedEntries();
  const labels = rows.map((row) => row.date);
  const growth = rows.map((row) => Math.max(telegramGrowth(row, sorted), 0));
  const reels = rows.map((row) => Number(row.reels || 0));
  const tiktoks = rows.map((row) => Number(row.tiktoks || 0));
  const igViews = rows.map((row) => Number(row.igViews || 0));
  const ttViews = rows.map((row) => Number(row.ttViews || 0));
  const salesRevenue = rows.map((row) => rowRevenue(row));

  document.querySelector("#contentTotal").textContent = number(total(rows, "reels") + total(rows, "tiktoks"));
  document.querySelector("#igViewsTotal").textContent = number(total(rows, "igViews"));
  document.querySelector("#ttViewsTotal").textContent = number(total(rows, "ttViews"));
  document.querySelector("#tgGrowthTotal").textContent = `+${number(growth.reduce((sum, value) => sum + value, 0))}`;
  document.querySelector("#salesRevenueTotal").textContent = money(totalRevenue(rows));
  document.querySelectorAll("[data-period-label]").forEach((item) => {
    item.textContent = periodLabel();
  });

  const contentSeries = [
    { color: "#fb7185", values: reels, type: "bar", offset: -4 },
    { color: "#38bdf8", values: tiktoks, type: "bar", offset: 4 },
  ];
  const igViewsSeries = [{ color: "#2f89ff", values: igViews }];
  const ttViewsSeries = [{ color: "#38bdf8", values: ttViews }];
  const tgSeries = [{ color: "#5ee15a", values: growth, type: "bar" }];
  const salesRevenueSeries = [{ color: "#c084fc", values: salesRevenue }];

  drawTelegramChart("#contentChart", contentSeries, labels);
  drawTelegramChart("#igViewsChart", igViewsSeries, labels);
  drawTelegramChart("#ttViewsChart", ttViewsSeries, labels);
  drawTelegramChart("#tgGrowthChart", tgSeries, labels);
  drawTelegramChart("#salesRevenueChart", salesRevenueSeries, labels);
}

function renderSummary() {
  const sorted = sortedEntries();
  const rows = scopedEntries();
  const views = rows.reduce((sum, row) => sum + rowViews(row), 0);
  const igViews = total(rows, "igViews");
  const ttViews = total(rows, "ttViews");
  const reels = total(rows, "reels");
  const tiktoks = total(rows, "tiktoks");
  const sales = totalSales(rows);
  const tgGrowth = rows.reduce((sum, row) => sum + telegramGrowth(row, sorted), 0);
  const igGrowth = rows.reduce((sum, row) => sum + instagramGrowth(row, sorted), 0);
  const ttGrowth = rows.reduce((sum, row) => sum + tiktokGrowth(row, sorted), 0);
  const revenue = totalRevenue(rows);
  const adSpend = total(rows, "adSpend");
  const profit = revenue - adSpend;

  periodSummary.innerHTML = `
    <p>
      За ${periodLabel()} ты выложил <b>${number(reels)}</b> Reels и
      <b>${number(tiktoks)}</b> TikTok. Reels набрали
      <b>${number(igViews)}</b> просмотров, TikTok набрал
      <b>${number(ttViews)}</b> просмотров. На рекламу потрачено
      <b>${money(adSpend)}</b>. Instagram вырос на
      <b class="${igGrowth >= 0 ? "positive" : "negative"}">${igGrowth >= 0 ? "+" : ""}${number(igGrowth)}</b>,
      TikTok вырос на
      <b class="${ttGrowth >= 0 ? "positive" : "negative"}">${ttGrowth >= 0 ? "+" : ""}${number(ttGrowth)}</b>,
      Telegram вырос на
      <b class="${tgGrowth >= 0 ? "positive" : "negative"}">${tgGrowth >= 0 ? "+" : ""}${number(tgGrowth)}</b>
      подписчиков, продаж ЗТТ было <b>${number(sales)}</b>.
    </p>
    <div class="summary-strip">
      <span>Выручка <b>${money(revenue)}</b></span>
      <span>Чистые <b class="${profit >= 0 ? "positive" : "negative"}">${money(profit)}</b></span>
      <span>Просмотры Instagram <b>${number(igViews)}</b></span>
      <span>Подписчики Instagram <b>${igGrowth >= 0 ? "+" : ""}${number(igGrowth)}</b></span>
      <span>Просмотры TikTok <b>${number(ttViews)}</b></span>
      <span>Подписчики TikTok <b>${ttGrowth >= 0 ? "+" : ""}${number(ttGrowth)}</b></span>
      <span>Подписчики Telegram <b>${tgGrowth >= 0 ? "+" : ""}${number(tgGrowth)}</b></span>
      <span>Продажи ЗТТ <b>${number(sales)}</b></span>
    </div>
  `;
}

function renderHistory() {
  const sorted = sortedEntries();
  historyRows.innerHTML = sorted
    .slice(-7)
    .reverse()
    .map((row) => {
      const revenue = rowRevenue(row);
      const profit = revenue - row.adSpend;
      const tgGrowth = telegramGrowth(row, sorted);
      return `
        <tr>
          <td>${row.date}</td>
          <td>${money(revenue)}</td>
          <td>${money(row.adSpend)}</td>
          <td class="${profit >= 0 ? "positive" : "negative"}">${money(profit)}</td>
          <td>${number(row.reels)}</td>
          <td>${number(row.tiktoks)}</td>
      <td>${number(row.igViews)}</td>
      <td>${number(row.ttViews)}</td>
          <td>${number(row.telegram)}</td>
          <td class="${tgGrowth >= 0 ? "positive" : "negative"}">${tgGrowth >= 0 ? "+" : ""}${number(tgGrowth)}</td>
          <td>${number(rowSales(row))}</td>
        </tr>
      `;
    })
    .join("");
}

function formRevenue() {
  const data = new FormData(form);
  return Object.entries(prices).reduce((sum, [key, price]) => sum + Number(data.get(key) || 0) * price, 0);
}

function updateCalculatedRevenue() {
  calculatedRevenue.textContent = `Выручка: ${money(formRevenue())}`;
}

function fillFormDefaults() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  form.elements.date.value = yesterday;
  Object.keys(prices).forEach((key) => {
    form.elements[key].value = "";
  });
  updateCalculatedRevenue();
}

function render() {
  renderCompare();
  renderCharts();
  renderSummary();
  renderHistory();
}

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    rangeButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    selectedRange = button.dataset.range;
    render();
  });
});

form.addEventListener("input", updateCalculatedRevenue);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const existing = entries.find((item) => item.date === data.get("date"));
  const last = sortedEntries().at(-1) || {};
  const baseAutoMetrics = existing || {
    adSpend: 0,
    leads: 0,
    telegram: last.telegram || 0,
    instagram: last.instagram || 0,
    tiktokFollowers: last.tiktokFollowers || 0,
    reels: 0,
    tiktoks: 0,
    views: 0,
  };

  const entry = {
    ...baseAutoMetrics,
    date: data.get("date"),
    sales29: Number(data.get("sales29") || 0),
    sales49: Number(data.get("sales49") || 0),
    sales99: Number(data.get("sales99") || 0),
    renewals29: Number(data.get("renewals29") || 0),
    renewals49: Number(data.get("renewals49") || 0),
    renewals99: Number(data.get("renewals99") || 0),
  };

  entries = normalizeEntries(entries.filter((item) => item.date !== entry.date).concat(entry));
  saveEntries();
  await saveEntryToSupabase(entry);
  fillFormDefaults();
  render();
});

resetButton.addEventListener("click", () => {
  entries = normalizeEntries(demoEntries);
  saveEntries();
  fillFormDefaults();
  render();
});

fillFormDefaults();
loadEntriesFromSupabase().finally(() => {
  fillFormDefaults();
  render();
});
