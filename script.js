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

const dashboardPassword = "inka27avg!";
const authStorageKey = "ztt-pulse-unlocked-v2";
const syncSecret = "ztt-meta-sync-2026";

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
const customRange = document.querySelector("#customRange");
const customStart = document.querySelector("#customStart");
const customEnd = document.querySelector("#customEnd");
const lockScreen = document.querySelector("#lockScreen");
const lockForm = document.querySelector("#lockForm");
const passwordInput = document.querySelector("#passwordInput");
const lockError = document.querySelector("#lockError");
const refreshStatsButton = document.querySelector("#refreshStats");
const refreshStatus = document.querySelector("#refreshStatus");

function loadEntries() {
  const stored = localStorage.getItem("ztt-pulse-entries");
  if (!stored) return [];

  const parsed = JSON.parse(stored);
  return Array.isArray(parsed) ? parsed : [];
}

function toDbRow(row) {
  return {
    date: row.date,
    ad_spend: Number(row.adSpend || 0),
    leads: Number(row.leads || 0),
    telegram: Number(row.telegram || 0),
    telegram_joined: Number(row.telegramJoined || 0),
    telegram_left: Number(row.telegramLeft || 0),
    telegram_growth: Number(row.telegramGrowth || 0),
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
    telegramJoined: Number(row.telegram_joined || 0),
    telegramLeft: Number(row.telegram_left || 0),
    telegramGrowth: Number(row.telegram_growth || 0),
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
    } else {
      entries = [];
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
      telegramJoined: 0,
      telegramLeft: 0,
      telegramGrowth: 0,
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

function formatDate(dateString, mode = "long") {
  if (!dateString) return "-";
  const date = new Date(`${dateString}T00:00:00`);
  const options = mode === "short"
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "long" };
  return new Intl.DateTimeFormat("ru-RU", options).format(date).replace(".", "");
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
  if (selectedRange === "custom") {
    const start = customStart?.value;
    const end = customEnd?.value;
    return sorted.filter((row) => (!start || row.date >= start) && (!end || row.date <= end));
  }
  if (selectedRange === "all") return sorted;
  return sorted.slice(-Number(selectedRange));
}

function previousFor(row, sorted) {
  const index = sorted.findIndex((item) => item.date === row.date);
  return index > 0 ? sorted[index - 1] : null;
}

function telegramGrowth(row, sorted) {
  if (Number(row.telegramGrowth || 0)) return Number(row.telegramGrowth || 0);
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
  if (selectedRange === "custom") {
    const start = customStart?.value ? formatDate(customStart.value) : "начало";
    const end = customEnd?.value ? formatDate(customEnd.value) : "сегодня";
    return `${start} — ${end}`;
  }
  return labels[selectedRange] || "период";
}

function renderCompare() {
  const sorted = sortedEntries();
  if (!sorted.length) {
    compareGrid.innerHTML = `
      <article class="day-card focus empty-state">
        <span class="eyebrow">Последний отчёт</span>
        <h3>Данных пока нет</h3>
        <p>Когда появится первая строка в базе, здесь будет свежая сводка.</p>
      </article>
    `;
    const signal = document.querySelector("#growthSignal");
    signal.textContent = periodLabel();
    return;
  }

  const lastReport = summarize(latest(sorted), sorted);
  const previousReport = summarize(sorted[sorted.length - 2] || {}, sorted);

  compareGrid.innerHTML = `
    <article class="day-card focus">
      <span class="eyebrow">Последний отчёт</span>
      <div class="day-title">
        <h3>${formatDate(lastReport.date)}</h3>
        <strong>${money(lastReport.revenue || 0)}</strong>
      </div>
      <div class="metric-strip">
        <span>Reels <b>${number(lastReport.reels || 0)}</b></span>
        <span>TikTok <b>${number(lastReport.tiktoks || 0)}</b></span>
        <span>Views <b>${number(rowViews(lastReport))}</b></span>
        <span>TG + <b class="${lastReport.tgGrowth >= 0 ? "positive" : "negative"}">${number(lastReport.tgGrowth)}</b></span>
        <span>Sales <b>${number(lastReport.sales || 0)}</b></span>
      </div>
    </article>

    <article class="day-card">
      <span class="eyebrow">День до этого</span>
      <div class="day-title">
        <h3>${formatDate(previousReport.date)}</h3>
        <strong>${money(previousReport.revenue || 0)}</strong>
      </div>
      <div class="metric-strip">
        <span>Reels <b>${number(previousReport.reels || 0)}</b></span>
        <span>TikTok <b>${number(previousReport.tiktoks || 0)}</b></span>
        <span>Views <b>${number(rowViews(previousReport))}</b></span>
        <span>TG + <b class="${previousReport.tgGrowth >= 0 ? "positive" : "negative"}">${number(previousReport.tgGrowth)}</b></span>
        <span>Sales <b>${number(previousReport.sales || 0)}</b></span>
      </div>
    </article>
  `;

  const signal = document.querySelector("#growthSignal");
  signal.textContent = periodLabel();
}

function formatChartValue(value, type = "number") {
  if (type === "money") return money(value);
  return number(value);
}

function chartPoint(index, length, plotWidth, padLeft) {
  if (length <= 1) return padLeft + plotWidth / 2;
  return padLeft + (plotWidth / (length - 1)) * index;
}

function placeChartTooltip(chart, x, y, text) {
  const tooltip = chart.querySelector(".chart-tooltip");
  if (!tooltip) return;

  tooltip.textContent = text;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.classList.add("active");
}

function bindChartTooltip(chart, points) {
  const svg = chart.querySelector(".chart-svg");
  if (!svg || !points.length) return;

  svg.addEventListener("click", (event) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = Number(svg.getAttribute("width")) / rect.width;
    const scaleY = Number(svg.getAttribute("height")) / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;
    const closest = points.reduce((best, point) => {
      const distance = Math.hypot(point.x - clickX, point.y - clickY);
      return !best || distance < best.distance ? { ...point, distance } : best;
    }, null);

    if (!closest) return;
    placeChartTooltip(chart, closest.x, closest.y, closest.text);
  });
}

function renderDataChart(chartId, series, labels, options = {}) {
  const chart = document.querySelector(chartId);
  if (!chart) return;

  const width = Math.max(560, labels.length * 78);
  const height = 230;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 22;
  const padBottom = 46;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const allValues = series.flatMap((item) => item.values.map((value) => Number(value || 0)));
  const min = 0;
  const maxValue = Math.max(...allValues, 1);
  const max = maxValue === min ? maxValue + 1 : maxValue;
  const y = (value) => padTop + plotHeight - ((Number(value || 0) - min) / (max - min)) * plotHeight;
  const axisValues = Array.from({ length: 5 }, (_, index) => max - (max / 4) * index);

  const grid = axisValues
    .map((value, index) => {
      const lineY = padTop + (plotHeight / 4) * index;
      return `
        <g class="chart-axis">
          <line x1="${padLeft}" y1="${lineY}" x2="${width - padRight}" y2="${lineY}"></line>
          <text x="8" y="${lineY + 4}">${formatChartValue(value, options.format)}</text>
        </g>
      `;
    })
    .join("");

  const xLabels = labels
    .map((label, index) => {
      const x = chartPoint(index, labels.length, plotWidth, padLeft);
      return `<text class="chart-x-label" x="${x}" y="${height - 14}">${formatDate(label, "short")}</text>`;
    })
    .join("");

  const interactivePoints = [];
  const shapes = series
    .map((item, seriesIndex) => {
      const values = item.values;
      const label = item.label || "Value";
      const color = item.color;
      const format = item.format || options.format;

      if (item.type === "bar") {
        const barGroupCount = series.filter((entry) => entry.type === "bar").length || 1;
        const step = plotWidth / Math.max(labels.length, 1);
        const barWidth = Math.max(Math.min(step / (barGroupCount + 1), 22), 8);
        const barOffset = (seriesIndex - (barGroupCount - 1) / 2) * (barWidth + 4);

        return values
          .map((value, index) => {
            const x = padLeft + step * index + step / 2 - barWidth / 2 + barOffset;
            const top = y(value);
            const barHeight = Math.max(padTop + plotHeight - top, Number(value || 0) > 0 ? 3 : 0);
            const tooltip = `${formatDate(labels[index])} · ${label}: ${formatChartValue(value, format)}`;
            interactivePoints.push({
              x: x + barWidth / 2,
              y: top,
              text: tooltip,
            });
            return `
              <rect class="chart-bar" x="${x}" y="${top}" width="${barWidth}" height="${barHeight}" fill="${color}" tabindex="0" data-tooltip="${tooltip}">
                <title>${tooltip}</title>
              </rect>
            `;
          })
          .join("");
      }

      const points = values
        .map((value, index) => `${chartPoint(index, labels.length, plotWidth, padLeft)},${y(value)}`)
        .join(" ");
      const circles = values
        .map((value, index) => {
          const x = chartPoint(index, labels.length, plotWidth, padLeft);
          const pointY = y(value);
          const tooltip = `${formatDate(labels[index])} · ${label}: ${formatChartValue(value, format)}`;
          interactivePoints.push({ x, y: pointY, text: tooltip });
          return `
            <circle class="chart-dot" cx="${x}" cy="${pointY}" r="5" fill="${color}" tabindex="0" data-tooltip="${tooltip}">
              <title>${tooltip}</title>
            </circle>
          `;
        })
        .join("");

      return `
        <polyline class="chart-line" points="${points}" stroke="${color}"></polyline>
        ${circles}
      `;
    })
    .join("");

  const legend = series
    .map((item) => `<span><i style="background:${item.color}"></i>${item.label || "Value"}</span>`)
    .join("");

  chart.innerHTML = `
    <div class="chart-scroll" tabindex="0" aria-label="Scroll chart horizontally">
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
        ${grid}
        ${shapes}
        ${xLabels}
      </svg>
      <div class="chart-tooltip" aria-live="polite"></div>
    </div>
    <div class="chart-legend">${legend}</div>
  `;

  chart.querySelectorAll("[data-tooltip]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      placeChartTooltip(chart, Number(element.getAttribute("cx") || Number(element.getAttribute("x")) + Number(element.getAttribute("width") || 0) / 2), Number(element.getAttribute("cy") || element.getAttribute("y")), element.dataset.tooltip);
    });
  });

  bindChartTooltip(chart, interactivePoints);
}

function renderCharts() {
  const sorted = sortedEntries();
  const rows = scopedEntries();
  if (!rows.length) {
    document.querySelector("#contentTotal").textContent = "0";
    document.querySelector("#igViewsTotal").textContent = "0";
    document.querySelector("#ttViewsTotal").textContent = "0";
    document.querySelector("#tgGrowthTotal").textContent = "+0";
    document.querySelector("#salesRevenueTotal").textContent = money(0);
    document.querySelectorAll("[data-period-label]").forEach((item) => {
      item.textContent = periodLabel();
    });
    ["#contentChart", "#igViewsChart", "#ttViewsChart", "#tgGrowthChart", "#salesRevenueChart"].forEach((selector) => {
      const chart = document.querySelector(selector);
      if (chart) chart.innerHTML = `<div class="chart-empty">Данных пока нет</div>`;
    });
    return;
  }

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
    { label: "Reels", color: "#fb7185", values: reels, type: "bar" },
    { label: "TikTok", color: "#38bdf8", values: tiktoks, type: "bar" },
  ];
  const igViewsSeries = [{ label: "Instagram", color: "#2f89ff", values: igViews }];
  const ttViewsSeries = [{ label: "TikTok", color: "#38bdf8", values: ttViews }];
  const tgSeries = [{ label: "TG +", color: "#5ee15a", values: growth, type: "bar" }];
  const salesRevenueSeries = [{ label: "Sales", color: "#c084fc", values: salesRevenue, format: "money" }];

  renderDataChart("#contentChart", contentSeries, labels);
  renderDataChart("#igViewsChart", igViewsSeries, labels);
  renderDataChart("#ttViewsChart", ttViewsSeries, labels);
  renderDataChart("#tgGrowthChart", tgSeries, labels);
  renderDataChart("#salesRevenueChart", salesRevenueSeries, labels, { format: "money" });
}

function renderSummary() {
  const sorted = sortedEntries();
  const rows = scopedEntries();
  if (!rows.length) {
    periodSummary.innerHTML = `
      <p>За ${periodLabel()} данных пока нет.</p>
      <div class="summary-strip">
        <span>Выручка <b>${money(0)}</b></span>
        <span>Чистые <b>${money(0)}</b></span>
        <span>Продажи ЗТТ <b>0</b></span>
      </div>
    `;
    return;
  }

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
  const chronological = sortedEntries();
  if (!chronological.length) {
    historyRows.innerHTML = `<tr><td colspan="11">Данных пока нет</td></tr>`;
    return;
  }

  historyRows.innerHTML = [...chronological]
    .reverse()
    .map((row) => {
      const revenue = rowRevenue(row);
      const profit = revenue - row.adSpend;
      const tgGrowth = telegramGrowth(row, chronological);
      const igGrowth = instagramGrowth(row, chronological);
      return `
        <tr>
          <td>${formatDate(row.date)}</td>
          <td>${money(revenue)}</td>
          <td>${money(row.adSpend)}</td>
          <td class="${profit >= 0 ? "positive" : "negative"}">${money(profit)}</td>
          <td>${number(row.reels)}</td>
          <td>${number(row.igViews)}</td>
          <td class="${igGrowth >= 0 ? "positive" : "negative"}">${igGrowth >= 0 ? "+" : ""}${number(igGrowth)}</td>
          <td>${number(row.tiktoks)}</td>
          <td>${number(row.ttViews)}</td>
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

function todayLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function syncSource(path, date) {
  const response = await fetch(`${path}?date=${date}&secret=${encodeURIComponent(syncSecret)}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Sync failed: ${path}`);
  }

  return payload;
}

async function refreshTodayStats() {
  if (!refreshStatsButton) return;

  const date = todayLocalDate();
  refreshStatsButton.disabled = true;
  refreshStatsButton.textContent = "Обновляю...";
  if (refreshStatus) refreshStatus.textContent = "Meta, Instagram, Telegram";

  try {
    await syncSource("/api/sync-meta", date);
    if (refreshStatus) refreshStatus.textContent = "Instagram...";
    await syncSource("/api/sync-instagram", date);
    if (refreshStatus) refreshStatus.textContent = "Telegram...";
    await syncSource("/api/sync-telegram", date);
    await loadEntriesFromSupabase();
    render();
    if (refreshStatus) refreshStatus.textContent = "Готово";
  } catch (error) {
    console.warn("Manual stats refresh failed.", error);
    if (refreshStatus) refreshStatus.textContent = "Ошибка обновления";
    alert(`Не получилось обновить статистику: ${error.message}`);
  } finally {
    refreshStatsButton.disabled = false;
    refreshStatsButton.textContent = "Обновить статистику";
  }
}

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    rangeButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    selectedRange = button.dataset.range;
    customRange?.classList.toggle("hidden", selectedRange !== "custom");
    render();
  });
});

[customStart, customEnd].forEach((input) => {
  input?.addEventListener("change", render);
});

form.addEventListener("input", updateCalculatedRevenue);

refreshStatsButton?.addEventListener("click", refreshTodayStats);

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

resetButton?.addEventListener("click", () => {
  entries = [];
  saveEntries();
  fillFormDefaults();
  render();
});

function unlockDashboard() {
  localStorage.setItem(authStorageKey, "true");
  lockScreen.classList.add("hidden");
  fillFormDefaults();
  loadEntriesFromSupabase().finally(() => {
    fillFormDefaults();
    render();
  });
}

lockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (passwordInput.value === dashboardPassword) {
    unlockDashboard();
    return;
  }
  lockError.textContent = "Неверный пароль";
  passwordInput.value = "";
  passwordInput.focus();
});

if (localStorage.getItem(authStorageKey) === "true") {
  unlockDashboard();
} else {
  lockScreen.classList.remove("hidden");
  fillFormDefaults();
  render();
}
