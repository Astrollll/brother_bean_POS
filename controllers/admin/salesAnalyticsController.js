const SALES_PRESET_KEY = "bb_sales_analytics_presets_v1";

export function createSalesAnalyticsPageController({ getAllOrders }) {
  const state = {
    initialized: false,
    orders: [],
    filteredOrders: [],
    selectedDates: new Set(),
    dragStartIso: "",
    dragPreviewEndIso: "",
    monthCursor: "",
    periodA: null,
    periodB: null,
    filters: {
      staff: "all",
      payment: "all",
      category: "all",
    },
    customRanges: {
      aStart: "",
      aEnd: "",
      bStart: "",
      bEnd: "",
    },
    presets: [],
    charts: {
      trend: null,
      compare: null,
      payment: null,
      products: null,
    },
  };

  function dayjsSafe(value) {
    if (window.dayjs) return window.dayjs(value);
    return null;
  }

  function nowDayjs() {
    return dayjsSafe(new Date());
  }

  function ensureLibraries() {
    if (!window.Chart) {
      throw new Error("Chart.js did not load. Please refresh and try again.");
    }
    if (!window.dayjs) {
      throw new Error("Day.js did not load. Please refresh and try again.");
    }
  }

  function currency(value) {
    return `\u20b1${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function pct(value) {
    const n = Number(value || 0);
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(1)}%`;
  }

  function inferCategory(name) {
    const text = String(name || "").toLowerCase();
    if (/latte|espresso|cappuccino|americano|mocha|macchiato|flat white/.test(text)) return "Coffee";
    if (/tea|matcha|chai/.test(text)) return "Tea";
    if (/sandwich|pasta|rice|bagel|croissant/.test(text)) return "Food";
    if (/cake|muffin|cookie|brownie|donut/.test(text)) return "Pastry";
    return "Other";
  }

  function getOrderDate(order) {
    if (order?.createdAt?.toDate) return order.createdAt.toDate();
    if (order?.createdAtMs) return new Date(order.createdAtMs);
    if (order?.timestamp) return new Date(order.timestamp);
    if (order?.createdAt) return new Date(order.createdAt);
    return null;
  }

  function normalizePayment(paymentMethod) {
    const normalized = String(paymentMethod || "cash").trim().toLowerCase();
    if (normalized.includes("gcash")) return "gcash";
    if (normalized.includes("card") || normalized.includes("debit") || normalized.includes("credit")) return "card";
    if (normalized.includes("maya")) return "gcash";
    return "cash";
  }

  function normalizeOrders(rawOrders) {
    return (Array.isArray(rawOrders) ? rawOrders : [])
      .map((order, index) => {
        const date = getOrderDate(order);
        if (!date || Number.isNaN(date.getTime())) return null;
        const d = dayjsSafe(date);
        if (!d) return null;

        const items = (Array.isArray(order?.items) ? order.items : []).map((item) => ({
          name: String(item?.name || "Unknown Item").trim() || "Unknown Item",
          quantity: Math.max(1, Number(item?.quantity || 1) || 1),
          category: String(item?.category || inferCategory(item?.name)).trim() || "Other",
        }));

        const total = Math.max(0, Number(order?.total || order?.amount || 0));

        return {
          id: String(order?.id || `ord-${index}`),
          date,
          isoDate: d.format("YYYY-MM-DD"),
          hour: d.hour(),
          total,
          payment: normalizePayment(order?.paymentMethod || order?.payment || "cash"),
          staff: String(order?.staffName || order?.cashier || order?.handledBy || order?.employeeName || "Unassigned").trim() || "Unassigned",
          items,
          isMock: !!order?.isMock,
        };
      })
      .filter(Boolean);
  }

  function hashString(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedHour(rand) {
    const bands = [
      { hour: 7, w: 4 },
      { hour: 8, w: 9 },
      { hour: 9, w: 12 },
      { hour: 10, w: 10 },
      { hour: 11, w: 8 },
      { hour: 12, w: 12 },
      { hour: 13, w: 10 },
      { hour: 14, w: 11 },
      { hour: 15, w: 12 },
      { hour: 16, w: 8 },
      { hour: 17, w: 7 },
      { hour: 18, w: 6 },
      { hour: 19, w: 3 },
    ];
    const total = bands.reduce((sum, b) => sum + b.w, 0);
    let target = rand() * total;
    for (const band of bands) {
      target -= band.w;
      if (target <= 0) return band.hour;
    }
    return 14;
  }

  function generateMockOrders(startIso, endIso) {
    const catalog = [
      { name: "Spanish Oat Latte", price: 165, category: "Coffee" },
      { name: "Iced Americano", price: 120, category: "Coffee" },
      { name: "Caramel Macchiato", price: 175, category: "Coffee" },
      { name: "Dirty Matcha", price: 185, category: "Tea" },
      { name: "Sea Salt Latte", price: 170, category: "Coffee" },
      { name: "Cold Brew", price: 145, category: "Coffee" },
      { name: "Chicken Pesto Sandwich", price: 210, category: "Food" },
      { name: "Blueberry Muffin", price: 95, category: "Pastry" },
      { name: "Chocolate Croissant", price: 110, category: "Pastry" },
      { name: "Classic Matcha", price: 155, category: "Tea" },
    ];
    const staffNames = ["Aly", "Bea", "Carlo", "Dee", "Enzo"];

    const start = dayjsSafe(startIso).startOf("day");
    const end = dayjsSafe(endIso).endOf("day");
    const all = [];

    let cursor = start;
    while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
      const key = cursor.format("YYYY-MM-DD");
      const rand = mulberry32(hashString(`bb-${key}`));
      const weekday = cursor.day();
      const base = weekday === 0 ? 28 : weekday === 6 ? 34 : weekday === 2 ? 22 : 30;
      const dailyTransactions = Math.max(10, Math.round(base + (rand() - 0.5) * 10));

      for (let idx = 0; idx < dailyTransactions; idx += 1) {
        const orderRand = mulberry32(hashString(`${key}-${idx}`));
        const hour = weightedHour(orderRand);
        const minute = Math.floor(orderRand() * 60);

        const dt = cursor.hour(hour).minute(minute).second(0).millisecond(0);
        const itemsCount = orderRand() > 0.7 ? 3 : orderRand() > 0.35 ? 2 : 1;

        const pickedItems = [];
        for (let i = 0; i < itemsCount; i += 1) {
          const pick = catalog[Math.floor(orderRand() * catalog.length)];
          const quantity = orderRand() > 0.8 ? 2 : 1;
          pickedItems.push({
            name: pick.name,
            quantity,
            category: pick.category,
          });
        }

        const subtotal = pickedItems.reduce((sum, item) => {
          const baseItem = catalog.find((entry) => entry.name === item.name);
          return sum + (baseItem ? baseItem.price : 120) * item.quantity;
        }, 0);

        const paymentRoll = orderRand();
        const payment = paymentRoll < 0.46 ? "cash" : paymentRoll < 0.8 ? "gcash" : "card";

        all.push({
          id: `mock-${key}-${idx}`,
          createdAtMs: dt.valueOf(),
          paymentMethod: payment,
          total: Math.round(subtotal + orderRand() * 25),
          items: pickedItems,
          staffName: staffNames[Math.floor(orderRand() * staffNames.length)],
          isMock: true,
        });
      }

      cursor = cursor.add(1, "day");
    }

    return all;
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(SALES_PRESET_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      state.presets = Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      state.presets = [];
    }
  }

  function persistPresets() {
    localStorage.setItem(SALES_PRESET_KEY, JSON.stringify(state.presets));
  }

  function renderShell(container) {
    container.innerHTML = `
      <section class="sa-toolbar card compact-card">
        <div class="sa-toolbar-row">
          <div class="sa-quick-compare" role="group" aria-label="Quick compare">
            <button class="orders-btn" data-quick="yesterday-today" type="button">Yesterday vs Today</button>
            <button class="orders-btn ghost" data-quick="week" type="button">Last Week vs This Week</button>
            <button class="orders-btn ghost" data-quick="month" type="button">Last Month vs This Month</button>
            <button class="orders-btn ghost" data-quick="custom" type="button">Custom Range</button>
          </div>
          <div class="sa-export-actions">
            <button class="orders-btn ghost" id="saExportPdf" type="button">Download PDF</button>
            <button class="orders-btn ghost" id="saExportExcel" type="button">Download Excel</button>
            <button class="orders-btn ghost" id="saPrint" type="button">Print View</button>
            <button class="orders-btn ghost" id="saShareEmail" type="button">Share Email</button>
          </div>
        </div>

        <div class="sa-toolbar-row sa-filter-row">
          <select class="ls-input" id="saFilterStaff">
            <option value="all">All Staff</option>
          </select>
          <select class="ls-input" id="saFilterPayment">
            <option value="all">All Payments</option>
            <option value="cash">Cash</option>
            <option value="gcash">GCash</option>
            <option value="card">Card</option>
          </select>
          <select class="ls-input" id="saFilterCategory">
            <option value="all">All Categories</option>
          </select>
          <select class="ls-input" id="saPresetSelect">
            <option value="">Saved Presets</option>
          </select>
          <input class="ls-input" id="saPresetName" placeholder="Preset name (e.g. Payday Sale)" />
          <button class="orders-btn" type="button" id="saSavePreset">Save Preset</button>
        </div>

        <div class="sa-custom-range" id="saCustomRangePanel" hidden>
          <div class="sa-custom-grid">
            <label>A Start<input class="ls-input" type="date" id="saAStart" /></label>
            <label>A End<input class="ls-input" type="date" id="saAEnd" /></label>
            <label>B Start<input class="ls-input" type="date" id="saBStart" /></label>
            <label>B End<input class="ls-input" type="date" id="saBEnd" /></label>
            <button class="orders-btn" id="saApplyCustom" type="button">Apply Comparison</button>
          </div>
        </div>
      </section>

      <section class="sa-top-grid">
        <article class="card sa-calendar-card">
          <div class="card-head">
            <span class="card-title">Interactive Sales Calendar</span>
            <div class="sa-calendar-nav">
              <button class="card-action" id="saPrevMonth" type="button">Prev</button>
              <span id="saMonthLabel" class="sa-month-label"></span>
              <button class="card-action" id="saNextMonth" type="button">Next</button>
            </div>
          </div>
          <div class="sa-weekdays">
            <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
          </div>
          <div id="saCalendarGrid" class="sa-calendar-grid"></div>
          <div id="saSelectedDates" class="sa-selected-dates"></div>
        </article>

        <article class="card sa-compare-card">
          <div class="card-head">
            <span class="card-title">Period Comparison</span>
          </div>
          <div id="saCompareCards" class="sa-compare-cards"></div>
        </article>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="card-title">Sales Trend</span>
        </div>
        <div class="sa-chart-wrap"><canvas id="saTrendChart" height="120"></canvas></div>
      </section>

      <section class="sa-middle-grid">
        <article class="card">
          <div class="card-head"><span class="card-title">Period Breakdown Comparison</span></div>
          <div class="sa-chart-wrap"><canvas id="saCompareChart" height="220"></canvas></div>
        </article>
        <article class="card">
          <div class="card-head"><span class="card-title">Payment Method Mix</span></div>
          <div class="sa-chart-wrap"><canvas id="saPaymentChart" height="220"></canvas></div>
        </article>
      </section>

      <section class="sa-bottom-grid">
        <article class="card">
          <div class="card-head"><span class="card-title">Top Products</span></div>
          <div class="sa-chart-wrap"><canvas id="saProductsChart" height="220"></canvas></div>
          <div id="saTopProductsTable" class="sa-top-products-table"></div>
        </article>

        <article class="card">
          <div class="card-head"><span class="card-title">Peak Hours Heatmap</span></div>
          <div id="saPeakHeatmap" class="sa-peak-heatmap"></div>
          <div class="card-head" style="padding-top:12px;"><span class="card-title">Smart Insights</span></div>
          <ul id="saInsights" class="sa-insights"></ul>
        </article>
      </section>
    `;
  }

  function bindEvents(container) {
    container.querySelectorAll("[data-quick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyQuickCompare(String(btn.dataset.quick || ""));
      });
    });

    container.querySelector("#saPrevMonth")?.addEventListener("click", () => {
      state.monthCursor = dayjsSafe(state.monthCursor).subtract(1, "month").format("YYYY-MM-01");
      renderCalendar();
    });

    container.querySelector("#saNextMonth")?.addEventListener("click", () => {
      state.monthCursor = dayjsSafe(state.monthCursor).add(1, "month").format("YYYY-MM-01");
      renderCalendar();
    });

    const filterStaff = container.querySelector("#saFilterStaff");
    const filterPayment = container.querySelector("#saFilterPayment");
    const filterCategory = container.querySelector("#saFilterCategory");

    [filterStaff, filterPayment, filterCategory].forEach((el) => {
      el?.addEventListener("change", () => {
        state.filters.staff = String(filterStaff?.value || "all");
        state.filters.payment = String(filterPayment?.value || "all");
        state.filters.category = String(filterCategory?.value || "all");
        applyFiltersAndRefresh();
      });
    });

    container.querySelector("#saApplyCustom")?.addEventListener("click", () => {
      const aStart = String(container.querySelector("#saAStart")?.value || "");
      const aEnd = String(container.querySelector("#saAEnd")?.value || "");
      const bStart = String(container.querySelector("#saBStart")?.value || "");
      const bEnd = String(container.querySelector("#saBEnd")?.value || "");
      if (!aStart || !aEnd || !bStart || !bEnd) return;
      setComparisonPeriods(
        { label: "Period A", start: aStart, end: aEnd },
        { label: "Period B", start: bStart, end: bEnd }
      );
      refreshAnalyticsViews();
    });

    container.querySelector("#saSavePreset")?.addEventListener("click", () => {
      const name = String(container.querySelector("#saPresetName")?.value || "").trim();
      if (!name || !state.periodA || !state.periodB) return;

      state.presets = state.presets.filter((entry) => entry.name !== name);
      state.presets.unshift({
        name,
        periodA: state.periodA,
        periodB: state.periodB,
      });
      state.presets = state.presets.slice(0, 12);
      persistPresets();
      renderPresetOptions();
      container.querySelector("#saPresetName").value = "";
    });

    container.querySelector("#saPresetSelect")?.addEventListener("change", (event) => {
      const value = String(event?.target?.value || "");
      if (!value) return;
      const preset = state.presets.find((entry) => entry.name === value);
      if (!preset) return;
      setComparisonPeriods(preset.periodA, preset.periodB);
      refreshAnalyticsViews();
    });

    container.querySelector("#saExportExcel")?.addEventListener("click", exportExcel);
    container.querySelector("#saExportPdf")?.addEventListener("click", exportPdf);
    container.querySelector("#saPrint")?.addEventListener("click", () => window.print());
    container.querySelector("#saShareEmail")?.addEventListener("click", shareEmailSummary);

    document.addEventListener("mouseup", () => {
      if (!state.dragStartIso || !state.dragPreviewEndIso) return;
      if (state.dragStartIso !== state.dragPreviewEndIso) {
        selectRange(state.dragStartIso, state.dragPreviewEndIso);
      }
      state.dragStartIso = "";
      state.dragPreviewEndIso = "";
      renderCalendar();
      syncComparisonFromDates();
      refreshAnalyticsViews();
    });
  }

  function renderPresetOptions() {
    const el = document.getElementById("saPresetSelect");
    if (!el) return;
    el.innerHTML = [
      '<option value="">Saved Presets</option>',
      ...state.presets.map((entry) => `<option value="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</option>`),
    ].join("");
  }

  function collectFilterOptions() {
    const staffNames = new Set();
    const categories = new Set();

    state.orders.forEach((order) => {
      staffNames.add(order.staff || "Unassigned");
      order.items.forEach((item) => categories.add(item.category || "Other"));
    });

    const staffEl = document.getElementById("saFilterStaff");
    const categoryEl = document.getElementById("saFilterCategory");

    if (staffEl) {
      staffEl.innerHTML = [
        '<option value="all">All Staff</option>',
        ...Array.from(staffNames).sort().map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
      ].join("");
    }

    if (categoryEl) {
      categoryEl.innerHTML = [
        '<option value="all">All Categories</option>',
        ...Array.from(categories).sort().map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
      ].join("");
    }
  }

  function applyFiltersAndRefresh() {
    state.filteredOrders = state.orders.filter((order) => {
      if (state.filters.staff !== "all" && order.staff !== state.filters.staff) return false;
      if (state.filters.payment !== "all" && order.payment !== state.filters.payment) return false;
      if (state.filters.category !== "all") {
        const hasCategory = order.items.some((item) => item.category === state.filters.category);
        if (!hasCategory) return false;
      }
      return true;
    });

    if (!state.filteredOrders.length) {
      const selectedDates = document.getElementById("saSelectedDates");
      if (selectedDates) {
        selectedDates.innerHTML = '<span class="sa-empty">No orders match this filter set.</span>';
      }
    }

    syncComparisonFromDates();
    refreshAnalyticsViews();
  }

  function heatColor(ratio) {
    const clamp = Math.max(0, Math.min(1, ratio));
    const start = { r: 243, g: 244, b: 246 };
    const end = { r: 5, g: 150, b: 105 };
    const r = Math.round(start.r + (end.r - start.r) * clamp);
    const g = Math.round(start.g + (end.g - start.g) * clamp);
    const b = Math.round(start.b + (end.b - start.b) * clamp);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function getDailyStats(orders) {
    const daily = {};
    orders.forEach((order) => {
      if (!daily[order.isoDate]) {
        daily[order.isoDate] = {
          sales: 0,
          tx: 0,
          products: {},
          payments: { cash: 0, gcash: 0, card: 0 },
          hourly: new Array(24).fill(0),
        };
      }
      const bucket = daily[order.isoDate];
      bucket.sales += order.total;
      bucket.tx += 1;
      bucket.payments[order.payment] = (bucket.payments[order.payment] || 0) + order.total;
      bucket.hourly[order.hour] += order.total;
      order.items.forEach((item) => {
        bucket.products[item.name] = (bucket.products[item.name] || 0) + item.quantity;
      });
    });

    return daily;
  }

  function renderCalendar() {
    const monthLabel = document.getElementById("saMonthLabel");
    const grid = document.getElementById("saCalendarGrid");
    if (!monthLabel || !grid) return;

    const cursor = dayjsSafe(state.monthCursor).startOf("month");
    monthLabel.textContent = cursor.format("MMMM YYYY");

    const start = cursor.startOf("month");
    const end = cursor.endOf("month");
    const firstWeekday = start.day();
    const days = end.date();

    const monthOrders = state.filteredOrders.filter((order) => dayjsSafe(order.isoDate).isSame(cursor, "month"));
    const monthDaily = getDailyStats(monthOrders);
    const maxSales = Math.max(1, ...Object.values(monthDaily).map((entry) => Number(entry.sales || 0)));

    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push('<div class="sa-day is-empty"></div>');
    }

    for (let day = 1; day <= days; day += 1) {
      const iso = cursor.date(day).format("YYYY-MM-DD");
      const entry = monthDaily[iso] || { sales: 0, tx: 0 };
      const ratio = entry.sales / maxSales;
      const isSelected = state.selectedDates.has(iso);
      const isCompareA = state.periodA && iso >= state.periodA.start && iso <= state.periodA.end;
      const isCompareB = state.periodB && iso >= state.periodB.start && iso <= state.periodB.end;
      const isToday = iso === nowDayjs().format("YYYY-MM-DD");
      const isDraggingPreview = state.dragStartIso && state.dragPreviewEndIso && isWithinRange(iso, state.dragStartIso, state.dragPreviewEndIso);
      const dots = new Array(Math.min(3, entry.tx)).fill('<span class="sa-dot"></span>').join("");
      const tooltip = `Sales: ${currency(entry.sales)} | Transactions: ${entry.tx}`;

      cells.push(`
        <button
          class="sa-day ${isSelected ? "is-selected" : ""} ${isCompareA ? "is-compare-a" : ""} ${isCompareB ? "is-compare-b" : ""} ${isToday ? "is-today" : ""} ${isDraggingPreview ? "is-preview" : ""}"
          data-iso="${iso}"
          type="button"
          style="background:${heatColor(ratio)}"
          title="${escapeHtml(tooltip)}"
        >
          <span class="sa-date-num">${day}</span>
          <span class="sa-dots">${dots}</span>
        </button>
      `);
    }

    grid.innerHTML = cells.join("");

    grid.querySelectorAll(".sa-day[data-iso]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const iso = String(btn.dataset.iso || "");
        if (!iso) return;
        if (state.selectedDates.has(iso)) {
          state.selectedDates.delete(iso);
        } else {
          state.selectedDates.add(iso);
        }
        syncComparisonFromDates();
        renderCalendar();
        refreshAnalyticsViews();
      });

      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const iso = String(btn.dataset.iso || "");
        state.dragStartIso = iso;
        state.dragPreviewEndIso = iso;
      });

      btn.addEventListener("mouseenter", () => {
        if (!state.dragStartIso) return;
        state.dragPreviewEndIso = String(btn.dataset.iso || "");
        renderCalendar();
      });
    });

    const selectedDatesEl = document.getElementById("saSelectedDates");
    if (selectedDatesEl) {
      const selected = Array.from(state.selectedDates).sort();
      selectedDatesEl.innerHTML = selected.length
        ? selected.map((iso) => `<span class="sa-date-pill">${dayjsSafe(iso).format("MMM D")}</span>`).join("")
        : '<span class="sa-empty">Select one or more dates to compare. Drag across dates to pick a range.</span>';
    }
  }

  function isWithinRange(targetIso, startIso, endIso) {
    const s = startIso <= endIso ? startIso : endIso;
    const e = startIso <= endIso ? endIso : startIso;
    return targetIso >= s && targetIso <= e;
  }

  function selectRange(startIso, endIso) {
    const s = startIso <= endIso ? startIso : endIso;
    const e = startIso <= endIso ? endIso : startIso;
    let cursor = dayjsSafe(s);
    const end = dayjsSafe(e);
    while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
      state.selectedDates.add(cursor.format("YYYY-MM-DD"));
      cursor = cursor.add(1, "day");
    }
  }

  function setComparisonPeriods(periodA, periodB) {
    state.periodA = normalizePeriod(periodA, "Period A");
    state.periodB = normalizePeriod(periodB, "Period B");
    state.customRanges.aStart = state.periodA.start;
    state.customRanges.aEnd = state.periodA.end;
    state.customRanges.bStart = state.periodB.start;
    state.customRanges.bEnd = state.periodB.end;

    setCustomInputs();
  }

  function normalizePeriod(period, fallbackLabel) {
    const start = dayjsSafe(period?.start || nowDayjs().format("YYYY-MM-DD")).format("YYYY-MM-DD");
    const end = dayjsSafe(period?.end || start).format("YYYY-MM-DD");
    const normalizedStart = start <= end ? start : end;
    const normalizedEnd = start <= end ? end : start;
    return {
      label: String(period?.label || fallbackLabel || "Period"),
      start: normalizedStart,
      end: normalizedEnd,
    };
  }

  function applyQuickCompare(type) {
    const panel = document.getElementById("saCustomRangePanel");
    if (panel) panel.hidden = type !== "custom";

    const today = nowDayjs();
    if (type === "yesterday-today") {
      const yesterday = today.subtract(1, "day").format("YYYY-MM-DD");
      const todayIso = today.format("YYYY-MM-DD");
      setComparisonPeriods(
        { label: "Yesterday", start: yesterday, end: yesterday },
        { label: "Today", start: todayIso, end: todayIso }
      );
      refreshAnalyticsViews();
      return;
    }

    if (type === "week") {
      const thisDay = today.format("YYYY-MM-DD");
      const lastWeek = today.subtract(7, "day").format("YYYY-MM-DD");
      setComparisonPeriods(
        { label: "Last Week (Same Day)", start: lastWeek, end: lastWeek },
        { label: "This Week (Same Day)", start: thisDay, end: thisDay }
      );
      refreshAnalyticsViews();
      return;
    }

    if (type === "month") {
      const startMonth = today.startOf("month");
      const elapsedDays = Math.max(1, today.date());
      const prevStart = startMonth.subtract(1, "month");
      const prevEnd = prevStart.date(Math.min(elapsedDays, prevStart.daysInMonth()));
      setComparisonPeriods(
        { label: "Last Month", start: prevStart.format("YYYY-MM-DD"), end: prevEnd.format("YYYY-MM-DD") },
        { label: "This Month", start: startMonth.format("YYYY-MM-DD"), end: today.format("YYYY-MM-DD") }
      );
      refreshAnalyticsViews();
    }
  }

  function syncComparisonFromDates() {
    const picks = Array.from(state.selectedDates).sort();
    if (picks.length >= 2) {
      setComparisonPeriods(
        { label: dayjsSafe(picks[picks.length - 2]).format("MMM D"), start: picks[picks.length - 2], end: picks[picks.length - 2] },
        { label: dayjsSafe(picks[picks.length - 1]).format("MMM D"), start: picks[picks.length - 1], end: picks[picks.length - 1] }
      );
      return;
    }

    if (picks.length === 1) {
      const selected = dayjsSafe(picks[0]);
      const prev = selected.subtract(1, "day").format("YYYY-MM-DD");
      setComparisonPeriods(
        { label: "Previous Day", start: prev, end: prev },
        { label: "Selected Day", start: picks[0], end: picks[0] }
      );
      return;
    }

    applyQuickCompare("yesterday-today");
  }

  function setCustomInputs() {
    const map = [
      ["saAStart", state.customRanges.aStart],
      ["saAEnd", state.customRanges.aEnd],
      ["saBStart", state.customRanges.bStart],
      ["saBEnd", state.customRanges.bEnd],
    ];
    map.forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });
  }

  function ordersForPeriod(period) {
    const start = period.start;
    const end = period.end;
    return state.filteredOrders.filter((order) => order.isoDate >= start && order.isoDate <= end);
  }

  function summarizePeriod(period) {
    const orders = ordersForPeriod(period);
    const products = {};
    const hourly = new Array(24).fill(0);
    const dailyMap = {};
    const payments = { cash: 0, gcash: 0, card: 0 };

    orders.forEach((order) => {
      hourly[order.hour] += order.total;
      dailyMap[order.isoDate] = (dailyMap[order.isoDate] || 0) + order.total;
      payments[order.payment] = (payments[order.payment] || 0) + order.total;
      order.items.forEach((item) => {
        products[item.name] = (products[item.name] || 0) + item.quantity;
      });
    });

    const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
    const tx = orders.length;
    const aov = tx ? totalSales / tx : 0;
    const bestProduct = Object.entries(products).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

    return {
      orders,
      totalSales,
      tx,
      aov,
      bestProduct,
      products,
      hourly,
      dailyMap,
      payments,
    };
  }

  function compareValue(a, b) {
    const safeA = Number(a || 0);
    const safeB = Number(b || 0);
    if (!safeA && !safeB) return 0;
    if (!safeA) return 100;
    return ((safeB - safeA) / safeA) * 100;
  }

  function renderCompareCards() {
    const host = document.getElementById("saCompareCards");
    if (!host || !state.periodA || !state.periodB) return;

    const a = summarizePeriod(state.periodA);
    const b = summarizePeriod(state.periodB);

    const salesDelta = compareValue(a.totalSales, b.totalSales);
    const txDelta = compareValue(a.tx, b.tx);
    const aovDelta = compareValue(a.aov, b.aov);

    host.innerHTML = `
      <div class="sa-compare-columns">
        ${renderPeriodCard(state.periodA.label, state.periodA, a)}
        ${renderPeriodCard(state.periodB.label, state.periodB, b)}
      </div>
      <div class="sa-compare-deltas">
        ${renderDelta("Sales", salesDelta)}
        ${renderDelta("Transactions", txDelta)}
        ${renderDelta("Avg Order", aovDelta)}
      </div>
    `;
  }

  function renderPeriodCard(label, period, summary) {
    return `
      <article class="sa-period-card">
        <h4>${escapeHtml(label)}</h4>
        <div class="sa-period-range">${dayjsSafe(period.start).format("MMM D")} - ${dayjsSafe(period.end).format("MMM D")}</div>
        <div class="sa-metric"><span>Total Sales</span><strong>${currency(summary.totalSales)}</strong></div>
        <div class="sa-metric"><span>Transactions</span><strong>${summary.tx}</strong></div>
        <div class="sa-metric"><span>Avg Order</span><strong>${currency(summary.aov)}</strong></div>
        <div class="sa-metric"><span>Best Seller</span><strong>${escapeHtml(summary.bestProduct)}</strong></div>
      </article>
    `;
  }

  function renderDelta(label, delta) {
    const cls = delta >= 0 ? "is-up" : "is-down";
    const arrow = delta >= 0 ? "\u2191" : "\u2193";
    return `<div class="sa-delta ${cls}"><span>${escapeHtml(label)}</span><strong>${arrow} ${pct(delta)}</strong></div>`;
  }

  function destroyChart(refName) {
    const chart = state.charts[refName];
    if (chart) {
      chart.destroy();
      state.charts[refName] = null;
    }
  }

  function getChartColors() {
    const dark = document.body.getAttribute("data-theme") === "dark";
    return {
      text: dark ? "#e2e8f0" : "#334155",
      grid: dark ? "#334155" : "#e2e8f0",
      amber: "#d97706",
      green: "#10b981",
      red: "#ef4444",
      slate: dark ? "#94a3b8" : "#64748b",
    };
  }

  function updateCharts() {
    if (!state.periodA || !state.periodB) return;

    const a = summarizePeriod(state.periodA);
    const b = summarizePeriod(state.periodB);
    const c = getChartColors();

    destroyChart("trend");
    destroyChart("compare");
    destroyChart("payment");
    destroyChart("products");

    const trendCtx = document.getElementById("saTrendChart")?.getContext("2d");
    const compareCtx = document.getElementById("saCompareChart")?.getContext("2d");
    const paymentCtx = document.getElementById("saPaymentChart")?.getContext("2d");
    const productsCtx = document.getElementById("saProductsChart")?.getContext("2d");
    if (!trendCtx || !compareCtx || !paymentCtx || !productsCtx) return;

    const trendLabels = [];
    const trendValues = [];
    let cursor = dayjsSafe(state.periodA.start);
    const trendEnd = dayjsSafe(state.periodA.end);
    while (cursor.isBefore(trendEnd) || cursor.isSame(trendEnd, "day")) {
      const iso = cursor.format("YYYY-MM-DD");
      trendLabels.push(cursor.format("MMM D"));
      trendValues.push(a.dailyMap[iso] || 0);
      cursor = cursor.add(1, "day");
    }

    state.charts.trend = new window.Chart(trendCtx, {
      type: "line",
      data: {
        labels: trendLabels,
        datasets: [{
          label: state.periodA.label,
          data: trendValues,
          borderColor: c.amber,
          backgroundColor: "rgba(217,119,6,0.18)",
          fill: true,
          tension: 0.3,
        }],
      },
      options: buildChartOptions(c),
    });

    const bothSingleDay = state.periodA.start === state.periodA.end && state.periodB.start === state.periodB.end;

    let compareLabels = [];
    let compareA = [];
    let compareB = [];

    if (bothSingleDay) {
      compareLabels = new Array(24).fill(0).map((_, h) => `${h}:00`);
      compareA = a.hourly;
      compareB = b.hourly;
    } else {
      const lengthA = dayjsSafe(state.periodA.end).diff(dayjsSafe(state.periodA.start), "day") + 1;
      const lengthB = dayjsSafe(state.periodB.end).diff(dayjsSafe(state.periodB.start), "day") + 1;
      const maxLen = Math.max(lengthA, lengthB);
      for (let i = 0; i < maxLen; i += 1) {
        compareLabels.push(`Day ${i + 1}`);
        const isoA = dayjsSafe(state.periodA.start).add(i, "day").format("YYYY-MM-DD");
        const isoB = dayjsSafe(state.periodB.start).add(i, "day").format("YYYY-MM-DD");
        compareA.push(a.dailyMap[isoA] || 0);
        compareB.push(b.dailyMap[isoB] || 0);
      }
    }

    state.charts.compare = new window.Chart(compareCtx, {
      type: "bar",
      data: {
        labels: compareLabels,
        datasets: [
          { label: state.periodA.label, data: compareA, backgroundColor: "rgba(16,185,129,0.7)" },
          { label: state.periodB.label, data: compareB, backgroundColor: "rgba(217,119,6,0.7)" },
        ],
      },
      options: buildChartOptions(c),
    });

    state.charts.payment = new window.Chart(paymentCtx, {
      type: "pie",
      data: {
        labels: ["Cash", "GCash", "Card"],
        datasets: [{
          data: [a.payments.cash + b.payments.cash, a.payments.gcash + b.payments.gcash, a.payments.card + b.payments.card],
          backgroundColor: ["#10b981", "#3b82f6", "#d97706"],
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: c.text } },
        },
      },
    });

    const topProducts = Object.entries(a.products)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8);

    state.charts.products = new window.Chart(productsCtx, {
      type: "bar",
      data: {
        labels: topProducts.map((entry) => entry[0]),
        datasets: [{
          data: topProducts.map((entry) => entry[1]),
          backgroundColor: "rgba(16,185,129,0.7)",
          borderColor: "#10b981",
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: c.text }, grid: { color: c.grid } },
          y: { ticks: { color: c.text }, grid: { color: c.grid } },
        },
      },
    });

    renderTopProductsTable(topProducts);
    renderPeakHeatmap(a.hourly);
  }

  function buildChartOptions(colors) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 420 },
      plugins: {
        legend: { labels: { color: colors.text } },
      },
      scales: {
        x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
        y: { ticks: { color: colors.text }, grid: { color: colors.grid } },
      },
    };
  }

  function renderTopProductsTable(rows) {
    const host = document.getElementById("saTopProductsTable");
    if (!host) return;

    if (!rows.length) {
      host.innerHTML = '<div class="sa-empty">No product sales for this period.</div>';
      return;
    }

    host.innerHTML = `
      <table class="sa-table">
        <thead>
          <tr><th>Product</th><th>Qty Sold</th></tr>
        </thead>
        <tbody>
          ${rows.map(([name, qty]) => `<tr><td>${escapeHtml(name)}</td><td>${qty}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
  }

  function renderPeakHeatmap(hourly) {
    const host = document.getElementById("saPeakHeatmap");
    if (!host) return;

    const max = Math.max(1, ...hourly);
    host.innerHTML = hourly
      .map((value, hour) => {
        const ratio = value / max;
        return `
          <div class="sa-hour-cell" style="background:${heatColor(ratio)}">
            <span>${String(hour).padStart(2, "0")}:00</span>
            <strong>${currency(value)}</strong>
          </div>
        `;
      })
      .join("");
  }

  function peakHour(hourly) {
    let winner = 0;
    let max = -1;
    hourly.forEach((value, idx) => {
      if (value > max) {
        winner = idx;
        max = value;
      }
    });
    return winner;
  }

  function weekdayName(num) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][num] || "Unknown";
  }

  function renderInsights() {
    const host = document.getElementById("saInsights");
    if (!host || !state.periodA || !state.periodB) return;

    const a = summarizePeriod(state.periodA);
    const b = summarizePeriod(state.periodB);

    const peakA = peakHour(a.hourly);
    const peakB = peakHour(b.hourly);

    const topA = Object.entries(a.products).sort((l, r) => r[1] - l[1])[0];
    const topBMap = Object.fromEntries(Object.entries(b.products));
    const topAInB = Number(topBMap[topA?.[0]] || 0);
    const topChange = topA ? compareValue(topAInB || 0, topA[1] || 0) : 0;

    const weekdayTotals = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    state.filteredOrders.forEach((order) => {
      const w = dayjsSafe(order.isoDate).day();
      weekdayTotals[w] += order.total;
    });
    const slowest = Object.entries(weekdayTotals).sort((l, r) => l[1] - r[1])[0];

    const sortedByDate = [...state.filteredOrders].sort((l, r) => l.isoDate.localeCompare(r.isoDate));
    const byDay = getDailyStats(sortedByDate);
    const dates = Object.keys(byDay).sort();
    const last7 = dates.slice(-7).reduce((sum, iso) => sum + (byDay[iso]?.sales || 0), 0);
    const prev7 = dates.slice(-14, -7).reduce((sum, iso) => sum + (byDay[iso]?.sales || 0), 0);
    const predicted = last7 + (last7 - prev7) * 0.5;

    const insights = [
      `Peak hour was ${peakB}:00-${peakB + 1}:00 in ${state.periodB.label} vs ${peakA}:00-${peakA + 1}:00 in ${state.periodA.label}.`,
      topA
        ? `${topA[0]} sales changed ${pct(topChange)} against the comparison period.`
        : "No dominant product detected for this range.",
      `${weekdayName(Number(slowest?.[0] || 2))} is typically your slowest day based on filtered sales history.`,
      `Projection: next 7 days could land around ${currency(predicted)} if the current trend continues.`,
    ];

    host.innerHTML = insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function exportExcel() {
    if (!state.periodA || !state.periodB) return;
    const a = summarizePeriod(state.periodA);
    const b = summarizePeriod(state.periodB);

    const rows = [
      ["Brother Bean Sales Analytics Export"],
      ["Generated", new Date().toLocaleString("en-PH")],
      [],
      ["Metric", state.periodA.label, state.periodB.label],
      ["Sales", a.totalSales, b.totalSales],
      ["Transactions", a.tx, b.tx],
      ["Average Order", a.aov, b.aov],
      ["Best Seller", a.bestProduct, b.bestProduct],
      [],
      ["Top Product", "Qty"],
      ...Object.entries(a.products).sort((l, r) => r[1] - l[1]).slice(0, 10),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll("\"", "\"\"")}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `brother-bean-sales-analytics-${nowDayjs().format("YYYY-MM-DD")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!state.periodA || !state.periodB) return;
    const a = summarizePeriod(state.periodA);
    const b = summarizePeriod(state.periodB);
    const html = `
      <html>
        <head><title>Brother Bean Sales Report</title></head>
        <body style="font-family:Arial,sans-serif;padding:20px;color:#111;">
          <h1>Brother Bean Sales Analytics</h1>
          <p>Generated ${new Date().toLocaleString("en-PH")}</p>
          <h2>${escapeHtml(state.periodA.label)}</h2>
          <ul>
            <li>Sales: ${currency(a.totalSales)}</li>
            <li>Transactions: ${a.tx}</li>
            <li>Average Order: ${currency(a.aov)}</li>
            <li>Best Seller: ${escapeHtml(a.bestProduct)}</li>
          </ul>
          <h2>${escapeHtml(state.periodB.label)}</h2>
          <ul>
            <li>Sales: ${currency(b.totalSales)}</li>
            <li>Transactions: ${b.tx}</li>
            <li>Average Order: ${currency(b.aov)}</li>
            <li>Best Seller: ${escapeHtml(b.bestProduct)}</li>
          </ul>
          <p>Use your browser print dialog and choose Save as PDF.</p>
        </body>
      </html>
    `;

    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) return;
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  function shareEmailSummary() {
    if (!state.periodA || !state.periodB) return;
    const a = summarizePeriod(state.periodA);
    const b = summarizePeriod(state.periodB);
    const delta = compareValue(a.totalSales, b.totalSales);

    const subject = encodeURIComponent("Brother Bean Sales Analytics Summary");
    const body = encodeURIComponent(
      [
        `Sales Summary (${new Date().toLocaleDateString("en-PH")})`,
        "",
        `${state.periodA.label}: ${currency(a.totalSales)} from ${a.tx} tx`,
        `${state.periodB.label}: ${currency(b.totalSales)} from ${b.tx} tx`,
        `Change: ${pct(delta)}`,
        `Top Product: ${b.bestProduct}`,
      ].join("\n")
    );

    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function refreshAnalyticsViews() {
    renderCompareCards();
    updateCharts();
    renderInsights();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function load() {
    const root = document.getElementById("salesAnalyticsContent");
    if (!root) return;

    try {
      ensureLibraries();
    } catch (error) {
      root.innerHTML = `<div class="section-state error">${escapeHtml(error?.message || "Sales analytics libraries failed to load.")}</div>`;
      return;
    }

    if (!state.initialized) {
      renderShell(root);
      bindEvents(root);
      loadPresets();
      state.monthCursor = nowDayjs().startOf("month").format("YYYY-MM-01");
      state.initialized = true;
    }

    root.classList.add("is-loading");

    try {
      let liveOrders = [];
      try {
        liveOrders = normalizeOrders(await getAllOrders());
      } catch (error) {
        console.warn("[SalesAnalytics] Falling back to mock data due to order fetch error:", error);
        liveOrders = [];
      }

      const minWindowStart = nowDayjs().subtract(120, "day").format("YYYY-MM-DD");
      const minWindowEnd = nowDayjs().format("YYYY-MM-DD");
      const mockOrders = generateMockOrders(minWindowStart, minWindowEnd);
      const normalizedMock = normalizeOrders(mockOrders);

      const recentLiveCount = liveOrders.filter((order) => order.isoDate >= minWindowStart).length;
      state.orders = recentLiveCount >= 60
        ? liveOrders
        : [...liveOrders, ...normalizedMock.filter((mock) => !liveOrders.some((live) => live.id === mock.id))];

      state.filteredOrders = [...state.orders];
      collectFilterOptions();
      renderPresetOptions();

      if (!state.periodA || !state.periodB) {
        applyQuickCompare("yesterday-today");
      } else {
        setCustomInputs();
      }

      renderCalendar();
      refreshAnalyticsViews();
    } finally {
      root.classList.remove("is-loading");
    }
  }

  return { load };
}
