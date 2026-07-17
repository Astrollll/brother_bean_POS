const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const viewState = {
  dashboardInitialized: false,
  analyticsInitialized: false,
  analyticsPeriod: "all",
  analyticsChart: null,
  analyticsData: null,
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatPeso(value, digits = 0) {
  return `₱${Number(toNumber(value)).toLocaleString("en-PH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getOrderDate(order) {
  if (order?.createdAt?.toDate) return order.createdAt.toDate();
  if (order?.createdAtMs) return new Date(order.createdAtMs);
  if (order?.paidAt?.toDate) return order.paidAt.toDate();
  if (order?.paidAt) {
    const paidDate = new Date(order.paidAt);
    if (!Number.isNaN(paidDate.getTime())) return paidDate;
  }
  if (order?.timestamp) {
    const date = new Date(order.timestamp);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (order?.date) {
    const date = new Date(order.date);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const numericOrderId = Number(order?.orderId || order?.id);
  if (Number.isFinite(numericOrderId) && numericOrderId > 0) {
    const idDate = new Date(numericOrderId);
    if (!Number.isNaN(idDate.getTime())) return idDate;
  }
  return new Date();
}

function getOrderItems(order) {
  return Array.isArray(order?.items) ? order.items : [];
}

function getMenuLookup(menuItems = []) {
  const lookup = new Map();
  for (const item of Array.isArray(menuItems) ? menuItems : []) {
    const id = String(item?.firestoreId || item?.id || "").trim();
    const name = String(item?.name || "").trim();
    const normalizedName = normalizeText(name);
    if (id) lookup.set(`id:${id}`, item);
    if (normalizedName) lookup.set(`name:${normalizedName}`, item);
  }
  return lookup;
}

function resolveMenuItem(item, menuLookup) {
  const itemId = String(item?.menuItemId || "").trim();
  if (itemId && menuLookup.has(`id:${itemId}`)) return menuLookup.get(`id:${itemId}`);
  const normalizedName = normalizeText(item?.name);
  if (normalizedName && menuLookup.has(`name:${normalizedName}`)) return menuLookup.get(`name:${normalizedName}`);
  return null;
}

function getDisplayName(orderItem, menuItem) {
  return String(menuItem?.name || orderItem?.name || "Unknown item").trim();
}

function getLineTotal(orderItem, menuItem) {
  const quantity = toNumber(orderItem?.quantity || 1) || 1;
  const itemPrice = toNumber(orderItem?.price || menuItem?.price || 0);
  return itemPrice * quantity;
}

function sumRevenue(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, order) => sum + toNumber(order?.total), 0);
}

function sumDiscounts(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, order) => sum + toNumber(order?.discountAmount), 0);
}

function sortOrdersNewestFirst(orders) {
  return [...(Array.isArray(orders) ? orders : [])].sort((a, b) => getOrderDate(b).getTime() - getOrderDate(a).getTime());
}

function readStoredSalesHistory() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = window.localStorage.getItem("brotherBean_salesHistory");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeUniqueOrders(baseOrders = [], fallbackOrders = []) {
  const merged = [];
  const seen = new Set();

  for (const order of [...(Array.isArray(baseOrders) ? baseOrders : []), ...(Array.isArray(fallbackOrders) ? fallbackOrders : [])]) {
    const id = String(order?.orderId || order?.id || order?.queueId || "").trim();
    const key = id || `${String(order?.timestamp || order?.createdAtMs || order?.createdAt || Date.now())}:${String(order?.total || 0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(order);
  }

  return merged;
}

function getPeriodRange(period, now = new Date(), orders = []) {
  const end = new Date(now);
  const start = new Date(now);

  if (period === "all") {
    const source = Array.isArray(orders) ? orders : [];
    const dates = source
      .map((order) => getOrderDate(order))
      .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));

    if (!dates.length) {
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 1);
      end.setHours(0, 0, 0, 0);
      return { start, end };
    }

    const minDate = new Date(Math.min(...dates.map((date) => date.getTime())));
    const maxDate = new Date(Math.max(...dates.map((date) => date.getTime())));
    start.setFullYear(minDate.getFullYear(), minDate.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    end.setFullYear(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (period === "week") {
    const day = now.getDay();
    const diffToMonday = (day + 6) % 7;
    start.setDate(now.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (period === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(start.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
  } else {
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 1);
    end.setHours(0, 0, 0, 0);
  }

  return { start, end };
}

function getPreviousRange(period, range) {
  const start = new Date(range.start);
  const end = new Date(range.end);

  if (period === "all") {
    const duration = end.getTime() - start.getTime();
    return {
      start: new Date(start.getTime() - duration),
      end: new Date(end.getTime() - duration),
    };
  }

  if (period === "month") {
    const previousEnd = new Date(range.start);
    const previousStart = new Date(range.start);
    previousStart.setMonth(previousStart.getMonth() - 1, 1);
    previousStart.setHours(0, 0, 0, 0);
    previousEnd.setMonth(previousEnd.getMonth() - 1, 1);
    previousEnd.setHours(0, 0, 0, 0);
    previousEnd.setMonth(previousEnd.getMonth() + 1, 1);
    return { start: previousStart, end: previousEnd };
  }

  const duration = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - duration),
    end: new Date(end.getTime() - duration),
  };
}

function filterOrdersByRange(orders, range) {
  const startTime = range.start.getTime();
  const endTime = range.end.getTime();
  return sortOrdersNewestFirst(orders).filter((order) => {
    const created = getOrderDate(order).getTime();
    return created >= startTime && created < endTime;
  });
}

function bucketLabelForOrder(orderDate, period, range = null) {
  if (period === "all") {
    const base = range?.start instanceof Date ? range.start : new Date();
    const monthIndex = (orderDate.getFullYear() - base.getFullYear()) * 12 + (orderDate.getMonth() - base.getMonth());
    return monthIndex;
  }
  if (period === "week") {
    return WEEKDAY_NAMES[orderDate.getDay()];
  }
  if (period === "month") {
    const weekIndex = Math.min(4, Math.floor((orderDate.getDate() - 1) / 7) + 1);
    return `W${weekIndex}`;
  }
  const hour = orderDate.getHours();
  const nextHour = (hour + 1) % 24;
  const formatHour = (value) => {
    const suffix = value >= 12 ? "p" : "a";
    const normalized = value % 12 || 12;
    return `${normalized}${suffix}`;
  };
  return `${formatHour(hour)}-${formatHour(nextHour)}`;
}

function buildPeriodBuckets(period, range = null) {
  if (period === "all") {
    const labels = [];
    const start = range?.start instanceof Date ? new Date(range.start) : new Date();
    const end = range?.end instanceof Date ? new Date(range.end) : new Date();
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const limit = new Date(end.getFullYear(), end.getMonth(), 1);

    while (cursor <= limit) {
      labels.push(`${MONTH_NAMES[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(-2)}`);
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }

    return labels.length ? labels : ["No data"];
  }
  if (period === "week") {
    return WEEKDAY_NAMES.slice(1).concat(WEEKDAY_NAMES[0]);
  }
  if (period === "month") {
    return ["W1", "W2", "W3", "W4"];
  }
  const labels = [];
  for (let hour = 7; hour <= 20; hour += 1) {
    const nextHour = hour + 1;
    const formatHour = (value) => {
      const suffix = value >= 12 ? "p" : "a";
      const normalized = value % 12 || 12;
      return `${normalized}${suffix}`;
    };
    labels.push(`${formatHour(hour)}-${formatHour(nextHour)}`);
  }
  return labels;
}

function getBucketIndex(orderDate, period, range = null) {
  if (period === "all") {
    const base = range?.start instanceof Date ? range.start : new Date();
    const index = (orderDate.getFullYear() - base.getFullYear()) * 12 + (orderDate.getMonth() - base.getMonth());
    return Math.max(0, index);
  }
  if (period === "week") {
    return (orderDate.getDay() + 6) % 7;
  }
  if (period === "month") {
    return Math.min(3, Math.floor((orderDate.getDate() - 1) / 7));
  }
  const hour = orderDate.getHours();
  return Math.max(0, Math.min(13, hour - 7));
}

function buildTrendSeries(orders, period, range = null) {
  const labels = buildPeriodBuckets(period, range);
  const values = labels.map(() => 0);

  for (const order of orders) {
    const date = getOrderDate(order);
    const index = getBucketIndex(date, period, range);
    if (index >= 0 && index < values.length) {
      values[index] += toNumber(order?.total);
    }
  }

  return { labels, values };
}

function buildComparisonDelta(current, previous) {
  if (!previous && !current) return "0%";
  if (!previous) return "+100%";
  const delta = ((current - previous) / previous) * 100;
  const rounded = Math.round(delta);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function buildMoneyDelta(current, previous) {
  const delta = current - previous;
  if (delta === 0) return "₱0";
  return `${delta >= 0 ? "+" : "-"}₱${Math.abs(Math.round(delta)).toLocaleString("en-PH")}`;
}

function computeTopItems(orders, menuItems) {
  const menuLookup = getMenuLookup(menuItems);
  const items = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    for (const orderItem of getOrderItems(order)) {
      const menuItem = resolveMenuItem(orderItem, menuLookup);
      const name = getDisplayName(orderItem, menuItem);
      const key = normalizeText(name);
      if (!key) continue;

      const quantity = toNumber(orderItem?.quantity || 1) || 1;
      const revenue = getLineTotal(orderItem, menuItem);
      const category = String(menuItem?.category || orderItem?.category || "Uncategorized").trim();

      const current = items.get(key) || { name, quantity: 0, revenue: 0, category };
      current.quantity += quantity;
      current.revenue += revenue;
      current.category = current.category || category;
      items.set(key, current);
    }
  }

  return [...items.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name))
    .slice(0, 5);
}

function computeCategoryBreakdown(orders, menuItems) {
  const menuLookup = getMenuLookup(menuItems);
  const categories = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    for (const orderItem of getOrderItems(order)) {
      const menuItem = resolveMenuItem(orderItem, menuLookup);
      const category = String(menuItem?.category || orderItem?.category || "Uncategorized").trim() || "Uncategorized";
      const revenue = getLineTotal(orderItem, menuItem);
      const current = categories.get(category) || { name: category, revenue: 0 };
      current.revenue += revenue;
      categories.set(category, current);
    }
  }

  const entries = [...categories.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  const totalRevenue = entries.reduce((sum, item) => sum + item.revenue, 0) || 1;
  return entries.slice(0, 3).map((item) => ({
    name: item.name,
    value: item.revenue,
    percent: Math.round((item.revenue / totalRevenue) * 100),
  }));
}

function computePeakBucket(series, period, range = null) {
  const values = Array.isArray(series?.values)
    ? series.values
    : Array.isArray(series)
      ? series
      : [];
  let index = 0;
  let maxValue = 0;
  values.forEach((value, idx) => {
    if (value >= maxValue) {
      maxValue = value;
      index = idx;
    }
  });

  const labels = buildPeriodBuckets(period, range);
  const label = labels[index] || "—";
  return { label, value: maxValue };
}

function getGreetingByTime() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 14) return "Good noon";
  if (hour >= 14 && hour < 18) return "Good afternoon";
  return "Good evening";
}

function updateDashboardGreeting() {
  const greetingEl = document.getElementById("dashboardGreeting");
  const subEl = document.getElementById("dashboardGreetingSub");
  if (greetingEl) greetingEl.textContent = getGreetingByTime();
  if (subEl) subEl.textContent = "Here's what's happening at Brother Bean today.";
}

function buildDashboardTemplate() {
  return `
    <div class="page-header dashboard-hello">
      <div>
        <div class="page-title" id="dashboardGreeting">Good morning</div>
        <div class="page-sub" id="dashboardGreetingSub">Here's what's happening at Brother Bean today.</div>
      </div>
      <div class="page-sub" id="dashboardUpdatedAt">Updated just now</div>
    </div>

    <div class="stats-grid" id="dashboardStats"></div>

    <div class="card compact-card quick-actions" aria-label="Quick actions">
      <div class="card-head">
        <span class="card-title">Quick actions</span>
      </div>
      <div class="quick-actions-grid">
        <button class="qa-btn" type="button" data-action="orders">View Transactions</button>
        <button class="qa-btn" type="button" data-action="inventory">Manage Inventory</button>
        <button class="qa-btn" type="button" data-action="add-menu">Add Menu Item</button>
        <button class="qa-btn" type="button" data-action="add-staff">Add Staff Member</button>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-12 col-xl-6">
        <div class="card compact-card h-100">
          <div class="card-head">
            <span class="card-title">Recent Transactions</span>
            <span class="card-action" id="seeAllTransactionsBtn" role="button" tabindex="0">See all</span>
          </div>
          <div id="dashboardRecentOrders"></div>
        </div>
      </div>

      <div class="col-12 col-lg-6 col-xl-3">
        <div class="card compact-card h-100">
          <div class="card-head">
            <span class="card-title">Best Selling</span>
            <span class="card-action">By quantity</span>
          </div>
          <div id="dashboardTopItems"></div>
        </div>
      </div>

      <div class="col-12 col-lg-6 col-xl-3">
        <div class="card compact-card h-100">
          <div class="card-head">
            <span class="card-title">Staff On Duty</span>
            <span class="card-action" id="dashboardStaffMeta">Live</span>
          </div>
          <div id="dashboardStaffOnDuty"></div>
        </div>
      </div>
    </div>
  `;
}

function bindDashboardQuickActions() {
  const root = document.getElementById("dashboard");
  if (!root) return;
  root.querySelectorAll('.quick-actions-grid [data-action]').forEach((btn) => {
    const action = btn.dataset.action;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        if (action === 'orders') {
          if (window.showPage) window.showPage('orders', document.getElementById('nav-orders'), 'Transactions');
        } else if (action === 'inventory') {
          if (window.showPage) window.showPage('inventory', document.querySelector('.nav-item[onclick*=\"inventory\"]'), 'Inventory');
        } else if (action === 'add-menu') {
          if (window.showPage) window.showPage('menu', document.querySelector('.nav-item[onclick*=\"menu\"]'), 'Menu');
          if (window.openMenuEditor) window.openMenuEditor(null);
        } else if (action === 'add-staff') {
          if (window.showPage) window.showPage('staff', document.querySelector('.nav-item[onclick*=\"staff\"]'), 'Staff');
          if (window.showAddStaff) window.showAddStaff();
        }
      } catch (err) {
        console.warn('[Dashboard] quick action failed', action, err);
      }
    });
  });
}

function buildStatCard({ icon, value, label, trend, trendClass }) {
  return `
    <div class="col-12 col-sm-6 col-xl-3">
      <div class="stat-card">
        <div class="stat-top">
          <div class="stat-icon-wrap"><i class="ti ${icon}" aria-hidden="true"></i></div>
          <span class="stat-trend ${trendClass || "trend-neutral"}">${trend}</span>
        </div>
        <div class="stat-val">${value}</div>
        <div class="stat-label">${label}</div>
      </div>
    </div>
  `;
}

function renderStats(summary) {
  const container = document.getElementById("dashboardStats");
  if (!container) return;

  container.innerHTML = `
    ${buildStatCard({ icon: "ti-currency-peso", value: formatPeso(summary.totalSales), label: "Total Sales Today", trend: summary.salesTrend, trendClass: summary.salesTrendClass })}
    ${buildStatCard({ icon: "ti-receipt", value: String(summary.totalOrders || 0), label: "Orders Today", trend: summary.orderTrend, trendClass: summary.orderTrendClass })}
    ${buildStatCard({ icon: "ti-cup", value: summary.bestSeller || "—", label: `Best Seller • ${summary.bestSellerCount || 0} sold`, trend: "Top item", trendClass: "trend-neutral" })}
    ${buildStatCard({ icon: "ti-users", value: `${summary.staffOnDuty || 0}/${summary.totalStaff || 0}`, label: "Staff On Duty", trend: summary.staffTrend, trendClass: summary.staffTrendClass })}
  `;
}

function renderRecentOrders(orders) {
  const container = document.getElementById("dashboardRecentOrders");
  if (!container) return;

  const items = Array.isArray(orders) ? orders : [];
  if (!items.length) {
    container.innerHTML = `<div class="text-muted small">No transactions yet today.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="list-group list-group-flush">
      ${items
        .map((order) => {
          const itemsText = getOrderItems(order)
            .slice(0, 3)
            .map((item) => `${item.name || "Item"} × ${toNumber(item.quantity || 1) || 1}`)
            .join(", ");
          const createdAt = formatDateTime(getOrderDate(order));
          return `
            <div class="list-group-item px-0 py-3 d-flex justify-content-between align-items-start gap-3">
              <div class="min-w-0">
                <div class="fw-semibold text-truncate">#${String(order.orderId || order.id || "—")}</div>
                <div class="text-muted small text-truncate">${itemsText || "No items"}</div>
                <div class="text-muted small">${createdAt} • ${String(order.paymentMethod || "—").toUpperCase()}</div>
              </div>
              <div class="fw-semibold text-nowrap">${formatPeso(order.total)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTopItems(items) {
  const container = document.getElementById("dashboardTopItems");
  if (!container) return;

  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    container.innerHTML = `<div class="text-muted small">No sales recorded yet.</div>`;
    return;
  }

  container.innerHTML = list
    .map((item, index) => `
      <div class="top-item-row">
        <div class="top-rank ${index === 0 ? "gold" : ""}">${index + 1}</div>
        <div class="top-item-name">
          <div>${item.name}</div>
          <div class="top-item-sold">${item.quantity} sold</div>
        </div>
        <div class="top-item-rev">${formatPeso(item.revenue)}</div>
      </div>
    `)
    .join("");
}

function renderStaffOnDuty(staff) {
  const container = document.getElementById("dashboardStaffOnDuty");
  const meta = document.getElementById("dashboardStaffMeta");
  if (!container) return;

  const list = Array.isArray(staff) ? staff : [];
  if (meta) meta.textContent = `${list.length} active`;

  if (!list.length) {
    container.innerHTML = `<div class="text-muted small">No staff are currently marked on duty.</div>`;
    return;
  }

  container.innerHTML = list
    .slice(0, 5)
    .map((member) => `
      <div class="staff-card mb-2">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div>
            <div class="fw-semibold">${member.name || "Staff member"}</div>
            <div class="text-muted small">${member.role || "Team member"}</div>
          </div>
          <span class="badge text-bg-success">${member.shift || "On duty"}</span>
        </div>
      </div>
    `)
    .join("");
}

export function renderAdminDashboard({ orders = [], menuItems = [], staff = [], schedule = {} } = {}) {
  const dashboardRoot = document.getElementById("dashboard");
  if (!dashboardRoot) return;

  if (!viewState.dashboardInitialized) {
    dashboardRoot.innerHTML = buildDashboardTemplate();
    viewState.dashboardInitialized = true;
  }

  updateDashboardGreeting();

  const sortedOrders = sortOrdersNewestFirst(orders);
  const topItems = computeTopItems(sortedOrders, menuItems);
  const onDutyInfo = typeof window.getOnDutyNowFromSchedule === "function"
    ? window.getOnDutyNowFromSchedule(staff, schedule, new Date())
    : { onDuty: [], total: Array.isArray(staff) ? staff.length : 0 };

  const totalSales = sumRevenue(sortedOrders);
  const totalOrders = sortedOrders.length;
  const bestSeller = topItems[0]?.name || "—";
  const bestSellerCount = topItems[0]?.quantity || 0;
  const staffOnDuty = Array.isArray(onDutyInfo.onDuty) ? onDutyInfo.onDuty : [];
  const totalStaff = toNumber(onDutyInfo.total || staff.length);

  renderStats({
    totalSales,
    totalOrders,
    bestSeller,
    bestSellerCount,
    staffOnDuty: staffOnDuty.length,
    totalStaff,
    salesTrend: `${totalSales ? "+" : ""}${totalSales ? "live" : "no sales yet"}`,
    salesTrendClass: totalSales > 0 ? "trend-up" : "trend-neutral",
    orderTrend: totalOrders ? "Today" : "Idle",
    orderTrendClass: totalOrders > 0 ? "trend-up" : "trend-neutral",
    staffTrend: staffOnDuty.length ? "On shift" : "Off shift",
    staffTrendClass: staffOnDuty.length ? "trend-up" : "trend-neutral",
  });
  renderRecentOrders(sortedOrders.slice(0, 5));
  renderTopItems(topItems);
  renderStaffOnDuty(staffOnDuty);

  const updatedAt = document.getElementById("dashboardUpdatedAt");
  if (updatedAt) updatedAt.textContent = `Updated ${formatDateTime(new Date())}`;

  // bind quick action buttons
  bindDashboardQuickActions();

  // bind "See all" transactions button - toggle between 5 and all
  const seeAllBtn = document.getElementById("seeAllTransactionsBtn");
  if (seeAllBtn) {
    const newBtn = seeAllBtn.cloneNode(true);
    seeAllBtn.replaceWith(newBtn);
    newBtn.addEventListener("click", () => {
      const expanded = newBtn.getAttribute("data-expanded") === "true";
      if (expanded) {
        renderRecentOrders(sortedOrders.slice(0, 5));
        newBtn.textContent = "See all";
        newBtn.setAttribute("data-expanded", "false");
      } else {
        renderRecentOrders(sortedOrders);
        newBtn.textContent = "Show less";
        newBtn.setAttribute("data-expanded", "true");
      }
    });
  }
}

function buildDeltaMarkup(deltaText, deltaType) {
  const icon = deltaType === "down" ? "ti-arrow-down" : deltaType === "ok" ? "ti-check" : deltaType === "neutral" ? "ti-minus" : "ti-arrow-up";
  return `
    <span class="sales-delta sales-delta-${deltaType}">
      <i class="ti ${icon}" aria-hidden="true"></i>
      <span>${deltaText}</span>
    </span>
  `;
}

function buildAnalyticsTemplate() {
  return `
    <div class="sales-analytics-shell">
      <div class="sales-analytics-header">
        <div class="sales-brand">
          <div class="sales-brand-mark" aria-hidden="true">
            <i class="ti ti-coffee"></i>
          </div>
          <div>
            <div class="sales-brand-title">Brother Bean</div>
            <div class="sales-brand-subtitle">Sales analytics</div>
          </div>
        </div>

        <div class="sales-header-actions">
          <div class="sales-sync-status" aria-label="Cloud sync status">
            <span class="sales-sync-dot"></span>
            <span>Cloud synced</span>
          </div>
          <div class="sales-period-tabs" role="tablist" aria-label="Period selector">
            <button class="sales-period-tab" type="button" data-period="all" aria-pressed="true">All</button>
            <button class="sales-period-tab" type="button" data-period="today" aria-pressed="false">Today</button>
            <button class="sales-period-tab" type="button" data-period="week" aria-pressed="false">Week</button>
            <button class="sales-period-tab" type="button" data-period="month" aria-pressed="false">Month</button>
          </div>
        </div>
      </div>

      <div class="sales-analytics-body">
        <aside class="sales-analytics-sidebar" aria-label="Sales summary metrics">
          <div class="sales-stat" data-stat="revenue">
            <div class="sales-stat-label"><i class="ti ti-currency-peso"></i><span>Total revenue</span></div>
            <div class="sales-stat-value" id="saRevenueValue">₱0</div>
            <div class="sales-stat-delta" id="saRevenueDelta"></div>
          </div>
          <div class="sales-stat" data-stat="orders">
            <div class="sales-stat-label"><i class="ti ti-receipt"></i><span>Orders</span></div>
            <div class="sales-stat-value" id="saOrdersValue">0</div>
            <div class="sales-stat-delta" id="saOrdersDelta"></div>
          </div>
          <div class="sales-stat" data-stat="avgTicket">
            <div class="sales-stat-label"><i class="ti ti-chart-bar"></i><span>Avg. ticket</span></div>
            <div class="sales-stat-value" id="saAvgTicketValue">₱0</div>
            <div class="sales-stat-delta" id="saAvgTicketDelta"></div>
          </div>
          <div class="sales-stat" data-stat="peakHour">
            <div class="sales-stat-label"><i class="ti ti-clock"></i><span>Peak hour</span></div>
            <div class="sales-stat-value" id="saPeakHourValue">—</div>
            <div class="sales-stat-delta" id="saPeakHourDelta"></div>
          </div>
          <div class="sales-stat" data-stat="discounts">
            <div class="sales-stat-label"><i class="ti ti-discount"></i><span>Discounts given</span></div>
            <div class="sales-stat-value" id="saDiscountsValue">₱0</div>
            <div class="sales-stat-delta" id="saDiscountsDelta"></div>
          </div>
          <div class="sales-stat" data-stat="sync">
            <div class="sales-stat-label"><i class="ti ti-wifi"></i><span>Pending sync</span></div>
            <div class="sales-stat-value" id="saSyncValue">0</div>
            <div class="sales-stat-delta" id="saSyncDelta"></div>
          </div>
        </aside>

        <main class="sales-analytics-main">
          <section class="sales-panel sales-top-sellers-panel">
            <div class="sales-section-kicker">Top sellers</div>
            <div class="sales-top-sellers-list" id="saTopSellers"></div>
          </section>

          <section class="sales-panel sales-chart-panel">
            <div class="sales-chart-head">
              <div>
                <div class="sales-section-kicker" id="saTrendKicker">Revenue trend</div>
                <div class="sales-chart-title" id="saTrendTitle">Revenue trend</div>
              </div>
              <div class="sales-chart-legend" id="saLegend"></div>
            </div>
            <div class="sales-chart-wrap">
              <canvas id="saTrendChart"></canvas>
            </div>
          </section>

          <section class="sales-panel sales-category-panel">
            <div class="sales-section-kicker">Category breakdown</div>
            <div class="sales-category-grid" id="saCategories"></div>
          </section>
        </main>
      </div>

      <div class="sales-analytics-footer">
        <div class="sales-footer-note" id="saFooterNote">Showing live sales data</div>
        <button class="sales-footer-btn" type="button">
          Full report <i class="ti ti-arrow-up-right"></i>
        </button>
      </div>
    </div>
  `;
}

function buildLegend() {
  return `
    <span class="sales-legend-item"><span class="sales-legend-swatch revenue"></span>Revenue</span>
    <span class="sales-legend-item"><span class="sales-legend-swatch average"></span>Previous period</span>
  `;
}

function renderTopSellers(periodData) {
  const list = document.getElementById("saTopSellers");
  const items = periodData.topSellers || [];

  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="text-muted small">No sales recorded for this period.</div>`;
    return;
  }

  const maxValue = Math.max(...items.map((item) => item.revenue), 1);
  list.innerHTML = items
    .map((item, index) => {
      const width = Math.max(8, Math.round((item.revenue / maxValue) * 100));
      return `
        <div class="sales-top-seller-row">
          <div class="sales-top-seller-rank ${index === 0 ? "is-gold" : ""}">${index + 1}</div>
          <div class="sales-top-seller-name">
            <div>${item.name}</div>
            <div class="sales-top-seller-meta">${item.quantity} sold • ${item.category || "Uncategorized"}</div>
          </div>
          <div class="sales-top-seller-bar"><span style="width:0%"></span></div>
          <div class="sales-top-seller-value">${formatPeso(item.revenue)}</div>
        </div>
      `;
    })
    .join("");

  window.requestAnimationFrame(() => {
    list.querySelectorAll(".sales-top-seller-bar span").forEach((bar, index) => {
      const width = Math.max(8, Math.round((items[index].revenue / maxValue) * 100));
      bar.style.width = `${width}%`;
    });
  });
}

function renderCategories(periodData) {
  const container = document.getElementById("saCategories");
  if (!container) return;

  const categories = periodData.categories || [];
  if (!categories.length) {
    container.innerHTML = `<div class="text-muted small">No category data available.</div>`;
    return;
  }

  container.innerHTML = categories
    .map((category) => `
      <div class="sales-category-card">
        <div class="sales-category-head">
          <i class="ti ti-chart-donut-2" aria-hidden="true"></i>
          <span>${category.name}</span>
        </div>
        <div class="sales-category-value">${formatPeso(category.value)}</div>
        <div class="sales-category-percent">${category.percent}% of sales</div>
      </div>
    `)
    .join("");
}

function formatTick(value) {
  if (Math.abs(value) >= 1000) {
    const compact = value / 1000;
    const text = Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1);
    return `₱${text}k`;
  }
  return `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function buildAnalyticsSeries(periodData) {
  const canvas = document.getElementById("saTrendChart");
  const legend = document.getElementById("saLegend");
  const title = document.getElementById("saTrendTitle");
  const kicker = document.getElementById("saTrendKicker");

  if (!canvas || !legend || !title || !kicker) return;

  legend.innerHTML = buildLegend();
  title.textContent = periodData.title;
  kicker.textContent = periodData.kicker;

  if (viewState.analyticsChart) {
    viewState.analyticsChart.destroy();
    viewState.analyticsChart = null;
  }

  viewState.analyticsChart = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: periodData.chart.labels,
      datasets: [
        {
          label: "Revenue",
          data: periodData.chart.current,
          borderColor: "#378ADD",
          backgroundColor: "rgba(55, 138, 221, 0.12)",
          pointBackgroundColor: "#378ADD",
          pointBorderColor: "#378ADD",
          pointRadius: 3,
          pointHoverRadius: 4,
          tension: 0.38,
          borderWidth: 2.5,
          fill: true,
        },
        {
          label: "Previous period",
          data: periodData.chart.previous,
          borderColor: "#1D9E75",
          backgroundColor: "transparent",
          pointBackgroundColor: "#1D9E75",
          pointBorderColor: "#1D9E75",
          pointRadius: 2.5,
          pointHoverRadius: 4,
          borderDash: [6, 4],
          tension: 0.38,
          borderWidth: 2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 700,
        easing: "easeOutQuart",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatPeso(context.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
            drawBorder: false,
          },
          ticks: {
            color: "#8A8A8A",
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: {
            color: "rgba(120, 120, 120, 0.16)",
            drawBorder: false,
          },
          ticks: {
            color: "#8A8A8A",
            font: { size: 11 },
            callback(value) {
              return formatTick(Number(value));
            },
          },
        },
      },
      elements: {
        line: {
          capBezierPoints: true,
        },
      },
    },
  });
}

function buildAnalyticsPeriodData(period, orders, menuItems, pendingSyncCount = 0, now = new Date(), todayOrders = []) {
  const range = getPeriodRange(period, now, orders);
  const previousRange = getPreviousRange(period, range);
  const sourceOrders = period === "today" && Array.isArray(todayOrders) && todayOrders.length
    ? todayOrders
    : orders;
  const currentOrders = filterOrdersByRange(sourceOrders, range);
  const previousOrders = filterOrdersByRange(orders, previousRange);
  const currentRevenue = sumRevenue(currentOrders);
  const previousRevenue = sumRevenue(previousOrders);
  const currentCount = currentOrders.length;
  const previousCount = previousOrders.length;
  const currentAvg = currentCount ? currentRevenue / currentCount : 0;
  const previousAvg = previousCount ? previousRevenue / previousCount : 0;
  const currentDiscounts = sumDiscounts(currentOrders);
  const trend = buildTrendSeries(currentOrders, period, range);
  const previousTrend = buildTrendSeries(previousOrders, period, previousRange);
  const peakBucket = computePeakBucket(trend, period, range);
  const topSellers = computeTopItems(currentOrders, menuItems);
  const categories = computeCategoryBreakdown(currentOrders, menuItems);

  const peakLabel = period === "today"
    ? `${peakBucket.label}`
    : period === "week"
      ? `Peak day: ${peakBucket.label}`
      : period === "month"
        ? `Peak week: ${peakBucket.label}`
        : `Peak month: ${peakBucket.label}`;

  return {
    period,
    periodLabel: period === "all" ? "All time" : period.charAt(0).toUpperCase() + period.slice(1),
    title: `Revenue trend — ${period === "all" ? "All time" : period.charAt(0).toUpperCase() + period.slice(1)} (${period === "today" ? "hourly" : period === "week" ? "daily" : period === "month" ? "weekly" : "monthly"})`,
    kicker: `Revenue trend`,
    stats: {
      revenue: {
        value: currentRevenue,
        deltaText: buildComparisonDelta(currentRevenue, previousRevenue),
        deltaType: currentRevenue >= previousRevenue ? "up" : "down",
      },
      orders: {
        value: currentCount,
        deltaText: `${currentCount >= previousCount ? "+" : ""}${currentCount - previousCount}`,
        deltaType: currentCount >= previousCount ? "up" : "down",
      },
      avgTicket: {
        value: currentAvg,
        deltaText: buildMoneyDelta(currentAvg, previousAvg),
        deltaType: currentAvg >= previousAvg ? "up" : "down",
      },
      peakHour: {
        value: peakBucket.label || "—",
        deltaText: `${Math.round(peakBucket.value || 0)} orders in peak bucket`,
        deltaType: "neutral",
      },
      discounts: {
        value: currentDiscounts,
        deltaText: `${currentOrders.filter((order) => toNumber(order?.discountAmount) > 0).length} discounted txn${currentOrders.filter((order) => toNumber(order?.discountAmount) > 0).length === 1 ? "" : "s"}`,
        deltaType: currentDiscounts > 0 ? "neutral" : "ok",
      },
      sync: {
        value: pendingSyncCount,
        deltaText: pendingSyncCount > 0 ? `${pendingSyncCount} pending sync${pendingSyncCount === 1 ? "" : "s"}` : "All orders synced",
        deltaType: pendingSyncCount > 0 ? "down" : "ok",
      },
    },
    topSellers,
    categories,
    chart: {
      labels: trend.labels,
      current: trend.values,
      previous: previousTrend.values,
    },
    footerLabel: period === "today"
      ? formatShortDate(now)
      : period === "all"
        ? `${formatShortDate(range.start)} → ${formatShortDate(new Date(range.end.getTime() - 1))}`
        : `${formatShortDate(range.start)} → ${formatShortDate(new Date(range.end.getTime() - 1))}`,
  };
}

function renderAnalyticsSidebar(periodData) {
  const stats = periodData.stats;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText("saRevenueValue", formatPeso(stats.revenue.value));
  setText("saOrdersValue", String(stats.orders.value));
  setText("saAvgTicketValue", formatPeso(stats.avgTicket.value));
  setText("saPeakHourValue", stats.peakHour.value);
  setText("saDiscountsValue", formatPeso(stats.discounts.value));
  setText("saSyncValue", String(stats.sync.value));

  const setHtml = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  };

  setHtml("saRevenueDelta", buildDeltaMarkup(stats.revenue.deltaText, stats.revenue.deltaType));
  setHtml("saOrdersDelta", buildDeltaMarkup(stats.orders.deltaText, stats.orders.deltaType));
  setHtml("saAvgTicketDelta", buildDeltaMarkup(stats.avgTicket.deltaText, stats.avgTicket.deltaType));
  setHtml("saPeakHourDelta", buildDeltaMarkup(stats.peakHour.deltaText, stats.peakHour.deltaType));
  setHtml("saDiscountsDelta", buildDeltaMarkup(stats.discounts.deltaText, stats.discounts.deltaType));
  setHtml("saSyncDelta", buildDeltaMarkup(stats.sync.deltaText, stats.sync.deltaType));

  document.querySelectorAll(".sales-stat").forEach((stat) => {
    stat.classList.remove("is-up", "is-down", "is-neutral", "is-ok");
    const key = stat.dataset.stat;
    const deltaType = stats[key]?.deltaType || "neutral";
    stat.classList.add(`is-${deltaType}`);
  });
}

function renderAnalyticsFooter(periodData) {
  const footer = document.getElementById("saFooterNote");
  if (footer) {
    footer.textContent = `Showing ${periodData.periodLabel.toLowerCase()} sales data • ${periodData.footerLabel}`;
  }
}

function setAnalyticsPeriod(period) {
  const periodData = buildAnalyticsPeriodData(
    period,
    viewState.analyticsData?.orders || [],
    viewState.analyticsData?.menuItems || [],
    viewState.analyticsData?.pendingSyncCount || 0,
    new Date(),
    viewState.analyticsData?.todayOrders || []
  );
  viewState.analyticsPeriod = period;

  document.querySelectorAll(".sales-period-tab").forEach((button) => {
    const isActive = button.dataset.period === period;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  renderAnalyticsSidebar(periodData);
  renderTopSellers(periodData);
  renderCategories(periodData);
  buildAnalyticsSeries(periodData);
  renderAnalyticsFooter(periodData);
}

function bindAnalyticsEvents() {
  document.querySelectorAll(".sales-period-tab").forEach((button) => {
    button.addEventListener("click", () => setAnalyticsPeriod(button.dataset.period));
  });
}

function handleOrderSavedEvent(e) {
  try {
    const sale = e?.detail;
    if (!sale) return;
    // Ensure analytics data store exists
    if (!viewState.analyticsData) viewState.analyticsData = { orders: [], menuItems: [], pendingSyncCount: 0 };
    // Append the new sale so it's included in current analytics
    viewState.analyticsData.orders = viewState.analyticsData.orders || [];
    // Avoid duplicates: check by orderId if present
    const exists = viewState.analyticsData.orders.some((o) => String(o?.orderId || o?.id || "") === String(sale?.orderId || sale?.id || ""));
    if (!exists) {
      // Normalize dates: if createdAt is a string, keep it — getOrderDate will handle it
      viewState.analyticsData.orders.unshift(sale);
      // Recompute current period view
      setAnalyticsPeriod(viewState.analyticsPeriod || "today");
    }
  } catch (err) {
    console.warn("[Analytics] order saved handler failed", err);
  }
}

export function renderSalesAnalyticsDashboard(data = {}) {
  const dashboardRoot = document.getElementById("salesAnalytics") || document.getElementById("dashboard");
  if (!dashboardRoot) return;

  const storedSalesHistory = readStoredSalesHistory();
  const bufferedOrders = typeof window !== "undefined" && Array.isArray(window.__bbOrderEventBuffer)
    ? window.__bbOrderEventBuffer
    : [];
  const providedOrders = Array.isArray(data.allOrders) ? data.allOrders : Array.isArray(data.orders) ? data.orders : [];
  const fallbackOrders = mergeUniqueOrders(bufferedOrders, storedSalesHistory);

  viewState.analyticsData = {
    orders: mergeUniqueOrders(providedOrders, fallbackOrders),
    todayOrders: Array.isArray(data.todayOrders) ? data.todayOrders : Array.isArray(data.ordersToday) ? data.ordersToday : [],
    menuItems: Array.isArray(data.menuItems) ? data.menuItems : [],
    pendingSyncCount: toNumber(data.pendingSyncCount || 0),
  };

  if (!viewState.analyticsData.orders.length && fallbackOrders.length) {
    viewState.analyticsData.orders = fallbackOrders;
  }

  if (!viewState.analyticsInitialized) {
    dashboardRoot.innerHTML = buildAnalyticsTemplate();
    bindAnalyticsEvents();
    // Listen for new orders saved in POS so analytics updates live
    try {
      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("bb:order:saved", handleOrderSavedEvent);
      }
    } catch (err) {
      console.warn("[Analytics] failed to bind order saved listener", err);
    }
    // If any orders were saved before analytics initialized, merge them
    try {
      const buf = (typeof window !== "undefined" && Array.isArray(window.__bbOrderEventBuffer)) ? window.__bbOrderEventBuffer.slice() : [];
      if (buf.length) {
        viewState.analyticsData.orders = viewState.analyticsData.orders || [];
        let added = 0;
        for (const sale of buf) {
          const exists = viewState.analyticsData.orders.some((o) => String(o?.orderId || o?.id || "") === String(sale?.orderId || sale?.id || ""));
          if (!exists) {
            viewState.analyticsData.orders.unshift(sale);
            added += 1;
          }
        }
        console.debug(`[Analytics] merged ${added} buffered order(s) into analytics`);
      }
    } catch (err) {
      console.warn("[Analytics] failed to merge buffered orders", err);
    }
    viewState.analyticsInitialized = true;
  }

  setAnalyticsPeriod(viewState.analyticsPeriod || "today");
}

export { renderStats, renderRecentOrders, renderTopItems, renderStaffOnDuty };
