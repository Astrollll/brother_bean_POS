import { logout as authLogout, watchAuth, createAuthUserByAdmin } from "../auth/firebaseAuth.js";
import { getUserRole, getUserProfile, listUsers, setUserRole, setUserProfile } from "../../models/userModel.js";
import { getMenuItems, saveMenuItem, deleteMenuItem } from "../../models/menuModel.js";
import { getTodayOrders } from "../../models/orderModel.js";
import { getAllOrders } from "../../models/orderModel.js";
import { resetDay as archiveResetDay } from "../../models/resetModel.js";
import { getInventoryItems, saveInventoryItem, deleteInventoryItem } from "../../models/inventoryModel.js";
import { getAllStaff as getStaff, getSchedule, addStaff, removeStaff, removeStaffByName, saveSchedule } from "../../models/staffModel.js";
import { renderStats, renderRecentOrders, renderTopItems, renderStaffOnDuty } from "../../views/dashboardView.js";
import { renderAdminMenu } from "../../views/menuView.js";
import { renderStaffList, renderScheduleEditor, readScheduleFromDOM } from "../../views/staffView.js";
import { navigateTo } from "../utils/routes.js";

const state = {
  page: "dashboard",
  menuItems: [],
  ordersToday: [],
  allOrders: [],
  filteredOrders: [],
  pagedOrders: [],
  inventoryItems: [],
  accounts: [],
  staff: [],
  schedule: {},
};

const orderFilters = {
  search: "",
  payment: "all",
  sortBy: "latest",
  pageSize: 10,
  page: 1,
  fromDate: "",
  toDate: "",
};

const accountFilters = {
  search: "",
  role: "all",
  status: "all",
  sortBy: "recent",
};

// #region agent log
const __bbDebugLog = (hypothesisId, location, message, data) => {
  try { console.log("[BB_DEBUG]", { runId: "pre-fix", hypothesisId, location, message, data }); } catch {}
  fetch('http://127.0.0.1:7280/ingest/428e4471-6b9b-4d77-83c3-f16307fb5c61',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a577ca'},body:JSON.stringify({sessionId:'a577ca',runId:'pre-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
};
// #endregion

function showLogin() {
  navigateTo("login", { replace: true });
}

function showApp() {
  const loading = document.getElementById("auth-loading");
  const app = document.getElementById("app");
  if (loading) loading.style.display = "none";
  if (app) app.style.display = "flex";
}

function setTopbarTitle(title) {
  const el = document.getElementById("topbar-page");
  if (el) el.textContent = title;
}

function setupTopbarDate() {
  const dateEl = document.getElementById("topbar-date");
  if (!dateEl) return;

  const updateDate = () => {
    const now = new Date();
    dateEl.textContent = now.toLocaleString("en-PH", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  updateDate();
  window.setInterval(updateDate, 60000);
}

function makeKeyboardClickable(el, onActivate) {
  if (!el || typeof onActivate !== "function") return;
  el.addEventListener("click", onActivate);
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onActivate();
  });
}

async function openTopbarNotifications() {
  await window.showPage("orders", document.getElementById("nav-orders"), "Transactions");
  const sub = document.getElementById("ordersPageSub");
  if (sub) {
    const count = Array.isArray(state.allOrders) ? state.allOrders.length : 0;
    sub.textContent = `Notifications focus: review ${count} transaction${count === 1 ? "" : "s"}.`;
  }
}

async function openTopbarAccount() {
  await window.showPage("accounts", document.querySelector('.nav-item[onclick*="accounts"]'), "Accounts");
}

function setupTopbarActions() {
  makeKeyboardClickable(document.getElementById("topbarNotifBtn"), openTopbarNotifications);
  makeKeyboardClickable(document.getElementById("topbarAvatarBtn"), openTopbarAccount);
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(pageId)?.classList.add("active");
}

function setActiveNav(navEl) {
  document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
  if (navEl) navEl.classList.add("active");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadDashboard() {
  const [menuItems, ordersToday, staff, schedule] = await Promise.all([
    getMenuItems(),
    getTodayOrders(),
    getStaff(),
    getSchedule(),
  ]);

  state.menuItems = menuItems;
  state.ordersToday = ordersToday;
  state.staff = staff;
  state.schedule = schedule;

  const totalSales = ordersToday.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = ordersToday.length;

  // Best seller
  const soldMap = {};
  ordersToday.forEach(o => (o.items || []).forEach(i => {
    soldMap[i.name] = (soldMap[i.name] || 0) + (i.quantity || 1);
  }));
  const best = Object.entries(soldMap).sort((a, b) => b[1] - a[1])[0];

  // Staff on duty (based on schedule doc for today's day name)
  const dayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const onDuty = staff
    .map(s => {
      const sched = (schedule || {})[s.id]?.[dayName];
      if (!sched?.onDuty) return null;
      return { name: s.name, role: s.role, shift: sched.shift || "" };
    })
    .filter(Boolean);

  renderStats({
    totalSales,
    totalOrders,
    bestSeller: best ? best[0] : "—",
    bestSellerCount: best ? best[1] : 0,
    staffOnDuty: onDuty.length,
    totalStaff: staff.length,
  });

  renderRecentOrders(ordersToday);
  renderTopItems(ordersToday, menuItems);
  renderStaffOnDuty(onDuty);
}

async function loadMenuPage() {
  const [menuItems, ordersToday] = await Promise.all([getMenuItems(), getTodayOrders()]);
  state.menuItems = menuItems;
  state.ordersToday = ordersToday;

  // sold map for today
  const soldMap = {};
  ordersToday.forEach(o => (o.items || []).forEach(i => {
    soldMap[i.name] = (soldMap[i.name] || 0) + (i.quantity || 1);
  }));

  const container = document.getElementById("menuContent");
  if (!container) return;

  container.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-head" style="align-items:flex-start;gap:12px;">
        <span class="card-title">Menu management</span>
        <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;">
          <button id="btnAddMenuItem"
            style="background:var(--primary);color:white;border:none;padding:8px 14px;border-radius:12px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">
            + Add item
          </button>
          <button id="btnRefreshMenu"
            style="background:transparent;border:1px solid var(--border-color);padding:8px 14px;border-radius:12px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">
            Refresh
          </button>
        </div>
      </div>
      <div id="menuEditorSlot"></div>
      <div style="padding-top:12px;" id="menuListSlot"></div>
    </div>
  `;

  const listSlot = document.getElementById("menuListSlot");
  listSlot.innerHTML = `<div id="menuListInner"></div>`;
  const inner = document.getElementById("menuListInner");
  inner.innerHTML = "";
  // renderAdminMenu writes into #menuContent, so temporarily swap target
  const original = document.getElementById("menuContent");
  original.id = "menuContent__tmp";
  inner.id = "menuContent";
  renderAdminMenu(menuItems, soldMap);
  inner.id = "menuListInner";
  original.id = "menuContent";

  window._adminEditMenuItem = (id) => openMenuEditor(id);
  window._adminDeleteMenuItem = async (id) => {
    if (!confirm("Delete this menu item?")) return;
    await deleteMenuItem(id);
    await loadMenuPage();
  };

  document.getElementById("btnAddMenuItem")?.addEventListener("click", () => openMenuEditor(null));
  document.getElementById("btnRefreshMenu")?.addEventListener("click", () => loadMenuPage());
}

async function loadStaffPage() {
  const [staff, schedule] = await Promise.all([getStaff(), getSchedule()]);
  state.staff = staff;
  state.schedule = schedule;

  renderStaffList(staff, async (id) => {
    await removeStaff(id);
    await loadStaffPage();
  });

  renderScheduleEditor(staff, schedule);
}

async function loadOrdersPage() {
  const wrap = document.getElementById("ordersTableWrap");
  if (!wrap) return;

  wrap.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0;">Loading transactions...</div>`;

  try {
    state.allOrders = await getAllOrders();
    bindOrdersControls();
    applyOrderFilters();
  } catch (error) {
    wrap.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px 0;">Failed to load transactions: ${error?.message || "Unknown error"}</div>`;
  }
}

function getOrderDate(order) {
  if (order.createdAt?.toDate) return order.createdAt.toDate();
  if (order.createdAtMs) return new Date(order.createdAtMs);
  if (order.timestamp) return new Date(order.timestamp);
  return null;
}

function applyOrderFilters() {
  const search = (orderFilters.search || "").trim().toLowerCase();
  const payment = (orderFilters.payment || "all").toLowerCase();
  const from = orderFilters.fromDate ? new Date(`${orderFilters.fromDate}T00:00:00`) : null;
  const to = orderFilters.toDate ? new Date(`${orderFilters.toDate}T23:59:59`) : null;

  const filtered = state.allOrders.filter((order) => {
    const date = getOrderDate(order);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;

    const normalizedPayment = String(order.paymentMethod || "cash").toLowerCase();
    if (payment !== "all" && normalizedPayment !== payment) return false;

    if (!search) return true;

    const orderRef = String(order.orderId || order.id || "").toLowerCase();
    const items = (order.items || []).map((i) => i.name || "").join(" ").toLowerCase();
    const timeText = date ? date.toLocaleString("en-PH").toLowerCase() : "";

    return orderRef.includes(search) || items.includes(search) || timeText.includes(search);
  });

  state.filteredOrders = sortOrders(filtered, orderFilters.sortBy);

  const pageSize = Number(orderFilters.pageSize) || 10;
  const totalPages = Math.max(1, Math.ceil(state.filteredOrders.length / pageSize));
  orderFilters.page = Math.min(Math.max(1, Number(orderFilters.page || 1)), totalPages);

  const start = (orderFilters.page - 1) * pageSize;
  state.pagedOrders = state.filteredOrders.slice(start, start + pageSize);

  renderOrdersTable(state.pagedOrders);
  renderOrdersKpis(state.filteredOrders);
  renderOrdersPagination(totalPages);
}

function sortOrders(orders, sortBy) {
  const next = [...orders];
  if (sortBy === "amount_desc") {
    next.sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
    return next;
  }
  if (sortBy === "amount_asc") {
    next.sort((a, b) => Number(a.total || 0) - Number(b.total || 0));
    return next;
  }

  next.sort((a, b) => {
    const aTime = getOrderDate(a)?.getTime() || 0;
    const bTime = getOrderDate(b)?.getTime() || 0;
    return sortBy === "oldest" ? aTime - bTime : bTime - aTime;
  });
  return next;
}

function renderOrdersPagination(totalPages) {
  const pager = document.getElementById("ordersPagination");
  if (!pager) return;

  if (!state.filteredOrders.length) {
    pager.innerHTML = "";
    return;
  }

  const current = Number(orderFilters.page || 1);
  pager.innerHTML = `
    <button class="orders-page-btn" data-page="${Math.max(1, current - 1)}" ${current <= 1 ? "disabled" : ""}>Prev</button>
    <span class="orders-page-meta">Page ${current} of ${totalPages}</span>
    <button class="orders-page-btn" data-page="${Math.min(totalPages, current + 1)}" ${current >= totalPages ? "disabled" : ""}>Next</button>
  `;

  pager.querySelectorAll(".orders-page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.dataset.page || "1");
      if (target === orderFilters.page) return;
      orderFilters.page = target;
      applyOrderFilters();
    });
  });
}

function renderOrdersKpis(orders) {
  const countEl = document.getElementById("ordersCountKpi");
  const totalEl = document.getElementById("ordersTotalKpi");
  const subEl = document.getElementById("ordersPageSub");

  const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  if (countEl) countEl.textContent = String(orders.length);
  if (totalEl) totalEl.textContent = `₱${totalSales.toFixed(2)}`;
  if (subEl) subEl.textContent = `${orders.length} transaction(s) shown`;
}

function renderOrdersTable(orders) {
  const wrap = document.getElementById("ordersTableWrap");
  if (!wrap) return;

  if (!orders.length) {
    wrap.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0;">No transactions found for the selected filters.</div>`;
    return;
  }

  const rows = orders.map((order) => {
    const shortId = (order.orderId || order.id || "").slice(-6);
    const items = (order.items || [])
      .map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}`)
      .join(", ");
    const date = getOrderDate(order);
    const time = date
      ? date.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "-";
    const total = Number(order.total || 0).toFixed(2);
    const type = (order.paymentMethod || "cash").toUpperCase();
    const status = order.isPwdSenior
      ? `<span class="badge b-orange">PWD</span>`
      : `<span class="badge b-green">Done</span>`;

    return `<tr>
      <td>#${shortId}</td>
      <td>${items || "-"}</td>
      <td>${type}</td>
      <td>${time}</td>
      <td>₱${total}</td>
      <td>${status}</td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `<table>
    <tr><th>#</th><th>Items</th><th>Type</th><th>Time</th><th>Amount</th><th>Status</th></tr>
    ${rows}
  </table>`;
}

function exportOrdersCsv() {
  if (!state.filteredOrders.length) {
    alert("No transactions to export.");
    return;
  }

  const header = ["Order ID", "Items", "Payment", "Date", "Amount", "Status"];
  const rows = state.filteredOrders.map((order) => {
    const items = (order.items || [])
      .map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}`)
      .join(", ");
    const date = getOrderDate(order);
    return [
      String(order.orderId || order.id || ""),
      items,
      String(order.paymentMethod || "cash").toUpperCase(),
      date ? date.toLocaleString("en-PH") : "-",
      Number(order.total || 0).toFixed(2),
      order.isPwdSenior ? "PWD" : "DONE",
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindOrdersControls() {
  const searchInput = document.getElementById("ordersSearch");
  const paymentInput = document.getElementById("ordersPaymentFilter");
  const fromInput = document.getElementById("ordersFromDate");
  const toInput = document.getElementById("ordersToDate");
  const sortInput = document.getElementById("ordersSortBy");
  const pageSizeInput = document.getElementById("ordersPageSize");
  const clearBtn = document.getElementById("ordersClearBtn");
  const exportBtn = document.getElementById("ordersExportBtn");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", (e) => {
      orderFilters.search = e.target.value;
      orderFilters.page = 1;
      applyOrderFilters();
    });
  }

  if (paymentInput && !paymentInput.dataset.bound) {
    paymentInput.dataset.bound = "1";
    paymentInput.addEventListener("change", (e) => {
      orderFilters.payment = e.target.value;
      orderFilters.page = 1;
      applyOrderFilters();
    });
  }

  if (fromInput && !fromInput.dataset.bound) {
    fromInput.dataset.bound = "1";
    fromInput.addEventListener("change", (e) => {
      orderFilters.fromDate = e.target.value;
      orderFilters.page = 1;
      applyOrderFilters();
    });
  }

  if (toInput && !toInput.dataset.bound) {
    toInput.dataset.bound = "1";
    toInput.addEventListener("change", (e) => {
      orderFilters.toDate = e.target.value;
      orderFilters.page = 1;
      applyOrderFilters();
    });
  }

  if (sortInput && !sortInput.dataset.bound) {
    sortInput.dataset.bound = "1";
    sortInput.addEventListener("change", (e) => {
      orderFilters.sortBy = e.target.value;
      orderFilters.page = 1;
      applyOrderFilters();
    });
  }

  if (pageSizeInput && !pageSizeInput.dataset.bound) {
    pageSizeInput.dataset.bound = "1";
    pageSizeInput.addEventListener("change", (e) => {
      orderFilters.pageSize = Number(e.target.value || 10);
      orderFilters.page = 1;
      applyOrderFilters();
    });
  }

  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = "1";
    clearBtn.addEventListener("click", () => {
      orderFilters.search = "";
      orderFilters.payment = "all";
      orderFilters.sortBy = "latest";
      orderFilters.pageSize = 10;
      orderFilters.page = 1;
      orderFilters.fromDate = "";
      orderFilters.toDate = "";

      if (searchInput) searchInput.value = "";
      if (paymentInput) paymentInput.value = "all";
      if (sortInput) sortInput.value = "latest";
      if (pageSizeInput) pageSizeInput.value = "10";
      if (fromInput) fromInput.value = "";
      if (toInput) toInput.value = "";

      applyOrderFilters();
    });
  }

  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", exportOrdersCsv);
  }
}

async function loadInventoryPage() {
  const listWrap = document.getElementById("inventoryListWrap");
  if (listWrap) {
    listWrap.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:10px 0;">Loading inventory...</div>`;
  }

  state.inventoryItems = await getInventoryItems();
  renderInventorySection();
  bindInventoryForm();
}

function inventoryStatus(item) {
  const quantity = Number(item.quantity || 0);
  const reorderLevel = Number(item.reorderLevel || 0);
  const criticalMark = reorderLevel * 0.5;

  if (quantity <= criticalMark) return "critical";
  if (quantity <= reorderLevel) return "low";
  return "good";
}

function renderInventorySection() {
  const listWrap = document.getElementById("inventoryListWrap");
  const strip = document.getElementById("inventoryAlertStrip");
  const pageSub = document.getElementById("inventoryPageSub");
  const navBadge = document.getElementById("inventoryNavBadge");
  if (!listWrap || !strip) return;

  if (navBadge) navBadge.textContent = String(state.inventoryItems.length);

  if (!state.inventoryItems.length) {
    strip.innerHTML = `<span class="badge b-blue">No inventory items yet. Add your first item above.</span>`;
    listWrap.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:10px 0;">No inventory items found.</div>`;
    if (pageSub) pageSub.textContent = "Track your ingredients and supplies";
    return;
  }

  const low = state.inventoryItems.filter((i) => inventoryStatus(i) === "low").length;
  const critical = state.inventoryItems.filter((i) => inventoryStatus(i) === "critical").length;
  if (pageSub) pageSub.textContent = `${critical} critical, ${low} low stock item(s)`;

  strip.innerHTML = `
    <span class="badge b-red">Critical: ${critical}</span>
    <span class="badge b-orange">Low: ${low}</span>
    <span class="badge b-green">Total: ${state.inventoryItems.length}</span>
  `;

  listWrap.innerHTML = state.inventoryItems.map((item) => {
    const quantity = Number(item.quantity || 0);
    const reorderLevel = Math.max(1, Number(item.reorderLevel || 1));
    const percent = Math.max(5, Math.min(100, Math.round((quantity / (reorderLevel * 2)) * 100)));
    const status = inventoryStatus(item);
    const statusBadge = status === "critical"
      ? `<span class="badge b-red">Critical</span>`
      : status === "low"
        ? `<span class="badge b-orange">Low</span>`
        : `<span class="badge b-green">Good</span>`;

    return `<div class="inv-row">
      <div>
        <div class="inv-name">${escapeHtml(item.name)}</div>
        <div class="inv-cat">${escapeHtml(item.category)}</div>
      </div>
      <div class="inv-bar-col">
        <div class="inv-qty">${quantity} ${escapeHtml(item.unit)} remaining (reorder at ${reorderLevel})</div>
        <div class="inv-bar-bg"><div class="inv-bar ${status === "critical" ? "crit" : status === "low" ? "low" : ""}" style="width:${percent}%"></div></div>
      </div>
      ${statusBadge}
      <div class="inventory-row-actions">
        <button class="orders-btn ghost inventory-mini-btn" type="button" data-inv-action="edit" data-inv-id="${escapeHtml(item.id)}">Edit</button>
        <button class="orders-btn ghost inventory-mini-btn danger" type="button" data-inv-action="delete" data-inv-id="${escapeHtml(item.id)}">Delete</button>
      </div>
    </div>`;
  }).join("");

  listWrap.querySelectorAll("button[data-inv-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.inventoryItems.find((i) => i.id === btn.dataset.invId);
      if (!item) return;

      const idEl = document.getElementById("invId");
      const nameEl = document.getElementById("invName");
      const catEl = document.getElementById("invCategory");
      const unitEl = document.getElementById("invUnit");
      const qtyEl = document.getElementById("invQuantity");
      const reorderEl = document.getElementById("invReorder");
      const saveBtn = document.getElementById("invSaveBtn");

      if (idEl) idEl.value = item.id;
      if (nameEl) nameEl.value = item.name || "";
      if (catEl) catEl.value = item.category || "";
      if (unitEl) unitEl.value = item.unit || "";
      if (qtyEl) qtyEl.value = String(item.quantity || 0);
      if (reorderEl) reorderEl.value = String(item.reorderLevel || 0);
      if (saveBtn) saveBtn.textContent = "Update Item";
    });
  });

  listWrap.querySelectorAll("button[data-inv-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.dataset.invId;
      if (!targetId) return;
      if (!confirm("Delete this inventory item?")) return;
      await deleteInventoryItem(targetId);
      await loadInventoryPage();
    });
  });
}

function clearInventoryForm() {
  const idEl = document.getElementById("invId");
  const form = document.getElementById("inventoryForm");
  const saveBtn = document.getElementById("invSaveBtn");
  if (idEl) idEl.value = "";
  if (form) form.reset();
  if (saveBtn) saveBtn.textContent = "Save Item";
}

const inventorySeedItems = [
  { id: "seed-arabica-beans", name: "Arabica Coffee Beans", category: "Coffee", unit: "kg", quantity: 16, reorderLevel: 8 },
  { id: "seed-fresh-milk", name: "Fresh Milk", category: "Dairy", unit: "L", quantity: 30, reorderLevel: 14 },
  { id: "seed-oat-milk", name: "Oat Milk", category: "Dairy Alternative", unit: "L", quantity: 12, reorderLevel: 6 },
  { id: "seed-matcha-powder", name: "Premium Matcha Powder", category: "Ingredients", unit: "kg", quantity: 3, reorderLevel: 1.5 },
  { id: "seed-chocolate-sauce", name: "Chocolate Sauce", category: "Syrup", unit: "bottles", quantity: 10, reorderLevel: 4 },
  { id: "seed-caramel-syrup", name: "Caramel Syrup", category: "Syrup", unit: "bottles", quantity: 10, reorderLevel: 4 },
  { id: "seed-cups-12oz", name: "Paper Cups (12oz)", category: "Packaging", unit: "pcs", quantity: 600, reorderLevel: 250 },
  { id: "seed-cup-lids", name: "Cup Lids (12oz)", category: "Packaging", unit: "pcs", quantity: 600, reorderLevel: 250 },
  { id: "seed-cup-sleeves", name: "Cup Sleeves", category: "Packaging", unit: "pcs", quantity: 350, reorderLevel: 150 },
  { id: "seed-sugar-syrup", name: "Sugar Syrup", category: "Ingredients", unit: "L", quantity: 14, reorderLevel: 6 },
  { id: "seed-croissant", name: "Croissant", category: "Pastry", unit: "pcs", quantity: 28, reorderLevel: 12 },
  { id: "seed-cheesecake-slice", name: "Cheesecake Slice", category: "Pastry", unit: "pcs", quantity: 16, reorderLevel: 8 },
];

function bindInventoryForm() {
  const form = document.getElementById("inventoryForm");
  const cancelBtn = document.getElementById("invCancelBtn");
  if (!form || form.dataset.bound) return;

  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("invId")?.value?.trim();
    const name = document.getElementById("invName")?.value?.trim();
    const category = document.getElementById("invCategory")?.value?.trim();
    const unit = document.getElementById("invUnit")?.value?.trim();
    const quantity = Number(document.getElementById("invQuantity")?.value || 0);
    const reorderLevel = Number(document.getElementById("invReorder")?.value || 0);

    if (!name || !category || !unit) {
      alert("Name, category, and unit are required.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderLevel) || reorderLevel < 0) {
      alert("Quantity and reorder level must be valid positive values.");
      return;
    }

    await saveInventoryItem({ id: id || undefined, name, category, unit, quantity, reorderLevel });
    clearInventoryForm();
    await loadInventoryPage();
  });

  cancelBtn?.addEventListener("click", clearInventoryForm);
}

async function loadAccountsPage() {
  const host = document.getElementById("accountsContent");
  if (!host) return;
  host.innerHTML = `
    <div class="accounts-layout">
      <div class="card accounts-create-card">
        <div class="card-head">
          <span class="card-title">Create Account</span>
          <span class="badge b-blue">Auth + Role</span>
        </div>
        <form id="createAccountForm" class="accounts-form-grid">
          <div>
            <div class="ls-label">Full Name</div>
            <input class="ls-input" id="newAccName" placeholder="e.g. Juan Dela Cruz" style="margin-bottom:0;" required>
          </div>
          <div>
            <div class="ls-label">Email</div>
            <input class="ls-input" id="newAccEmail" type="email" placeholder="staff@email.com" style="margin-bottom:0;" required>
          </div>
          <div>
            <div class="ls-label">Password</div>
            <input class="ls-input" id="newAccPassword" type="password" placeholder="min 6 chars" style="margin-bottom:0;" required>
          </div>
          <div>
            <div class="ls-label">Role</div>
            <select class="ls-input" id="newAccRole" style="margin-bottom:0;">
              <option value="staff">staff</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <label class="accounts-inline-check">
            <input type="checkbox" id="newAccAddStaff" checked>
            <span>Also add to Staff list (for staff role)</span>
          </label>
          <div class="accounts-form-actions">
            <button type="button" class="orders-btn ghost" id="clearCreateAccountBtn">Reset</button>
            <button type="submit" class="orders-btn" id="createAccountBtn">Create Account</button>
          </div>
        </form>
        <div class="accounts-form-note">
          Creates a Firebase Authentication user and writes role/profile in Firestore users collection.
        </div>
      </div>

      <div class="card accounts-directory-card">
        <div class="card-head" style="align-items:flex-start;gap:12px;">
          <span class="card-title">Account Directory</span>
          <div class="accounts-kpis" id="accountsKpis"></div>
        </div>

        <div class="accounts-toolbar">
          <input id="accountsSearch" class="ls-input orders-filter-input" placeholder="Search by name, email, or UID" />
          <select id="accountsRoleFilter" class="ls-input orders-filter-input">
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select id="accountsStatusFilter" class="ls-input orders-filter-input">
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select id="accountsSortBy" class="ls-input orders-filter-input">
            <option value="recent">Sort: Recently updated</option>
            <option value="name_asc">Sort: Name A-Z</option>
            <option value="email_asc">Sort: Email A-Z</option>
            <option value="role">Sort: Role</option>
          </select>
          <div class="accounts-toolbar-actions">
            <button class="orders-btn ghost" type="button" id="accountsClearFiltersBtn">Clear</button>
            <button class="orders-btn" type="button" id="accountsRefreshBtn">Refresh</button>
          </div>
        </div>

        <div class="tbl-wrap">
          <table>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>UID</th>
              <th>Role</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
            <tbody id="accountsRows"></tbody>
          </table>
        </div>
        <div id="accountsEmptyState" style="display:none;color:var(--text-muted);font-size:13px;padding:10px 0;">No accounts match the selected filters.</div>
      </div>
    </div>
  `;

  await refreshAccountsRecords();
  bindAccountsControls();
}

function normalizeAccountRecord(user) {
  const role = String(user?.role || "").trim().toLowerCase();
  const status = String(user?.status || "active").trim().toLowerCase() === "suspended" ? "suspended" : "active";
  const deleted = !!user?.deleted || Number(user?.deletedAtMs || 0) > 0;

  let updatedMs = 0;
  if (typeof user?.updatedAtMs === "number") {
    updatedMs = user.updatedAtMs;
  } else if (typeof user?.updatedAt?.seconds === "number") {
    updatedMs = user.updatedAt.seconds * 1000;
  }

  return {
    uid: String(user?.uid || ""),
    fullName: String(user?.fullName || "").trim(),
    email: String(user?.email || "").trim(),
    role: role || "unassigned",
    status,
    deleted,
    updatedMs,
  };
}

function formatAccountUpdated(updatedMs) {
  if (!updatedMs) return "-";
  return new Date(updatedMs).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function getFilteredAccounts() {
  const search = String(accountFilters.search || "").trim().toLowerCase();
  const role = String(accountFilters.role || "all").toLowerCase();
  const status = String(accountFilters.status || "all").toLowerCase();

  let next = state.accounts.filter((account) => {
    if (account.deleted) return false;
    if (role !== "all" && account.role !== role) return false;
    if (status !== "all" && account.status !== status) return false;
    if (!search) return true;

    return [account.fullName, account.email, account.uid]
      .map((v) => String(v || "").toLowerCase())
      .some((v) => v.includes(search));
  });

  const sortBy = String(accountFilters.sortBy || "recent");
  if (sortBy === "name_asc") {
    next.sort((a, b) => String(a.fullName || a.email || a.uid).localeCompare(String(b.fullName || b.email || b.uid)));
  } else if (sortBy === "email_asc") {
    next.sort((a, b) => String(a.email || "").localeCompare(String(b.email || "")));
  } else if (sortBy === "role") {
    next.sort((a, b) => String(a.role || "").localeCompare(String(b.role || "")));
  } else {
    next.sort((a, b) => Number(b.updatedMs || 0) - Number(a.updatedMs || 0));
  }

  return next;
}

function renderAccountsKpis(accounts) {
  const kpis = document.getElementById("accountsKpis");
  if (!kpis) return;

  const activeAccounts = accounts.filter((a) => !a.deleted);
  const total = activeAccounts.length;
  const admins = activeAccounts.filter((a) => a.role === "admin").length;
  const staff = activeAccounts.filter((a) => a.role === "staff").length;
  const suspended = activeAccounts.filter((a) => a.status === "suspended").length;

  kpis.innerHTML = `
    <span class="badge b-blue">Total ${total}</span>
    <span class="badge b-green">Admin ${admins}</span>
    <span class="badge b-orange">Staff ${staff}</span>
    <span class="badge b-red">Suspended ${suspended}</span>
  `;
}

function renderAccountsTable(accounts) {
  const rowsEl = document.getElementById("accountsRows");
  const emptyEl = document.getElementById("accountsEmptyState");
  if (!rowsEl || !emptyEl) return;

  if (!accounts.length) {
    rowsEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";
  rowsEl.innerHTML = accounts.map((account) => {
    const isAdminAccount = account.role === "admin";
    const canDeleteAccount = account.role === "staff";
    const nameDisplay = account.fullName || "-";
    const roleBadgeClass = account.role === "admin" ? "b-blue" : account.role === "staff" ? "b-green" : "b-gray";
    const statusBadgeClass = account.status === "suspended" ? "b-red" : "b-green";
    const nextRole = account.role === "admin" ? "staff" : "admin";
    const nextRoleLabel = account.role === "admin" ? "Make Staff" : "Make Admin";
    const toggleStatusLabel = account.status === "suspended" ? "Activate" : "Suspend";
    const toggleStatusDisabled = isAdminAccount ? "disabled" : "";
    const toggleStatusTitle = isAdminAccount ? "title=\"Admin accounts cannot be suspended or activated here\"" : "";
    const deleteDisabled = canDeleteAccount ? "" : "disabled";
    const deleteTitle = canDeleteAccount ? "" : "title=\"Only staff accounts can be deleted\"";

    return `
      <tr>
        <td>${escapeHtml(nameDisplay)}</td>
        <td>${escapeHtml(account.email || "-")}</td>
        <td><code>${escapeHtml(account.uid)}</code></td>
        <td><span class="badge ${roleBadgeClass}">${escapeHtml(account.role)}</span></td>
        <td><span class="badge ${statusBadgeClass}">${escapeHtml(account.status)}</span></td>
        <td>${escapeHtml(formatAccountUpdated(account.updatedMs))}</td>
        <td>
          <div class="accounts-row-actions">
            <button class="orders-btn ghost inventory-mini-btn" data-account-action="toggle-role" data-account-uid="${escapeHtml(account.uid)}" data-account-next-role="${escapeHtml(nextRole)}">${nextRoleLabel}</button>
            <button class="orders-btn ghost inventory-mini-btn ${account.status === "suspended" ? "" : "danger"}" data-account-action="toggle-status" data-account-uid="${escapeHtml(account.uid)}" data-account-next-status="${account.status === "suspended" ? "active" : "suspended"}" ${toggleStatusDisabled} ${toggleStatusTitle}>${toggleStatusLabel}</button>
            <button class="orders-btn ghost inventory-mini-btn danger" data-account-action="delete-account" data-account-uid="${escapeHtml(account.uid)}" ${deleteDisabled} ${deleteTitle}>Delete</button>
            <button class="orders-btn ghost inventory-mini-btn" data-account-action="copy-uid" data-account-uid="${escapeHtml(account.uid)}">Copy UID</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderAccountsDirectory() {
  const filtered = getFilteredAccounts();
  renderAccountsKpis(state.accounts);
  renderAccountsTable(filtered);
}

async function refreshAccountsRecords() {
  const users = await listUsers();
  state.accounts = users.map(normalizeAccountRecord);
  renderAccountsDirectory();
}

function bindAccountsControls() {
  const host = document.getElementById("accountsContent");
  if (!host || host.dataset.bound === "1") return;
  host.dataset.bound = "1";

  const searchInput = document.getElementById("accountsSearch");
  const roleFilter = document.getElementById("accountsRoleFilter");
  const statusFilter = document.getElementById("accountsStatusFilter");
  const sortBy = document.getElementById("accountsSortBy");
  const clearFiltersBtn = document.getElementById("accountsClearFiltersBtn");
  const refreshBtn = document.getElementById("accountsRefreshBtn");
  const clearCreateBtn = document.getElementById("clearCreateAccountBtn");
  const createForm = document.getElementById("createAccountForm");

  const clearCreateForm = () => {
    const form = document.getElementById("createAccountForm");
    form?.reset();
    const addStaff = document.getElementById("newAccAddStaff");
    if (addStaff) addStaff.checked = true;
  };

  searchInput?.addEventListener("input", (e) => {
    accountFilters.search = e.target.value;
    renderAccountsDirectory();
  });

  roleFilter?.addEventListener("change", (e) => {
    accountFilters.role = e.target.value;
    renderAccountsDirectory();
  });

  statusFilter?.addEventListener("change", (e) => {
    accountFilters.status = e.target.value;
    renderAccountsDirectory();
  });

  sortBy?.addEventListener("change", (e) => {
    accountFilters.sortBy = e.target.value;
    renderAccountsDirectory();
  });

  clearFiltersBtn?.addEventListener("click", () => {
    accountFilters.search = "";
    accountFilters.role = "all";
    accountFilters.status = "all";
    accountFilters.sortBy = "recent";
    if (searchInput) searchInput.value = "";
    if (roleFilter) roleFilter.value = "all";
    if (statusFilter) statusFilter.value = "all";
    if (sortBy) sortBy.value = "recent";
    renderAccountsDirectory();
  });

  refreshBtn?.addEventListener("click", async () => {
    await refreshAccountsRecords();
  });

  clearCreateBtn?.addEventListener("click", clearCreateForm);

  createForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = document.getElementById("newAccName")?.value?.trim();
    const email = document.getElementById("newAccEmail")?.value?.trim();
    const password = document.getElementById("newAccPassword")?.value || "";
    const role = String(document.getElementById("newAccRole")?.value || "staff").toLowerCase();
    const addToStaff = !!document.getElementById("newAccAddStaff")?.checked;

    if (!fullName || !email || !password || password.length < 6 || !role) {
      alert("Full name, valid email, password (min 6), and role are required.");
      return;
    }
    if (!isValidEmailAddress(email)) {
      alert("Please provide a valid email address.");
      return;
    }

    const duplicate = state.accounts.some((acc) => String(acc.email || "").toLowerCase() === email.toLowerCase());
    if (duplicate) {
      alert("An account with this email already exists in the directory.");
      return;
    }

    try {
      const created = await createAuthUserByAdmin(email, password);
      await setUserRole(created.uid, role, email);
      await setUserProfile(created.uid, {
        fullName,
        email,
        role,
        status: "active",
        updatedAtMs: Date.now(),
      });

      if (role === "staff" && addToStaff) {
        await addStaff(fullName, "Staff");
      }

      clearCreateForm();
      await refreshAccountsRecords();
      alert("Account created successfully.");
    } catch (error) {
      alert(`Account creation failed: ${error?.message || "Unknown error"}`);
    }
  });

  host.addEventListener("click", async (e) => {
    const actionBtn = e.target.closest("button[data-account-action]");
    if (!actionBtn) return;

    const action = actionBtn.dataset.accountAction;
    const uid = actionBtn.dataset.accountUid;
    if (!uid) return;

    if (action === "copy-uid") {
      try {
        await navigator.clipboard.writeText(uid);
        alert("UID copied to clipboard.");
      } catch {
        alert("Unable to copy UID in this browser.");
      }
      return;
    }

    if (action === "toggle-role") {
      const nextRole = String(actionBtn.dataset.accountNextRole || "staff").toLowerCase();
      const account = state.accounts.find((acc) => acc.uid === uid);
      if (!account) return;
      await setUserRole(uid, nextRole, account.email || "");
      await setUserProfile(uid, { role: nextRole, updatedAtMs: Date.now() });
      await refreshAccountsRecords();
      return;
    }

    if (action === "toggle-status") {
      const account = state.accounts.find((acc) => acc.uid === uid);
      if (!account) return;
      if (account.role === "admin") {
        alert("Admin accounts cannot be suspended from this page.");
        return;
      }

      const nextStatus = String(actionBtn.dataset.accountNextStatus || "active").toLowerCase();
      await setUserProfile(uid, { status: nextStatus, updatedAtMs: Date.now() });
      await refreshAccountsRecords();
      return;
    }

    if (action === "delete-account") {
      const account = state.accounts.find((acc) => acc.uid === uid);
      if (!account) return;
      if (account.role !== "staff") {
        alert("Only staff accounts can be deleted.");
        return;
      }

      const label = account.fullName || account.email || account.uid;
      const confirmed = confirm(`Delete staff account for ${label}?\n\nThis will disable access and hide it from this list.`);
      if (!confirmed) return;

      await setUserProfile(uid, {
        status: "suspended",
        deleted: true,
        deletedAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });

      if (account.fullName) {
        await removeStaffByName(account.fullName);
      }

      await refreshAccountsRecords();
      alert("Staff account deleted.");
    }
  });
}

async function loadSettingsPage() {
  const host = document.getElementById("settings");
  if (!host) return;

  host.innerHTML = `
    <div class="page-header">
      <div class="page-title">Settings</div>
      <div class="page-sub">Manage your shop preferences</div>
      <div style="margin-top:10px;">
        <button onclick="window.showPage('accounts', document.querySelector('.nav-item[onclick*=\"accounts\"]'), 'Accounts')" style="background:var(--brown);color:white;border:none;padding:8px 14px;border-radius:20px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">
          Manage Accounts →
        </button>
      </div>
    </div>
    <div class="grid-2">
      <div>
        <div class="card" style="margin-bottom:14px;">
          <div class="card-head"><span class="card-title">Shop Operations</span></div>
          <div class="setting-row"><div><div class="setting-label">Online ordering</div><div class="setting-desc">Accept orders via delivery apps</div></div><label class="toggle"><input type="checkbox" checked><span class="tslider"></span></label></div>
          <div class="setting-row"><div><div class="setting-label">Dine-in available</div><div class="setting-desc">Allow customers to eat in the shop</div></div><label class="toggle"><input type="checkbox" checked><span class="tslider"></span></label></div>
          <div class="setting-row"><div><div class="setting-label">Loyalty rewards</div><div class="setting-desc">Enable stamp card system</div></div><label class="toggle"><input type="checkbox" checked><span class="tslider"></span></label></div>
          <div class="setting-row"><div><div class="setting-label">Low stock alerts</div><div class="setting-desc">Notify when ingredients run low</div></div><label class="toggle"><input type="checkbox" checked><span class="tslider"></span></label></div>
        </div>
        <div class="card">
          <div class="card-head"><span class="card-title">Notifications</span></div>
          <div class="setting-row"><div><div class="setting-label">Email alerts</div><div class="setting-desc">Get notified on suspicious activity</div></div><label class="toggle"><input type="checkbox" checked><span class="tslider"></span></label></div>
          <div class="setting-row"><div><div class="setting-label">New transactions</div><div class="setting-desc">Notify on every new transaction</div></div><label class="toggle"><input type="checkbox"><span class="tslider"></span></label></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Shop Info</span></div>
        <div class="setting-row"><div><div class="setting-label">Shop name</div><div class="setting-desc">Brother Bean Coffee House</div></div></div>
        <div class="setting-row"><div><div class="setting-label">Opening hours</div><div class="setting-desc">7:00 AM - 9:00 PM daily</div></div></div>
        <div class="setting-row"><div><div class="setting-label">Location</div><div class="setting-desc">Imus, Cavite</div></div></div>
        <div class="setting-row"><div><div class="setting-label">Currency</div><div class="setting-desc">Philippine Peso (PHP)</div></div></div>
        <div class="setting-row"><div><div class="setting-label">Admin username</div><div class="setting-desc">admin</div></div></div>
      </div>
    </div>
  `;
}

// Public API expected by admin.html
window.showPage = async function (pageId, navEl, title) {
  state.page = pageId;
  setActiveNav(navEl);
  setTopbarTitle(title || "Admin");
  showPage(pageId);

  if (pageId === "dashboard") await loadDashboard();
  if (pageId === "orders") await loadOrdersPage();
  if (pageId === "menu") await loadMenuPage();
  if (pageId === "inventory") await loadInventoryPage();
  if (pageId === "staff") await loadStaffPage();
  if (pageId === "accounts") await loadAccountsPage();
  if (pageId === "settings") await loadSettingsPage();
};

window.refreshOrders = async function () {
  await loadOrdersPage();
};

window.refreshInventory = async function () {
  await loadInventoryPage();
};

window.seedInventory = async function () {
  const hasExisting = Array.isArray(state.inventoryItems) && state.inventoryItems.length > 0;
  const confirmed = hasExisting
    ? confirm("Inventory already has items. Seeding will update/insert sample items. Continue?")
    : confirm("Seed sample inventory items?");
  if (!confirmed) return;

  for (const item of inventorySeedItems) {
    await saveInventoryItem(item);
  }

  await loadInventoryPage();
  alert("Sample inventory items are ready.");
};

window.openQuickAction = async function (action) {
  if (action === "orders") {
    await window.showPage("orders", document.getElementById("nav-orders"), "Transactions");
    return;
  }
  if (action === "inventory") {
    await window.showPage("inventory", document.querySelector('.nav-item[onclick*="inventory"]'), "Inventory");
    return;
  }
  if (action === "menu-add") {
    await window.showPage("menu", document.querySelector('.nav-item[onclick*="menu"]'), "Menu");
    openMenuEditor(null);
    return;
  }
  if (action === "staff-add") {
    await window.showPage("staff", document.querySelector('.nav-item[onclick*="staff"]'), "Staff");
    window.showAddStaff();
  }
};

window.addStaff = async function () {
  const name = document.getElementById("newStaffName")?.value?.trim();
  const role = document.getElementById("newStaffRole")?.value?.trim();
  if (!name || !role) return;
  await addStaff(name, role);
  document.getElementById("newStaffName").value = "";
  document.getElementById("newStaffRole").value = "";
  document.getElementById("addStaffForm").style.display = "none";
  await loadStaffPage();
};

window.showAddStaff = function () {
  document.getElementById("addStaffForm").style.display = "block";
};

window.saveSchedule = async function () {
  const sched = readScheduleFromDOM();
  await saveSchedule(sched);
  await loadStaffPage();
};

window.resetDay = async function () {
  if (!confirm("Archive and clear all of today's transactions?")) return;
  const result = await archiveResetDay();
  if (!result.success) {
    alert(result.reason || "Nothing to reset.");
    return;
  }
  alert(`Archived ${result.totalArchived} transactions for ${result.date}.`);
  await loadDashboard();
};

window.logout = async function () {
  await authLogout();
};

document.addEventListener("DOMContentLoaded", async () => {
  setupTopbarDate();
  setupTopbarActions();
  watchAuth(async (user) => {
    __bbDebugLog("B","controllers/admin/adminPortalController.js:watchAuth","auth_state",{hasUser: !!user});
    if (!user) {
      showLogin();
      return;
    }

    const profile = await getUserProfile(user.uid);
    if (String(profile?.status || "active").toLowerCase() === "suspended") {
      await authLogout();
      alert("Your account is suspended. Please contact an administrator.");
      showLogin();
      return;
    }

    const role = await getUserRole(user.uid);
    __bbDebugLog("B","controllers/admin/adminPortalController.js:watchAuth","role_loaded",{role: role || null});
    if (role && role !== "admin") {
      __bbDebugLog("B","controllers/admin/adminPortalController.js:watchAuth","redirect_to_pos",{});
      navigateTo("pos", { replace: true });
      return;
    }

    // If role is missing or admin, allow viewing admin portal UI.
    // Admin role enforcement is handled by Firestore security rules + role doc.
    showApp();
    __bbDebugLog("B","controllers/admin/adminPortalController.js:watchAuth","show_admin_app",{});
    await window.showPage("dashboard", document.querySelector('.nav-item[onclick*="dashboard"]'), "Dashboard");
  });
});

function openMenuEditor(itemId) {
  const slot = document.getElementById("menuEditorSlot");
  if (!slot) return;

  const existing = state.menuItems.find(i => i.id === itemId);
  const isNew = !existing;
  const nextId = Math.max(0, ...state.menuItems.map(i => Number(i.id) || 0)) + 1;
  const item = existing ? { ...existing } : {
    id: nextId,
    name: "",
    price: 0,
    category: "coffee",
    subcategory: "Coffee",
    hasVariant: false,
    hasTemp: false,
    popular: false,
    bestseller: false,
    note: "",
    variants: [],
  };

  const variantsText = Array.isArray(item.variants) && item.variants.length ? JSON.stringify(item.variants, null, 2) : "[]";

  slot.innerHTML = `
    <div class="card" style="margin:14px 0;">
      <div class="card-head">
        <span class="card-title">${isNew ? "Add menu item" : "Edit menu item"}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
        <div>
          <div class="ls-label">ID</div>
          <input class="ls-input" id="mm_id" value="${item.id}" ${isNew ? "readonly" : "readonly"} style="margin-bottom:0;">
        </div>
        <div>
          <div class="ls-label">Price</div>
          <input class="ls-input" id="mm_price" type="number" step="0.25" value="${Number(item.price) || 0}" style="margin-bottom:0;">
        </div>
        <div style="grid-column:1/-1;">
          <div class="ls-label">Name</div>
          <input class="ls-input" id="mm_name" value="${(item.name || "").replaceAll('"', "&quot;")}" style="margin-bottom:0;">
        </div>
        <div>
          <div class="ls-label">Category</div>
          <input class="ls-input" id="mm_category" value="${item.category || ""}" placeholder="coffee / signature / matcha / ... / addons" style="margin-bottom:0;">
        </div>
        <div>
          <div class="ls-label">Subcategory</div>
          <input class="ls-input" id="mm_subcategory" value="${item.subcategory || ""}" placeholder="Coffee / Signature / Add-ons Drink / ..." style="margin-bottom:0;">
        </div>
        <div style="grid-column:1/-1;">
          <div class="ls-label">Note (optional)</div>
          <input class="ls-input" id="mm_note" value="${(item.note || "").replaceAll('"', "&quot;")}" style="margin-bottom:0;">
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;">
            <input type="checkbox" id="mm_hasTemp" ${item.hasTemp ? "checked" : ""}> Has temperature
          </label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;">
            <input type="checkbox" id="mm_hasVariant" ${item.hasVariant ? "checked" : ""}> Has variants
          </label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;">
            <input type="checkbox" id="mm_popular" ${item.popular ? "checked" : ""}> Popular
          </label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;">
            <input type="checkbox" id="mm_bestseller" ${item.bestseller ? "checked" : ""}> Bestseller
          </label>
        </div>
        <div style="grid-column:1/-1;">
          <div class="ls-label">Variants (JSON)</div>
          <textarea class="ls-input" id="mm_variants" rows="6" style="margin-bottom:0;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${variantsText}</textarea>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Example: [{\"name\":\"Small\",\"price\":120},{\"name\":\"Large\",\"price\":150}]</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end;">
        <button id="mm_cancel" style="background:transparent;border:1px solid var(--border-color);padding:10px 16px;border-radius:12px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Cancel</button>
        <button id="mm_save" style="background:var(--primary);color:white;border:none;padding:10px 16px;border-radius:12px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Save</button>
      </div>
    </div>
  `;

  document.getElementById("mm_cancel")?.addEventListener("click", () => {
    slot.innerHTML = "";
  });

  document.getElementById("mm_save")?.addEventListener("click", async () => {
    const err = (msg) => alert(msg);
    const id = Number(document.getElementById("mm_id")?.value);
    const name = document.getElementById("mm_name")?.value?.trim();
    const price = Number(document.getElementById("mm_price")?.value);
    const category = document.getElementById("mm_category")?.value?.trim();
    const subcategory = document.getElementById("mm_subcategory")?.value?.trim();
    const note = document.getElementById("mm_note")?.value?.trim() || "";
    const hasTemp = !!document.getElementById("mm_hasTemp")?.checked;
    const hasVariant = !!document.getElementById("mm_hasVariant")?.checked;
    const popular = !!document.getElementById("mm_popular")?.checked;
    const bestseller = !!document.getElementById("mm_bestseller")?.checked;

    if (!id || !name || !Number.isFinite(price) || !category || !subcategory) return err("ID, name, price, category, and subcategory are required.");

    let variants = [];
    const variantsRaw = document.getElementById("mm_variants")?.value || "[]";
    try {
      variants = JSON.parse(variantsRaw);
      if (!Array.isArray(variants)) return err("Variants must be a JSON array.");
      variants = variants.map(v => ({ name: String(v.name || "").trim(), price: Number(v.price) || 0 })).filter(v => v.name);
    } catch {
      return err("Variants JSON is invalid.");
    }

    const payload = {
      id,
      name,
      price,
      category,
      subcategory,
      note: note || undefined,
      hasTemp,
      hasVariant,
      popular: popular || undefined,
      bestseller: bestseller || undefined,
      ...(hasVariant ? { variants } : { variants: undefined }),
    };

    await saveMenuItem(payload);
    slot.innerHTML = "";
    await loadMenuPage();
  });
}

