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
