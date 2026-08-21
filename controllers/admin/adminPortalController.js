import { logout as authLogout, watchAuth, createAuthUserByAdmin, updatePasswordByAdmin, getCurrentUser } from "../auth/firebaseAuth.js";
import { db } from "../firebase.js";
import {
  doc, setDoc, getDoc, updateDoc, collection, getDocs, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getAdminSettings, saveAdminSettings, getDefaultSettings, syncPendingAdminSettings } from "../../models/settingsModel.js";
import { getUserRole, getUserProfile, listUsers, setUserRole, setUserProfile, ensureAdminAccessProfile } from "../../models/userModel.js";
import { getMenuItems, saveMenuItem, deleteMenuItem, clearMenuItems, syncPendingMenuOps } from "../../models/menuModel.js";
import { getCategories, saveCategory, deleteCategory, getCategoryIconForName, syncCategoryLocalChanges } from "../../models/categoryModel.js";
import { getTodayOrders, getAllSalesOrders, deleteOrder, clearAllOrders, getPendingOrderCount, getQueuedOrders, syncQueuedOrders, getOrderStatus, voidOrder } from "../../models/orderModel.js";
import { getSavedSalesHistory, getDailyStatsByDate, getDrawerLogsByDate, purgeSavedSale, removeKitchenOrder } from "../../models/storageModel.js";
import { resetDay as archiveResetDay } from "../../models/resetModel.js";
import { getInventoryItems, saveInventoryItem, deleteInventoryItem, clearInventoryItems, convertQuantityBetweenUnits, normalizeUnit, renameInventoryCategory, deleteInventoryCategory, getInventoryCategoryNames, createInventoryCategory, restoreInventoryForOrder } from "../../models/inventoryModel.js";
import { inventorySeedItems } from "../../models/defaultSeedData.js";
import { getAllStaff as getStaff, getSchedule, getOnDutyNowFromSchedule, addStaff, removeStaff, removeStaffByName, removeStaffByAccountUid, updateStaffAccountLink, updateStaffNameByUid, saveSchedule, parseShiftRange } from "../../models/staffModel.js";
import { renderSalesAnalyticsDashboard, renderAdminDashboard, AIR_DATEPICKER_EN_LOCALE, airDatepickerSmartPosition, trackAirDatepickerReposition } from "../../views/dashboardView.js?v=20260821A";
import { renderAdminMenu } from "../../views/menuView.js";
import { renderStaffList, renderScheduleEditor, readScheduleFromDOM } from "../../views/staffView.js?v=20260821A";
import { navigateTo } from "../utils/routes.js";
import {
  isSupported as isPrinterSupported,
  getStatus as getPrinterStatus,
  connectPrinter as connectThermalPrinter,
  disconnectPrinter as disconnectThermalPrinter,
  reconnectSavedPrinter as reconnectThermalPrinter,
  printReceipt as printThermalReceipt,
  onPrinterStatus,
} from "../printer/thermalPrinter.js";

const ModalUtils = window.ModalUtils || {
  async confirm(title, message) {
    const prompt = `${String(title || "Confirm")}\n\n${String(message || "")}`.replace(/<[^>]*>/g, "");
    return window.confirm(prompt) ? 1 : 0;
  },
  async show(options) {
    const prompt = `${String(options?.title || "Message")}\n\n${String(options?.message || "")}`.replace(/<[^>]*>/g, "");
    window.alert(prompt);
    return 0;
  },
  async success(title, message) {
    const prompt = `${String(title || "Success")}\n\n${String(message || "")}`.replace(/<[^>]*>/g, "");
    window.alert(prompt);
    return 0;
  },
  async warning(title, message) {
    const prompt = `${String(title || "Warning")}\n\n${String(message || "")}`.replace(/<[^>]*>/g, "");
    window.alert(prompt);
    return 0;
  },
  async error(title, message) {
    const prompt = `${String(title || "Error")}\n\n${String(message || "")}`.replace(/<[^>]*>/g, "");
    window.alert(prompt);
    return 0;
  },
};

let currentReceiptOrder = null;

const state = {
  page: null,
  categories: [],
  menuItems: [],
  soldMap: {},
  ordersToday: [],
  allOrders: [],
  filteredOrders: [],
  pagedOrders: [],
  inventoryItems: [],
  inventoryCategories: [],
  lastInventorySyncMs: 0,
  accounts: [],
  lastAccountsSyncMs: 0,
  staff: [],
  schedule: {},
  orderStockExpanded: {},
};

const DASHBOARD_SYNC_INTERVAL_MS = 60_000;
let dashboardSyncInProgress = false;
let settingsRenderedSignature = null;
const AUTH_OPERATION_TIMEOUT_MS = 6000;

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

const orderFilters = {
  search: "",
  payment: "all",
  status: "all",
  sortBy: "latest",
  pageSize: 10,
  page: 1,
  fromDate: "",
  toDate: "",
  preset: "",
};

const ordersDatePickers = { from: null, to: null };

const logsState = { date: "" };
let logsDatePicker = null;

const accountFilters = {
  search: "",
  role: "all",
  status: "all",
  sortBy: "recent",
};

function showLogin() {
  window.__bbAuthSettled = true;
  navigateTo("login", { replace: true });
}

function normalizeSoldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildSoldMapFromOrders(orders = []) {
  const soldMap = {};
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    (Array.isArray(order?.items) ? order.items : []).forEach((item) => {
      const qty = Number(item?.quantity || 1) || 1;
      const menuItemId = String(item?.menuItemId || "").trim();
      const nameKey = normalizeSoldKey(item?.name);

      if (menuItemId) {
        soldMap[`id:${menuItemId}`] = (soldMap[`id:${menuItemId}`] || 0) + qty;
      }
      if (nameKey) {
        soldMap[`name:${nameKey}`] = (soldMap[`name:${nameKey}`] || 0) + qty;
      }
    });
  });
  return soldMap;
}

function showApp() {
  window.__bbAuthSettled = true;
  const loading = document.getElementById("auth-loading");
  const app = document.getElementById("app");
  if (loading) loading.style.display = "none";
  if (app) app.style.display = "flex";
  syncOfflineEdits();
}

async function syncOfflineEdits() {
  try {
    await Promise.allSettled([
      syncPendingAdminSettings(),
      syncPendingMenuOps(),
      syncCategoryLocalChanges(),
      syncQueuedOrders(),
    ]);
  } catch (error) {
    console.warn("[Admin] Offline edit sync failed; will retry on next load.", error);
  }
}

window.addEventListener("online", () => {
  syncOfflineEdits();
});

function setAuthLoadingState(message = "Loading dashboard...", keepAppVisible = false) {
  const loading = document.getElementById("auth-loading");
  const text = document.getElementById("auth-loading-text");
  const app = document.getElementById("app");
  if (text) text.textContent = message;
  if (loading) loading.style.display = "flex";
  if (app && !keepAppVisible) app.style.display = "none";
}

function setButtonLoadingState(button, isLoading, loadingLabel = "Working...") {
  if (!button) return;
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = String(button.textContent || "").trim() || "Button";
  }
  button.disabled = !!isLoading;
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
  button.textContent = isLoading ? loadingLabel : button.dataset.originalLabel;
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



function closeAdminMenuDropdowns() {
  document.querySelectorAll(".ls-dropdown-list.show").forEach((el) => el.classList.remove("show"));
}

function attachAdminMenuDropdownsOutsideClickListener() {
  if (window.__bbAdminMenuDropdownListenerSetup) return;
  window.__bbAdminMenuDropdownListenerSetup = true;
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".ls-dropdown-field")) {
      closeAdminMenuDropdowns();
    }
  });
}

function setupAdminMenuDropdownField(inputId, listId, values) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  list.innerHTML = values.map((value) => `
    <li><button type="button" class="ls-dropdown-item" data-value="${value}">${value}</button></li>
  `).join("");

  const toggle = document.querySelector(`[data-target="${listId}"]`);
  if (toggle) {
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = list.classList.contains("show");
      closeAdminMenuDropdowns();
      list.classList.toggle("show", !open);
    });
  }

  list.addEventListener("click", (event) => {
    const item = event.target.closest(".ls-dropdown-item");
    if (!item) return;
    input.value = item.dataset.value || "";
    closeAdminMenuDropdowns();
    input.focus();
  });
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

function notifTimeAgo(date) {
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const DISMISSED_NOTIFS_KEY = "bb_admin_dismissed_notifs";
const READ_NOTIFS_KEY = "bb_admin_read_notifs";
const dismissedNotifs = new Set();
const readNotifs = new Set();

function loadNotifState() {
  try {
    const raw = localStorage.getItem(DISMISSED_NOTIFS_KEY);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) arr.forEach((id) => dismissedNotifs.add(id)); }
  } catch {}
  try {
    const raw = localStorage.getItem(READ_NOTIFS_KEY);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) arr.forEach((id) => readNotifs.add(id)); }
  } catch {}
}

function saveNotifState() {
  try { localStorage.setItem(DISMISSED_NOTIFS_KEY, JSON.stringify(Array.from(dismissedNotifs))); } catch {}
  try { localStorage.setItem(READ_NOTIFS_KEY, JSON.stringify(Array.from(readNotifs))); } catch {}
}

async function loadNotifStateFromFirestore() {
  try {
    const uid = getCurrentUser()?.uid;
    if (!uid) return;
    const snap = await getDoc(doc(db, "adminReadNotifications", uid));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.dismissedIds)) data.dismissedIds.forEach((id) => dismissedNotifs.add(id));
      if (Array.isArray(data.readIds)) data.readIds.forEach((id) => readNotifs.add(id));
    }
  } catch {}
}

async function saveNotifStateToFirestore() {
  try {
    const uid = getCurrentUser()?.uid;
    if (!uid) return;
    await setDoc(doc(db, "adminReadNotifications", uid), {
      dismissedIds: Array.from(dismissedNotifs),
      readIds: Array.from(readNotifs),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch {}
}

function clearNotifState() {
  dismissedNotifs.clear();
  readNotifs.clear();
  localStorage.removeItem(DISMISSED_NOTIFS_KEY);
  localStorage.removeItem(READ_NOTIFS_KEY);
  saveNotifStateToFirestore().catch(() => {});
}

function getNotifId(n, i) {
  if (n.type === "order") return `order-${n.text}`;
  if (n.type === "stock") return `stock-${n.text}`;
  if (n.type === "sync") return `sync-${i}`;
  return `${n.type}-${i}`;
}

function buildNotifications() {
  const notifications = [];

  const todayOrders = Array.isArray(state.ordersToday) ? state.ordersToday : [];
  const recentOrders = todayOrders
    .slice()
    .sort((a, b) => {
      const aMs = getOrderDate(a)?.getTime() || 0;
      const bMs = getOrderDate(b)?.getTime() || 0;
      return bMs - aMs;
    })
    .slice(0, 5);

  for (const order of recentOrders) {
    const orderDate = getOrderDate(order);
    const total = Number(order.total || 0);
    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
    notifications.push({
      type: "order",
      text: `New order #${String(order.orderId || order.id || "\u2014")} \u2014 ${formatMoney(total)}`,
      meta: `${itemCount} item${itemCount === 1 ? "" : "s"} \u2022 ${order.paymentMethod ? String(order.paymentMethod).toUpperCase() : "CASH"}`,
      date: orderDate,
      navigate: "orders",
    });
  }

  const inventory = Array.isArray(state.inventoryItems) ? state.inventoryItems : [];
  const lowStockItems = inventory.filter((i) => {
    const s = inventoryStatus(i);
    return s === "low" || s === "critical" || s === "out";
  }).slice(0, 3);

  for (const item of lowStockItems) {
    const status = inventoryStatus(item);
    const label = status === "out" ? "Out of stock" : status === "critical" ? "Critically low" : "Low stock";
    notifications.push({
      type: "stock",
      text: `${item.name} \u2014 ${label}`,
      meta: `${formatDecimal(item.quantity)} ${item.unit || "unit"} remaining`,
      date: null,
      navigate: "inventory",
    });
  }

  const pendingSync = typeof getPendingOrderCount === "function" ? getPendingOrderCount() : 0;
  if (pendingSync > 0) {
    notifications.push({
      type: "sync",
      text: `${pendingSync} order${pendingSync === 1 ? "" : "s"} pending sync`,
      meta: "Will upload when online",
      date: null,
      navigate: null,
    });
  }

  return notifications
    .map((n, i) => ({ ...n, _id: getNotifId(n, i) }))
    .filter((n) => !dismissedNotifs.has(n._id));
}

function renderNotifications() {
  const body = document.getElementById("notifDropdownBody");
  const badge = document.getElementById("notifBadge");
  const countEl = document.getElementById("notifTotalCount");
  const markReadBtn = document.getElementById("notifMarkReadBtn");
  const clearBtn = document.getElementById("notifClearAllBtn");
  if (!body) return;

  const all = buildNotifications();
  const unreadCount = all.filter((n) => !readNotifs.has(n._id)).length;
  const totalCount = all.length;

  if (countEl) countEl.textContent = unreadCount > 0 ? unreadCount : totalCount;
  if (markReadBtn) markReadBtn.style.display = unreadCount > 0 ? "inline-block" : "none";
  if (clearBtn) clearBtn.style.display = totalCount > 0 ? "inline-block" : "none";

  if (badge) {
    const prevCount = parseInt(badge.textContent) || 0;
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
      badge.classList.add("has-count");
      if (unreadCount !== prevCount) {
        badge.classList.remove("pulse");
        void badge.offsetWidth;
        badge.classList.add("pulse");
      }
    } else {
      badge.classList.remove("has-count");
      badge.textContent = "";
    }
  }

  const bellBtn = document.getElementById("topbarNotifBtn");
  if (bellBtn) {
    if (unreadCount > 0) {
      bellBtn.classList.add("has-notifs");
    } else {
      bellBtn.classList.remove("has-notifs");
    }
  }

  if (!totalCount) {
    body.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-icon"><i class="ri-notification-off-line"></i></div>
        <div>All caught up</div>
        <div style="font-size:11px;color:var(--text-muted);">No new notifications right now.</div>
      </div>`;
    return;
  }

  const sections = [];
  const orders = all.filter((n) => n.type === "order");
  const stocks = all.filter((n) => n.type === "stock");
  const syncs = all.filter((n) => n.type === "sync");

  function renderSection(items, label, iconClass, iconHtml) {
    if (!items.length) return "";
    return `
      <div class="notif-section">
        <div class="notif-section-label">${escapeHtml(label)}</div>
        ${items.map((n) => {
          const isRead = readNotifs.has(n._id);
          return `
          <div class="notif-item${isRead ? " notif-item-read" : ""}" data-notif-nav="${escapeHtml(n.navigate || "")}" data-notif-id="${escapeHtml(n._id || "")}">
            <div class="notif-icon ${escapeHtml(iconClass)}">${iconHtml}</div>
            <div class="notif-content">
              <div class="notif-text">${escapeHtml(n.text)}</div>
              <div class="notif-meta">${escapeHtml(n.meta)}${n.date ? " \u2022 " + notifTimeAgo(n.date) : ""}</div>
            </div>
          </div>`;
        }).join("")}
      </div>
    `;
  }

  sections.push(renderSection(orders, "Recent Orders", "order", '<i class="ri-shopping-bag-3-line"></i>'));
  sections.push(renderSection(stocks, "Low Stock", "stock", '<i class="ri-alert-line"></i>'));
  sections.push(renderSection(syncs, "Pending Sync", "sync", '<i class="ri-refresh-line"></i>'));

  body.innerHTML = sections.filter(Boolean).join("") + `
    <div class="notif-viewall" data-notif-nav="orders"><i class="ri-arrow-right-line" style="font-size:12px;vertical-align:middle;margin-right:4px;"></i>View all transactions</div>
  `;

  body.querySelectorAll(".notif-item[data-notif-nav]").forEach((el) => {
    el.addEventListener("click", async () => {
      const nid = el.getAttribute("data-notif-id");
      const target = el.getAttribute("data-notif-nav");
      if (nid) {
        dismissedNotifs.add(nid);
        saveNotifState();
        saveNotifStateToFirestore();
      }
      closeNotifDropdown();
      if (target && window.showPage) {
        const navEl = document.querySelector(`.nav-item[onclick*="${target}"]`) || document.getElementById(`nav-${target}`);
        await window.showPage(target, navEl, target === "orders" ? "Transactions" : target === "inventory" ? "Inventory" : target);
      }
    });
  });

  const viewAll = body.querySelector(".notif-viewall[data-notif-nav]");
  if (viewAll) {
    viewAll.addEventListener("click", async () => {
      const target = viewAll.getAttribute("data-notif-nav");
      closeNotifDropdown();
      if (target && window.showPage) {
        const navEl = document.querySelector(`.nav-item[onclick*="${target}"]`) || document.getElementById(`nav-${target}`);
        await window.showPage(target, navEl, target === "orders" ? "Transactions" : target);
      }
    });
  }

  if (markReadBtn) {
    markReadBtn.onclick = () => {
      all.forEach((n) => { if (n._id) readNotifs.add(n._id); });
      saveNotifState();
      saveNotifStateToFirestore();
      renderNotifications();
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      all.forEach((n) => { if (n._id) dismissedNotifs.add(n._id); });
      readNotifs.clear();
      saveNotifState();
      saveNotifStateToFirestore();
      renderNotifications();
    };
  }
}

function toggleNotifDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (!dropdown) return;
  const isOpen = dropdown.classList.contains("open");
  if (isOpen) {
    closeNotifDropdown();
  } else {
    renderNotifications();
    dropdown.classList.add("open");
  }
}

function closeNotifDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (dropdown) dropdown.classList.remove("open");
}

async function openTopbarAccount() {
  await window.showPage("accounts", document.querySelector('.nav-item[onclick*="accounts"]'), "Accounts");
}

function setupTopbarActions() {
  makeKeyboardClickable(document.getElementById("topbarNotifBtn"), toggleNotifDropdown);
  makeKeyboardClickable(document.getElementById("topbarAvatarBtn"), openTopbarAccount);

  const showAddBtn = document.getElementById("showAddStaffBtn");
  const hideAddBtn = document.getElementById("hideAddStaffBtn");
  const cancelAddBtn = document.getElementById("cancelAddStaffBtn");
  if (showAddBtn) showAddBtn.addEventListener("click", window.showAddStaff);
  if (hideAddBtn) hideAddBtn.addEventListener("click", window.hideAddStaff);
  if (cancelAddBtn) cancelAddBtn.addEventListener("click", window.hideAddStaff);

  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("notifDropdown");
    const btn = document.getElementById("topbarNotifBtn");
    if (dropdown && !dropdown.contains(e.target) && btn && !btn.contains(e.target)) {
      closeNotifDropdown();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNotifDropdown();
  });
}

function setupSidebarToggle() {
  const toggleBtn = document.getElementById("sidebarToggle");
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!toggleBtn || !sidebar || !overlay) return;

  function closeSidebar() {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    document.documentElement.classList.remove("sidebar-open");
  }

  toggleBtn.addEventListener("click", () => {
    const isOpen = sidebar.classList.contains("is-open");
    if (isOpen) {
      closeSidebar();
    } else {
      sidebar.classList.add("is-open");
      overlay.classList.add("is-visible");
      document.documentElement.classList.add("sidebar-open");
    }
  });

  overlay.addEventListener("click", closeSidebar);

  sidebar.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", closeSidebar);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
      closeSidebar();
    }
  });
}

function showPage(pageId) {
  const mainEl = document.querySelector(".main");
  if (mainEl) mainEl.scrollTop = 0;
  if (document.activeElement) document.activeElement.blur();
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

function formatMoney(value) {
  return `₱${(Number(value) || 0).toFixed(2)}`;
}

function renderSectionState(message, tone = "muted") {
  const safeTone = ["muted", "warning", "error"].includes(tone) ? tone : "muted";
  return `<div class="section-state ${safeTone}">${escapeHtml(message || "")}</div>`;
}

function normalizeIdentityToken(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCategoryToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/\s+/g, " ");
}

function resolveCanonicalMenuCategory(categoryName, categories = [], menuItems = []) {
  const normalized = normalizeCategoryToken(categoryName);
  if (!normalized) return "";

  const fromCategories = (Array.isArray(categories) ? categories : []).find((entry) => {
    const idNormalized = normalizeCategoryToken(entry?.id);
    const nameNormalized = normalizeCategoryToken(entry?.name);
    return normalized === nameNormalized || normalized === idNormalized;
  });
  if (fromCategories?.name) return String(fromCategories.name).trim();

  const fromMenuItems = (Array.isArray(menuItems) ? menuItems : []).find((entry) => {
    return normalizeCategoryToken(entry?.category) === normalized;
  });
  if (fromMenuItems?.category) return String(fromMenuItems.category).trim();

  return String(categoryName || "").trim();
}

function normalizeAddonCollection(addons, idPrefix = "addon") {
  if (!Array.isArray(addons)) return [];

  return addons
    .map((addon, index) => {
      const recipe = Array.isArray(addon?.recipe)
        ? addon.recipe
            .map((ingredient) => ({
              inventoryId: String(ingredient?.inventoryId || "").trim(),
              name: String(ingredient?.name || "").trim(),
              quantity: Number(ingredient?.quantity || 0),
              unit: normalizeUnit(ingredient?.unit || "") || String(ingredient?.unit || "").trim(),
            }))
            .filter((ingredient) => ingredient.inventoryId && ingredient.quantity > 0)
        : [];

      const name = String(addon?.name || recipe[0]?.name || "").trim();
      if (!name) return null;

      return {
        id: String(addon?.id || `${idPrefix}-${index + 1}`),
        name,
        price: Math.max(0, Number(addon?.price || 0)),
        recipe,
      };
    })
    .filter(Boolean);
}

function getCategoryByToken(categoryValue) {
  const normalized = normalizeCategoryToken(categoryValue);
  if (!normalized) return null;

  return (Array.isArray(state.categories) ? state.categories : []).find((entry) => {
    const idKey = normalizeCategoryToken(entry?.id);
    const nameKey = normalizeCategoryToken(entry?.name);
    return normalized === idKey || normalized === nameKey;
  }) || null;
}

async function backfillStaffAccountLinks(staff, users) {
  const staffList = Array.isArray(staff) ? staff : [];
  const userList = Array.isArray(users) ? users : [];
  if (!staffList.length || !userList.length) {
    return { linked: 0, ambiguous: 0, skipped: 0 };
  }

  const usedAccountUids = new Set(
    staffList
      .map((entry) => String(entry?.accountUid || "").trim())
      .filter(Boolean)
  );

  const eligibleUsers = userList.filter((user) => {
    const role = normalizeIdentityToken(user?.role);
    const deleted = !!user?.deleted || Number(user?.deletedAtMs || 0) > 0;
    return role === "staff" && !deleted;
  });

  let linked = 0;
  let ambiguous = 0;
  let skipped = 0;

  for (const member of staffList) {
    const staffId = String(member?.id || "").trim();
    const currentUid = String(member?.accountUid || "").trim();
    if (!staffId || currentUid) continue;

    const byEmailKey = normalizeIdentityToken(member?.email);
    const byNameKey = normalizeIdentityToken(member?.name);

    let candidates = [];
    if (byEmailKey) {
      candidates = eligibleUsers.filter((user) => normalizeIdentityToken(user?.email) === byEmailKey);
    }

    if (!candidates.length && byNameKey) {
      candidates = eligibleUsers.filter((user) => normalizeIdentityToken(user?.fullName) === byNameKey);
    }

    const uniqueCandidates = candidates.filter((user) => {
      const uid = String(user?.uid || "").trim();
      return uid && !usedAccountUids.has(uid);
    });

    if (uniqueCandidates.length !== 1) {
      if (uniqueCandidates.length > 1) {
        ambiguous += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const match = uniqueCandidates[0];
    const accountUid = String(match?.uid || "").trim();
    if (!accountUid) {
      skipped += 1;
      continue;
    }

    await updateStaffAccountLink(staffId, {
      accountUid,
      email: String(match?.email || member?.email || "").trim(),
    });
    usedAccountUids.add(accountUid);
    linked += 1;
  }

  return { linked, ambiguous, skipped };
}

async function loadDashboard() {
  try {
    // Make sure any queued POS transactions are pushed to Firestore before analytics reads them.
    try {
      if (typeof syncQueuedOrders === "function") {
        const syncResult = await syncQueuedOrders();
        if (syncResult && (syncResult.synced || syncResult.pending)) {
          console.debug("[Admin] syncQueuedOrders result:", syncResult);
        }
      }
    } catch (syncError) {
      console.warn("[Admin] queued order sync failed before dashboard load:", syncError);
    }

    // Fetch live data and render both dashboard and analytics as needed
    const [menuItems, ordersToday, allOrders, staff, schedule, inventoryItems] = await Promise.all([
      getMenuItems().catch(() => []),
      getTodayOrders().catch(() => []),
      getAllSalesOrders().catch(() => []),
      getStaff().catch(() => []),
      getSchedule().catch(() => ({})),
      getInventoryItems().catch(() => []),
    ]);

    state.ordersToday = ordersToday;
    state.inventoryItems = inventoryItems;
    try { renderNotifications(); } catch (_) {}

    // Render legacy dashboard (uses today's orders, menu items, and staff schedule)
    try {
      renderAdminDashboard({ orders: ordersToday, menuItems, staff, schedule });
    } catch (e) {
      console.warn("[Dashboard] renderAdminDashboard failed:", e);
    }

    // Render analytics (uses full order history and menuItems)
    try {
      const pendingSyncCount = typeof getPendingOrderCount === "function" ? getPendingOrderCount() : 0;
      // If there are queued orders locally, include them in analytics so offline sales are visible
      let queuedOrders = [];
      try {
        queuedOrders = typeof getQueuedOrders === "function" ? getQueuedOrders() : [];
      } catch (err) {
        queuedOrders = [];
      }
      // Prefer the live POS transaction store first, then add Firestore history as backup.
      const mergedOrders = [];
      // Also include locally saved salesHistory (POS local storage) to ensure analytics reflects POS totals
      try {
        const saved = typeof getSavedSalesHistory === "function" ? getSavedSalesHistory() : [];
        if (Array.isArray(saved) && saved.length) {
          let added = 0;
          for (const s of saved) {
            const id = String(s?.orderId || s?.id || "");
            const exists = mergedOrders.some((o) => String(o?.orderId || o?.id || "") === id);
            if (!exists) {
              mergedOrders.unshift(s);
              added += 1;
            }
          }
          if (added) console.debug(`[Analytics] merged ${added} local saved sale(s) into analytics`);
        }
      } catch (err) {
        console.warn("[Analytics] failed to merge saved sales history", err);
      }
      if (Array.isArray(queuedOrders) && queuedOrders.length) {
        // Append queued orders (they already have timestamps/createdAtMs)
        mergedOrders.unshift(...queuedOrders);
      }
      if (Array.isArray(allOrders) && allOrders.length) {
        for (const order of allOrders) {
          const id = String(order?.orderId || order?.id || "");
          const exists = mergedOrders.some((o) => String(o?.orderId || o?.id || "") === id);
          if (!exists) mergedOrders.push(order);
        }
      }
      // Drop "ghost" orders: local saved/queued copies that exist in neither
      // Firestore nor the offline outbox. This happens when a transaction is
      // deleted on the admin Transactions page — the Firestore doc is gone but
      // a stale copy can linger in this terminal's localStorage and would
      // otherwise keep inflating Sales Analytics forever.
      if (mergedOrders.length) {
        const firestoreIds = new Set((Array.isArray(allOrders) ? allOrders : []).map((o) => String(o?.orderId || o?.id || "").trim()));
        const outboxIds = new Set((Array.isArray(queuedOrders) ? queuedOrders : []).map((o) => String(o?.orderId || o?.id || "").trim()));
        const ghosts = mergedOrders.filter((o) => {
          const id = String(o?.orderId || o?.id || "").trim();
          return id && !firestoreIds.has(id) && !outboxIds.has(id);
        });
        if (ghosts.length) {
          const pruned = mergedOrders.filter((o) => {
            const id = String(o?.orderId || o?.id || "").trim();
            if (!id) return false;
            return firestoreIds.has(id) || outboxIds.has(id);
          });
          console.debug(`[Analytics] dropped ${ghosts.length} stale local order(s) not in Firestore or queued outbox`);
          mergedOrders.length = 0;
          mergedOrders.push(...pruned);
        }
      }
      // Normalize merged orders to ensure date and total fields are usable by analytics
      const normalized = (Array.isArray(mergedOrders) ? mergedOrders : []).map((o) => {
        try {
          const copy = Object.assign({}, o || {});
          // ensure numeric total
          copy.total = Number(copy.total) || 0;
          // createdAtMs precedence
          if (Number.isFinite(Number(copy.createdAtMs)) && Number(copy.createdAtMs) > 0) {
            copy.createdAtMs = Number(copy.createdAtMs);
          } else if (copy.createdAt && copy.createdAt?.toDate) {
            // Firestore Timestamp
            try { copy.createdAtMs = copy.createdAt.toDate().getTime(); } catch (e) {}
          } else if (copy.createdAt) {
            const parsed = Date.parse(copy.createdAt);
            if (!Number.isNaN(parsed)) copy.createdAtMs = parsed;
          } else if (copy.timestamp) {
            const parsed2 = Date.parse(copy.timestamp);
            if (!Number.isNaN(parsed2)) copy.createdAtMs = parsed2;
          }
          // fallback
          if (!Number.isFinite(copy.createdAtMs)) copy.createdAtMs = Date.now();
          return copy;
        } catch (err) {
          return o;
        }
      });

      const normalizedToday = normalized.filter((order) => {
        try {
          const created = order?.createdAtMs
            ? new Date(Number(order.createdAtMs))
            : (order?.createdAt?.toDate ? order.createdAt.toDate() : (order?.createdAt ? new Date(order.createdAt) : null));
          if (!created || Number.isNaN(created.getTime())) return false;
          const now = new Date();
          return created.getFullYear() === now.getFullYear()
            && created.getMonth() === now.getMonth()
            && created.getDate() === now.getDate();
        } catch {
          return false;
        }
      });

      console.debug(`[Admin] analytics source orders: firestore=${Array.isArray(allOrders) ? allOrders.length : 0}, queued=${Array.isArray(queuedOrders) ? queuedOrders.length : 0}, local=${Array.isArray(getSavedSalesHistory?.()) ? getSavedSalesHistory().length : 0}, merged=${normalized.length}`);

      renderSalesAnalyticsDashboard({ allOrders: normalized, todayOrders: normalizedToday.length ? normalizedToday : ordersToday, menuItems, pendingSyncCount });
    } catch (e) {
      console.warn("[Analytics] renderSalesAnalyticsDashboard failed:", e);
    }

  } finally {
    showApp();
  }
}

function startDashboardAutoSync() {
  window.setInterval(async () => {
    if (state.page !== "dashboard" && state.page !== "salesAnalytics") return;
    if (dashboardSyncInProgress) return;

    dashboardSyncInProgress = true;
    try {
      await loadDashboard();
    } catch (error) {
      console.warn("[Dashboard] Auto-sync failed:", error);
    } finally {
      dashboardSyncInProgress = false;
    }
  }, DASHBOARD_SYNC_INTERVAL_MS);
}

async function loadMenuPage() {
  try {
    const [menuItems, ordersToday, inventoryItems] = await Promise.all([
      getMenuItems(),
      getTodayOrders(),
      getInventoryItems().catch((error) => {
        console.warn("[Menu] Inventory prefetch failed:", error);
        return state.inventoryItems || [];
      }),
    ]);
    let provisionedMenuItems = menuItems || [];
    let provisionedInventoryItems = inventoryItems || [];
    state.menuItems = provisionedMenuItems || [];
    state.ordersToday = ordersToday;
    state.inventoryItems = provisionedInventoryItems;

    // Load Categories into the dedicated section above the menu items
    const categoriesListEl = document.getElementById("adminCategoriesList");
    if (categoriesListEl) {
       const hasCachedCategories = Array.isArray(state.categories) && state.categories.length > 0;
       if (hasCachedCategories) {
         renderAdminCategories();
       } else {
         categoriesListEl.innerHTML = renderSectionState("Loading categories...");
       }
       try {
         state.categories = await getCategories();
         renderAdminCategories();
       } catch (err) {
         console.error(err);
         if (!hasCachedCategories) {
           categoriesListEl.innerHTML = renderSectionState("Failed to load categories.", "error");
         }
       }
    }

    // sold map for today
    state.soldMap = buildSoldMapFromOrders(ordersToday);

    const container = document.getElementById("menuContent");
    if (!container) return;

  container.innerHTML = `
    <div class="card admin-menu-shell">
      <div class="card-head admin-menu-shell-head">
        <div>
          <span class="card-title">Menu management</span>
          <div class="admin-menu-shell-sub">Use Quick Add to prefill category and speed up item creation.</div>
        </div>
        <div class="admin-menu-shell-actions">
          <button id="btnAddMenuItem"
            class="admin-menu-shell-btn primary">
            + Add item
          </button>
          <button id="btnClearMenu"
            class="admin-menu-shell-btn danger">
            Clear all
          </button>
          <button id="btnRefreshMenu"
            class="admin-menu-shell-btn ghost">
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
  if (original) {
    original.id = "menuContent__tmp";
    inner.id = "menuContent";
    try {
      renderAdminMenu(state.menuItems || [], state.soldMap || {}, state.inventoryItems || [], state.categories || []);
    } finally {
      inner.id = "menuListInner";
      original.id = "menuContent";
    }
  } else {
    // If not found, create a temporary one
    inner.id = "menuContent";
    try {
      renderAdminMenu(state.menuItems || [], state.soldMap || {}, state.inventoryItems || [], state.categories || []);
    } finally {
      inner.id = "menuListInner";
    }
  }

  window._adminEditMenuItem = (id) => openMenuEditor(id);
  window._adminDeleteMenuItem = async (id) => {
    try {
      const choice = await ModalUtils.confirm("Delete Item", "Are you sure you want to delete this menu item? This action cannot be undone.");
      if (choice !== 1) return;
      await deleteMenuItem(id);
      await loadMenuPage();
      await ModalUtils.success("Item Deleted", "Menu item has been removed successfully.");
    } catch (error) {
      console.error("Delete menu item failed:", error);
      await ModalUtils.error("Delete Failed", error?.message || "Unable to delete menu item.");
    }
  };

    document.getElementById("btnAddMenuItem")?.addEventListener("click", () => openMenuEditor(null));
    document.getElementById("btnClearMenu")?.addEventListener("click", async () => {
      try {
        const confirmed = await ModalUtils.confirm("Clear all menu items", "This will permanently remove every menu item. Are you sure you want to continue?");
        if (confirmed !== 1) return;
        await clearMenuItems();
        await loadMenuPage();
        await ModalUtils.success("Menu cleared", "All menu items have been removed. You can now add new categories and items.");
      } catch (error) {
        console.error("Clear menu failed:", error);
        await ModalUtils.error("Clear Failed", error?.message || "Unable to clear menu items.");
      }
    });
    document.getElementById("btnRefreshMenu")?.addEventListener("click", () => loadMenuPage());
  } finally {
    showApp();
  }
}

async function loadStaffPage() {
  try {
    const [staff, schedule] = await Promise.all([getStaff(), getSchedule()]);

    let nextStaff = staff;
    try {
      const users = await listUsers();
      const backfill = await backfillStaffAccountLinks(staff, users);
      if (backfill.linked > 0) {
        nextStaff = await getStaff();
        console.info(
          `[Staff] Backfilled account links: ${backfill.linked} linked, ${backfill.ambiguous} ambiguous, ${backfill.skipped} skipped.`
        );
      }
    } catch (backfillError) {
      console.warn("[Staff] Backfill skipped due to account fetch/update issue:", backfillError);
    }

    state.staff = nextStaff;
    state.schedule = schedule;

    renderStaffList(nextStaff, async (id) => {
    const member = state.staff.find((entry) => entry.id === id);
    if (!member) return;

    const confirmed = await ModalUtils.confirm(
      "Remove Staff",
      `Remove ${escapeHtml(member.name || "this staff member")} from staff list? This will also deactivate linked staff account access.`
    );
    if (confirmed !== 1) return;

    await removeStaff(id);

    let deactivatedCount = 0;
    try {
      const users = await listUsers();
      const targetUid = String(member?.accountUid || "").trim();
      let matchedStaffAccounts = [];

      if (targetUid) {
        const linked = users.find((user) => String(user?.uid || "").trim() === targetUid);
        if (linked) matchedStaffAccounts = [linked];
      }

      if (!matchedStaffAccounts.length) {
        const targetName = String(member.name || "").trim().toLowerCase();
        matchedStaffAccounts = users.filter((user) => {
          const fullName = String(user?.fullName || "").trim().toLowerCase();
          const role = String(user?.role || "").trim().toLowerCase();
          const deleted = !!user?.deleted || Number(user?.deletedAtMs || 0) > 0;
          return fullName && fullName === targetName && role === "staff" && !deleted;
        });
      }

      const firedAtMs = Date.now();
      await Promise.all(matchedStaffAccounts.map((user) =>
        setUserProfile(user.uid, {
          status: "suspended",
          deleted: true,
          firedAtMs,
          deletedAtMs: firedAtMs,
          updatedAtMs: firedAtMs,
        })
      ));
      deactivatedCount = matchedStaffAccounts.length;
    } catch (accountError) {
      console.warn("[Staff] Removed staff record, but account deactivation failed:", accountError);
    }

    await loadStaffPage();

    if (deactivatedCount > 0) {
      await ModalUtils.success(
        "Staff Removed",
        `${escapeHtml(member.name || "Staff member")} was removed and ${deactivatedCount} account(s) were deactivated.`
      );
    } else {
      await ModalUtils.success(
        "Staff Removed",
        `${escapeHtml(member.name || "Staff member")} was removed from the staff list.`
      );
    }
  });

    renderScheduleEditor(nextStaff, schedule);
  } finally {
    showApp();
  }
}

async function loadOrdersPage() {
  const wrap = document.getElementById("ordersTableWrap");
  if (!wrap) return;

  wrap.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0;">Loading transactions...</div>`;

  try {
    state.allOrders = await getAllSalesOrders(null, null, { includeVoided: true });
    state.orderStockExpanded = {};
    await autoCompleteStalePendingOrders();
    await autoArchivePreviousDayOrders();
    bindOrdersControls();
    applyOrderFilters();
  } catch (error) {
    wrap.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px 0;">Failed to load transactions: ${escapeHtml(error?.message || "Unknown error")}</div>`;
  } finally {
    showApp();
  }
}

// Auto-record stale pending orders (from a previous day) as "done" so they stop
// stacking as Pending on the transactions page when staff forget to mark them
// prepared. Covers both live `orders` docs and archived `resets/{date}/orders`
// docs (archived copies carry `archivedFrom`). Best-effort and idempotent — it
// only ever sets status to "done" and never blocks or fails the page load.
async function autoCompleteStalePendingOrders() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startMs = startOfToday.getTime();

  // Make the sweep self-contained so it also works at login (before the
  // transactions page has populated state.allOrders).
  if (!Array.isArray(state.allOrders) || state.allOrders.length === 0) {
    try {
      state.allOrders = await getAllSalesOrders(null, null, { includeVoided: true });
    } catch (error) {
      console.warn("[Admin] Auto-complete: could not load orders at login.", error);
      return 0;
    }
  }

  const stale = (state.allOrders || []).filter((order) => {
    if (getOrderStatus(order) !== "pending") return false;
    const date = getOrderDate(order);
    return date ? date.getTime() < startMs : false;
  });

  if (!stale.length) return 0;

  const preparedAtMs = Date.now();
  const preparedBy = "Auto (stale cleanup)";
  let updated = 0;

  try {
    const writes = [];
    for (const order of stale) {
      const orderKey = String(order.id || order.orderId || "");
      if (!orderKey) continue;
      const ref = order.archivedFrom
        ? doc(db, "resets", order.archivedFrom, "orders", orderKey)
        : doc(db, "orders", orderKey);
      writes.push({ ref, data: { status: "done", preparedAtMs, preparedBy } });
    }

    for (let i = 0; i < writes.length; i += 450) {
      const batch = writeBatch(db);
      writes.slice(i, i + 450).forEach((w) => batch.update(w.ref, w.data));
      await batch.commit();
      updated += Math.min(450, writes.length - i);
    }

    if (updated > 0) {
      try {
        state.allOrders = await getAllSalesOrders(null, null, { includeVoided: true });
      } catch (refreshError) {
        console.warn("[Admin] Refresh after auto-complete failed.", refreshError);
      }
    }
  } catch (error) {
    console.warn("[Admin] Auto-complete stale pending orders failed (best-effort).", error);
  }

  return updated;
}

// Auto-archive previous-day orders so the transactions feed rolls over each
// morning without anyone pressing "Archive Transactions". Only orders created
// strictly before today are moved to resets/{date}/orders (pending ones become
// done); today's orders stay live so KPIs, the POS feed, and the reset-marker
// prune guard are all unaffected. Idempotent — it no-ops when there is nothing
// before today. The manual Archive button still works for a full end-of-day
// close. Best-effort: a failure here must never block the page.
async function autoArchivePreviousDayOrders() {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const result = await archiveResetDay({ onlyBeforeMs: startOfToday.getTime() });
    if (result && result.success) {
      console.log(`[Admin] Auto-archived ${result.totalArchived} previous-day order(s).`);
      if (Number(result.autoCompleted) > 0) {
        console.log(`[Admin] ${result.autoCompleted} pending order(s) were marked done.`);
      }
      showAutoArchiveToast(result);
      return result;
    }
  } catch (error) {
    console.warn("[Admin] Auto-archive previous-day orders failed (best-effort).", error);
  }
  return null;
}

function showAutoArchiveToast(result) {
  try {
    const parts = [`Auto-archived ${result.totalArchived} previous-day transaction(s).`];
    if (Number(result.autoCompleted) > 0) {
      parts.push(`${result.autoCompleted} pending order(s) were marked done.`);
    }
    const el = document.createElement("div");
    el.textContent = parts.join(" ");
    Object.assign(el.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      zIndex: "99999",
      background: "#0f7b3e",
      color: "#fff",
      padding: "12px 18px",
      borderRadius: "10px",
      font: "14px/1.4 system-ui, sans-serif",
      boxShadow: "0 6px 18px rgba(0,0,0,.25)",
      maxWidth: "340px",
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .4s ease";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 420);
    }, 6000);
  } catch (e) {
    // The toast is purely cosmetic; never let it break anything.
  }
}

function getOrderDate(order) {
  if (order.createdAt?.toDate) return order.createdAt.toDate();
  if (order.createdAtMs) return new Date(order.createdAtMs);
  if (order.timestamp) return new Date(order.timestamp);
  return null;
}

function orderHasDiscount(order) {
  if (Number(order.discountAmount || 0) > 0) return true;
  if (order.isPwdSenior) return true;
  if ((order.items || []).some((item) => Number(item.discountPercent || 0) > 0)) return true;
  return false;
}

function applyOrderFilters() {
  const search = (orderFilters.search || "").trim().toLowerCase();
  const payment = (orderFilters.payment || "all").toLowerCase();
  const statusFilter = (orderFilters.status || "all").toLowerCase();
  const from = orderFilters.fromDate ? new Date(`${orderFilters.fromDate}T00:00:00`) : null;
  const to = orderFilters.toDate ? new Date(`${orderFilters.toDate}T23:59:59`) : null;

  const filtered = state.allOrders.filter((order) => {
    const date = getOrderDate(order);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;

    if (statusFilter !== "all" && getOrderStatus(order) !== statusFilter) return false;

    const normalizedPayment = String(order.paymentMethod || "cash").toLowerCase();
    const orderType = String(order.orderType || "regular").toLowerCase();
    if (payment === "paid") {
      if (orderType === "employee") return false;
    } else if (payment === "employee") {
      if (orderType !== "employee") return false;
    } else if (payment === "discounted") {
      if (orderType === "employee" || !orderHasDiscount(order)) return false;
    } else if (payment === "no_discount") {
      if (orderType === "employee" || orderHasDiscount(order)) return false;
    } else if (payment !== "all" && normalizedPayment !== payment) {
      return false;
    }

    if (!search) return true;

    const orderRef = String(order.orderId || order.id || "").toLowerCase();
    const items = (order.items || []).map((i) => i.name || "").join(" ").toLowerCase();
    const timeText = date ? date.toLocaleString("en-PH").toLowerCase() : "";
    const noteText = String(order.note || "").toLowerCase();

    return orderRef.includes(search) || items.includes(search) || timeText.includes(search) || noteText.includes(search);
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
  syncOrderPresetChips();
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
  if (sortBy === "items_desc" || sortBy === "items_asc") {
    const count = (order) =>
      (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    next.sort((a, b) => (sortBy === "items_desc" ? count(b) - count(a) : count(a) - count(b)));
    return next;
  }
  if (sortBy === "payment_asc" || sortBy === "payment_desc") {
    next.sort((a, b) => {
      const pa = String(a.paymentMethod || "cash").toUpperCase();
      const pb = String(b.paymentMethod || "cash").toUpperCase();
      const cmp = pa.localeCompare(pb);
      return sortBy === "payment_asc" ? cmp : -cmp;
    });
    return next;
  }
  if (sortBy === "ref_desc" || sortBy === "ref_asc") {
    next.sort((a, b) => {
      const ra = String(a.orderId || a.id || "");
      const rb = String(b.orderId || b.id || "");
      const cmp = ra.localeCompare(rb);
      return sortBy === "ref_desc" ? cmp : -cmp;
    });
    return next;
  }

  next.sort((a, b) => {
    const aTime = getOrderDate(a)?.getTime() || 0;
    const bTime = getOrderDate(b)?.getTime() || 0;
    return sortBy === "oldest" ? aTime - bTime : bTime - aTime;
  });
  return next;
}

function formatInventoryQty(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num - Math.round(num)) < 0.000001) return String(Math.round(num));
  return num.toFixed(2);
}

function summarizeInventoryDeductions(auditRows) {
  const source = Array.isArray(auditRows) ? auditRows : [];
  const byInventory = new Map();

  source.forEach((entry) => {
    const inventoryId = String(entry?.inventoryId || "").trim() || String(entry?.name || "unknown").trim() || `unknown-${byInventory.size + 1}`;
    const existing = byInventory.get(inventoryId) || {
      inventoryId,
      name: String(entry?.name || inventoryId),
      unit: String(entry?.unit || ""),
      totalDeducted: 0,
      remainingQty: entry?.remainingQty ?? 0,
    };

    existing.totalDeducted += Number(entry?.deductedQty || 0);
    const rawQty = entry?.remainingQty;
    existing.remainingQty = rawQty != null ? Number(rawQty) : (existing.remainingQty ?? 0);
    byInventory.set(inventoryId, existing);
  });

  return Array.from(byInventory.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function summarizeOrderRecipeUsage(order) {
  const byInventory = new Map();
  const items = Array.isArray(order?.items) ? order.items : [];

  items.forEach((soldItem) => {
    const quantity = Number(soldItem?.quantity || 1);
    const recipeItems = Array.isArray(soldItem?.recipe) ? soldItem.recipe : [];

    recipeItems.forEach((ingredient) => {
      const inventoryId = String(ingredient?.inventoryId || "").trim() || String(ingredient?.name || "").trim();
      const deductedQty = Number(ingredient?.quantity || 0) * quantity;
      if (!inventoryId || !Number.isFinite(deductedQty) || deductedQty <= 0) return;

      const existing = byInventory.get(inventoryId) || {
        inventoryId,
        name: String(ingredient?.name || inventoryId),
        unit: String(ingredient?.unit || ""),
        totalDeducted: 0,
        remainingQty: null,
      };

      existing.totalDeducted += deductedQty;
      if (!existing.unit && ingredient?.unit) {
        existing.unit = String(ingredient.unit || "");
      }
      byInventory.set(inventoryId, existing);
    });
  });

  return Array.from(byInventory.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getOrderInventorySummary(order) {
  const recordedSummary = summarizeInventoryDeductions(order?.inventoryDeductions);
  if (recordedSummary.length) {
    return { summary: recordedSummary, recorded: true };
  }

  const derivedSummary = summarizeOrderRecipeUsage(order);
  return { summary: derivedSummary, recorded: false };
}

function findOrderByKey(orderKey) {
  const key = String(orderKey || "").trim();
  return state.allOrders.find((order) => String(order.id || order.orderId || "") === key);
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDayLabel(date) {
  const today = new Date();
  const todayKey = toDayKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = toDayKey(yesterday);
  const key = toDayKey(date);
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (date.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString("en-PH", opts);
}

function setOrderPreset(preset) {
  orderFilters.preset = preset;
  const today = new Date();
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  if (preset === "today") {
    orderFilters.fromDate = fmt(today);
    orderFilters.toDate = fmt(today);
  } else if (preset === "yesterday") {
    const day = new Date(today);
    day.setDate(today.getDate() - 1);
    orderFilters.fromDate = fmt(day);
    orderFilters.toDate = fmt(day);
  } else if (preset === "7d") {
    const day = new Date(today);
    day.setDate(today.getDate() - 6);
    orderFilters.fromDate = fmt(day);
    orderFilters.toDate = fmt(today);
  } else if (preset === "30d") {
    const day = new Date(today);
    day.setDate(today.getDate() - 29);
    orderFilters.fromDate = fmt(day);
    orderFilters.toDate = fmt(today);
  } else {
    orderFilters.fromDate = "";
    orderFilters.toDate = "";
  }
  syncOrderDateInputs();
  orderFilters.page = 1;
  applyOrderFilters();
}

function syncOrderDateInputs() {
  const fromInput = document.getElementById("ordersFromDate");
  const toInput = document.getElementById("ordersToDate");
  if (fromInput) fromInput.value = orderFilters.fromDate;
  if (toInput) toInput.value = orderFilters.toDate;

  if (ordersDatePickers.from) {
    if (orderFilters.fromDate) {
      ordersDatePickers.from.selectDate(new Date(`${orderFilters.fromDate}T00:00:00`), { silent: true });
    } else {
      ordersDatePickers.from.clear({ silent: true });
    }
  }
  if (ordersDatePickers.to) {
    if (orderFilters.toDate) {
      ordersDatePickers.to.selectDate(new Date(`${orderFilters.toDate}T00:00:00`), { silent: true });
    } else {
      ordersDatePickers.to.clear({ silent: true });
    }
  }
}

function commitOrderDateFilter(key) {
  orderFilters.preset = "";
  orderFilters.page = 1;

  const from = orderFilters.fromDate ? new Date(`${orderFilters.fromDate}T00:00:00`) : null;
  const to = orderFilters.toDate ? new Date(`${orderFilters.toDate}T23:59:59`) : null;
  if (from && to && from > to) {
    if (key === "fromDate") {
      orderFilters.toDate = toDayKey(from);
    } else {
      orderFilters.fromDate = toDayKey(to);
    }
  }

  syncOrderDateInputs();
  applyOrderFilters();
}

function handleOrderDateSelect(key) {
  return ({ date, datepicker }) => {
    const selected = Array.isArray(datepicker.selectedDates)
      ? datepicker.selectedDates[0]
      : date || null;
    orderFilters[key] = selected ? toDayKey(selected) : "";
    commitOrderDateFilter(key);
  };
}

function initOrdersDatePickers() {
  const fromInput = document.getElementById("ordersFromDate");
  const toInput = document.getElementById("ordersToDate");

  if (!window.AirDatepicker) {
    if (fromInput) fromInput.readOnly = false;
    if (toInput) toInput.readOnly = false;
    return;
  }

  if (fromInput && !ordersDatePickers.from) {
    let fromPicker = new window.AirDatepicker(fromInput, {
      locale: AIR_DATEPICKER_EN_LOCALE,
      dateFormat: "yyyy-MM-dd",
      autoClose: true,
      keyboardNav: true,
      toggleSelected: true,
      maxDate: new Date(),
      position: airDatepickerSmartPosition,
      onShow: () => {
        if (fromPicker) fromPicker.update({ maxDate: new Date() });
      },
      onSelect: handleOrderDateSelect("fromDate"),
    });
    ordersDatePickers.from = fromPicker;
    trackAirDatepickerReposition(ordersDatePickers.from);
  }

  if (toInput && !ordersDatePickers.to) {
    let toPicker = new window.AirDatepicker(toInput, {
      locale: AIR_DATEPICKER_EN_LOCALE,
      dateFormat: "yyyy-MM-dd",
      autoClose: true,
      keyboardNav: true,
      toggleSelected: true,
      maxDate: new Date(),
      position: airDatepickerSmartPosition,
      onShow: () => {
        if (toPicker) toPicker.update({ maxDate: new Date() });
      },
      onSelect: handleOrderDateSelect("toDate"),
    });
    ordersDatePickers.to = toPicker;
    trackAirDatepickerReposition(ordersDatePickers.to);
  }
}

function syncOrderPresetChips() {
  document.querySelectorAll(".orders-preset-chip").forEach((chip) => {
    const active = chip.dataset.preset === orderFilters.preset;
    chip.classList.toggle("active", active);
    if (active) {
      chip.setAttribute("aria-pressed", "true");
    } else {
      chip.removeAttribute("aria-pressed");
    }
  });
}

function buildNoteBlock(note) {
  const maxNoteLen = 140;
  const noteEscaped = escapeHtml(note);
  const truncated = note.length > maxNoteLen;
  const display = truncated ? escapeHtml(note.slice(0, maxNoteLen)) + "…" : noteEscaped;
  const shortAttr = display.replace(/"/g, "&quot;");
  const fullAttr = noteEscaped.replace(/"/g, "&quot;");
  return `
    <div class="od-note" data-full="${fullAttr}" data-short="${shortAttr}">${display}</div>
    ${truncated ? `<button class="od-note-toggle" type="button" data-note-toggle="1">See more</button>` : ""}`;
}

function toggleDetailNote(btn) {
  const el = btn.previousElementSibling;
  if (!el) return;
  const full = el.getAttribute("data-full") || "";
  const short = el.getAttribute("data-short") || "";
  if (!short) return;
  if (btn.dataset.expanded === "1") {
    el.textContent = short;
    btn.textContent = "See more";
    btn.removeAttribute("data-expanded");
  } else {
    el.textContent = full;
    btn.textContent = "See less";
    btn.dataset.expanded = "1";
  }
}

function nextSortValue(key, current) {
  const pairs = {
    ref: ["ref_desc", "ref_asc"],
    items: ["items_desc", "items_asc"],
    payment: ["payment_asc", "payment_desc"],
    time: ["latest", "oldest"],
    amount: ["amount_desc", "amount_asc"],
  };
  const [desc, asc] = pairs[key] || [];
  return current === desc ? asc : desc;
}

function buildSortHeader(key, label) {
  const current = orderFilters.sortBy || "latest";
  const [descValue, ascValue] = {
    ref: ["ref_desc", "ref_asc"],
    items: ["items_desc", "items_asc"],
    payment: ["payment_asc", "payment_desc"],
    time: ["latest", "oldest"],
    amount: ["amount_desc", "amount_asc"],
  }[key] || [];
  const active = current === descValue || current === ascValue;
  const arrow = active ? (current === descValue ? "↓" : "↑") : "";
  return `<button class="orders-sort-btn ${active ? "active" : ""}" type="button" data-sort="${key}" title="Sort by ${label}">${label}${arrow ? `<span class="orders-sort-arrow" aria-hidden="true">${arrow}</span>` : ""}</button>`;
}

async function getAdminActorName() {
  try {
    const currentUser = getCurrentUser();
    if (!currentUser) return "Admin";
    const profile = await getUserProfile(currentUser.uid);
    return profile?.fullName || currentUser.displayName || currentUser.email || "Admin";
  } catch {
    return "Admin";
  }
}

function buildOrderMainRow(order) {
  const orderKey = String(order.id || order.orderId || "");
  const shortId = orderKey.slice(-6) || "—";
  const customerName = String(order.customerName || "").trim();
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  const itemChips = items.slice(0, 2)
    .map((item) => `<span class="orders-item-chip">${escapeHtml(item.name || "Item")}</span>`)
    .join("");
  const moreLabel = items.length > 2 ? `<span class="orders-item-more">+${items.length - 2} more</span>` : "";
  const note = String(order.note || "").trim();
  const noteInline = note
    ? `<span class="orders-note-inline" title="${escapeHtml(note)}"><i class="ri-chat-1-line" aria-hidden="true"></i> ${escapeHtml(note.length > 60 ? `${note.slice(0, 60)}…` : note)}</span>`
    : "";
  const date = getOrderDate(order);
  const time = date
    ? date.toLocaleString("en-PH", { hour: "2-digit", minute: "2-digit" })
    : "-";
  const total = Number(order.total || 0).toFixed(2);
  const type = String(order.paymentMethod || "cash").toUpperCase();
  const isEmployee = String(order.orderType || "regular").toLowerCase() === "employee";
  const lifecycle = getOrderStatus(order);
  const status = lifecycle === "cancelled"
    ? `<span class="badge b-red">Cancelled</span>`
    : isEmployee
    ? `<span class="badge b-blue">Employee</span>`
    : order.isPwdSenior
    ? `<span class="badge b-orange">PWD</span>`
    : lifecycle === "pending"
    ? `<span class="badge b-amber">Pending</span>`
    : `<span class="badge b-green">Done</span>`;
  const cancelNote = lifecycle === "cancelled"
    ? `<span class="orders-note-inline orders-note-cancelled" title="Order was cancelled — sale not recorded in analytics"><i class="ri-close-circle-line" aria-hidden="true"></i> Cancelled — not recorded in sales</span>`
    : "";
  const amountCell = lifecycle === "cancelled"
    ? `<span class="orders-amount-strike" title="Sales not recorded (order cancelled)">₱${total}</span>`
    : `₱${total}`;
  const expanded = !!state.orderStockExpanded?.[orderKey];
  const isPending = lifecycle === "pending";
  const pendingActions = isPending
    ? `
        <button class="orders-btn ghost inventory-mini-btn order-complete-btn" type="button" data-order-action="complete" data-order-id="${escapeHtml(orderKey)}" title="Mark as done / prepared" aria-label="Mark as done"><i class="ri-check-double-line" aria-hidden="true"></i></button>
        <button class="orders-btn ghost inventory-mini-btn danger order-cancel-btn" type="button" data-order-action="cancel" data-order-id="${escapeHtml(orderKey)}" title="Cancel order (void)" aria-label="Cancel order"><i class="ri-close-circle-line" aria-hidden="true"></i></button>`
    : "";
  return `
    <tr class="orders-main-row" data-order-id="${escapeHtml(orderKey)}">
      <td class="orders-ref-cell">
        <button class="orders-expand-btn ${expanded ? "active" : ""}" type="button" data-order-action="toggle" data-order-id="${escapeHtml(orderKey)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse details" : "Expand details"}" title="${expanded ? "Collapse details" : "Expand details"}"><i class="ri-arrow-down-s-line" aria-hidden="true"></i></button>
        <span class="orders-ref">#${escapeHtml(shortId)}</span>
        ${customerName ? `<span class="orders-customer">${escapeHtml(customerName)}</span>` : ""}
        <span class="orders-count">${itemCount} item${itemCount === 1 ? "" : "s"}</span>
      </td>
      <td class="orders-items-cell"><span class="orders-item-chips">${itemChips || `<span class="orders-items-empty">—</span>`}${moreLabel}</span>${noteInline}${cancelNote}</td>
      <td><span class="orders-pay-badge">${escapeHtml(type)}</span></td>
      <td class="orders-time-cell">${time}</td>
      <td class="orders-amount-cell">${amountCell}</td>
      <td>${status}</td>
      <td class="orders-actions-cell">
        ${pendingActions}
        <button class="orders-btn ghost inventory-mini-btn order-view-btn" type="button" data-order-action="view" data-order-id="${escapeHtml(orderKey)}" title="View receipt" aria-label="View receipt"><i class="ri-receipt-line" aria-hidden="true"></i></button>
        <button class="orders-btn ghost inventory-mini-btn danger order-delete-btn" type="button" data-order-action="delete" data-order-id="${escapeHtml(orderKey)}" title="Delete transaction" aria-label="Delete transaction"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
      </td>
    </tr>`;
}

function buildOrderDetailRow(order, expanded) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemRows = items.map((item) => {
    const qty = Number(item.quantity || 1) || 1;
    const addonTotal = Array.isArray(item.addons)
      ? item.addons.reduce((sum, addon) => sum + (Number(addon?.price) || 0), 0)
      : 0;
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = (Number(item.price) || 0) + addonTotal;
    const unit = originalUnit * (1 - discountPct);
    const lineTotal = unit * qty;
    const variant = [item.variant, item.temperature && item.temperature !== "N/A" ? item.temperature : null]
      .filter(Boolean)
      .join(" · ");
    const unitLabel = discountPct > 0
      ? `<span class="od-price-original">${formatMoney(originalUnit)}</span> <span class="od-price-arrow">&rarr;</span> ${formatMoney(unit)} <span class="od-price-disc">(-${Math.round(discountPct * 100)}%)</span>`
      : formatMoney(unit);
    return `
      <div class="od-item">
        <div class="od-item-name">${escapeHtml(item.name || "Item")}${variant ? `<span class="od-item-variant">${escapeHtml(variant)}</span>` : ""}</div>
        <div class="od-item-calc"><span class="od-item-qty">${qty} × ${unitLabel}</span><span class="od-item-total">${formatMoney(lineTotal)}</span></div>
      </div>`;
  }).join("");

  const orderLifecycle = getOrderStatus(order);
  const orderCancelled = orderLifecycle === "cancelled";
  const { summary: stockSummary, recorded: stockRecorded } = getOrderInventorySummary(order);
  const stockRows = orderCancelled
    ? `<div class="od-empty od-stock-restored"><i class="ri-restart-line" aria-hidden="true"></i> Stock restored — order was cancelled.</div>`
    : stockSummary.length
    ? stockSummary.map((entry) => {
        const remainingText = entry.remainingQty === null || entry.remainingQty === undefined
          ? "Not recorded"
          : `${formatInventoryQty(entry.remainingQty)} ${entry.unit || "unit"}`;
        return `
          <div class="od-stock-row">
            <span class="od-stock-name">${escapeHtml(entry.name)}</span>
            <span class="od-stock-deducted">− ${escapeHtml(formatInventoryQty(entry.totalDeducted))} ${escapeHtml(entry.unit || "unit")}</span>
            <span class="od-stock-remaining">Remaining: ${escapeHtml(remainingText)}</span>
          </div>`;
      }).join("")
    : `<div class="od-empty">No stock usage recorded.</div>`;

  const skipEntries = Array.isArray(order.inventorySkips) ? order.inventorySkips : [];
  const seenSkips = new Set();
  const uniqueSkips = [];
  for (const skip of skipEntries) {
    const key = `${String(skip?.name || "")}|${String(skip?.reason || "")}`;
    if (seenSkips.has(key)) continue;
    seenSkips.add(key);
    uniqueSkips.push(skip);
  }
  const skipNote = !orderCancelled && uniqueSkips.length
    ? `<div class="orders-skip-note"><i class="ri-error-warning-line" aria-hidden="true"></i> <strong>${uniqueSkips.length} ingredient${uniqueSkips.length === 1 ? "" : "s"} not deducted:</strong> ${escapeHtml(uniqueSkips.map((s) => `${s.name || "?"} (${s.reason || "unknown"})`).join(", "))}</div>`
    : "";

  const payment = String(order.paymentMethod || "cash").toUpperCase();
  const isEmployee = String(order.orderType || "regular").toLowerCase() === "employee";
  const note = String(order.note || "").trim();
  const customerName = String(order.customerName || "").trim();

  let paymentBlock = "";
  if (order.paymentMethod === "split") {
    paymentBlock = `
      <div class="od-pay-line"><span>Cash</span><span>${formatMoney(order.cashAmount || 0)}</span></div>
      <div class="od-pay-line"><span>GCash</span><span>${formatMoney(order.gcashAmount || 0)}</span></div>`;
  } else if (isEmployee) {
    paymentBlock = `<div class="od-pay-line"><span>Employee order</span><span>${formatMoney(order.total || 0)}</span></div>`;
  } else {
    paymentBlock = `
      <div class="od-pay-line"><span>Tendered</span><span>${formatMoney(order.amountTendered ?? order.total ?? 0)}</span></div>
      <div class="od-pay-line"><span>Change</span><span>${formatMoney(order.change ?? 0)}</span></div>`;
  }

  return `
    <tr class="orders-detail-row ${expanded ? "" : "orders-detail-hidden"}" aria-hidden="${expanded ? "false" : "true"}">
      <td colspan="7">
        <div class="orders-detail-grid">
          <section class="od-section">
            <h4 class="od-section-title"><i class="ri-shopping-bag-3-line" aria-hidden="true"></i> Items</h4>
            <div class="od-item-list">${itemRows || `<div class="od-empty">No item details available.</div>`}</div>
          </section>
          <section class="od-section">
            <h4 class="od-section-title"><i class="ri-stack-line" aria-hidden="true"></i> Stock Used ${stockRecorded ? "" : `<span class="orders-stock-badge">Estimated</span>`}</h4>
            <div class="od-stock-list">${stockRows}</div>
            ${skipNote}
          </section>
          <section class="od-section">
            <h4 class="od-section-title"><i class="ri-money-dollar-circle-line" aria-hidden="true"></i> Payment</h4>
            <div class="od-pay-method"><span class="badge b-green">${escapeHtml(payment)}</span></div>
            <div class="od-pay-lines">${customerName ? `<div class="od-pay-line"><span>Customer</span><span>${escapeHtml(customerName)}</span></div>` : ""}${paymentBlock}</div>
            ${note ? `<h4 class="od-section-title od-note-title"><i class="ri-chat-1-line" aria-hidden="true"></i> Note</h4>${buildNoteBlock(note)}` : ""}
          </section>
        </div>
      </td>
    </tr>`;
}

function buildAdminReceiptHTML(order) {
  const date = getOrderDate(order);
  const orderShort = String(order.orderId || order.id || "—").slice(-6) || "—";
  const payment = String(order.paymentMethod || "cash").toUpperCase();
  const cashier = String(order.cashierName || order.cashierUid || order.staffName || order.staff || "Staff");
  const lifecycleStatus = getOrderStatus(order);
  const paidStamp = lifecycleStatus === "cancelled" ? "CANCELLED" : "PAID";
  const items = Array.isArray(order.items) ? order.items : [];

  const itemRows = items.map((item) => {
    const qty = Number(item.quantity || 1) || 1;
    const addonTotal = Array.isArray(item.addons) ? item.addons.reduce((sum, addon) => sum + (Number(addon?.price) || 0), 0) : 0;
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = (Number(item.price) || 0) + addonTotal;
    const unit = originalUnit * (1 - discountPct);
    const lineTotal = unit * qty;
    const variant = [item.variant, item.temperature && item.temperature !== "N/A" ? item.temperature : null].filter(Boolean).join(" · ");
    const priceDisplay = discountPct > 0
      ? `<span class="qty">${qty} x <span class="item-price-original">${formatMoney(originalUnit)}</span> <span class="item-price-arrow">&rarr;</span> ${formatMoney(unit)} <span class="item-price-label">(-${Math.round(discountPct * 100)}%)</span></span>`
      : `<span class="qty">${qty} x ${formatMoney(unit)}</span>`;

    return `
      <div class="item">
        <div class="item-name"><span>${escapeHtml(item.name || "Item")}</span></div>
        ${variant ? `<div class="item-variant">${escapeHtml(variant)}</div>` : ""}
        <div class="item-calc">
          ${priceDisplay}
          <span>${formatMoney(lineTotal)}</span>
        </div>
      </div>
    `;
  }).join("");

  const totalItemSavings = items.reduce((sum, item) => {
    const qty = Number(item.quantity || 1) || 1;
    const addonTotal = Array.isArray(item.addons) ? item.addons.reduce((s, a) => s + (Number(a?.price) || 0), 0) : 0;
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = (Number(item.price) || 0) + addonTotal;
    const savings = originalUnit * discountPct * qty;
    return sum + savings;
  }, 0);
  const originalSubtotal = items.reduce((sum, item) => {
    const qty = Number(item.quantity || 1) || 1;
    const addonTotal = Array.isArray(item.addons) ? item.addons.reduce((s, a) => s + (Number(a?.price) || 0), 0) : 0;
    const originalUnit = (Number(item.price) || 0) + addonTotal;
    return sum + originalUnit * qty;
  }, 0);
  const subtotalRounded = Math.round(originalSubtotal * 100) / 100;
  const savingsRounded = Math.round(totalItemSavings * 100) / 100;
  const totalRounded = Math.round((Number(order.total) || 0) * 100) / 100;

  const isEmployeeOrder = order.orderType === "employee" || order.paymentMethod === "employee";

  let itemDiscountBlock = "";
  let discountBlock = "";

  if (isEmployeeOrder) {
    const employeeDiscount = Math.max(0, subtotalRounded - totalRounded);
    if (employeeDiscount > 0) {
      discountBlock = `<div class="totals-row sub"><span>Employee discount</span><span>− ${formatMoney(employeeDiscount)}</span></div>`;
    }
  } else {
    const hasDiscount = Number(order.discountAmount) > 0;
    let displayItemSavings = 0;
    if (totalItemSavings > 0) {
      displayItemSavings = hasDiscount ? savingsRounded : (subtotalRounded - totalRounded);
    }
    const displayDiscount = hasDiscount
      ? Math.max(0, subtotalRounded - displayItemSavings - totalRounded)
      : 0;

    itemDiscountBlock = displayItemSavings > 0
      ? `<div class="totals-row sub"><span>Item discounts</span><span>− ${formatMoney(displayItemSavings)}</span></div>`
      : "";
    discountBlock = displayDiscount > 0
      ? `<div class="totals-row sub"><span>Discount</span><span>− ${formatMoney(displayDiscount)}</span></div>`
      : "";
  }

  const timestamp = date
    ? date.toLocaleString("en-PH", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "-";

  return `
    <div class="receipt-wrap">
      <button
        type="button"
        class="receipt-close-btn"
        aria-label="Close receipt"
        title="Close receipt"
        onclick="window.closeOrderReceipt && window.closeOrderReceipt()"
      ><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
      <div class="zigzag-top" aria-hidden="true"></div>
      <div class="receipt">
        <div class="center">
          <div class="brand-mark">
            <img src="/assets/icons/brother-bean-logo-rounded.png" alt="Brother Bean Coffeehouse logo" />
          </div>
          <div class="brand-name">Brother Bean Coffee House</div>
          <div class="brand-tag">anytime is coffee time.</div>
          <div class="brand-addr">N. Guevarra St., Brgy. Zone 1, Poblacion, Dasmariñas City, Cavite</div>
        </div>

        <hr class="rule">

        <div class="meta-row"><span class="label">Date</span><span class="value">${escapeHtml(timestamp)}</span></div>
        <div class="meta-row"><span class="label">Order #</span><span class="value">${escapeHtml(orderShort)}</span></div>
        ${order.customerName ? `<div class="meta-row"><span class="label">Order for</span><span class="value">${escapeHtml(String(order.customerName).trim())}</span></div>` : ""}
        <div class="meta-row"><span class="label">Payment</span><span class="value">${escapeHtml(payment)}</span></div>
        ${order.paymentMethod === "split" ? `
        <div class="meta-row"><span class="label">Cash</span><span class="value">${formatMoney(order.cashAmount || 0)}</span></div>
        <div class="meta-row"><span class="label">GCash</span><span class="value">${formatMoney(order.gcashAmount || 0)}</span></div>
        ` : ""}
        <div class="meta-row"><span class="label">Cashier</span><span class="value">${escapeHtml(cashier)}</span></div>

        <hr class="rule">

        ${itemRows || `<div class="item"><div class="item-name"><span style="color:#6b6255;">No item details available.</span></div></div>`}

        <hr class="rule">

        <div class="totals-row sub"><span>Subtotal</span><span>${formatMoney(originalSubtotal)}</span></div>
        ${itemDiscountBlock}
        ${discountBlock}
        <div class="totals-row grand"><span>TOTAL</span><span>${formatMoney(order.total)}</span></div>
        ${order.paymentMethod === "split" ? `
        <div class="totals-row sub"><span>Paid</span><span>Cash ${formatMoney(order.cashAmount || 0)} + GCash ${formatMoney(order.gcashAmount || 0)}</span></div>
        ` : `
        <div class="totals-row sub"><span>Tendered</span><span>${formatMoney(order.amountTendered || order.total || 0)}</span></div>
        <div class="totals-row sub"><span>Change</span><span>${formatMoney(order.change)}</span></div>
        `}

        <div class="stamp"><span>${escapeHtml(paidStamp)}</span></div>

        <div class="barcode" aria-hidden="true"></div>

        <hr class="rule">

        <div class="center">
          <div class="footer-msg">Thank you for visiting!</div>
          <div class="footer-sub">Please come again</div>
          <div class="footer-legal">
            VAT Registered TIN: 000-000-000-000<br>
            Permit No: 0000000
          </div>
        </div>
      </div>
      <div class="zigzag-bottom" aria-hidden="true"></div>
    </div>
  `;
}

window.openOrderReceipt = function(orderId) {
  const order = findOrderByKey(orderId);
  const modal = document.getElementById("orderReceiptModal");
  const content = document.getElementById("orderReceiptContent");
  if (!order || !modal || !content) return;

  currentReceiptOrder = order;
  content.innerHTML = buildAdminReceiptHTML(order);
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  renderAdminPrinterStatus();
  // If a printer was paired on the other side (POS), auto-reconnect it now so
  // the admin side is ready to reprint without the cashier pairing it again.
  if (isPrinterSupported() && !getPrinterStatus().connected) {
    reconnectThermalPrinter().catch(() => {});
  }
};

window.closeOrderReceipt = function() {
  const modal = document.getElementById("orderReceiptModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
};

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const modal = document.getElementById("orderReceiptModal");
  if (modal && modal.style.display !== "none") {
    window.closeOrderReceipt();
  }
});

// Reprint from the admin dashboard. Tries the connected Bluetooth thermal
// printer first (same ESC/POS receipt the cashier prints), then falls back to
// the browser print dialog for the on-screen HTML receipt.
window.printOrderReceipt = async function() {
  // Thermal printer only — no browser print window fallback. The receipt is
  // laid out for the paper width selected in the printer modal; if no printer
  // is connected, explain in-app instead of popping a browser print dialog.
  if (!currentReceiptOrder) return;
  const result = await printThermalReceipt(normalizeAdminOrderForPrinter(currentReceiptOrder));
  if (result.status === "sent") return;
  if (result.status === "not-connected") {
    ModalUtils.warning("No printer connected", "Open the printer row in this receipt and tap Connect printer, then print again.");
    return;
  }
  if (result.status === "unsupported") {
    ModalUtils.warning("Printing not supported", "Bluetooth printing needs Chrome or Edge on Windows/Android.");
    return;
  }
  ModalUtils.warning("Thermal print failed", result.message || "The receipt could not be sent to the printer.");
};

function normalizeAdminOrderForPrinter(order) {
  return {
    ...order,
    queued: order.queued === true,
    cancelled: getOrderStatus(order) === "cancelled",
  };
}

// ── Thermal printer status in the receipt modal ──

function renderAdminPrinterStatus() {
  const row = document.getElementById("adminPrinterRow");
  const dot = document.getElementById("adminPrinterDot");
  const text = document.getElementById("adminPrinterStatus");
  const btn = document.getElementById("adminPrinterBtn");
  if (!row || !text) return;

  const status = getPrinterStatus();
  const reconnecting = !!(status && status.reconnecting && !status.connected);
  if (!status.supported) {
    dot.className = "receipt-admin-dot is-off";
    text.textContent = "Bluetooth printing not supported — use Chrome or Edge";
    row.className = "receipt-admin-printer unsupported";
    if (btn) btn.style.display = "none";
    return;
  }
  if (btn) btn.style.display = "";

  if (status.connected) {
    dot.className = "receipt-admin-dot is-on";
    text.textContent = `Thermal printer: ${status.deviceName || "Connected"}`;
    row.className = "receipt-admin-printer is-connected";
    if (btn) {
      btn.textContent = "Disconnect";
      btn.disabled = false;
      btn.onclick = () => window.disconnectAdminPrinter();
    }
  } else if (reconnecting) {
    dot.className = "receipt-admin-dot is-off";
    text.textContent = "Thermal printer: Reconnecting...";
    row.className = "receipt-admin-printer";
    if (btn) {
      btn.textContent = "Reconnecting...";
      btn.disabled = true;
    }
  } else {
    dot.className = "receipt-admin-dot is-off";
    text.textContent = "Thermal printer: Not connected";
    row.className = "receipt-admin-printer";
    if (btn) {
      btn.textContent = "Connect printer";
      btn.disabled = false;
      btn.onclick = () => window.connectAdminPrinter();
    }
  }
}

window.connectAdminPrinter = async function() {
  try {
    await connectThermalPrinter();
  } catch (error) {
    console.warn("[Admin] Printer connect cancelled or failed.", error);
  }
};

window.disconnectAdminPrinter = function() {
  disconnectThermalPrinter();
};

window.refundOrderReceipt = function() {
  ModalUtils.warning("Refund", "Refund flow is not implemented yet.");
};

function buildPageButtons(current, totalPages) {
  const pages = [];
  const push = (p) => { if (p >= 1 && p <= totalPages && !pages.includes(p)) pages.push(p); };
  push(1);
  for (let p = Math.max(2, current - 1); p <= Math.min(totalPages - 1, current + 1); p++) push(p);
  push(totalPages);
  pages.sort((a, b) => a - b);

  const out = [];
  let prev = 0;
  pages.forEach((p) => {
    if (p - prev > 1) out.push(`<span class="orders-page-ellipsis" aria-hidden="true">…</span>`);
    out.push(`<button class="orders-page-btn orders-page-num ${p === current ? "current" : ""}" data-page="${p}" ${p === current ? "disabled aria-current='page'" : ""}>${p}</button>`);
    prev = p;
  });
  return out.join("");
}

function renderOrdersPagination(totalPages) {
  const pager = document.getElementById("ordersPagination");
  if (!pager) return;

  if (!state.filteredOrders.length) {
    pager.innerHTML = "";
    return;
  }

  const current = Number(orderFilters.page || 1);
  const pageSize = Number(orderFilters.pageSize) || 10;
  const totalItems = state.filteredOrders.length;
  const start = (current - 1) * pageSize + 1;
  const end = Math.min(totalItems, start + pageSize - 1);

  pager.innerHTML = `
    <div class="orders-page-meta">Showing <strong>${start}–${end}</strong> of <strong>${totalItems}</strong> transaction${totalItems === 1 ? "" : "s"}</div>
    <div class="orders-page-nav">
      <button class="orders-page-btn" data-page="${Math.max(1, current - 1)}" ${current <= 1 ? "disabled" : ""}>Prev</button>
      ${buildPageButtons(current, totalPages)}
      <button class="orders-page-btn" data-page="${Math.min(totalPages, current + 1)}" ${current >= totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;

  pager.querySelectorAll(".orders-page-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.dataset.page || "1");
      if (target === current) return;
      orderFilters.page = target;
      applyOrderFilters();
    });
  });
}

function renderOrdersKpis(orders) {
  const countEl = document.getElementById("ordersCountKpi");
  const totalEl = document.getElementById("ordersTotalKpi");
  const subEl = document.getElementById("ordersPageSub");

  const totalSales = orders.reduce((sum, order) => {
    if (getOrderStatus(order) === "cancelled") return sum;
    return sum + Number(order.total || 0);
  }, 0);

  if (subEl) subEl.textContent = `${orders.length} transaction(s) shown`;

  animateOrdersKpiValue(countEl, orders.length, (v) => String(Math.round(v)));
  animateOrdersKpiValue(totalEl, totalSales, (v) => `₱${v.toFixed(2)}`);
}

function animateOrdersKpiValue(el, target, formatter, duration = 650) {
  if (!el || typeof el.dataset === "undefined") return;
  const from = Number(el.dataset.kpiValue || 0) || 0;
  el.dataset.kpiValue = String(target);

  const paint = (value) => {
    el.textContent = formatter(value);
  };

  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || typeof window.requestAnimationFrame !== "function") {
    paint(target);
    return;
  }

  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + (target - from) * eased;
    el.textContent = formatter(value);
    if (progress < 1) {
      window.requestAnimationFrame(tick);
    }
  };
  window.requestAnimationFrame(tick);
}

function renderOrdersTable(orders) {
  const wrap = document.getElementById("ordersTableWrap");
  if (!wrap) return;

  if (!orders.length) {
    wrap.innerHTML = `
      <div class="orders-empty-state">
        <i class="ri-inbox-2-line" aria-hidden="true"></i>
        <div class="orders-empty-title">No transactions found</div>
        <div class="orders-empty-sub">Try adjusting your search, payment, or date range.</div>
      </div>`;
    return;
  }

  const rows = [];
  let lastDayKey = null;
  orders.forEach((order) => {
    const date = getOrderDate(order);
    const dayKey = date ? toDayKey(date) : null;
    if (dayKey && dayKey !== lastDayKey) {
      rows.push(`<tr class="orders-date-group"><td colspan="7">${escapeHtml(formatDayLabel(date))}</td></tr>`);
      lastDayKey = dayKey;
    }
    const orderKey = String(order.id || order.orderId || "");
    rows.push(buildOrderMainRow(order));
    rows.push(buildOrderDetailRow(order, !!state.orderStockExpanded?.[orderKey]));
  });

  wrap.innerHTML = `
    <table class="orders-table">
      <thead>
        <tr>
          <th class="orders-th-ref">${buildSortHeader("ref", "Order")}</th>
          <th>${buildSortHeader("items", "Items")}</th>
          <th>${buildSortHeader("payment", "Payment")}</th>
          <th>${buildSortHeader("time", "Time")}</th>
          <th class="orders-th-amount">${buildSortHeader("amount", "Amount")}</th>
          <th>Status</th>
          <th class="orders-th-actions">Action</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>`;

  bindOrdersTableEvents(wrap);
}

function toggleOrderRow(wrap, btn, orderId) {
  const key = String(orderId || "");
  const next = !(state.orderStockExpanded?.[key]);
  state.orderStockExpanded = { ...(state.orderStockExpanded || {}), [key]: next };
  const mainRow = btn.closest("tr.orders-main-row");
  const detailRow = mainRow?.nextElementSibling;
  btn.classList.toggle("active", next);
  btn.setAttribute("aria-expanded", String(next));
  btn.setAttribute("aria-label", next ? "Collapse details" : "Expand details");
  btn.title = next ? "Collapse details" : "Expand details";
  if (detailRow) {
    detailRow.classList.toggle("orders-detail-hidden", !next);
    detailRow.setAttribute("aria-hidden", String(!next));
  }
}

function bindOrdersTableEvents(wrap) {
  wrap.querySelectorAll("button[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      orderFilters.sortBy = nextSortValue(btn.dataset.sort, orderFilters.sortBy);
      const sortInput = document.getElementById("ordersSortBy");
      if (sortInput) sortInput.value = orderFilters.sortBy;
      orderFilters.page = 1;
      applyOrderFilters();
    });
  });

  wrap.querySelectorAll("button[data-order-action]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const action = btn.dataset.orderAction;
      const orderId = btn.dataset.orderId;

      if (action === "toggle") {
        toggleOrderRow(wrap, btn, orderId);
        return;
      }

      const order = findOrderByKey(orderId);
      if (!order) return;

      if (action === "view") {
        window.openOrderReceipt && window.openOrderReceipt(orderId);
        return;
      }

      if (action === "delete") {
        const confirmed = await ModalUtils.confirm("Delete Transaction", "This will permanently delete this transaction. Continue?");
        if (confirmed !== 1) return;

        try {
          await deleteOrder(orderId);
          purgeSavedSale(orderId);
          await ModalUtils.success("Transaction Deleted", "The transaction has been removed successfully.");
          await loadOrdersPage();
        } catch (error) {
          await ModalUtils.error("Delete Failed", error?.message || "Unable to delete transaction.");
        }
        return;
      }

      if (action === "complete") {
        try {
          const actorName = await getAdminActorName();
          await updateDoc(doc(db, "orders", orderId), {
            status: "done",
            preparedAtMs: Date.now(),
            preparedBy: actorName,
          });
          try { await removeKitchenOrder(orderId); } catch (e) {
            console.warn("[Admin] Mark prepared: kitchen order removal failed.", e);
          }
          purgeSavedSale(orderId);
          await ModalUtils.success("Order Completed", "The order has been marked as done/prepared.");
          await loadOrdersPage();
        } catch (error) {
          await ModalUtils.error("Complete Failed", error?.message || "Unable to mark the order as done.");
        }
        return;
      }

      if (action === "cancel") {
        const confirmed = await ModalUtils.confirm(
          "Cancel Order",
          "Cancel this order? The order will be voided, the deducted stock will be restored, and it will no longer be counted in sales."
        );
        if (confirmed !== 1) return;

        try {
          const actorName = await getAdminActorName();
          await voidOrder(orderId, {
            voidedBy: actorName,
            voidReason: "Cancelled from admin transactions",
          });
          try { await removeKitchenOrder(orderId); } catch (e) {
            console.warn("[Admin] Cancel: kitchen order removal failed.", e);
          }
          purgeSavedSale(orderId);

          const restored = await restoreInventoryForOrder(order).catch((e) => {
            console.warn("[Admin] Cancel: inventory restore failed.", e);
            return { success: false };
          });
          if (restored?.success === false) {
            await ModalUtils.warning("Order Cancelled", "The order was cancelled, but stock could not be restored automatically. Please check inventory.");
          } else {
            await ModalUtils.success("Order Cancelled", "The order was cancelled and stock was restored.");
          }
          await loadOrdersPage();
        } catch (error) {
          const denied = /permission|denied|permission-denied/i.test(String(error?.message || error?.code || ""));
          await ModalUtils.error("Cancel Failed", denied ? "Unable to cancel the order — cancel requires permission (rules may need redeploy)." : (error?.message || "Unable to cancel the order."));
        }
        return;
      }
    });
  });

  wrap.querySelectorAll("button[data-note-toggle]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDetailNote(btn);
    });
  });
}

function exportOrdersCsv() {
  if (!state.filteredOrders.length) {
    (async () => await ModalUtils.warning("No Data", "No transactions to export."))();
    return;
  }

  const header = ["Order ID", "Items", "Payment", "Date", "Amount", "Status", "Note"];
  const rows = state.filteredOrders.map((order) => {
    const items = (order.items || [])
      .map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}`)
      .join(", ");
    const date = getOrderDate(order);
    const isEmployee = String(order.orderType || "regular").toLowerCase() === "employee";
    const lifecycle = getOrderStatus(order);
    return [
      String(order.orderId || order.id || ""),
      items,
      String(order.paymentMethod || "cash").toUpperCase(),
      date ? date.toLocaleString("en-PH") : "-",
      lifecycle === "cancelled" ? "CANCELLED (not recorded)" : Number(order.total || 0).toFixed(2),
      lifecycle === "cancelled" ? "CANCELLED" : isEmployee ? "EMPLOYEE" : order.isPwdSenior ? "PWD" : lifecycle === "pending" ? "PENDING" : "DONE",
      String(order.note || ""),
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
  const statusInput = document.getElementById("ordersStatusFilter");
  const fromInput = document.getElementById("ordersFromDate");
  const toInput = document.getElementById("ordersToDate");
  const sortInput = document.getElementById("ordersSortBy");
  const pageSizeInput = document.getElementById("ordersPageSize");
  const clearBtn = document.getElementById("ordersClearBtn");
  const exportBtn = document.getElementById("ordersExportBtn");
  const clearAllBtn = document.getElementById("ordersClearAllBtn");

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

  if (statusInput && !statusInput.dataset.bound) {
    statusInput.dataset.bound = "1";
    statusInput.addEventListener("change", (e) => {
      orderFilters.status = e.target.value;
      orderFilters.page = 1;
      applyOrderFilters();
    });
  }

  if (fromInput && !fromInput.dataset.bound) {
    fromInput.dataset.bound = "1";
    if (!window.AirDatepicker) {
      fromInput.addEventListener("change", (e) => {
        orderFilters.fromDate = e.target.value;
        commitOrderDateFilter("fromDate");
      });
    }
  }

  if (toInput && !toInput.dataset.bound) {
    toInput.dataset.bound = "1";
    if (!window.AirDatepicker) {
      toInput.addEventListener("change", (e) => {
        orderFilters.toDate = e.target.value;
        commitOrderDateFilter("toDate");
      });
    }
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
      orderFilters.status = "all";
      orderFilters.sortBy = "latest";
      orderFilters.pageSize = 10;
      orderFilters.page = 1;
      orderFilters.fromDate = "";
      orderFilters.toDate = "";
      orderFilters.preset = "";

      if (searchInput) searchInput.value = "";
      if (paymentInput) paymentInput.value = "all";
      if (statusInput) statusInput.value = "all";
      if (sortInput) sortInput.value = "latest";
      if (pageSizeInput) pageSizeInput.value = "10";
      syncOrderDateInputs();

      applyOrderFilters();
    });
  }

  if (clearAllBtn && !clearAllBtn.dataset.bound) {
    clearAllBtn.dataset.bound = "1";
    clearAllBtn.addEventListener("click", async () => {
      const confirmed = await ModalUtils.confirm(
        "Clear All Transactions",
        "This will permanently delete every transaction in the database. This cannot be undone."
      );
      if (confirmed !== 1) return;

      try {
        const result = await clearAllOrders();
        await ModalUtils.success("Transactions Cleared", `Deleted ${result.deleted} transaction(s).`);
        await loadOrdersPage();
      } catch (error) {
        await ModalUtils.error("Clear Failed", error?.message || "Unable to clear transactions.");
      }
    });
  }

  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", exportOrdersCsv);
  }

  document.querySelectorAll(".orders-preset-chip").forEach((chip) => {
    if (chip.dataset.bound) return;
    chip.dataset.bound = "1";
    chip.addEventListener("click", () => setOrderPreset(chip.dataset.preset));
  });

  initOrdersDatePickers();
}

function logsFormatPeso(value) {
  return `₱${(Number(value) || 0).toFixed(2)}`;
}

function setLogsKpi(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderLogsEmptyState(title, sub) {
  const wrap = document.getElementById("logsTableWrap");
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="orders-empty-state">
      <i class="ri-inbox-2-line" aria-hidden="true"></i>
      <div class="orders-empty-title">${escapeHtml(title)}</div>
      <div class="orders-empty-sub">${escapeHtml(sub)}</div>
    </div>`;
}

function logsSumKind(entries, kind) {
  return (entries || []).reduce((sum, e) => {
    return e?.kind === kind ? sum + (Number(e.amount) || 0) : sum;
  }, 0);
}

// Starting cash = the LATEST "float" entry across all terminals (the store
// runs ONE shared physical drawer, so a re-set is an edit, not another drawer).
// Falls back to the legacy dailyStats float.
function logsStartingCash(entries, legacyStats) {
  const floats = (entries || []).filter((e) => e?.kind === "float");
  if (floats.length) {
    const latest = floats.reduce(
      (best, f) => (!best || (Number(f.t) || 0) > (Number(best.t) || 0) ? f : best),
      null
    );
    return Number(latest?.amount) || 0;
  }
  return legacyStats ? Number(legacyStats.openingFloat || 0) : 0;
}

// Merge per-entry drawer logs with the legacy dailyStats ledger. New entries
// carry an id and are deduplicated; pre-feature legacy entries have no id, so
// they are always kept. The result is sorted by time (oldest first).
function logsMergeEntries(drawerLogs, legacyLedger) {
  const seen = new Set((drawerLogs || []).map((e) => String(e?.id || "")).filter(Boolean));
  const extra = (legacyLedger || [])
    .filter((e) => !(e?.id && seen.has(String(e.id))))
    .map((e) => ({ ...e, terminalId: "" }));
  return [...(drawerLogs || []), ...extra].sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
}

async function loadLogsPage() {
  const wrap = document.getElementById("logsTableWrap");
  const subEl = document.getElementById("logsPageSub");
  bindLogsControls();

  const dateKey = logsState.date || toDayKey(new Date());
  const input = document.getElementById("logsDateFilter");
  if (input) input.value = dateKey;
  if (subEl) subEl.textContent = `Cash drawer activity for ${dateKey}`;
  if (wrap) wrap.innerHTML = renderSectionState("Loading logs...");

  let statsDoc = null;
  let drawerLogs = [];
  try {
    statsDoc = await getDailyStatsByDate(dateKey);
  } catch (error) {
    console.warn("[Logs] Failed to load daily stats:", error);
  }
  try {
    drawerLogs = await getDrawerLogsByDate(dateKey);
  } catch (error) {
    console.warn("[Logs] Failed to load drawer log:", error);
  }

  const legacyStats = statsDoc?.dailyStats || null;
  const hasRecord = Boolean(legacyStats) || drawerLogs.length > 0;

  const legacyLedger = Array.isArray(legacyStats?.ledgerEntries) ? legacyStats.ledgerEntries : [];
  const entries = logsMergeEntries(drawerLogs, legacyLedger);

  let terminalLabels = {};
  let counter = 0;
  for (const e of entries) {
    const tid = String(e?.terminalId || "");
    if (tid && !terminalLabels[tid]) {
      counter += 1;
      terminalLabels[tid] = `Terminal ${counter}`;
    }
  }

  const hasEntries = entries.length > 0;
  const floatTotal = logsStartingCash(entries, legacyStats);
  const cashInTotal = drawerLogs.length > 0
    ? logsSumKind(entries, "in")
    : (legacyStats ? Number(legacyStats.cashIn || 0) : 0);
  const cashOutTotal = drawerLogs.length > 0
    ? logsSumKind(entries, "out")
    : (legacyStats ? Number(legacyStats.cashOut || 0) : 0);
  // End-of-day reconciliation: expected cash on hand = starting cash + cash
  // sales + cash in − cash out. Counted cash and the variance come from the
  // latest manual "count" entry (if any); without one the drawer is treated as
  // auto-tracked, so the difference shows as Balanced automatically.
  const cashSales = legacyStats ? Number(legacyStats.cashReceived || 0) : 0;
  const cashOnHand = Math.round((floatTotal + cashSales + cashInTotal - cashOutTotal) * 100) / 100;
  const countEntries = (entries || []).filter((e) => e?.kind === "count");
  const countedCash = countEntries.length
    ? Number(countEntries[countEntries.length - 1].amount) || 0
    : null;
  const variance = countedCash === null ? 0 : Math.round((countedCash - cashOnHand) * 100) / 100;

  setLogsKpi("logsFloatValue", hasRecord ? logsFormatPeso(floatTotal) : "—");
  setLogsKpi("logsCashInValue", hasRecord ? logsFormatPeso(cashInTotal) : "—");
  setLogsKpi("logsCashOutValue", hasRecord ? logsFormatPeso(cashOutTotal) : "—");
  setLogsKpi("logsCashSalesValue", hasRecord ? logsFormatPeso(cashSales) : "—");
  setLogsKpi("logsCashOnHandValue", hasRecord ? logsFormatPeso(cashOnHand) : "—");

  const varianceEl = document.getElementById("logsVarianceValue");
  if (varianceEl) {
    varianceEl.innerHTML = !hasRecord ? "—"
      : variance === 0 ? `<span class="logs-variance is-balanced">Balanced</span>`
      : variance > 0 ? `<span class="logs-variance is-over">Over ${logsFormatPeso(variance)}</span>`
      : `<span class="logs-variance is-short">Short ${logsFormatPeso(Math.abs(variance))}</span>`;
  }

  if (!hasRecord) {
    renderLogsEmptyState(
      "No record for this date",
      `The POS did not save any drawer activity on ${dateKey}.`
    );
    return;
  }

  if (!hasEntries) {
    renderLogsEmptyState(
      "No cash in / cash out entries",
      `No drawer activity was recorded on ${dateKey}.`
    );
    return;
  }

  if (!wrap) return;
  wrap.innerHTML = `
    <table class="orders-table logs-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Terminal</th>
          <th>Reason</th>
          <th class="orders-th-amount">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${entries.slice().reverse().map((entry) => {
          const time = new Date(Number(entry.t) || Date.now()).toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
          });
          const isIn = entry.kind === "in";
          const isFloat = entry.kind === "float";
          const isCount = entry.kind === "count";
          const typeLabel = isIn ? "Cash in" : isFloat ? "Starting cash" : isCount ? "Cash count" : "Cash out";
          const sign = isIn ? "+" : isFloat || isCount ? "" : "−";
          const kindClass = isIn ? "is-in" : isFloat || isCount ? "is-float" : "is-out";
          const terminalLabel = terminalLabels[entry.terminalId] || (entry.terminalId ? String(entry.terminalId).slice(0, 8) : "—");
          return `<tr>
            <td>${escapeHtml(time)}</td>
            <td><span class="logs-type ${kindClass}">${escapeHtml(typeLabel)}</span></td>
            <td><span class="logs-terminal">${escapeHtml(terminalLabel)}</span></td>
            <td>${escapeHtml(entry.note || "—")}</td>
            <td class="orders-th-amount logs-amount ${kindClass}">${sign}${logsFormatPeso(entry.amount)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function initLogsDatePicker() {
  const input = document.getElementById("logsDateFilter");
  if (!input || input.dataset.bound) return;
  input.dataset.bound = "1";

  if (!window.AirDatepicker) {
    input.readOnly = false;
    input.addEventListener("change", (e) => {
      logsState.date = e.target.value;
      loadLogsPage();
    });
    return;
  }

  let picker = new window.AirDatepicker(input, {
    locale: AIR_DATEPICKER_EN_LOCALE,
    dateFormat: "yyyy-MM-dd",
    autoClose: true,
    keyboardNav: true,
    toggleSelected: true,
    maxDate: new Date(),
    position: airDatepickerSmartPosition,
    onShow: () => {
      if (picker) picker.update({ maxDate: new Date() });
    },
    onSelect: ({ date }) => {
      if (Array.isArray(date)) return;
      logsState.date = date ? toDayKey(date) : "";
      loadLogsPage();
    },
  });
  logsDatePicker = picker;
  trackAirDatepickerReposition(logsDatePicker);
}

function bindLogsControls() {
  initLogsDatePicker();

  const todayBtn = document.getElementById("logsTodayBtn");
  if (todayBtn && !todayBtn.dataset.bound) {
    todayBtn.dataset.bound = "1";
    todayBtn.addEventListener("click", () => {
      logsState.date = "";
      if (logsDatePicker) {
        logsDatePicker.selectDate(new Date(), { silent: true });
      }
      loadLogsPage();
    });
  }
}

window.refreshLogs = async function () {
  await loadLogsPage();
};

async function loadInventoryPage() {
  const listWrap = document.getElementById("inventoryListWrap");
  const hasCached = Array.isArray(state.inventoryItems) && state.inventoryItems.length > 0;

  if (!hasCached && listWrap) {
    listWrap.innerHTML = renderSectionState("Loading inventory...");
  }

  if (hasCached) {
    renderInventorySection();
  }

  try {
    state.inventoryItems = await getInventoryItems();
    state.lastInventorySyncMs = Date.now();
    try {
      state.inventoryCategories = await getInventoryCategoryNames();
    } catch (err) {
      console.warn("[Inventory] Failed to load stored categories:", err);
      state.inventoryCategories = [];
    }
    renderInventorySection();
  } catch (error) {
    console.error("[Inventory] Failed to load inventory items:", error);
    if (!hasCached && listWrap) {
      listWrap.innerHTML = renderSectionState("Unable to load inventory right now. Please try again.", "error");
    }
  } finally {
    showApp();
  }

  bindInventoryForm();
  bindInventoryEditForm();
  bindQuickAddStock();
  bindNewCategoryModal();
  clampDecimalInputs();
  bindInventoryFormToggle();

  try { renderNotifications(); } catch (_) {}
}

function inventoryStatus(item) {
  const quantity = Number(item.quantity || 0);
  const reorderLevel = Number(item.reorderLevel || 0);
  const criticalMark = reorderLevel * 0.5;

  if (quantity <= 0) return "out";
  if (quantity <= criticalMark) return "critical";
  if (quantity <= reorderLevel) return "low";
  return "good";
}

// Display helper — show whole numbers without decimals, otherwise cap at 2 decimal places
// (avoids floating-point noise like 4.664020000000004).
function formatDecimal(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return String(value ?? 0);
  return num % 1 === 0 ? String(num) : num.toFixed(2);
}

// Inventory table header sort helpers (mirrors the transactions table sort behavior).
function invSortPairs(key) {
  return {
    item: ["name_desc", "name_asc"],
    stock: ["stock-desc", "stock-asc"],
    reorder: ["reorder_desc", "reorder_asc"],
    price: ["price_desc", "price_asc"],
    status: ["status_desc", "status_asc"],
  }[key] || [];
}

function buildInvSortHeader(key, label) {
  const [descValue, ascValue] = invSortPairs(key);
  const active = _invSortBy === descValue || _invSortBy === ascValue;
  const arrow = active ? (_invSortBy === descValue ? "↓" : "↑") : "";
  return `<button class="orders-sort-btn ${active ? "active" : ""}" type="button" data-inv-sort="${key}" title="Sort by ${label}">${label}${arrow ? `<span class="orders-sort-arrow" aria-hidden="true">${arrow}</span>` : ""}</button>`;
}

let _invCategoryFilter = "All";
let _invSortBy = "name_asc";
let _invStatusFilter = "all";

function renderInventorySection() {
  const listWrap = document.getElementById("inventoryListWrap");
  const strip = document.getElementById("inventoryAlertStrip");
  const pageSub = document.getElementById("inventoryPageSub");
  const navBadge = document.getElementById("inventoryNavBadge");
  const catPills = document.getElementById("inventoryCategoryPills");
  const sortEl = document.getElementById("inventorySortSelect");
  const itemCountEl = document.getElementById("invItemCount");
  if (!listWrap || !strip) return;

  const syncText = state.lastInventorySyncMs ? ` • Last synced ${formatSyncTime(state.lastInventorySyncMs)}` : "";

  // Read search input
  const searchEl = document.getElementById("inventorySearchInput");
  const searchTerm = (searchEl && String(searchEl.value || "").trim().toLowerCase()) || "";

  const searchClearBtn = document.getElementById("inventorySearchClear");
  if (searchClearBtn) searchClearBtn.style.visibility = searchTerm ? "visible" : "hidden";

  let filteredItems = searchTerm
    ? state.inventoryItems.filter((i) => {
        const hay = (String(i.name || "") + " " + String(i.category || "") + " " + String(i.id || "")).toLowerCase();
        return hay.includes(searchTerm);
      })
    : [...state.inventoryItems];

  // Apply category filter
  if (_invCategoryFilter !== "All") {
    filteredItems = filteredItems.filter((i) => String(i.category || "General").trim().toLowerCase() === _invCategoryFilter.toLowerCase());
  }

  // Apply status filter
  if (_invStatusFilter !== "all") {
    filteredItems = filteredItems.filter((i) => inventoryStatus(i) === _invStatusFilter);
  }

  // Apply sort
  const statusOrder = { out: 0, critical: 1, low: 2, good: 3 };
  const sortDir = _invSortBy.endsWith("_desc") ? -1 : 1;
  if (_invSortBy === "name" || _invSortBy === "name_asc" || _invSortBy === "name_desc") {
    filteredItems.sort((a, b) => sortDir * String(a.name || "").localeCompare(String(b.name || "")));
  } else if (_invSortBy === "stock-asc" || _invSortBy === "stock-desc") {
    filteredItems.sort((a, b) => sortDir * (Number(a.quantity || 0) - Number(b.quantity || 0)));
  } else if (_invSortBy === "reorder_asc" || _invSortBy === "reorder_desc") {
    filteredItems.sort((a, b) => sortDir * (Number(a.reorderLevel || 0) - Number(b.reorderLevel || 0)));
  } else if (_invSortBy === "price_asc" || _invSortBy === "price_desc") {
    filteredItems.sort((a, b) => sortDir * (Number(a.price || 0) - Number(b.price || 0)));
  } else if (_invSortBy === "status" || _invSortBy === "status_asc" || _invSortBy === "status_desc") {
    filteredItems.sort((a, b) => sortDir * ((statusOrder[inventoryStatus(a)] ?? 4) - (statusOrder[inventoryStatus(b)] ?? 4)));
  } else if (_invSortBy === "category") {
    filteredItems.sort((a, b) => String(a.category || "").localeCompare(String(b.category || "")));
  }

  if (navBadge) navBadge.textContent = String(filteredItems.length);

  // Update item count display
  if (itemCountEl) {
    const total = state.inventoryItems.length;
    const showing = filteredItems.length;
    if (searchTerm || _invCategoryFilter !== "All" || _invStatusFilter !== "all") {
      itemCountEl.textContent = `Showing ${showing} of ${total}`;
    } else {
      itemCountEl.textContent = `${total} item${total === 1 ? "" : "s"}`;
    }
  }

  // Render editable category cards (filter, add-to-category, rename, delete)
  renderInventoryCategoryCards(catPills);

  // Sort select
  if (sortEl && !sortEl.dataset.bound) {
    sortEl.dataset.bound = "1";
    sortEl.value = _invSortBy;
    sortEl.addEventListener("change", () => {
      _invSortBy = sortEl.value;
      renderInventorySection();
    });
  }

  if (!state.inventoryItems.length) {
    strip.innerHTML = `<span class="badge b-blue">No inventory items yet</span>`;
    listWrap.innerHTML = `
      <div class="inv-empty-state">
        <div class="inv-empty-icon"><i class="ri-archive-line"></i></div>
        <div class="inv-empty-title">No inventory items yet</div>
        <div class="inv-empty-sub">Add your first item using the form above to start tracking stock levels.</div>
      </div>`;
    if (pageSub) pageSub.textContent = `Track your ingredients and supplies${syncText}`;
    return;
  }

  if (!filteredItems.length) {
    const statusLabels = { out: "Out of Stock", critical: "Critical", low: "Low Stock", good: "In Stock" };
    let emptyTitle;
    let emptySub;
    if (searchTerm) {
      emptyTitle = `No results for "${escapeHtml(searchTerm)}"`;
      emptySub = "Try a different search term or clear the filter.";
    } else if (_invStatusFilter !== "all") {
      emptyTitle = `No ${statusLabels[_invStatusFilter] || ""} items${_invCategoryFilter !== "All" ? ` in "${escapeHtml(_invCategoryFilter)}"` : ""}`;
      emptySub = "Try another status or clear the filter.";
    } else {
      emptyTitle = "No items to display";
      emptySub = "Try clearing the category filter.";
    }
    listWrap.innerHTML = `
      <div class="inv-empty-state">
        <div class="inv-empty-icon"><i class="ri-search-line"></i></div>
        <div class="inv-empty-title">${emptyTitle}</div>
        <div class="inv-empty-sub">${emptySub}</div>
      </div>`;
    return;
  }

  // Summary stats
  const allItems = state.inventoryItems;
  const totalOut = allItems.filter((i) => inventoryStatus(i) === "out").length;
  const totalCritical = allItems.filter((i) => inventoryStatus(i) === "critical").length;
  const totalLow = allItems.filter((i) => inventoryStatus(i) === "low").length;
  const totalValue = allItems.reduce((sum, i) => sum + (Number(i.quantity || 0) * Number(i.price || 0)), 0);
  const needsRestock = allItems.filter((i) => inventoryStatus(i) !== "good").length;

  if (pageSub) pageSub.textContent = `${totalOut} out, ${totalCritical} critical, ${totalLow} low stock item(s)${syncText}`;

  const statusLabels = { out: "Out", critical: "Critical", low: "Low", good: "Good" };
  const statusChips = [
    ["out", totalOut, "inv-stat-out", "ri-error-warning-line"],
    ["critical", totalCritical, "inv-stat-critical", "ri-alert-line"],
    ["low", totalLow, "inv-stat-low", "ri-alert-fill"],
    ["good", allItems.length - needsRestock, "inv-stat-good", "ri-checkbox-circle-line"],
  ].map(([key, count, cls, icon]) =>
    `<button type="button" class="inv-stat-chip ${cls}${_invStatusFilter === key ? " active" : ""}" data-inv-status="${key}" title="Show ${statusLabels[key].toLowerCase()} items">` +
    `<i class="${icon}"></i><span class="inv-stat-num">${count}</span> ${statusLabels[key]}</button>`
  ).join("");

  strip.innerHTML = `
    <div class="inv-stats-group">
      ${statusChips}
      <span class="inv-stat-chip inv-stat-value"><i class="ri-money-currency-circle-line"></i><span class="inv-stat-num">₱${totalValue.toFixed(0)}</span> Total</span>
    </div>
    <div class="inv-strip-actions">
      <button type="button" class="inv-stat-chip inv-stat-restock" data-inv-restock title="Quick add stock"><i class="ri-shopping-cart-2-line"></i><span class="inv-stat-num">${needsRestock}</span> Restock</button>
      <button type="button" class="inv-reset-filter-chip" id="inventoryResetFiltersBtn" data-inv-reset-filter title="Reset all filters"><i class="ri-filter-off-line"></i> Reset Filter</button>
    </div>
  `;

  strip.querySelectorAll("[data-inv-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.invStatus;
      _invStatusFilter = _invStatusFilter === key ? "all" : key;
      renderInventorySection();
    });
  });

  const restockChip = strip.querySelector("[data-inv-restock]");
  if (restockChip) {
    restockChip.addEventListener("click", () => {
      if (typeof window.openRestockModal === "function") window.openRestockModal();
    });
  }

  const resetChip = strip.querySelector("[data-inv-reset-filter]");
  if (resetChip) {
    const hasFilters = Boolean(searchTerm) || _invCategoryFilter !== "All" || _invStatusFilter !== "all";
    resetChip.classList.toggle("is-muted", !hasFilters);
    if (!resetChip.dataset.bound) {
      resetChip.dataset.bound = "1";
      resetChip.addEventListener("click", () => {
        if (searchEl) searchEl.value = "";
        _invCategoryFilter = "All";
        _invStatusFilter = "all";
        _invSortBy = "name_asc";
        const sortEl = document.getElementById("inventorySortSelect");
        if (sortEl) sortEl.value = _invSortBy;
        renderInventorySection();
        if (searchEl) searchEl.focus();
      });
    }
  }

  // Separate stock into category sections, keeping the applied sort within each category.
  const groups = new Map();
  for (const item of filteredItems) {
    const cat = String(item.category || "General").trim() || "General";
    const key = cat.toLowerCase();
    if (!groups.has(key)) groups.set(key, { display: cat, items: [] });
    groups.get(key).items.push(item);
  }
  const groupEntries = [...groups.values()].sort((a, b) => String(a.display).localeCompare(String(b.display)));

  const rows = [];
  groupEntries.forEach((group) => {
    rows.push(`<tr class="inv-cat-group"><td colspan="6"><span class="inv-cat-group-label">${escapeHtml(group.display)}</span><span class="inv-cat-group-count">${group.items.length} item${group.items.length === 1 ? "" : "s"}</span></td></tr>`);
    group.items.forEach((item) => {
      const quantity = Number(item.quantity || 0);
      const reorderLevel = Math.max(1, Number(item.reorderLevel || 1));
      const price = Number(item.price || 0).toFixed(2);
      const qtyDisplay = formatDecimal(quantity);
      const reorderDisplay = formatDecimal(reorderLevel);
      const percent = Math.max(5, Math.min(100, Math.round((quantity / (reorderLevel * 2)) * 100)));
      const status = inventoryStatus(item);
      const statusClass = status === "out" ? "inv-status-out" : status === "critical" ? "inv-status-critical" : status === "low" ? "inv-status-low" : "inv-status-good";
      const statusLabel = status === "out" ? "Out of Stock" : status === "critical" ? "Critical" : status === "low" ? "Low Stock" : "In Stock";
      const alertClass = status === "out" || status === "critical" ? "inv-row-alert" : "";

      rows.push(`<tr class="inv-main-row ${alertClass}">
      <td class="inv-item-cell">
        <div class="inv-name">${escapeHtml(item.name)}</div>
        <div class="inv-row-tags">
          <span class="inv-cat-tag">${escapeHtml(item.category)}</span>
          <span class="inv-unit-tag">${escapeHtml(item.unit)}</span>
        </div>
      </td>
      <td class="inv-stock-cell">
        <div class="inv-qty-row"><span class="inv-qty-current"><strong>${qtyDisplay}</strong> ${escapeHtml(item.unit)}</span></div>
        <div class="inv-bar-bg"><div class="inv-bar ${status === "critical" ? "crit" : status === "low" ? "low" : ""}" style="width:${percent}%"></div></div>
      </td>
      <td class="inv-reorder-cell">${reorderDisplay} ${escapeHtml(item.unit)}</td>
      <td class="inv-price-cell"><span class="inv-price">₱${price}</span><span class="inv-price-unit">/unit</span></td>
      <td class="inv-status-cell"><span class="inv-status-badge ${statusClass}">${statusLabel}</span></td>
      <td class="inventory-row-actions">
        <div class="inv-actions-inner">
          <button class="row-action-btn row-action-restock" type="button" data-inv-action="restock" data-inv-id="${escapeHtml(item.id)}" title="Quick restock" aria-label="Quick restock"><i class="ri-add-box-line" aria-hidden="true"></i></button>
          <button class="row-action-btn row-action-edit" type="button" data-inv-action="edit" data-inv-id="${escapeHtml(item.id)}" title="Edit inventory item" aria-label="Edit inventory item"><i class="ri-pencil-line" aria-hidden="true"></i></button>
          <button class="row-action-btn row-action-delete" type="button" data-inv-action="delete" data-inv-id="${escapeHtml(item.id)}" title="Delete inventory item" aria-label="Delete inventory item"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
        </div>
      </td>
    </tr>`);
    });
  });

  listWrap.innerHTML = `
    <div class="inventory-table-scroll">
      <table class="inv-table">
        <thead>
          <tr>
            <th class="inv-th-item">${buildInvSortHeader("item", "Item")}</th>
            <th class="inv-th-stock">${buildInvSortHeader("stock", "Stock")}</th>
            <th class="inv-th-reorder">${buildInvSortHeader("reorder", "Reorder")}</th>
            <th class="inv-th-price">${buildInvSortHeader("price", "Price")}</th>
            <th class="inv-th-status">${buildInvSortHeader("status", "Status")}</th>
            <th class="inv-th-actions">Action</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`;

  // Bind header sort buttons
  listWrap.querySelectorAll("button[data-inv-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.invSort;
      const [descValue, ascValue] = invSortPairs(key);
      _invSortBy = _invSortBy === descValue ? ascValue : descValue;
      const sortSelect = document.getElementById("inventorySortSelect");
      if (sortSelect) sortSelect.value = _invSortBy;
      renderInventorySection();
    });
  });

  // Bind row actions
  listWrap.querySelectorAll("button[data-inv-action='restock']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.inventoryItems.find((i) => i.id === btn.dataset.invId);
      if (item && typeof openQuickAddStock === "function") {
        openQuickAddStock();
        const searchInput = document.getElementById("quickAddSearchInput");
        if (searchInput) {
          searchInput.value = item.name;
          searchInput.dispatchEvent(new Event("input"));
        }
      }
    });
  });

  listWrap.querySelectorAll("button[data-inv-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.inventoryItems.find((i) => i.id === btn.dataset.invId);
      if (!item) return;
      openInventoryEditModal(item);
    });
  });

  listWrap.querySelectorAll("button[data-inv-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.dataset.invId;
      if (!targetId) return;
      const choice = await ModalUtils.confirm("Delete Item", "Are you sure you want to delete this inventory item? This action cannot be undone.");
      if (choice !== 1) return;
      await deleteInventoryItem(targetId);
      await ModalUtils.success("Item Deleted", "Inventory item has been removed successfully.");
      await loadInventoryPage();
    });
  });

  // Bind search input events and clear button
  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = "1";
    searchEl.addEventListener("input", () => {
      renderInventorySection();
    });
  }

  const clearBtn = document.getElementById("inventorySearchClear");
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = "1";
    clearBtn.addEventListener("click", () => {
      if (searchEl) searchEl.value = "";
      _invCategoryFilter = "All";
      _invStatusFilter = "all";
      renderInventorySection();
      if (searchEl) searchEl.focus();
    });
  }
}

function ensureInventoryUnitOption(selectEl, unitValue) {
  if (!selectEl || !unitValue) return;
  const exists = Array.from(selectEl.options || []).some((option) => option.value === unitValue);
  if (exists) return;
  const custom = document.createElement("option");
  custom.value = unitValue;
  custom.textContent = unitValue;
  custom.dataset.dynamic = "true";
  selectEl.appendChild(custom);
}

// ── Editable category cards ──

function buildInvCategoryCard(catName, items, isAll, tone) {
  const isActive = isAll ? _invCategoryFilter === "All" : _invCategoryFilter === catName;
  const count = items.length;
  const alerts = items.filter((i) => inventoryStatus(i) !== "good").length;
  const safeName = escapeHtml(catName);
  const dataCat = isAll ? "All" : safeName;
  const countText = `${count} item${count === 1 ? "" : "s"}${alerts ? ` · <span class="inv-cat-card-alerts">${alerts} need restock</span>` : ""}`;

  if (isAll) {
    return `<div class="inv-cat-card${isActive ? " active" : ""}" data-inv-cat="All">
      <button type="button" class="inv-cat-card-main" data-inv-cat-filter="All" title="Show all items">
        <span class="inv-cat-card-icon"><i class="ri-layout-grid-line"></i></span>
        <span class="inv-cat-card-info"><span class="inv-cat-card-name">All Items</span></span>
      </button>
      <div class="inv-cat-card-foot">
        <span class="inv-cat-card-count">${countText}</span>
      </div>
    </div>`;
  }

  return `<div class="inv-cat-card${isActive ? " active" : ""}" data-inv-cat="${safeName}">
    <button type="button" class="inv-cat-card-main" data-inv-cat-filter="${safeName}" title="Filter by ${safeName}">
      <span class="inv-cat-card-icon tone-${tone}"><i class="ri-price-tag-3-line"></i></span>
      <span class="inv-cat-card-info"><span class="inv-cat-card-name">${safeName}</span></span>
    </button>
    <div class="inv-cat-card-foot">
      <span class="inv-cat-card-count">${countText}</span>
      <div class="inv-cat-card-actions">
        <button type="button" class="inv-cat-card-btn" data-inv-cat-add="${safeName}" title="Add item to ${safeName}"><i class="ri-add-line"></i></button>
        <button type="button" class="inv-cat-card-btn" data-inv-cat-rename="${safeName}" title="Rename category"><i class="ri-edit-line"></i></button>
        <button type="button" class="inv-cat-card-btn danger" data-inv-cat-delete="${safeName}" title="Delete category"><i class="ri-delete-bin-line"></i></button>
      </div>
    </div>
  </div>`;
}

function getMergedInventoryCategoryNames() {
  const derived = state.inventoryItems.map((i) => String(i.category || "General").trim()).filter(Boolean);
  const stored = Array.isArray(state.inventoryCategories) ? state.inventoryCategories : [];
  return [...new Set([...derived, ...stored])].sort();
}

function renderInventoryCategoryCards(catPills) {
  if (!catPills) return;

  const allItems = state.inventoryItems;
  const allCategories = getMergedInventoryCategoryNames();

  let html = buildInvCategoryCard("All", allItems, true);
  html += allCategories.map((cat, index) => buildInvCategoryCard(cat, allItems.filter((i) => String(i.category || "General").trim().toLowerCase() === cat.toLowerCase()), false, (index % 5) + 1)).join("");
  html += `<button type="button" class="inv-cat-card inv-cat-card-new" data-inv-cat-add="" title="Create a new category">
    <span class="inv-cat-card-icon"><i class="ri-add-circle-line"></i></span>
    <span class="inv-cat-card-name">New Category</span>
    <span class="inv-cat-card-count">Add a new stock category</span>
  </button>`;

  catPills.innerHTML = html;

  catPills.querySelectorAll("[data-inv-cat-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _invCategoryFilter = btn.dataset.invCatFilter || "All";
      renderInventorySection();
    });
  });

  catPills.querySelectorAll("[data-inv-cat-add]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const category = btn.dataset.invCatAdd || "";
      if (!category) {
        openNewCategoryModal();
        return;
      }
      openInventoryAddForm(category);
    });
  });

  catPills.querySelectorAll("[data-inv-cat-rename]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      startCategoryRename(btn.dataset.invCatRename);
    });
  });

  catPills.querySelectorAll("[data-inv-cat-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const catName = btn.dataset.invCatDelete;
      const itemCount = state.inventoryItems.filter(
        (i) => String(i.category || "General").trim().toLowerCase() === catName.toLowerCase()
      ).length;
      const message = itemCount > 0
        ? `Delete the category "<strong>${escapeHtml(catName)}</strong>" and its ${itemCount} item${itemCount === 1 ? "" : "s"}? This action cannot be undone.`
        : `Delete the empty category "<strong>${escapeHtml(catName)}</strong>"?`;
      const choice = await ModalUtils.confirm("Delete Category", message, { html: true });
      if (choice !== 1) return;
      try {
        await deleteInventoryCategory(catName, { keepItems: false });
        await ModalUtils.success("Category Deleted", itemCount > 0 ? `Category "${catName}" and its items have been removed.` : `Category "${catName}" has been removed.`);
        if (_invCategoryFilter === catName) _invCategoryFilter = "All";
        await loadInventoryPage();
      } catch (error) {
        await ModalUtils.error("Delete Failed", error?.message || "Unable to delete category right now.");
      }
    });
  });
}

function findInvCatCard(catName) {
  const pills = document.getElementById("inventoryCategoryPills");
  if (!pills) return null;
  for (const card of pills.querySelectorAll(".inv-cat-card")) {
    if (card.dataset.invCat === catName) return card;
  }
  return null;
}

function startCategoryRename(catName) {
  const card = findInvCatCard(catName);
  if (!card) return;
  const main = card.querySelector(".inv-cat-card-main");
  const infoEl = card.querySelector(".inv-cat-card-info");
  const nameEl = card.querySelector(".inv-cat-card-name");
  const actions = card.querySelector(".inv-cat-card-actions");
  if (!main || !infoEl || !nameEl) return;

  const originalName = nameEl.textContent;
  const input = document.createElement("input");
  input.className = "inv-cat-card-rename-input";
  input.value = originalName;
  input.maxLength = 40;
  input.setAttribute("aria-label", "Rename category");

  // Swap the whole filter button for a neutral wrapper while renaming so
  // clicks/keys (space/enter) inside the input can never activate the button.
  const wrapper = document.createElement("div");
  wrapper.className = "inv-cat-card-main inv-cat-card-renaming";
  const icon = main.querySelector(".inv-cat-card-icon");
  if (icon) wrapper.appendChild(icon.cloneNode(true));
  wrapper.appendChild(input);
  main.replaceWith(wrapper);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (!wrapper.isConnected) return;
    wrapper.replaceWith(main);
    if (actions) actions.style.display = "";
  };

  const commit = async () => {
    const next = input.value.trim();
    if (!next || next.toLowerCase() === originalName.toLowerCase()) {
      finish();
      return;
    }
    try {
      await renameInventoryCategory(originalName, next);
      await ModalUtils.success("Category Renamed", `Category renamed to "${next}".`);
      if (_invCategoryFilter === originalName) _invCategoryFilter = next;
      await loadInventoryPage();
    } catch (error) {
      await ModalUtils.error("Rename Failed", error?.message || "Unable to rename category right now.");
      finish();
    }
  };

  input.focus();
  input.select();
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") finish();
  });
  input.addEventListener("blur", () => commit());
}

function openInventoryAddForm(category) {
  clearInventoryForm();
  const catEl = document.getElementById("invCategory");
  if (catEl && category) catEl.value = category;

  const body = document.getElementById("inventoryForm");
  const chevron = document.getElementById("invFormChevron");
  if (body && body.classList.contains("inv-form-collapsed")) {
    body.classList.remove("inv-form-collapsed");
    if (chevron) chevron.classList.remove("inv-form-collapsed");
  }

  const nameEl = document.getElementById("invName");
  if (nameEl) nameEl.focus();

  const formCard = document.getElementById("invFormCard");
  if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearInventoryForm() {
  const idEl = document.getElementById("invId");
  const form = document.getElementById("inventoryForm");
  const unitEl = document.getElementById("invUnit");
  const saveBtn = document.getElementById("invSaveBtn");
  if (idEl) idEl.value = "";
  if (form) form.reset();
  if (unitEl) {
    unitEl.querySelectorAll("option[data-dynamic='true']").forEach((opt) => opt.remove());
    unitEl.value = "";
  }
  if (saveBtn) saveBtn.textContent = "Save Item";
}

function clearInventoryEditForm() {
  const idEl = document.getElementById("invEditId");
  const form = document.getElementById("inventoryEditForm");
  const unitEl = document.getElementById("invEditUnit");
  const saveBtn = document.getElementById("invEditSaveBtn");
  if (idEl) idEl.value = "";
  if (form) form.reset();
  if (unitEl) {
    unitEl.querySelectorAll("option[data-dynamic='true']").forEach((opt) => opt.remove());
    unitEl.value = "";
  }
  if (saveBtn) saveBtn.textContent = "Save Changes";
}

function openInventoryEditModal(item) {
  const modal = document.getElementById("inventoryEditModal");
  const idEl = document.getElementById("invEditId");
  const nameEl = document.getElementById("invEditName");
  const catEl = document.getElementById("invEditCategory");
  const unitEl = document.getElementById("invEditUnit");
  const qtyEl = document.getElementById("invEditQuantity");
  const reorderEl = document.getElementById("invEditReorder");
  const priceEl = document.getElementById("invEditPrice");
  const saveBtn = document.getElementById("invEditSaveBtn");
  if (!modal || !idEl || !nameEl || !catEl || !unitEl || !qtyEl || !reorderEl || !priceEl) return;

  clearInventoryEditForm();

  idEl.value = String(item?.id || "");
  nameEl.value = String(item?.name || "");
  catEl.value = String(item?.category || "");
  const nextUnit = String(item?.unit || "").trim();
  if (nextUnit) {
    ensureInventoryUnitOption(unitEl, nextUnit);
    unitEl.value = nextUnit;
  }
  qtyEl.value = formatDecimal(item?.quantity ?? 0);
  const invEditForm = document.getElementById("inventoryEditForm");
  if (invEditForm) invEditForm.dataset.originalQuantity = formatDecimal(item?.quantity ?? 0);
  reorderEl.value = formatDecimal(item?.reorderLevel ?? 0);
  priceEl.value = Number(item?.price ?? 0).toFixed(2);
  if (saveBtn) saveBtn.textContent = "Update Item";

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    nameEl.focus();
    nameEl.select?.();
  }, 0);
}

function closeInventoryEditModal() {
  const modal = document.getElementById("inventoryEditModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  clearInventoryEditForm();
}

window.openInventoryEditModal = openInventoryEditModal;
window.closeInventoryEditModal = closeInventoryEditModal;

function bindInventoryEditForm() {
  const form = document.getElementById("inventoryEditForm");
  const cancelBtn = document.getElementById("invEditCancelBtn");
  if (!form || form.dataset.bound) return;

  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("invEditId")?.value?.trim();
    const name = document.getElementById("invEditName")?.value?.trim();
    const category = document.getElementById("invEditCategory")?.value?.trim();
    const unit = document.getElementById("invEditUnit")?.value?.trim();
    const quantity = Number(document.getElementById("invEditQuantity")?.value || 0);
    const reorderLevel = Number(document.getElementById("invEditReorder")?.value || 0);
    const price = Number(document.getElementById("invEditPrice")?.value || 0);
    const saveBtn = document.getElementById("invEditSaveBtn");

    if (!name || !category || !unit) {
      await ModalUtils.warning("Validation Error", "Name, category, and unit are required.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isFinite(price) || price < 0) {
      await ModalUtils.warning("Validation Error", "Quantity, reorder level, and price must be valid positive values.");
      return;
    }

    setButtonLoadingState(saveBtn, true, "Saving...");
    try {
      await saveInventoryItem(
        { id: id || undefined, name, category, unit, quantity, reorderLevel, price },
        { originalQuantity: Number(form.dataset.originalQuantity ?? "") }
      );
      await ModalUtils.success("Success", "Inventory item has been saved successfully.");
      closeInventoryEditModal();
      await loadInventoryPage();
    } catch (error) {
      await ModalUtils.error("Save Failed", error?.message || "Unable to save inventory item right now.");
    } finally {
      setButtonLoadingState(saveBtn, false, "Update Item");
    }
  });

  cancelBtn?.addEventListener("click", closeInventoryEditModal);
}

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
    const price = Number(document.getElementById("invPrice")?.value || 0);
    const saveBtn = document.getElementById("invSaveBtn");

    if (!name || !category || !unit) {
      await ModalUtils.warning("Validation Error", "Name, category, and unit are required.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isFinite(price) || price < 0) {
      await ModalUtils.warning("Validation Error", "Quantity, reorder level, and price must be valid positive values.");
      return;
    }

    setButtonLoadingState(saveBtn, true, "Saving...");
    try {
      await saveInventoryItem({ id: id || undefined, name, category, unit, quantity, reorderLevel, price });
      await ModalUtils.success("Success", "Inventory item has been saved successfully.");
      clearInventoryForm();
      await loadInventoryPage();
    } catch (error) {
      await ModalUtils.error("Save Failed", error?.message || "Unable to save inventory item right now.");
    } finally {
      setButtonLoadingState(saveBtn, false, "Save Item");
    }
  });

  cancelBtn?.addEventListener("click", clearInventoryForm);
}

function clampDecimalInputs() {
  document.querySelectorAll(".inv-decimal-input").forEach((input) => {
    if (input.dataset.decimalBound) return;
    input.dataset.decimalBound = "1";
    input.addEventListener("input", () => {
      const raw = input.value;
      if (raw === "" || raw === ".") return;
      const parts = raw.split(".");
      if (parts.length === 2 && parts[1].length > 2) {
        input.value = parts[0] + "." + parts[1].slice(0, 2);
      }
      const num = Number(input.value);
      if (Number.isFinite(num) && num > 99999.99) {
        input.value = "99999.99";
      }
    });
    input.addEventListener("blur", () => {
      const num = Number(input.value);
      if (Number.isFinite(num) && input.value.includes(".")) {
        input.value = num.toFixed(2);
      }
    });
  });
}

function bindInventoryFormToggle() {
  const toggle = document.getElementById("invFormToggle");
  const body = document.getElementById("inventoryForm");
  const chevron = document.getElementById("invFormChevron");
  if (!toggle || !body || !chevron || toggle.dataset.bound) return;
  toggle.dataset.bound = "1";

  // Start collapsed
  body.classList.add("inv-form-collapsed");
  chevron.classList.add("inv-form-collapsed");

  toggle.addEventListener("click", () => {
    const isCollapsed = body.classList.contains("inv-form-collapsed");
    if (isCollapsed) {
      body.classList.remove("inv-form-collapsed");
      chevron.classList.remove("inv-form-collapsed");
    } else {
      body.classList.add("inv-form-collapsed");
      chevron.classList.add("inv-form-collapsed");
    }
  });
}

let quickAddSelectedItem = null;

function openQuickAddStock() {
  const modal = document.getElementById("quickAddStockModal");
  const searchInput = document.getElementById("quickAddSearchInput");
  const resultsEl = document.getElementById("quickAddSearchResults");
  const selectedSection = document.getElementById("quickAddSelectedSection");
  const fieldsSection = document.getElementById("quickAddFieldsSection");
  const saveBtn = document.getElementById("quickAddSaveBtn");
  const qtyInput = document.getElementById("quickAddQty");
  if (!modal) return;

  quickAddSelectedItem = null;
  if (searchInput) searchInput.value = "";
  if (resultsEl) resultsEl.innerHTML = "";
  if (resultsEl) resultsEl.style.display = "none";
  if (selectedSection) selectedSection.style.display = "none";
  if (fieldsSection) fieldsSection.style.display = "none";
  if (saveBtn) saveBtn.disabled = true;
  if (qtyInput) qtyInput.value = "";

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => { if (searchInput) searchInput.focus(); }, 0);
}

function closeQuickAddStock() {
  const modal = document.getElementById("quickAddStockModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  quickAddSelectedItem = null;
}

function openNewCategoryModal() {
  const modal = document.getElementById("newCategoryModal");
  const input = document.getElementById("newCategoryNameInput");
  const createBtn = document.getElementById("newCategoryCreateBtn");
  if (!modal) return;

  if (input) input.value = "";
  if (createBtn) createBtn.disabled = true;

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => { if (input) input.focus(); }, 0);
}

function closeNewCategoryModal() {
  const modal = document.getElementById("newCategoryModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

function submitNewCategoryModal() {
  const input = document.getElementById("newCategoryNameInput");
  const name = (input?.value || "").trim();
  if (!name) return;

  const existing = getMergedInventoryCategoryNames().some((c) => c.toLowerCase() === name.toLowerCase());
  if (existing) {
    ModalUtils.warning("Duplicate Category", `A category named "${name}" already exists.`);
    return;
  }

  (async () => {
    try {
      await createInventoryCategory(name);
      state.inventoryCategories = [...(state.inventoryCategories || []), name].sort((a, b) => a.localeCompare(b));
      closeNewCategoryModal();
      renderInventorySection();
      await ModalUtils.success("Category Created", `Category "${name}" has been created.`);
    } catch (error) {
      await ModalUtils.error("Create Failed", error?.message || "Unable to create the category right now.");
    }
  })();
}

function bindNewCategoryModal() {
  const modal = document.getElementById("newCategoryModal");
  if (!modal) return;

  const input = document.getElementById("newCategoryNameInput");
  const createBtn = document.getElementById("newCategoryCreateBtn");
  const cancelBtn = document.getElementById("newCategoryCancelBtn");

  input?.addEventListener("input", () => {
    if (createBtn) createBtn.disabled = !input.value.trim();
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitNewCategoryModal();
    } else if (e.key === "Escape") {
      closeNewCategoryModal();
    }
  });
  createBtn?.addEventListener("click", submitNewCategoryModal);
  cancelBtn?.addEventListener("click", closeNewCategoryModal);
}

function renderQuickAddSearchResults(term) {
  const resultsEl = document.getElementById("quickAddSearchResults");
  if (!resultsEl) return;

  if (!term || !state.inventoryItems.length) {
    resultsEl.innerHTML = "";
    resultsEl.style.display = "none";
    return;
  }

  const filtered = state.inventoryItems.filter((item) => {
    const hay = (String(item.name || "") + " " + String(item.category || "")).toLowerCase();
    return hay.includes(term);
  }).slice(0, 8);

  if (!filtered.length) {
    resultsEl.innerHTML = '<div class="quick-add-result-empty"><i class="ri-search-line" aria-hidden="true"></i>No items found</div>';
    resultsEl.style.display = "block";
    return;
  }

  resultsEl.innerHTML = filtered.map((item) => {
    const qty = Number(item.quantity || 0);
    const status = inventoryStatus(item);
    const statusClass = status === "out" ? "b-red" : status === "critical" ? "b-red" : status === "low" ? "b-orange" : "b-green";
    return `<div class="quick-add-result-item" data-quick-add-id="${escapeHtml(item.id)}">
      <div class="quick-add-result-info">
        <span class="quick-add-result-name">${escapeHtml(item.name)}</span>
        <span class="quick-add-result-cat">${escapeHtml(item.category)}</span>
      </div>
      <div class="quick-add-result-meta">
        <span class="badge ${statusClass}">${formatDecimal(qty)} ${escapeHtml(item.unit)}</span>
      </div>
    </div>`;
  }).join("");

  resultsEl.style.display = "block";

  resultsEl.querySelectorAll(".quick-add-result-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.quickAddId;
      const item = state.inventoryItems.find((i) => i.id === id);
      if (!item) return;
      selectQuickAddItem(item);
    });
  });
}

function selectQuickAddItem(item) {
  quickAddSelectedItem = item;
  const searchInput = document.getElementById("quickAddSearchInput");
  const resultsEl = document.getElementById("quickAddSearchResults");
  const selectedSection = document.getElementById("quickAddSelectedSection");
  const selectedName = document.getElementById("quickAddSelectedName");
  const selectedTags = document.getElementById("quickAddSelectedTags");
  const stockBar = document.getElementById("quickAddStockBar");
  const stockValue = document.getElementById("quickAddStockValue");
  const fieldsSection = document.getElementById("quickAddFieldsSection");
  const qtyInput = document.getElementById("quickAddQty");
  const qtyUnit = document.getElementById("quickAddQtyUnit");
  const saveBtn = document.getElementById("quickAddSaveBtn");

  if (searchInput) searchInput.value = item.name;
  if (resultsEl) { resultsEl.innerHTML = ""; resultsEl.style.display = "none"; }
  if (selectedSection) selectedSection.style.display = "block";
  if (fieldsSection) fieldsSection.style.display = "block";
  if (saveBtn) saveBtn.disabled = false;

  const qty = Number(item.quantity || 0);
  const reorderLevel = Math.max(1, Number(item.reorderLevel || 1));
  const status = inventoryStatus(item);
  const statusLabel = status === "out" ? "Out of stock" : status === "critical" ? "Critical" : status === "low" ? "Low stock" : "Good";
  const statusClass = status === "out" ? "bar-out" : status === "critical" ? "bar-critical" : status === "low" ? "bar-low" : "";
  const percent = Math.max(3, Math.min(100, Math.round((qty / (reorderLevel * 2)) * 100)));

  if (selectedName) selectedName.textContent = item.name;
  if (selectedTags) {
    selectedTags.innerHTML = `<span class="quick-add-selected-tag">${escapeHtml(item.category)}</span><span class="quick-add-selected-tag">${escapeHtml(item.unit)}</span><span class="quick-add-selected-tag">₱${Number(item.price || 0).toFixed(2)}/unit</span>`;
  }
  if (stockBar) {
    stockBar.style.width = percent + "%";
    stockBar.className = "quick-add-stock-bar" + (statusClass ? " " + statusClass : "");
  }
  if (stockValue) stockValue.textContent = `${formatDecimal(qty)} ${item.unit} — ${statusLabel}`;
  if (qtyUnit) qtyUnit.textContent = item.unit;
  if (qtyInput) { qtyInput.value = ""; qtyInput.focus(); }
  updateQuickAddPreview();
}

function quickAddChangeItem() {
  quickAddSelectedItem = null;
  const searchInput = document.getElementById("quickAddSearchInput");
  const selectedSection = document.getElementById("quickAddSelectedSection");
  const fieldsSection = document.getElementById("quickAddFieldsSection");
  const saveBtnEl = document.getElementById("quickAddSaveBtn");
  if (selectedSection) selectedSection.style.display = "none";
  if (fieldsSection) fieldsSection.style.display = "none";
  if (saveBtnEl) saveBtnEl.disabled = true;
  if (searchInput) { searchInput.value = ""; searchInput.focus(); }
}

function updateQuickAddPreview() {
  const qtyInput = document.getElementById("quickAddQty");
  const newTotal = document.getElementById("quickAddNewTotal");
  if (!qtyInput || !newTotal || !quickAddSelectedItem) return;
  const addQty = Number(qtyInput.value || 0);
  const current = Number(quickAddSelectedItem.quantity || 0);
  if (addQty > 0) {
    newTotal.textContent = `${formatDecimal(current + addQty)} ${quickAddSelectedItem.unit}`;
    newTotal.classList.add("has-value");
  } else {
    newTotal.textContent = `${formatDecimal(current)} ${quickAddSelectedItem.unit}`;
    newTotal.classList.remove("has-value");
  }
}

async function submitQuickAddStock() {
  if (!quickAddSelectedItem) return;
  const qtyInput = document.getElementById("quickAddQty");
  const addQty = Number(qtyInput?.value || 0);
  if (!Number.isFinite(addQty) || addQty <= 0) {
    await ModalUtils.warning("Validation Error", "Please enter a valid quantity to add.");
    return;
  }

  const fallbackNewQty = Number(quickAddSelectedItem.quantity || 0) + addQty;
  const result = await saveInventoryItem(
    {
      id: quickAddSelectedItem.id,
      name: quickAddSelectedItem.name,
      category: quickAddSelectedItem.category,
      unit: quickAddSelectedItem.unit,
      reorderLevel: quickAddSelectedItem.reorderLevel,
      price: quickAddSelectedItem.price,
    },
    { quantityDelta: addQty }
  );

  const newQty = Number(result?.quantity ?? fallbackNewQty);
  await ModalUtils.success("Stock Updated", `${formatDecimal(addQty)} ${quickAddSelectedItem.unit} added to ${quickAddSelectedItem.name}. New stock: ${formatDecimal(newQty)} ${quickAddSelectedItem.unit}.`);
  closeQuickAddStock();
  await loadInventoryPage();
}

function bindQuickAddStock() {
  const searchInput = document.getElementById("quickAddSearchInput");
  const cancelBtn = document.getElementById("quickAddCancelBtn");
  const saveBtn = document.getElementById("quickAddSaveBtn");
  const qtyInput = document.getElementById("quickAddQty");
  const changeBtn = document.getElementById("quickAddChangeBtn");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      quickAddSelectedItem = null;
      const selectedSection = document.getElementById("quickAddSelectedSection");
      const fieldsSection = document.getElementById("quickAddFieldsSection");
      const saveBtnEl = document.getElementById("quickAddSaveBtn");
      if (selectedSection) selectedSection.style.display = "none";
      if (fieldsSection) fieldsSection.style.display = "none";
      if (saveBtnEl) saveBtnEl.disabled = true;
      renderQuickAddSearchResults(term);
    });
  }

  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", closeQuickAddStock);
  }

  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", submitQuickAddStock);
  }

  if (qtyInput && !qtyInput.dataset.bound) {
    qtyInput.dataset.bound = "1";
    qtyInput.addEventListener("input", updateQuickAddPreview);
  }

  if (changeBtn && !changeBtn.dataset.bound) {
    changeBtn.dataset.bound = "1";
    changeBtn.addEventListener("click", quickAddChangeItem);
  }

  const restockCloseBtn = document.getElementById("restockCloseBtn");
  if (restockCloseBtn && !restockCloseBtn.dataset.bound) {
    restockCloseBtn.dataset.bound = "1";
    restockCloseBtn.addEventListener("click", closeRestockModal);
  }
}

window.openQuickAddStock = openQuickAddStock;
window.closeQuickAddStock = closeQuickAddStock;
window.openNewCategoryModal = openNewCategoryModal;
window.closeNewCategoryModal = closeNewCategoryModal;

function openRestockModal() {
  const modal = document.getElementById("restockModal");
  const listEl = document.getElementById("restockItemsList");
  const emptyEl = document.getElementById("restockEmpty");
  const subEl = document.getElementById("restockModalSub");
  if (!modal || !listEl) return;

  const items = (state.inventoryItems || []).filter((i) => inventoryStatus(i) !== "good");
  const statusLabels = { out: "Out of Stock", critical: "Critical", low: "Low Stock" };

  if (emptyEl) emptyEl.style.display = items.length ? "none" : "block";

  listEl.innerHTML = items.map((item) => {
    const qty = Number(item.quantity || 0);
    const reorderLevel = Number(item.reorderLevel || 0);
    const status = inventoryStatus(item);
    const statusClass = status === "out" ? "inv-status-out" : status === "critical" ? "inv-status-critical" : "inv-status-low";
    return `<div class="restock-item">
      <div class="restock-item-info">
        <span class="restock-item-name">${escapeHtml(item.name)}</span>
        <span class="restock-item-tags"><span class="inv-cat-tag">${escapeHtml(item.category)}</span><span class="inv-unit-tag">${escapeHtml(item.unit)}</span></span>
      </div>
      <div class="restock-item-stock">
        <span class="restock-qty"><strong>${formatDecimal(qty)}</strong> ${escapeHtml(item.unit)}</span>
        <span class="restock-reorder">Reorder: ${formatDecimal(reorderLevel)} ${escapeHtml(item.unit)}</span>
      </div>
      <span class="inv-status-badge ${statusClass}">${statusLabels[status] || "Low Stock"}</span>
      <button class="restock-item-btn" type="button" data-restock-id="${escapeHtml(item.id)}" title="Add stock for ${escapeHtml(item.name)}"><i class="ri-add-box-line"></i> Restock</button>
    </div>`;
  }).join("");

  if (subEl) subEl.textContent = `${items.length} item${items.length === 1 ? "" : "s"} at or below the restock level`;

  listEl.querySelectorAll(".restock-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.inventoryItems.find((i) => i.id === btn.dataset.restockId);
      closeRestockModal();
      if (item) {
        openQuickAddStock();
        selectQuickAddItem(item);
      }
    });
  });

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
}

function closeRestockModal() {
  const modal = document.getElementById("restockModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

window.openRestockModal = openRestockModal;
window.closeRestockModal = closeRestockModal;

async function loadAccountsPage() {
  const host = document.getElementById("accountsContent");
  if (!host) return;
  host.innerHTML = `
    <div class="accounts-layout">
      <div class="card accounts-create-card">
        <div class="card-head accounts-card-head">
          <div>
            <span class="card-title">Create Account</span>
            <div class="accounts-head-sub">Provision access and role in one step</div>
          </div>
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
            <input class="ls-input" id="newAccPassword" type="password" placeholder="min 6 chars" autocomplete="new-password" style="margin-bottom:0;" required>
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
        <div class="card-head accounts-card-head" style="align-items:flex-start;gap:12px;">
          <div>
            <span class="card-title">Account Directory</span>
            <div class="accounts-head-sub" id="accountsSyncMeta">Last synced: Never</div>
          </div>
          <div class="accounts-kpis" id="accountsKpis"></div>
        </div>

        <div class="accounts-toolbar">
          <div class="accounts-search-row">
            <input id="accountsSearch" class="ls-input orders-filter-input accounts-search" placeholder="Search by name, email, or UID" />
          </div>
          <div class="accounts-filter-row">
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
        </div>

        <div class="tbl-wrap accounts-table-shell">
          <table class="accounts-table">
            <tr>
              <th>Member</th>
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
  showApp();
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

function formatSyncTime(updatedMs) {
  if (!updatedMs) return "Never";
  return new Date(updatedMs).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderAccountsSyncMeta(note = "") {
  const el = document.getElementById("accountsSyncMeta");
  if (!el) return;

  const base = `Last synced: ${formatSyncTime(state.lastAccountsSyncMs)}`;
  el.textContent = note ? `${base} (${note})` : base;
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function isValidShiftValue(value) {
  // Delegate to the same parser the runtime scheduler uses (staffModel), so a
  // schedule that passes this check is guaranteed to actually put staff on duty.
  // Rejects values like 24:00-24:00, 13 AM, or 0 AM that the scheduler ignores.
  return parseShiftRange(value) !== null;
}

function validateScheduleBeforeSave() {
  const sched = readScheduleFromDOM();
  const invalid = [];

  document.querySelectorAll(".staff-shift-input").forEach((input) => {
    input.classList.remove("is-invalid");
    input.removeAttribute("title");
  });

  Object.entries(sched).forEach(([staffId, days]) => {
    Object.entries(days || {}).forEach(([day, payload]) => {
      if (!payload?.onDuty) return;
      const rawShift = String(payload?.shift || "").trim();
      const input = document.getElementById(`shift_${staffId}_${day}`);
      if (!isValidShiftValue(rawShift)) {
        invalid.push({ staffId, day, value: rawShift });
        if (input) {
          input.classList.add("is-invalid");
          input.setAttribute("title", "Use format like 7AM-3PM or 07:00-15:00");
        }
      }
    });
  });

  return { sched, invalid };
}

function summarizeSchedulePayload(sched) {
  const schedule = sched && typeof sched === "object" ? sched : {};
  let onDutySlots = 0;
  let withAnyDuty = 0;

  Object.values(schedule).forEach((days) => {
    const entries = days && typeof days === "object" ? Object.values(days) : [];
    const dutyCount = entries.filter((payload) => !!payload?.onDuty).length;
    onDutySlots += dutyCount;
    if (dutyCount > 0) withAnyDuty += 1;
  });

  return { onDutySlots, withAnyDuty };
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
    const initials = String(nameDisplay)
      .split(" ")
      .filter(Boolean)
      .map((chunk) => chunk[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U";
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
        <td>
          <div class="accounts-member-cell">
            <div class="avatar sm">${escapeHtml(initials)}</div>
            <div class="accounts-member-meta">
              <div class="accounts-member-name">${escapeHtml(nameDisplay)}</div>
              <div class="accounts-member-sub">${account.role === "admin" ? "Administrator account" : "Staff account"}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(account.email || "-")}</td>
        <td><code>${escapeHtml(account.uid)}</code></td>
        <td><span class="badge ${roleBadgeClass}">${escapeHtml(account.role)}</span></td>
        <td><span class="badge ${statusBadgeClass}">${escapeHtml(account.status)}</span></td>
        <td>${escapeHtml(formatAccountUpdated(account.updatedMs))}</td>
        <td>
          <div class="accounts-row-actions">
            <button class="orders-btn ghost inventory-mini-btn row-action-btn" data-account-action="edit" data-account-uid="${escapeHtml(account.uid)}" title="Edit account" aria-label="Edit account"><i class="ri-pencil-line" aria-hidden="true"></i></button>
            <button class="orders-btn ghost inventory-mini-btn row-action-btn" data-account-action="toggle-role" data-account-uid="${escapeHtml(account.uid)}" data-account-next-role="${escapeHtml(nextRole)}" title="${nextRoleLabel}" aria-label="${nextRoleLabel}"><i class="ri-exchange-line" aria-hidden="true"></i></button>
            <button class="orders-btn ghost inventory-mini-btn ${account.status === "suspended" ? "" : "danger"} row-action-btn" data-account-action="toggle-status" data-account-uid="${escapeHtml(account.uid)}" data-account-next-status="${account.status === "suspended" ? "active" : "suspended"}" ${toggleStatusDisabled} ${toggleStatusTitle} title="${toggleStatusLabel}" aria-label="${toggleStatusLabel}"><i class="ri-toggle-line" aria-hidden="true"></i></button>
            <button class="orders-btn ghost inventory-mini-btn danger row-action-btn" data-account-action="delete-account" data-account-uid="${escapeHtml(account.uid)}" ${deleteDisabled} ${deleteTitle} title="Delete account" aria-label="Delete account"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
            <button class="orders-btn ghost inventory-mini-btn row-action-btn" data-account-action="copy-uid" data-account-uid="${escapeHtml(account.uid)}" title="Copy UID" aria-label="Copy UID"><i class="ri-file-copy-line" aria-hidden="true"></i></button>
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
  try {
    const users = await listUsers();
    state.accounts = users.map(normalizeAccountRecord);
    state.lastAccountsSyncMs = Date.now();
    renderAccountsDirectory();
    renderAccountsSyncMeta();
  } catch (error) {
    console.error("[Accounts] Failed to load users:", error);
    const rowsEl = document.getElementById("accountsRows");
    const emptyEl = document.getElementById("accountsEmptyState");
    if (rowsEl) rowsEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.style.display = "block";
      emptyEl.innerHTML = renderSectionState("Unable to load accounts. Please refresh or check access permissions.", "error");
    }
    renderAccountsSyncMeta("sync failed");
  }
}

function openAccountEditModal(account) {
  let modal = document.getElementById("accountEditModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "accountEditModal";
    modal.className = "modal-overlay-custom";
    modal.setAttribute("aria-hidden", "true");
    document.body.appendChild(modal);
  }

  const currentRole = account.role || "unassigned";
  const fullName = account.fullName || "";
  const email = account.email || "";

  modal.innerHTML = `
    <div class="modal-custom" role="dialog" aria-modal="true" aria-labelledby="accountEditTitle" style="max-width:440px;width:100%;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--border-color);">
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-secondary);margin-bottom:2px;">Edit Account</div>
          <div id="accountEditTitle" style="font-size:17px;font-weight:700;color:var(--text-primary);">Edit ${escapeHtml(fullName || email)}</div>
        </div>
        <button class="orders-btn ghost" type="button" onclick="document.getElementById('accountEditModal').style.display='none'; document.getElementById('accountEditModal').setAttribute('aria-hidden','true');" aria-label="Close" style="font-size:20px;padding:4px 8px;">&times;</button>
      </div>
      <div style="padding:22px;">
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px;">Full Name</label>
          <input type="text" id="accountEditFullName" value="${escapeHtml(fullName)}" style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-primary);color:var(--text-primary);box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px;">Email</label>
          <input type="email" value="${escapeHtml(email)}" readonly style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-secondary);color:var(--text-muted);cursor:not-allowed;box-sizing:border-box;" />
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Email cannot be changed from here.</div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px;">New Password</label>
          <div style="position:relative;">
            <input type="password" id="accountEditPassword" placeholder="Leave blank to keep current" style="width:100%;padding:10px 36px 10px 12px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-primary);color:var(--text-primary);box-sizing:border-box;" />
            <button type="button" id="accountEditTogglePwd" onclick="var inp=document.getElementById('accountEditPassword');var btn=document.getElementById('accountEditTogglePwd');var showing=inp.type==='text';inp.type=showing?'password':'text';btn.innerHTML=showing?'&#128065;':'&#128064;';btn.setAttribute('aria-label',showing?'Show password':'Hide password');" aria-label="Show password" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:16px;padding:2px;line-height:1;color:var(--text-muted);">&#128065;</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Minimum 6 characters. Leave blank to keep current password.</div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px;">Role</label>
          <select id="accountEditRole" style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-primary);color:var(--text-primary);box-sizing:border-box;">
            <option value="admin" ${currentRole === "admin" ? "selected" : ""}>Admin</option>
            <option value="staff" ${currentRole === "staff" ? "selected" : ""}>Staff</option>
          </select>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--border-color);">
        <button class="orders-btn ghost" type="button" onclick="document.getElementById('accountEditModal').style.display='none'; document.getElementById('accountEditModal').setAttribute('aria-hidden','true');" style="padding:8px 16px;">Cancel</button>
        <button class="orders-btn primary" type="button" id="accountEditSaveBtn" style="padding:8px 20px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Save Changes</button>
      </div>
    </div>
  `;

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");

  document.getElementById("accountEditSaveBtn").addEventListener("click", async () => {
    const newFullName = document.getElementById("accountEditFullName").value.trim();
    const newRole = document.getElementById("accountEditRole").value;
    const newPassword = document.getElementById("accountEditPassword").value;

    if (!newFullName) {
      await ModalUtils.warning("Validation", "Full name is required.");
      return;
    }

    if (newPassword && newPassword.length < 6) {
      await ModalUtils.warning("Validation", "Password must be at least 6 characters.");
      return;
    }

    try {
      const saveBtn = document.getElementById("accountEditSaveBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      if (newPassword) {
        await updatePasswordByAdmin(account.uid, newPassword);
      }

      await setUserProfile(account.uid, {
        fullName: newFullName,
        role: newRole,
        updatedAtMs: Date.now(),
      });

      if (newRole !== currentRole) {
        await setUserRole(account.uid, newRole, account.email || "");
      }

      if (newFullName !== fullName) {
        await updateStaffNameByUid(account.uid, newFullName);
        try {
          state.staff = await getStaff();
        } catch (_) {}
      }

      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");

      await refreshAccountsRecords();
      await ModalUtils.success("Account Updated", newPassword ? "Account details and password have been saved." : "Account details have been saved.");
    } catch (error) {
      await ModalUtils.error("Save Failed", error?.message || "Unable to update account.");
    }
  });
}

function setAccountsActionBusy(button, busy = true) {
  if (!button) return;
  if (busy) {
    button.disabled = true;
    button.dataset.busy = "1";
  } else {
    button.disabled = false;
    delete button.dataset.busy;
  }
}

function bindAccountsControls() {
  const host = document.getElementById("accountsContent");
  if (!host) return;

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
    refreshBtn.disabled = true;
    try {
      await refreshAccountsRecords();
    } finally {
      refreshBtn.disabled = false;
    }
  });

  clearCreateBtn?.addEventListener("click", clearCreateForm);

  createForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("createAccountBtn");
    const fullName = document.getElementById("newAccName")?.value?.trim();
    const email = document.getElementById("newAccEmail")?.value?.trim();
    const password = document.getElementById("newAccPassword")?.value || "";
    const role = String(document.getElementById("newAccRole")?.value || "staff").toLowerCase();
    const addToStaff = !!document.getElementById("newAccAddStaff")?.checked;

    if (!fullName || !email || !password || password.length < 6 || !role) {
      await ModalUtils.warning("Validation Error", "Full name, valid email, password (min 6), and role are required.");
      return;
    }
    if (!isValidEmailAddress(email)) {
      await ModalUtils.warning("Invalid Email", "Please provide a valid email address.");
      return;
    }

    const duplicate = state.accounts.some((acc) => String(acc.email || "").toLowerCase() === email.toLowerCase());
    if (duplicate) {
      await ModalUtils.warning("Email Exists", "An account with this email already exists in the directory.");
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating...";
      }
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
        await addStaff(fullName, "Staff", { accountUid: created.uid, email });
      }

      clearCreateForm();
      await refreshAccountsRecords();
      await ModalUtils.success("Account Created", "New account has been created successfully.");
    } catch (error) {
      await ModalUtils.error("Account Creation Failed", `${error?.message || "Unknown error"}`);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
      }
    }
  });

  if (host.__accountsDelegatedHandler) {
    host.removeEventListener("click", host.__accountsDelegatedHandler);
  }
  if (host.__accountsDelegatedPointerHandler) {
    host.removeEventListener("pointerup", host.__accountsDelegatedPointerHandler);
  }

  const handleAccountAction = async (target) => {
    const actionBtn = target?.closest?.("button[data-account-action]");
    if (!actionBtn) return;
    if (actionBtn.dataset.busy === "1") return;

    const action = actionBtn.dataset.accountAction;
    const uid = actionBtn.dataset.accountUid;
    if (!uid) return;

    setAccountsActionBusy(actionBtn, true);
    try {
    if (action === "copy-uid") {
      try {
        await navigator.clipboard.writeText(uid);
        await ModalUtils.success("Copied", "UID copied to clipboard.");
      } catch {
        await ModalUtils.error("Copy Failed", "Unable to copy UID in this browser.");
      }
      return;
    }

    if (action === "toggle-role") {
      const nextRole = String(actionBtn.dataset.accountNextRole || "staff").toLowerCase();
      const account = state.accounts.find((acc) => acc.uid === uid);
      if (!account) return;
      const confirmed = await ModalUtils.confirm("Change Role", `Change role for <strong>${escapeHtml(account.fullName || account.email || uid)}</strong> to <strong>${escapeHtml(nextRole)}</strong>?`, { html: true });
      if (confirmed !== 1) return;
      await setUserRole(uid, nextRole, account.email || "");
      await setUserProfile(uid, { role: nextRole, updatedAtMs: Date.now() });
      await refreshAccountsRecords();
      await ModalUtils.success("Role Updated", "Account role updated successfully.");
      return;
    }

    if (action === "toggle-status") {
      const account = state.accounts.find((acc) => acc.uid === uid);
      if (!account) return;
      if (account.role === "admin") {
        await ModalUtils.warning("Cannot Suspend", "Admin accounts cannot be suspended from this page.");
        return;
      }

      const nextStatus = String(actionBtn.dataset.accountNextStatus || "active").toLowerCase();
      const confirmed = await ModalUtils.confirm(
        nextStatus === "suspended" ? "Suspend Account" : "Activate Account",
        `${nextStatus === "suspended" ? "Suspend" : "Activate"} <strong>${escapeHtml(account.fullName || account.email || uid)}</strong>?`,
        { html: true }
      );
      if (confirmed !== 1) return;
      await setUserProfile(uid, { status: nextStatus, updatedAtMs: Date.now() });
      await refreshAccountsRecords();
      await ModalUtils.success("Status Updated", `Account is now ${nextStatus}.`);
      return;
    }

    if (action === "delete-account") {
      const account = state.accounts.find((acc) => acc.uid === uid);
      if (!account) return;
      if (account.role !== "staff") {
        await ModalUtils.warning("Cannot Delete", "Only staff accounts can be deleted.");
        return;
      }

      const label = escapeHtml(account.fullName || account.email || account.uid);
      const confirmed = await ModalUtils.confirm("Delete Staff Account", `This will disable access and hide the account for <strong>${label}</strong> from this list. This action cannot be undone.`, { html: true });
      if (confirmed !== 1) return;

      await setUserProfile(uid, {
        status: "suspended",
        deleted: true,
        deletedAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });

      const removedByUid = await removeStaffByAccountUid(uid);
      if (account.fullName && !removedByUid) {
        await removeStaffByName(account.fullName);
      }

      await refreshAccountsRecords();
      await ModalUtils.success("Account Deleted", "Staff account has been deleted successfully.");
    }

    if (action === "edit") {
      const account = state.accounts.find((acc) => acc.uid === uid);
      if (!account) return;
      openAccountEditModal(account);
      return;
    }
    } finally {
      setAccountsActionBusy(actionBtn, false);
    }
  };

  const delegatedHandler = async (e) => {
    await handleAccountAction(e.target);
  };

  const delegatedPointerHandler = async (e) => {
    await handleAccountAction(e.target);
  };

  host.__accountsDelegatedHandler = delegatedHandler;
  host.__accountsDelegatedPointerHandler = delegatedPointerHandler;
  host.addEventListener("click", delegatedHandler);
  host.addEventListener("pointerup", delegatedPointerHandler);
}

async function loadSettingsPage() {
  const host = document.getElementById("settings");
  if (!host) return;

  const DEFAULT_SETTINGS = getDefaultSettings();
  const settings = await getAdminSettings();

  // Skip the rebuild when settings are unchanged — re-writing innerHTML on
  // every tab visit replays entry animations (page fade, badge pops) and
  // collapses the shop-info edit form, losing any unsaved input. The DOM and
  // its existing listeners already reflect the current values.
  const signature = JSON.stringify(settings);
  if (signature === settingsRenderedSignature && host.innerHTML) {
    showApp();
    return;
  }
  settingsRenderedSignature = signature;

  host.innerHTML = `
    <div class="page-header settings-page-header">
      <div class="page-title">Settings</div>
      <div class="page-sub">System controls and preferences based on what this build currently supports.</div>
      <div class="settings-header-actions">
        <button id="resetSettingsBtn" class="orders-btn ghost" type="button">Reset to Defaults</button>
        <button id="exportDataBtn" class="orders-btn" type="button">Export Settings</button>
      </div>
      <div id="settingsSavedHint" class="settings-save-hint">Changes are stored in this browser.</div>
    </div>

    <div class="settings-layout">
      <div class="settings-main-col">
        <div class="card settings-card">
          <div class="card-head settings-card-head">
            <div>
              <span class="card-title">Shop Information</span>
              <div class="settings-card-sub">Used in receipts and admin references.</div>
            </div>
            <span class="card-action" id="toggleShopEdit">Edit</span>
          </div>

          <div id="shopInfoDisplay">
            <div class="setting-row"><div><div class="setting-label">Shop Name</div><div class="setting-desc" id="displayShopName"></div></div></div>
            <div class="setting-row"><div><div class="setting-label">Location</div><div class="setting-desc" id="displayLocation"></div></div></div>
            <div class="setting-row"><div><div class="setting-label">Opening Hours</div><div class="setting-desc" id="displayHours"></div></div></div>
            <div class="setting-row"><div><div class="setting-label">Phone Number</div><div class="setting-desc" id="displayPhone"></div></div></div>
            <div class="setting-row"><div><div class="setting-label">Currency</div><div class="setting-desc" id="displayCurrency"></div></div></div>
          </div>

          <form id="shopInfoForm" style="display:none;">
            <div class="accounts-form-grid">
              <div>
                <div class="ls-label">Shop Name</div>
                <input class="ls-input" id="inputShopName" style="margin-bottom:0;" required>
              </div>
              <div>
                <div class="ls-label">Location</div>
                <input class="ls-input" id="inputLocation" style="margin-bottom:0;" required>
              </div>
              <div>
                <div class="ls-label">Opening Hours</div>
                <input class="ls-input" id="inputHours" placeholder="e.g. 7:00 AM - 9:00 PM" style="margin-bottom:0;" required>
              </div>
              <div>
                <div class="ls-label">Phone Number</div>
                <input class="ls-input" id="inputPhone" type="tel" style="margin-bottom:0;" required>
              </div>
              <div class="settings-form-actions">
                <button type="button" class="orders-btn ghost" id="cancelShopEdit">Cancel</button>
                <button type="submit" class="orders-btn" id="saveShopInfoBtn">Save Changes</button>
              </div>
            </div>
          </form>
        </div>

        <div class="card settings-card">
          <div class="card-head settings-card-head">
            <div>
              <span class="card-title">Operational Preferences</span>
              <div class="settings-card-sub">These affect local UI behavior for admins.</div>
            </div>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Low Stock Alerts</div>
              <div class="setting-desc">Keep inventory warning badges and summaries visible.</div>
            </div>
            <label class="toggle">
              <input type="checkbox" class="setting-toggle" data-setting="preferences.lowStockAlerts">
              <span class="tslider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Transaction Notifications</div>
              <div class="setting-desc">Show transaction update confirmations in admin flows.</div>
            </div>
            <label class="toggle">
              <input type="checkbox" class="setting-toggle" data-setting="preferences.transactionNotifications">
              <span class="tslider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Order Sync Toasts</div>
              <div class="setting-desc">Show sync result toasts after queued orders are processed.</div>
            </div>
            <label class="toggle">
              <input type="checkbox" class="setting-toggle" data-setting="preferences.orderSyncToasts">
              <span class="tslider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Compact Table Rows</div>
              <div class="setting-desc">Use tighter row density on management tables.</div>
            </div>
            <label class="toggle">
              <input type="checkbox" class="setting-toggle" data-setting="preferences.compactTableRows">
              <span class="tslider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="settings-side-col">
        <div class="card settings-card" style="margin-bottom:14px;">
          <div class="card-head settings-card-head">
            <div>
              <span class="card-title">Current System Capabilities</span>
              <div class="settings-card-sub">What this version can do right now.</div>
            </div>
          </div>

          <div class="settings-capability-list">
            <div class="settings-capability-item"><span>Menu and Categories Management</span><span class="badge b-green">Supported</span></div>
            <div class="settings-capability-item"><span>Inventory Tracking and Stock Depletion</span><span class="badge b-green">Supported</span></div>
            <div class="settings-capability-item"><span>Staff Scheduling and Account Linking</span><span class="badge b-green">Supported</span></div>
            <div class="settings-capability-item"><span>Account Role, Status, and Deactivation</span><span class="badge b-green">Supported</span></div>
            <div class="settings-capability-item"><span>Offline Order Queue and Sync</span><span class="badge b-green">Supported</span></div>
            <div class="settings-capability-item"><span>Delivery Platform Integrations</span><span class="badge b-orange">Not in this build</span></div>
            <div class="settings-capability-item"><span>Email/SMS Notification Delivery</span><span class="badge b-orange">Not in this build</span></div>
          </div>
        </div>

        <div class="card settings-card">
          <div class="card-head settings-card-head">
            <div>
              <span class="card-title">Maintenance</span>
              <div class="settings-card-sub">Local admin maintenance tools.</div>
            </div>
          </div>

          <div class="setting-row">
            <div>
              <div class="setting-label">Persistence</div>
              <div class="setting-desc">Settings are saved to browser local storage.</div>
            </div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Backend Stack</div>
              <div class="setting-desc">Firebase Auth + Firestore</div>
            </div>
          </div>

          <button id="clearCacheBtn" class="orders-btn ghost settings-block-btn" type="button">Clear App Cache</button>
        </div>
      </div>
    </div>
  `;

  const savedHint = document.getElementById("settingsSavedHint");
  const showSavedHint = (message = "Saved.") => {
    if (!savedHint) return;
    savedHint.textContent = message;
    savedHint.classList.add("saved");
    window.setTimeout(() => savedHint.classList.remove("saved"), 1200);
  };

  const toggleDisplay = document.getElementById("shopInfoDisplay");
  const toggleForm = document.getElementById("shopInfoForm");
  const toggleEditBtn = document.getElementById("toggleShopEdit");
  const shopForm = document.getElementById("shopInfoForm");
  const cancelShopEditBtn = document.getElementById("cancelShopEdit");
  const saveShopInfoBtn = document.getElementById("saveShopInfoBtn");

  const applyShopView = () => {
    document.getElementById("displayShopName").textContent = settings.shop.name;
    document.getElementById("displayLocation").textContent = settings.shop.location;
    document.getElementById("displayHours").textContent = settings.shop.openingHours;
    document.getElementById("displayPhone").textContent = settings.shop.phone;
    document.getElementById("displayCurrency").textContent = settings.shop.currency;

    document.getElementById("inputShopName").value = settings.shop.name;
    document.getElementById("inputLocation").value = settings.shop.location;
    document.getElementById("inputHours").value = settings.shop.openingHours;
    document.getElementById("inputPhone").value = settings.shop.phone;
  };

  const applyToggleState = () => {
    document.querySelectorAll(".setting-toggle").forEach((toggle) => {
      const setting = String(toggle.dataset.setting || "");
      const [section, key] = setting.split(".");
      if (!section || !key) return;
      if (!settings[section]) return;
      toggle.checked = !!settings[section][key];
    });
  };

  const toggleShopEditMode = () => {
    const isEditing = toggleForm.style.display !== "none";
    if (isEditing) {
      toggleForm.style.display = "none";
      toggleDisplay.style.display = "block";
      toggleEditBtn.textContent = "Edit";
      return;
    }

    applyShopView();
    toggleForm.style.display = "block";
    toggleDisplay.style.display = "none";
    toggleEditBtn.textContent = "Cancel";
  };

  applyShopView();
  applyToggleState();

  toggleEditBtn?.addEventListener("click", toggleShopEditMode);
  cancelShopEditBtn?.addEventListener("click", toggleShopEditMode);

  shopForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("inputShopName")?.value?.trim();
    const location = document.getElementById("inputLocation")?.value?.trim();
    const hours = document.getElementById("inputHours")?.value?.trim();
    const phone = document.getElementById("inputPhone")?.value?.trim();

    if (!name || !location || !hours || !phone) {
      await ModalUtils.warning("Validation Error", "All shop information fields are required.");
      return;
    }

    try {
      if (saveShopInfoBtn) {
        saveShopInfoBtn.disabled = true;
        saveShopInfoBtn.textContent = "Saving...";
      }
      settings.shop.name = name;
      settings.shop.location = location;
      settings.shop.openingHours = hours;
      settings.shop.phone = phone;

      await saveAdminSettings(settings);
      applyShopView();
      toggleShopEditMode();
      showSavedHint("Shop information saved.");
      await ModalUtils.success("Settings Updated", "Shop information has been saved successfully.");
    } finally {
      if (saveShopInfoBtn) {
        saveShopInfoBtn.disabled = false;
        saveShopInfoBtn.textContent = "Save Changes";
      }
    }
  });

  document.querySelectorAll(".setting-toggle").forEach((toggle) => {
    toggle.addEventListener("change", async () => {
      const setting = String(toggle.dataset.setting || "");
      const [section, key] = setting.split(".");
      if (!section || !key) return;
      if (!settings[section]) return;

      settings[section][key] = !!toggle.checked;
      await saveAdminSettings(settings);
      showSavedHint("Preference updated.");
    });
  });

  document.getElementById("resetSettingsBtn")?.addEventListener("click", async () => {
    const confirmed = await ModalUtils.confirm(
      "Reset to Defaults",
      "This will restore settings on this page to default values. Continue?"
    );
    if (confirmed !== 1) return;

    const reset = getDefaultSettings();
    Object.keys(settings).forEach((section) => {
      settings[section] = reset[section];
    });

    await saveAdminSettings(settings);
    applyShopView();
    applyToggleState();
    showSavedHint("Defaults restored.");
    await ModalUtils.success("Settings Reset", "All settings were restored to default values.");
  });

  document.getElementById("clearCacheBtn")?.addEventListener("click", async () => {
    const confirmed = await ModalUtils.confirm(
      "Clear App Cache",
      "Clear local cache entries used by this app? This does not delete cloud data."
    );
    if (confirmed !== 1) return;

    try {
      const keys = Object.keys(localStorage);
      keys
        .filter((key) => key.startsWith("bb_") || key.startsWith("bb-") || key.startsWith("brotherBean_") || key.startsWith("brother-bean"))
        .forEach((key) => localStorage.removeItem(key));
      sessionStorage.clear();

      await saveAdminSettings(DEFAULT_SETTINGS);
      await ModalUtils.success("Cache Cleared", "App cache was cleared. Settings were reset to defaults.");
      await loadSettingsPage();
    } catch (error) {
      await ModalUtils.error("Clear Cache Failed", error?.message || "Unable to clear cache.");
    }
  });

  document.getElementById("exportDataBtn")?.addEventListener("click", async () => {
    try {
      const dataStr = JSON.stringify(settings, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `brother-bean-settings-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      await ModalUtils.success("Export Complete", "Settings have been exported successfully.");
    } catch (error) {
      await ModalUtils.error("Export Failed", error?.message || "Unable to export settings.");
    }
  });

  showApp();
}

// Public API expected by admin.html
window.showPage = async function (pageId, navEl, title) {
  if (state.page === pageId) return;
  state.page = pageId;
  setActiveNav(navEl);
  setTopbarTitle(title || "Admin");
  showPage(pageId);
  try {
    if (pageId === "dashboard" || pageId === "salesAnalytics") await loadDashboard();
    if (pageId === "orders") await loadOrdersPage();
    if (pageId === "menu") await loadMenuPage();
    if (pageId === "inventory") await loadInventoryPage();
    if (pageId === "staff") await loadStaffPage();
    if (pageId === "accounts") await loadAccountsPage();
    if (pageId === "logs") await loadLogsPage();
    if (pageId === "categories") await loadCategoriesPage();
    if (pageId === "settings") await loadSettingsPage();
  } finally {
    showApp();
  }
};

window.refreshOrders = async function () {
  await loadOrdersPage();
};

window.refreshInventory = async function () {
  await loadInventoryPage();
};

window.clearAllInventory = async function () {
  const hasExisting = Array.isArray(state.inventoryItems) && state.inventoryItems.length > 0;
  if (!hasExisting) {
    await ModalUtils.warning("Nothing to Clear", "Inventory is already empty.");
    return;
  }
  
  const confirmed = await ModalUtils.confirm(
    "Clear All Inventory",
    "This will permanently delete every item in your inventory database. This cannot be undone."
  );
  if (confirmed !== 1) return;

  try {
    const result = await clearInventoryItems();
    await ModalUtils.success("Inventory Cleared", `Deleted ${result.count || 0} inventory item(s).`);
    await loadInventoryPage();
  } catch (error) {
    await ModalUtils.error("Clear Failed", error?.message || "Unable to clear inventory.");
  }
};

window.seedInventory = async function () {
  const hasExisting = Array.isArray(state.inventoryItems) && state.inventoryItems.length > 0;
  const title = hasExisting ? "Seed Inventory" : "Seed Inventory";
  const message = hasExisting
    ? "Inventory already has items. Seeding will update/insert sample items. Continue?"
    : "Seed sample inventory items?";
  const confirmed = await ModalUtils.confirm(title, message);
  if (confirmed !== 1) return;

  for (const item of inventorySeedItems) {
    await saveInventoryItem(item);
  }

  await loadInventoryPage();
  await ModalUtils.success("Inventory Seeded", "Sample inventory items are ready.");
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
  const form = document.getElementById("addStaffForm");
  if (form) form.style.display = "block";
  const input = document.getElementById("newStaffName");
  if (input) input.focus();
};

window.hideAddStaff = function () {
  const form = document.getElementById("addStaffForm");
  if (form) form.style.display = "none";
};

window.saveSchedule = async function () {
  const { sched, invalid } = validateScheduleBeforeSave();
  if (invalid.length > 0) {
    const first = invalid[0];
    await ModalUtils.warning(
      "Invalid Shift Format",
      `Please fix ${invalid.length} invalid shift entr${invalid.length > 1 ? "ies" : "y"}. Example issue: ${escapeHtml(first.day)} has an invalid value.`
    );
    return;
  }

  await saveSchedule(sched);
  const summary = summarizeSchedulePayload(sched);
  await loadStaffPage();
  await ModalUtils.show({
    type: "success",
    title: "Schedule Saved",
    html: true,
    message: `
      <div style="display:grid;gap:8px;">
        <div>Weekly schedule has been updated successfully.</div>
        <div style="display:grid;gap:4px;padding:10px;border:1px solid rgba(16,185,129,0.25);border-radius:10px;background:rgba(16,185,129,0.08);font-size:13px;">
          <div><strong>${summary.onDutySlots}</strong> on-duty slot${summary.onDutySlots === 1 ? "" : "s"} saved</div>
          <div><strong>${summary.withAnyDuty}</strong> team member${summary.withAnyDuty === 1 ? "" : "s"} assigned this week</div>
        </div>
      </div>
    `,
    buttons: [{ text: "Done", type: "primary success" }],
  });
};

window.resetDay = async function () {
  const confirmed = await ModalUtils.confirm("Archive Transactions", "Archive and clear all of today's transactions? This action cannot be undone.");
  if (confirmed !== 1) return;
  
  const result = await archiveResetDay();
  if (!result.success) {
    await ModalUtils.warning("Reset Failed", result.reason || "Nothing to reset.");
    return;
  }
  const autoNote = Number(result.autoCompleted) > 0
    ? ` ${result.autoCompleted} pending order${Number(result.autoCompleted) === 1 ? "" : "s"} were auto-marked as done.`
    : "";
  await ModalUtils.success("Transactions Archived", `Archived ${result.totalArchived} transactions for ${result.date}.${autoNote}`);
  await loadDashboard();
};

window.openLogoutModal = function () {
  const modal = document.getElementById("logoutConfirmModal");
  if (!modal) return;
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  const cancelButton = modal.querySelector(".modal-custom-btn.secondary");
  if (cancelButton && typeof cancelButton.focus === "function") {
    window.setTimeout(() => cancelButton.focus(), 0);
  }
};

window.closeLogoutModal = function () {
  const modal = document.getElementById("logoutConfirmModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  const trigger = document.querySelector(".topbar-logout");
  if (trigger && typeof trigger.focus === "function") {
    trigger.focus();
  }
};

window.logout = function () {
  window.openLogoutModal();
};

window.confirmLogout = async function () {
  const modal = document.getElementById("logoutConfirmModal");
  const signOutBtn = modal?.querySelector(".modal-custom-btn.primary.error");
  setButtonLoadingState(signOutBtn, true, "Signing out...");
  try {
    await withTimeout(authLogout(), AUTH_OPERATION_TIMEOUT_MS, "logout");
    navigateTo("login", { replace: true });
  } catch (error) {
    console.error("[Auth] Logout failed:", error);
    await ModalUtils.error(
      "Logout Failed",
      error?.message === "logout_timeout" ? "Logout is taking too long. Please try again." : error?.message || "Unable to sign out right now."
    );
  } finally {
    setButtonLoadingState(signOutBtn, false);
    window.closeLogoutModal();
  }
};

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const modal = document.getElementById("logoutConfirmModal");
  const inventoryModal = document.getElementById("inventoryEditModal");
  if (inventoryModal && inventoryModal.style.display !== "none") {
    window.closeInventoryEditModal();
    return;
  }
  if (!modal || modal.style.display === "none") return;
  window.closeLogoutModal();
});

document.addEventListener("DOMContentLoaded", async () => {
  setupTopbarDate();
  loadNotifState();
  await loadNotifStateFromFirestore();
  setupTopbarActions();
  setupSidebarToggle();
  startDashboardAutoSync();

  let authSettled = false;
  let nullUserTimerId = null;
  const authTimeoutMs = 5000;
  const authTimeoutId = window.setTimeout(() => {
    if (authSettled) return;
    const fallbackUser = getCurrentUser();
    if (fallbackUser) {
      authSettled = true;
      console.warn("[Auth] Session check timed out, but authenticated user is available. Opening admin shell.");
      showApp();
      return;
    }
    console.warn("[Auth] Session check timed out; waiting for page-level fallback UI.");
  }, authTimeoutMs);

  watchAuth(async (user) => {
    try {
      if (!window.__bbAuthSettled) {
        window.__bbAuthSettled = true;
      }
      if (user) {
        authSettled = true;
        window.clearTimeout(authTimeoutId);
        if (nullUserTimerId) {
          window.clearTimeout(nullUserTimerId);
          nullUserTimerId = null;
        }
      }

      const activeUser = user || getCurrentUser();
      if (!activeUser) {
        // Firebase can briefly emit null before restoring persisted auth; wait before redirecting.
        if (nullUserTimerId) return;
        nullUserTimerId = window.setTimeout(() => {
          nullUserTimerId = null;
          const latestUser = getCurrentUser();
          if (latestUser) return;
          authSettled = true;
          window.clearTimeout(authTimeoutId);
          showLogin();
        }, 1000);
        return;
      }

      let profile = null;
      let role = null;

      try {
        profile = await withTimeout(getUserProfile(activeUser.uid), AUTH_OPERATION_TIMEOUT_MS, "getUserProfile");
      } catch (profileError) {
        console.warn("[Auth] Unable to read user profile; continuing with role fallback.", profileError);
      }

      if (String(profile?.status || "active").toLowerCase() === "suspended") {
        await authLogout();
        if (typeof ModalUtils !== "undefined" && ModalUtils.error) {
          await ModalUtils.error("Account Suspended", "Your account is suspended. Please contact an administrator.");
        }
        showLogin();
        return;
      }

      try {
        role = await withTimeout(getUserRole(activeUser.uid), AUTH_OPERATION_TIMEOUT_MS, "getUserRole");
      } catch (roleError) {
        console.warn("[Auth] Unable to read user role; defaulting to admin access path.", roleError);
      }

      if (!role) {
        try {
          await withTimeout(ensureAdminAccessProfile(activeUser.uid, {
            fullName: profile?.fullName || activeUser.displayName || activeUser.email || "Admin",
            displayName: profile?.displayName || activeUser.displayName || activeUser.email || "Admin",
            email: activeUser.email || profile?.email || "",
            status: profile?.status || "active",
            isDefaultAdmin: profile?.isDefaultAdmin === true,
          }), AUTH_OPERATION_TIMEOUT_MS, "ensureAdminAccessProfile");
          role = "admin";
        } catch (seedError) {
          console.warn("[Auth] Unable to backfill admin profile; continuing with admin UI fallback.", seedError);
        }
      }

      if (role && role !== "admin") {
        navigateTo("pos", { replace: true });
        return;
      }

      // If role is missing or admin, allow viewing admin portal UI.
      // Admin role enforcement is handled by Firestore security rules + role doc.
      showApp();
      try {
        await window.showPage("dashboard", document.querySelector('.nav-item[onclick*="dashboard"]'), "Dashboard");
      } catch (pageError) {
        console.error("[Admin] Page initialization failed:", pageError);
        const loading = document.getElementById("auth-loading");
        if (loading) loading.style.display = "none";
      }

      // Auto-record any previous-day pending orders staff forgot to mark done,
      // right on login — even if the transactions page is never opened. Runs
      // after the dashboard (and its queued-order sync), best-effort and
      // idempotent; it also runs again when the transactions tab is opened.
      await autoCompleteStalePendingOrders();
      // Then roll previous-day orders into the resets archive automatically,
      // so no one has to press "Archive Transactions" each morning.
      await autoArchivePreviousDayOrders();

      // Pre-load inventory in background so nav badge shows count immediately
      getInventoryItems().then((items) => {
        state.inventoryItems = items;
        state.lastInventorySyncMs = Date.now();
        const navBadge = document.getElementById("inventoryNavBadge");
        if (navBadge) navBadge.textContent = String(items.length);
      }).catch(() => {});

      initParallaxEffects();

      // Thermal printer (reprint receipts). The status row also shows the
      // "unsupported" state in non-Chrome browsers. Reconnect is a safe no-op
      // when Web Bluetooth is unavailable or no printer was paired before.
      renderAdminPrinterStatus();
      onPrinterStatus(renderAdminPrinterStatus);
      if (isPrinterSupported()) {
        reconnectThermalPrinter().catch(() => {});
      }
    } catch (error) {
      console.error("[Auth] watchAuth error:", error);
      authSettled = true;
      window.clearTimeout(authTimeoutId);
      // Keep user on admin UI if already authenticated; avoid redirect loops on transient failures.
      showApp();
    }
  });
});

/* ── Parallax scroll effects ── */
const _pxAnimatedPages = new Set();
function initParallaxEffects() {
  const mainEl = document.querySelector(".main");
  if (!mainEl) return;

  /* — Scroll progress bar — */
  const progressBar = document.getElementById("px-scroll-progress");

  /* — IntersectionObserver for fade-in on scroll — */
  const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("px-visible");
        fadeObserver.unobserve(entry.target);
      }
    });
  }, { root: mainEl, threshold: 0.1 });

  function observeFadeTargets(skipAnimation = false) {
    const currentPage = state.page || "dashboard";
    const selectors = ".stat-card, .card.compact-card, .staff-kpi-card, .menu-card, .settings-card, .accounts-directory-card, .orders-kpi-card";
    const newEls = [];
    mainEl.querySelectorAll(selectors).forEach((el) => {
      if (el.classList.contains("px-fade-in")) return;
      el.classList.add("px-fade-in");
      // Stagger delay based on sibling index
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.classList.contains("px-fade-in"));
        const idx = siblings.indexOf(el);
        if (idx >= 0 && idx <= 5) el.classList.add(`px-delay-${idx + 1}`);
      }
      // Skip animation on re-renders of already-visited pages
      if (_pxAnimatedPages.has(currentPage)) {
        el.classList.add("px-visible");
        return;
      }
      newEls.push(el);
    });
    // Only mark page as animated after elements are actually found
    if (newEls.length) {
      _pxAnimatedPages.add(currentPage);
      if (skipAnimation) {
        // Initial page load: reveal content immediately instead of fading in,
        // otherwise the dashboard flashes invisible then fades in after reload.
        newEls.forEach((el) => el.classList.add("px-visible"));
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          newEls.forEach((el) => fadeObserver.observe(el));
        });
      });
    }
  }

  observeFadeTargets(true);
  const pageObserver = new MutationObserver(() => { observeFadeTargets(); });
  mainEl.querySelectorAll(".page").forEach((p) => {
    pageObserver.observe(p, { childList: true, subtree: true });
  });

  /* — Scroll handler: topbar shadow + progress bar — */
  const topbar = document.querySelector(".topbar");
  let ticking = false;
  mainEl.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const scrollY = mainEl.scrollTop;
      const scrollH = mainEl.scrollHeight - mainEl.clientHeight;
      const pct = scrollH > 0 ? Math.min((scrollY / scrollH) * 100, 100) : 0;
      progressBar.style.width = `${pct}%`;

      if (topbar) {
        if (scrollY > 8) {
          topbar.classList.add("px-scrolled");
        } else {
          topbar.classList.remove("px-scrolled");
        }
      }
      ticking = false;
    });
  });

  /* — Window scroll handler for mobile (natural page scroll) — */
  let mobileTicking = false;
  window.addEventListener("scroll", () => {
    if (window.innerWidth > 992) return;
    if (mobileTicking) return;
    mobileTicking = true;
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const scrollY = window.scrollY;
      const scrollH = doc.scrollHeight - window.innerHeight;
      const pct = scrollH > 0 ? Math.min((scrollY / scrollH) * 100, 100) : 0;
      progressBar.style.width = `${pct}%`;
      mobileTicking = false;
    });
  });

  /* — Stat card tilt on mousemove — */
  mainEl.addEventListener("mousemove", (e) => {
    const card = e.target.closest(".stat-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const midX = rect.width / 2;
    const midY = rect.height / 2;
    const rotateY = ((x - midX) / midX) * 5;
    const rotateX = ((midY - y) / midY) * 5;
    card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
  });
  mainEl.addEventListener("mouseleave", (e) => {
    const card = e.target.closest(".stat-card");
    if (card) card.style.transform = "";
  }, true);
  // Reset tilt when mouse leaves a stat card
  mainEl.querySelectorAll(".stat-card").forEach((card) => {
    card.addEventListener("mouseleave", () => { card.style.transform = ""; });
  });
}

function openMenuEditor(itemId, preset = {}) {
  // Render the menu editor inside a modal overlay appended to body.
  // Keep `menuEditorSlot` for legacy fallback, but prefer modal so editing is modal-based.
  const slot = document.getElementById("menuEditorSlot");

  const existing = state.menuItems.find(i => i.id === itemId);
  const isNew = !existing;
  const nextId = Math.max(0, ...state.menuItems.map(i => Number(i.id) || 0)) + 1;
  const presetItem = preset && typeof preset === "object" ? preset : {};
  const item = existing
    ? { ...presetItem, ...existing }
    : {
        id: presetItem.id || nextId,
        name: String(presetItem.name || ""),
        price: Number(presetItem.price || 0),
        category: String(presetItem.category || ""),
        hasVariant: !!presetItem.hasVariant,
        hasTemp: !!presetItem.hasTemp,
        popular: !!presetItem.popular,
        bestseller: !!presetItem.bestseller,
        note: String(presetItem.note || ""),
        variants: Array.isArray(presetItem.variants) ? presetItem.variants.map((variant) => ({ ...variant })) : [],
        addons: Array.isArray(presetItem.addons) ? presetItem.addons.map((addon) => ({ ...addon })) : [],
        recipe: Array.isArray(presetItem.recipe) ? presetItem.recipe.map((ingredient) => ({ ...ingredient })) : [],
      };

  const initialVariants = Array.isArray(item.variants) && item.variants.length
    ? item.variants
    : [{ name: "", price: Number(item.price) || 0 }];

  const initialAddons = Array.isArray(item.addons)
    ? item.addons
        .map((addon, index) => ({
          id: String(addon?.id || `addon-${item.id || "item"}-${index}`),
          name: String(addon?.name || "").trim(),
          price: Number(addon?.price || 0),
          recipe: Array.isArray(addon?.recipe) ? addon.recipe.map((ingredient) => ({ ...ingredient })) : [],
        }))
        .filter((addon) => addon.name || addon.recipe.length > 0)
    : [];

  const categorySuggestionMap = new Map();
  const addCategorySuggestion = (value) => {
    const name = String(value || "").trim();
    if (!name) return;
    const key = normalizeCategoryToken(name);
    if (!key || categorySuggestionMap.has(key)) return;
    categorySuggestionMap.set(key, name);
  };

  if (Array.isArray(state.categories)) {
    state.categories.forEach((category) => addCategorySuggestion(category?.name));
  }
  if (Array.isArray(state.menuItems)) {
    state.menuItems.forEach((menuItem) => addCategorySuggestion(menuItem?.category));
  }
  addCategorySuggestion("Coffee");
  addCategorySuggestion("Add-ons");

  const categorySuggestions = Array.from(categorySuggestionMap.values()).sort((a, b) => a.localeCompare(b));

  const normalizedCurrentCategory = String(item.category || "").trim();
  const hasCurrentCategoryOption = categorySuggestions.some(
    (name) => String(name || "").trim().toLowerCase() === normalizedCurrentCategory.toLowerCase()
  );
  const categoryOptionsHtml = categorySuggestions
    .map((value) => {
      const normalizedValue = String(value || "").trim();
      if (!normalizedValue) return "";
      const isSelected = normalizedValue.toLowerCase() === normalizedCurrentCategory.toLowerCase();
      return `<option value="${escapeHtml(normalizedValue)}"${isSelected ? " selected" : ""}>${escapeHtml(normalizedValue)}</option>`;
    })
    .join("");
  const currentCategoryOptionHtml = !hasCurrentCategoryOption && normalizedCurrentCategory
    ? `<option value="${escapeHtml(normalizedCurrentCategory)}" selected>${escapeHtml(normalizedCurrentCategory)}</option>`
    : "";

  // Create or reuse modal container
  let modal = document.getElementById("menuEditModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "menuEditModal";
    modal.className = "admin-menu-edit-modal";
    modal.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:1200;padding:20px;background:rgba(0,0,0,0.45);";
    const inner = document.createElement("div");
    inner.className = "menu-editor-modal-inner";
    inner.style.cssText = "width:100%;max-width:1100px;max-height:90vh;overflow:auto;";
    modal.appendChild(inner);
    document.body.appendChild(modal);
    // close when clicking outside content
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
    // close on Escape
    document.addEventListener("keydown", function __menuEditEsc(e) {
      if (e.key === "Escape") {
        const m = document.getElementById("menuEditModal");
        if (m) m.remove();
        document.removeEventListener("keydown", __menuEditEsc);
      }
    });
  }

  const host = modal.querySelector(".menu-editor-modal-inner");
  host.innerHTML = `
    <div class="card mm-menu-editor" style="margin:14px 0;border:1px solid rgba(107,68,35,0.12);border-radius:18px;box-shadow:0 12px 34px rgba(30,20,12,0.08);overflow:hidden;background:linear-gradient(180deg,#ffffff 0%,#fdfaf6 100%);">
      <div class="card-head" style="padding:14px 16px;border-bottom:1px solid rgba(107,68,35,0.12);background:linear-gradient(135deg,rgba(107,68,35,0.08) 0%,rgba(221,184,146,0.16) 100%);">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <span class="card-title" style="font-size:15px;letter-spacing:0.04em;text-transform:uppercase;color:#5f3c1f;">${isNew ? (presetItem.id ? "Customize menu item" : "Add menu item") : "Edit menu item"}</span>
          <span style="font-size:12px;color:#7b6652;">Set details, recipe, and pricing before saving.</span>
        </div>
      </div>
      <div class="mm-menu-editor-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:14px;">
        <div ${isNew && !presetItem.id ? 'style="display:none;"' : 'style="grid-column:1/-1;"'}>
          <div class="ls-label">ID</div>
          <input class="ls-input" id="mm_id" value="${isNew && !presetItem.id ? 'Auto-generated' : item.id}" readonly style="margin-bottom:0;">
        </div>
        <div>
          <div class="ls-label">Name</div>
          <input class="ls-input" id="mm_name" value="${(item.name || "").replaceAll('"', "&quot;")}" style="margin-bottom:0;" aria-label="Menu item name">
          <div id="mm_name_error" class="mm-field-error" aria-live="polite"></div>
        </div>
        <div>
          <div class="ls-label">Price</div>
          <input class="ls-input" id="mm_price" type="number" step="0.25" min="0" value="${Number(item.price) || 0}" style="margin-bottom:0;" aria-label="Menu item price">
          <div id="mm_price_error" class="mm-field-error" aria-live="polite"></div>
        </div>
        <div>
          <div class="ls-label">Category</div>
          <select class="ls-input" id="mm_category" style="margin-bottom:0;" aria-label="Menu item category">
            <option value="">Select category</option>
            ${currentCategoryOptionHtml}
            ${categoryOptionsHtml}
          </select>
          <div id="mm_category_error" class="mm-field-error" aria-live="polite"></div>
        </div>
        <div style="grid-column:1/-1;">
          <div class="ls-label">Note (optional)</div>
          <input class="ls-input" id="mm_note" value="${(item.note || "").replaceAll('"', "&quot;")}" style="margin-bottom:0;">
        </div>
        <div style="display:flex;gap:12px;align-items:center;background:rgba(107,68,35,0.06);border:1px solid rgba(107,68,35,0.14);padding:8px 10px;border-radius:12px;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;cursor:pointer;">
            <input type="checkbox" id="mm_hasTemp" ${item.hasTemp ? "checked" : ""}> Has temperature
          </label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;background:rgba(107,68,35,0.06);border:1px solid rgba(107,68,35,0.14);padding:8px 10px;border-radius:12px;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;cursor:pointer;">
            <input type="checkbox" id="mm_hasVariant" ${item.hasVariant ? "checked" : ""}> Has variants
          </label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;background:rgba(107,68,35,0.06);border:1px solid rgba(107,68,35,0.14);padding:8px 10px;border-radius:12px;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;cursor:pointer;">
            <input type="checkbox" id="mm_popular" ${item.popular ? "checked" : ""}> Popular
          </label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;background:rgba(107,68,35,0.06);border:1px solid rgba(107,68,35,0.14);padding:8px 10px;border-radius:12px;">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-secondary);font-weight:600;cursor:pointer;">
            <input type="checkbox" id="mm_bestseller" ${item.bestseller ? "checked" : ""}> Bestseller
          </label>
        </div>

        <!-- Recipe Section -->
        <div id="mm_recipeSection" style="grid-column:1/-1;border-top:1px solid var(--border-color);padding-top:12px;margin-top:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <div class="ls-label" style="margin:0;">Recipe / Ingredients</div>
            <button type="button" id="mm_addRecipeIngredient" style="background:transparent;border:1px solid var(--border-color);padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">+ Add Ingredient</button>
          </div>
          <div id="mm_recipeRows" style="display:grid;gap:8px;"></div>
          <div id="mm_recipeWarnings" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.28);color:#991B1B;font-size:12px;" aria-live="polite"></div>
          <div style="display:flex;justify-content:space-between;margin-top:12px;padding:8px;background:rgba(0,0,0,0.02);border-radius:8px;">
            <div style="font-size:13px;color:var(--text-secondary);font-weight:600;">Calculated Base Cost:</div>
            <div id="mm_basePriceDisplay" style="font-size:14px;font-weight:bold;color:var(--text-main);" aria-live="polite">₱0.00</div>
          </div>
        </div>

        <!-- Add-ons Section -->
        <div id="mm_addonsSection" style="grid-column:1/-1;border-top:1px solid var(--border-color);padding-top:12px;margin-top:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <div class="ls-label" style="margin:0;">Add-ons (Optional)</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button type="button" id="mm_editCategoryAddons" style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);color:#047857;padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Edit category add-ons</button>
              <button type="button" id="mm_addAddon" style="background:transparent;border:1px solid var(--border-color);padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">+ Add Add-on</button>
            </div>
          </div>
          <div id="mm_addonsRows" style="display:grid;gap:8px;"></div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Tip: Category add-ons (if configured) are applied to all items in that category on POS.</div>
        </div>

        <!-- Variants Section -->
        <div id="mm_variantsSection" style="grid-column:1/-1;border-top:1px solid var(--border-color);padding-top:12px;margin-top:4px;${item.hasVariant ? "" : "display:none;"}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <div class="ls-label" style="margin:0;">Variants</div>
            <button type="button" id="mm_addVariant" style="background:transparent;border:1px solid var(--border-color);padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">+ Add variant</button>
          </div>
          <div id="mm_variantsRows" style="display:grid;gap:8px;"></div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Add each size/option as a row (example: Small - 120, Large - 150)</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;padding:14px;justify-content:flex-end;border-top:1px solid rgba(107,68,35,0.12);background:rgba(255,252,248,0.95);">
        <div id="mm_formHint" class="mm-form-hint" aria-live="polite"></div>
        <button id="mm_cancel" type="button" style="background:white;border:1px solid rgba(107,68,35,0.24);padding:10px 16px;border-radius:12px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5f3c1f;font-weight:600;">Cancel</button>
        <button id="mm_save" type="button" style="background:linear-gradient(135deg,#7c4e28 0%,#5f3c1f 100%);color:white;border:none;padding:10px 18px;border-radius:12px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:700;box-shadow:0 8px 18px rgba(95,60,31,0.25);" aria-label="Save menu item">Save</button>
      </div>
    </div>
  `;

  const nameInput = document.getElementById("mm_name");
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }

  const hasVariantInput = document.getElementById("mm_hasVariant");
  const variantsSection = document.getElementById("mm_variantsSection");
  const variantsRows = document.getElementById("mm_variantsRows");
  const addVariantBtn = document.getElementById("mm_addVariant");
  const addonsRows = document.getElementById("mm_addonsRows");
  const addAddonBtn = document.getElementById("mm_addAddon");
  const editCategoryAddonsBtn = document.getElementById("mm_editCategoryAddons");
  const nameField = document.getElementById("mm_name");
  const priceField = document.getElementById("mm_price");
  const categoryField = document.getElementById("mm_category");
  const saveBtn = document.getElementById("mm_save");
  const formHint = document.getElementById("mm_formHint");
  const inventorySelectOptionsHtml = state.inventoryItems
    .map((inv) => `<option value="${escapeHtml(inv.id)}" data-unit="${escapeHtml(inv.unit)}">${escapeHtml(inv.name)} (${escapeHtml(inv.unit)})</option>`)
    .join("");

  function appendVariantRow(variant = { name: "", price: 0 }) {
    if (!variantsRows) return;
    const row = document.createElement("div");
    row.className = "mm-variant-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1.5fr 1fr auto";
    row.style.gap = "8px";
    row.innerHTML = `
      <input class="ls-input mm-variant-name" placeholder="Variant name (e.g. Small)" value="${String(variant.name || "").replaceAll('"', '&quot;')}" style="margin-bottom:0;" />
      <input class="ls-input mm-variant-price" type="number" step="0.25" min="0" placeholder="Price" value="${Number(variant.price) || 0}" style="margin-bottom:0;" />
      <button type="button" class="mm-remove-variant" style="background:transparent;border:1px solid var(--border-color);padding:8px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Remove</button>
    `;
    variantsRows.appendChild(row);
  }

  if (variantsRows) {
    initialVariants.forEach((variant) => appendVariantRow(variant));
    variantsRows.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".mm-remove-variant");
      if (!removeBtn) return;
      const row = removeBtn.closest(".mm-variant-row");
      if (!row) return;
      row.remove();
    });
  }

  addVariantBtn?.addEventListener("click", () => appendVariantRow());

  function appendAddonRow(addon = { id: "", name: "", price: 0, recipe: [] }, options = {}) {
    if (!addonsRows) return;
    const shouldFocus = !!options.focus;
    const addonRecipe = Array.isArray(addon.recipe) && addon.recipe.length ? addon.recipe[0] : {};
    const selectedInventoryId = String(addonRecipe.inventoryId || "").trim();
    const selectedUnit = normalizeUnit(addonRecipe.unit || "") || "";
    const selectedQty = Number(addonRecipe.quantity || 0);
    const row = document.createElement("div");
    row.className = "mm-addon-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1.6fr 0.9fr 0.8fr 0.9fr auto auto";
    row.style.gap = "8px";
    row.innerHTML = `
      <select class="ls-input mm-addon-inv" style="margin-bottom:0;">
        <option value="" ${!selectedInventoryId ? "selected" : ""}>Select add-on ingredient...</option>
        ${inventorySelectOptionsHtml}
      </select>
      <input class="ls-input mm-addon-price" type="number" step="0.25" min="0" placeholder="Extra price" value="${Number(addon.price) || 0}" style="margin-bottom:0;" />
      <input class="ls-input mm-addon-qty" type="number" step="0.01" min="0" placeholder="Qty" value="${Number.isFinite(selectedQty) && selectedQty > 0 ? selectedQty : ''}" style="margin-bottom:0;" />
      <select class="ls-input mm-addon-unit" style="margin-bottom:0;">
        <option value="" ${!selectedUnit ? "selected" : ""}>Unit</option>
        <option value="g" ${selectedUnit === "g" ? "selected" : ""}>g</option>
        <option value="kg" ${selectedUnit === "kg" ? "selected" : ""}>kg</option>
        <option value="oz" ${selectedUnit === "oz" ? "selected" : ""}>oz</option>
        <option value="lb" ${selectedUnit === "lb" ? "selected" : ""}>lb</option>
        <option value="ml" ${selectedUnit === "ml" ? "selected" : ""}>ml</option>
        <option value="L" ${selectedUnit === "L" ? "selected" : ""}>L</option>
        <option value="fl oz" ${selectedUnit === "fl oz" ? "selected" : ""}>fl oz</option>
        <option value="gal" ${selectedUnit === "gal" ? "selected" : ""}>gal</option>
        <option value="pcs" ${selectedUnit === "pcs" ? "selected" : ""}>pcs</option>
        <option value="pack" ${selectedUnit === "pack" ? "selected" : ""}>pack</option>
        <option value="box" ${selectedUnit === "box" ? "selected" : ""}>box</option>
        <option value="tray" ${selectedUnit === "tray" ? "selected" : ""}>tray</option>
        <option value="bottle" ${selectedUnit === "bottle" ? "selected" : ""}>bottle</option>
        <option value="can" ${selectedUnit === "can" ? "selected" : ""}>can</option>
        <option value="jar" ${selectedUnit === "jar" ? "selected" : ""}>jar</option>
        <option value="sachet" ${selectedUnit === "sachet" ? "selected" : ""}>sachet</option>
        <option value="shot" ${selectedUnit === "shot" ? "selected" : ""}>shot</option>
        <option value="cup" ${selectedUnit === "cup" ? "selected" : ""}>cup</option>
        <option value="serving" ${selectedUnit === "serving" ? "selected" : ""}>serving</option>
        <option value="portion" ${selectedUnit === "portion" ? "selected" : ""}>portion</option>
        <option value="slice" ${selectedUnit === "slice" ? "selected" : ""}>slice</option>
        <option value="set" ${selectedUnit === "set" ? "selected" : ""}>set</option>
      </select>
      <button type="button" class="mm-duplicate-addon" style="background:transparent;border:1px solid var(--border-color);padding:8px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Copy</button>
      <button type="button" class="mm-remove-addon" style="background:transparent;border:1px solid var(--border-color);padding:8px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Remove</button>
      <div class="mm-addon-name-display" style="grid-column:1/-1;font-size:11px;color:var(--text-muted);margin-top:-2px;">Add-on name: ${escapeHtml(String(addon.name || "-") || "-")}</div>
    `;

    const invSelect = row.querySelector(".mm-addon-inv");
    const unitEl = row.querySelector(".mm-addon-unit");
    const qtyEl = row.querySelector(".mm-addon-qty");
    const nameDisplay = row.querySelector(".mm-addon-name-display");

    const updateAddonNameDisplay = () => {
      if (!nameDisplay) return;
      const selectedOption = invSelect?.options?.[invSelect.selectedIndex];
      const selectedLabel = String(selectedOption?.textContent || "").trim();
      const derivedName = selectedLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
      nameDisplay.textContent = `Add-on name: ${derivedName || "-"}`;
    };

    invSelect?.addEventListener("change", () => {
      const selectedOption = invSelect.options[invSelect.selectedIndex];
      const invUnit = normalizeUnit(selectedOption?.dataset?.unit || "") || "";
      if (unitEl && !unitEl.value && invUnit) {
        unitEl.value = invUnit;
      }
      if (qtyEl && !qtyEl.value) {
        qtyEl.value = "1";
      }
      updateAddonNameDisplay();
    });

    if (selectedInventoryId) {
      invSelect.value = selectedInventoryId;
      updateAddonNameDisplay();
    }

    addonsRows.appendChild(row);
    if (shouldFocus) {
      row.querySelector(".mm-addon-inv")?.focus();
    }
  }

  if (addonsRows) {
    initialAddons.forEach((addon) => appendAddonRow(addon));
    addonsRows.addEventListener("click", (event) => {
      const duplicateBtn = event.target.closest(".mm-duplicate-addon");
      if (duplicateBtn) {
        const row = duplicateBtn.closest(".mm-addon-row");
        if (!row) return;
        const clone = {
          price: Number(row.querySelector(".mm-addon-price")?.value || 0),
          recipe: [],
        };
        const invId = String(row.querySelector(".mm-addon-inv")?.value || "").trim();
        const qty = Number(row.querySelector(".mm-addon-qty")?.value || 0);
        const unit = String(row.querySelector(".mm-addon-unit")?.value || "").trim();
        if (invId && Number.isFinite(qty) && qty > 0) {
          clone.recipe = [{ inventoryId: invId, quantity: qty, unit }];
        }
        appendAddonRow(clone, { focus: true });
        return;
      }

      const removeBtn = event.target.closest(".mm-remove-addon");
      if (!removeBtn) return;
      const row = removeBtn.closest(".mm-addon-row");
      if (!row) return;
      row.remove();
    });
  }

  addAddonBtn?.addEventListener("click", () => appendAddonRow({ price: 0 }, { focus: true }));

  const updateCategoryAddonButtonState = () => {
    if (!editCategoryAddonsBtn) return;
    const categoryValue = String(categoryField?.value || "").trim();
    const category = getCategoryByToken(categoryValue);
    editCategoryAddonsBtn.disabled = !category;
    editCategoryAddonsBtn.style.opacity = category ? "1" : "0.55";
    editCategoryAddonsBtn.title = category
      ? `Edit shared add-ons for ${category.name}`
      : "Select an existing category first";
  };

  editCategoryAddonsBtn?.addEventListener("click", async () => {
    const categoryValue = String(categoryField?.value || "").trim();
    const category = getCategoryByToken(categoryValue);
    if (!category) {
      await ModalUtils.warning("Select Category", "Choose an existing category first to edit shared add-ons.");
      return;
    }
    await window._adminEditCategoryAddons(category.id);
  });
  categoryField?.addEventListener("change", updateCategoryAddonButtonState);
  categoryField?.addEventListener("input", updateCategoryAddonButtonState);
  updateCategoryAddonButtonState();

  const syncVariantVisibility = () => {
    if (!variantsSection || !hasVariantInput) return;
    variantsSection.style.display = hasVariantInput.checked ? "block" : "none";
    if (hasVariantInput.checked && variantsRows && variantsRows.children.length === 0) {
      appendVariantRow({ name: "", price: Number(document.getElementById("mm_price")?.value) || 0 });
    }
  };

  hasVariantInput?.addEventListener("change", syncVariantVisibility);
  syncVariantVisibility();

  // Recipe logic
  const addRecipeBtn = document.getElementById("mm_addRecipeIngredient");
  const recipeRows = document.getElementById("mm_recipeRows");
  const basePriceDisplay = document.getElementById("mm_basePriceDisplay");
  const recipeWarnings = document.getElementById("mm_recipeWarnings");
  
  const recipeUnitOptionsHtml = [
    ["g", "g - grams"],
    ["kg", "kg - kilograms"],
    ["oz", "oz - ounces"],
    ["lb", "lb - pounds"],
    ["ml", "ml - milliliters"],
    ["L", "L - liters"],
    ["fl oz", "fl oz - fluid ounces"],
    ["gal", "gal - gallons"],
    ["pcs", "pcs - pieces"],
    ["pack", "pack - package"],
    ["box", "box - boxed item"],
    ["tray", "tray - tray unit"],
    ["bottle", "bottle - bottled item"],
    ["can", "can - canned item"],
    ["jar", "jar - jar unit"],
    ["sachet", "sachet - packet"],
    ["shot", "shot - espresso shot"],
    ["cup", "cup - cup serving"],
    ["serving", "serving - serving size"],
    ["portion", "portion - portion size"],
    ["slice", "slice - sliced serving"],
    ["set", "set - grouped set"],
  ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");

  const calculateBasePrice = () => {
    let base = 0;
    const incompatibleRows = [];
    const rows = recipeRows?.querySelectorAll(".mm-recipe-row") || [];
    rows.forEach((r, rowIndex) => {
       const invSelect = r.querySelector(".mm-recipe-inv");
       const selectedOption = invSelect?.options?.[invSelect.selectedIndex];
       const invId = invSelect?.value;
       const qty = Number(r.querySelector(".mm-recipe-qty")?.value) || 0;
       const recipeUnit = r.querySelector(".mm-recipe-unit")?.value || "";
       const invItem = state.inventoryItems.find(i => i.id === invId);
       r.style.boxShadow = "none";

       if (invItem && qty > 0) {
           const fromUnit = normalizeUnit(recipeUnit || invItem.unit) || String(recipeUnit || invItem.unit || "").trim();
           const toUnit = normalizeUnit(invItem.unit) || String(invItem.unit || "").trim();
           const convertedQty = convertQuantityBetweenUnits(qty, fromUnit, toUnit);
           if (convertedQty !== null && Number.isFinite(convertedQty)) {
             base += (Number(invItem.price || 0) * convertedQty);
           } else {
             incompatibleRows.push({
               index: rowIndex + 1,
               ingredient: String(invItem.name || selectedOption?.textContent || "Selected ingredient"),
               fromUnit,
               toUnit,
             });
             r.style.boxShadow = "inset 0 0 0 1px #EF4444";
           }
       }
    });

    if (recipeWarnings) {
      if (incompatibleRows.length > 0) {
        const first = incompatibleRows[0];
        recipeWarnings.style.display = "block";
        recipeWarnings.textContent = `Unit mismatch in ${incompatibleRows.length} row(s). Example: Row ${first.index} (${first.ingredient}) uses ${first.fromUnit || "unknown"} but inventory is ${first.toUnit || "unknown"}.`;
      } else {
        recipeWarnings.style.display = "none";
        recipeWarnings.textContent = "";
      }
    }

    if (basePriceDisplay) {
      basePriceDisplay.textContent = `₱${base.toFixed(2)}`;
    }
    validateMenuEditorForm(false);
  };

  const inventoryOptionsHtml = state.inventoryItems.map(inv => `<option value="${escapeHtml(inv.id)}" data-price="${inv.price || 0}" data-unit="${escapeHtml(inv.unit)}">${escapeHtml(inv.name)} (₱${Number(inv.price||0).toFixed(2)} / ${escapeHtml(inv.unit)})</option>`).join('');

  function updateRecipeRowConversion(row) {
    const conv = row.querySelector(".mm-recipe-conversion");
    if (!conv) return;
    const invId = row.querySelector(".mm-recipe-inv")?.value || "";
    const qty = Number(row.querySelector(".mm-recipe-qty")?.value || 0);
    const recipeUnitRaw = row.querySelector(".mm-recipe-unit")?.value || "";
    const invItem = state.inventoryItems.find((item) => item.id === invId);

    if (!invItem || !Number.isFinite(qty) || qty <= 0) {
      conv.textContent = "";
      conv.style.color = "var(--text-muted)";
      return;
    }

    const recipeUnit = normalizeUnit(recipeUnitRaw || invItem.unit) || recipeUnitRaw || invItem.unit;
    const invUnit = normalizeUnit(invItem.unit) || invItem.unit;
    const converted = convertQuantityBetweenUnits(qty, recipeUnit, invUnit);

    if (converted === null || !Number.isFinite(converted)) {
      conv.textContent = `Cannot convert ${recipeUnit || "unknown"} to ${invUnit || "unknown"}.`;
      conv.style.color = "#991B1B";
      return;
    }

    if (recipeUnit === invUnit) {
      conv.textContent = `${qty.toFixed(2)} ${recipeUnit} used per item.`;
      conv.style.color = "var(--text-muted)";
      return;
    }

    conv.textContent = `${qty.toFixed(2)} ${recipeUnit} = ${converted.toFixed(4)} ${invUnit} per item.`;
    conv.style.color = "var(--text-secondary)";
  }

  function setFieldError(field, errorId, message) {
    const errorEl = document.getElementById(errorId);
    if (errorEl) errorEl.textContent = message || "";
    if (!field) return;
    if (message) {
      field.setAttribute("aria-invalid", "true");
      field.style.borderColor = "#EF4444";
      field.style.boxShadow = "0 0 0 2px rgba(239,68,68,0.15)";
    } else {
      field.removeAttribute("aria-invalid");
      field.style.borderColor = "";
      field.style.boxShadow = "";
    }
  }

  function validateMenuEditorForm(showMessages = false) {
    const name = nameField?.value?.trim() || "";
    const price = Number(priceField?.value);
    const category = categoryField?.value?.trim() || "";

    let valid = true;
    if (!name) {
      valid = false;
      if (showMessages) setFieldError(nameField, "mm_name_error", "Name is required.");
    } else {
      setFieldError(nameField, "mm_name_error", "");
    }

    if (!Number.isFinite(price) || price < 0) {
      valid = false;
      if (showMessages) setFieldError(priceField, "mm_price_error", "Price must be 0 or higher.");
    } else {
      setFieldError(priceField, "mm_price_error", "");
    }

    if (!category) {
      valid = false;
      if (showMessages) setFieldError(categoryField, "mm_category_error", "Category is required.");
    } else {
      setFieldError(categoryField, "mm_category_error", "");
    }

    const hasRecipeMismatch = !!(recipeWarnings && recipeWarnings.style.display !== "none" && recipeWarnings.textContent.trim());
    if (hasRecipeMismatch) valid = false;

    if (saveBtn) saveBtn.disabled = !valid;
    if (formHint) {
      formHint.textContent = hasRecipeMismatch
        ? "Fix recipe unit mismatch before saving."
        : valid
          ? ""
          : "Complete required fields to enable Save.";
    }

    return valid;
  }

  function appendRecipeRow(ingredient = { inventoryId: "", quantity: 0, unit: "" }, options = {}) {
    if (!recipeRows) return;
    const shouldFocus = !!options.focus;
    const row = document.createElement("div");
    row.className = "mm-recipe-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "2fr 1fr 1.35fr auto auto";
    row.style.gap = "8px";
    const selectedUnit = normalizeUnit(ingredient.unit || "") || "";
    row.innerHTML = `
      <select class="ls-input mm-recipe-inv" style="margin-bottom:0;">
        <option value="" disabled ${!ingredient.inventoryId ? "selected" : ""}>Select ingredient...</option>
        ${inventoryOptionsHtml}
      </select>
      <input class="ls-input mm-recipe-qty" type="number" step="0.01" min="0" placeholder="Qty" value="${Number(ingredient.quantity) || ''}" style="margin-bottom:0;" />
      <select class="ls-input mm-recipe-unit" style="margin-bottom:0;">
        <option value="" disabled ${!selectedUnit ? "selected" : ""}>Unit</option>
        ${recipeUnitOptionsHtml}
      </select>
      <button type="button" class="mm-duplicate-recipe" style="background:transparent;border:1px solid var(--border-color);padding:8px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Copy</button>
      <button type="button" class="mm-remove-recipe" style="background:transparent;border:1px solid var(--border-color);padding:8px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Remove</button>
      <div class="mm-recipe-conversion" style="grid-column:1/-1;font-size:11px;color:var(--text-muted);margin-top:-2px;"></div>
    `;
    
    const selectEl = row.querySelector(".mm-recipe-inv");
    const unitEl = row.querySelector(".mm-recipe-unit");
    if (ingredient.inventoryId) {
      selectEl.value = ingredient.inventoryId;
    }
    if (selectedUnit) {
      unitEl.value = selectedUnit;
    }

    selectEl.addEventListener("change", () => {
      const selectedOption = selectEl.options[selectEl.selectedIndex];
      const invUnit = selectedOption?.dataset?.unit || "";
      const qtyEl = row.querySelector(".mm-recipe-qty");
      if (!unitEl.value && invUnit) {
        unitEl.value = normalizeUnit(invUnit) || invUnit;
      }
      if (qtyEl && !qtyEl.value) {
        qtyEl.value = "1";
      }
      updateRecipeRowConversion(row);
      calculateBasePrice();
    });
    
    unitEl.addEventListener("change", () => {
      updateRecipeRowConversion(row);
      calculateBasePrice();
    });
    row.querySelector(".mm-recipe-qty").addEventListener("input", () => {
      updateRecipeRowConversion(row);
      calculateBasePrice();
    });
    
    recipeRows.appendChild(row);
    if (shouldFocus) {
      row.querySelector(".mm-recipe-inv")?.focus();
    }
    updateRecipeRowConversion(row);
    calculateBasePrice();
  }

  if (recipeRows) {
    if (Array.isArray(item.recipe) && item.recipe.length > 0) {
      item.recipe.forEach(ing => appendRecipeRow(ing));
    }
    recipeRows.addEventListener("click", (event) => {
      const duplicateBtn = event.target.closest(".mm-duplicate-recipe");
      if (duplicateBtn) {
        const row = duplicateBtn.closest(".mm-recipe-row");
        if (!row) return;
        appendRecipeRow({
          inventoryId: String(row.querySelector(".mm-recipe-inv")?.value || ""),
          quantity: Number(row.querySelector(".mm-recipe-qty")?.value || 0),
          unit: String(row.querySelector(".mm-recipe-unit")?.value || ""),
        }, { focus: true });
        return;
      }

      const removeBtn = event.target.closest(".mm-remove-recipe");
      if (!removeBtn) return;
      const row = removeBtn.closest(".mm-recipe-row");
      if (!row) return;
      row.remove();
      calculateBasePrice();
      validateMenuEditorForm(false);
    });
  }

  addRecipeBtn?.addEventListener("click", () => appendRecipeRow({}, { focus: true }));
  calculateBasePrice();
  [nameField, priceField, categoryField].forEach((field) => {
    field?.addEventListener("input", () => validateMenuEditorForm(false));
    field?.addEventListener("change", () => validateMenuEditorForm(false));
  });
  validateMenuEditorForm(false);

  document.getElementById("mm_cancel")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const m = document.getElementById("menuEditModal");
    if (m) m.remove();
    if (slot) slot.innerHTML = "";
  });

  document.getElementById("mm_save")?.addEventListener("click", async () => {
    const err = async (msg) => {
      try {
        await ModalUtils.error("Cannot Save Menu Item", msg);
      } catch (fallbackError) {
        alert(msg);
      }
    };
    if (!validateMenuEditorForm(true)) return;
    const idInput = document.getElementById("mm_id");
    const id = idInput && idInput.value !== "Auto-generated" ? idInput.value : undefined;
    const name = document.getElementById("mm_name")?.value?.trim();
    const price = Number(document.getElementById("mm_price")?.value);
    const category = document.getElementById("mm_category")?.value?.trim();
    const note = document.getElementById("mm_note")?.value?.trim() || "";
    const hasTemp = !!document.getElementById("mm_hasTemp")?.checked;
    const hasVariant = !!document.getElementById("mm_hasVariant")?.checked;
    const popular = !!document.getElementById("mm_popular")?.checked;
    const bestseller = !!document.getElementById("mm_bestseller")?.checked;

    if (!name || !Number.isFinite(price) || !category) return err("Name, price, and category are required.");

    let variants = [];
    if (hasVariant) {
      variants = Array.from(document.querySelectorAll("#mm_variantsRows .mm-variant-row"))
        .map((row) => {
          const variantName = row.querySelector(".mm-variant-name")?.value?.trim() || "";
          const variantPrice = Number(row.querySelector(".mm-variant-price")?.value || 0);
          return { name: variantName, price: Number.isFinite(variantPrice) ? variantPrice : 0 };
        })
        .filter((variant) => variant.name);

      if (!variants.length) {
        return err("Add at least one variant when 'Has variants' is enabled.");
      }
    }

    const addons = Array.from(document.querySelectorAll("#mm_addonsRows .mm-addon-row"))
      .map((row, index) => {
        const addonPrice = Number(row.querySelector(".mm-addon-price")?.value || 0);
        const addonInventoryId = String(row.querySelector(".mm-addon-inv")?.value || "").trim();
        const addonQty = Number(row.querySelector(".mm-addon-qty")?.value || 0);
        const addonUnitRaw = String(row.querySelector(".mm-addon-unit")?.value || "").trim();
        const addonInventory = state.inventoryItems.find((item) => item.id === addonInventoryId);
        if (!addonInventoryId || !addonInventory) return null;

        const derivedAddonName = String(addonInventory?.name || addonInventoryId).trim();
        const resolvedQty = Number.isFinite(addonQty) && addonQty > 0 ? addonQty : 1;
        const addonUnit = normalizeUnit(addonUnitRaw || addonInventory?.unit || "") || "";
        const addonRecipe = addonInventoryId
          ? [{
              inventoryId: addonInventoryId,
              name: derivedAddonName,
              quantity: resolvedQty,
              unit: addonUnit,
            }]
          : [];
        return {
          id: `addon-${String(id || name || "menu-item").replace(/\s+/g, "-").toLowerCase()}-${index + 1}`,
          name: derivedAddonName,
          price: Number.isFinite(addonPrice) ? Math.max(0, addonPrice) : 0,
          recipe: addonRecipe,
        };
      })
      .filter(Boolean);

    let recipe = Array.from(document.querySelectorAll("#mm_recipeRows .mm-recipe-row"))
        .map((row) => {
        const invSelect = row.querySelector(".mm-recipe-inv");
        const selectedOption = invSelect?.options?.[invSelect.selectedIndex];
        const selectedInventoryId = row.querySelector(".mm-recipe-inv")?.value || "";
        const selectedInventoryItem = state.inventoryItems.find((item) => item.id === selectedInventoryId);
        const fallbackInvUnit = normalizeUnit(selectedOption?.dataset?.unit || "") || "";
            return {
                inventoryId: selectedInventoryId,
              name: String(selectedInventoryItem?.name || selectedOption?.textContent || "").replace(/\s*\(₱.*$/, "").trim(),
              quantity: Number(row.querySelector(".mm-recipe-qty")?.value || 0),
          unit: normalizeUnit(row.querySelector(".mm-recipe-unit")?.value || "") || fallbackInvUnit
            };
        })
        .filter(ing => ing.inventoryId && ing.quantity > 0);

    const incompatibleRecipe = recipe
      .map((ing) => {
        const invItem = state.inventoryItems.find((item) => item.id === ing.inventoryId);
        if (!invItem) return null;
        const converted = convertQuantityBetweenUnits(Number(ing.quantity || 0), ing.unit || invItem.unit, invItem.unit);
        if (converted !== null && Number.isFinite(converted)) return null;
        return {
          ingredient: invItem.name || ing.inventoryId,
          recipeUnit: ing.unit || "unknown",
          inventoryUnit: invItem.unit || "unknown",
        };
      })
      .filter(Boolean);

    if (incompatibleRecipe.length > 0) {
      const first = incompatibleRecipe[0];
      await ModalUtils.warning(
        "Recipe Unit Mismatch",
        `Unable to save recipe. ${incompatibleRecipe.length} ingredient row(s) have incompatible units. Example: ${first.ingredient} uses ${first.recipeUnit} but inventory unit is ${first.inventoryUnit}.`
      );
      return;
    }

    const payload = {
      id,
      name,
      price,
      category: resolveCanonicalMenuCategory(category, state.categories, state.menuItems),
      note: note || "",
      hasTemp,
      hasVariant,
      popular,
      bestseller,
      variants: hasVariant ? variants : [],
      addons,
      recipe,
    };

    try {
      await saveMenuItem(payload);
      const m = document.getElementById("menuEditModal");
      if (m) m.remove();
      if (slot) slot.innerHTML = "";
      await loadMenuPage();
    } catch (saveError) {
      const message = saveError?.message || "Unable to save menu item.";
      if (typeof ModalUtils !== "undefined" && ModalUtils.error) {
        await ModalUtils.error("Save Failed", message);
      } else {
        alert(message);
      }
      console.error("Menu save failed:", saveError, payload);
    }
  });
}



// ── CATEGORIES ──
async function loadCategoriesPage() {
  try {
    state.categories = await getCategories();
    renderAdminCategories();
  } catch (error) {
    console.error("Failed to load categories page:", error);
    // Silent fail if element doesn't exist to avoid popup on non-category pages
    const container = document.getElementById("adminCategoriesList");
    if(container) {
      ModalUtils.error("Load Error", "Failed to load categories.");
    }
  }
}

async function renderAdminCategories() {
  const container = document.getElementById("adminCategoriesList");
  if (!container) return;
  
  if (state.categories.length === 0) {
    container.innerHTML = '<div class="admin-categories-empty">No categories found.</div>';
    return;
  }

  let html = '<div class="admin-categories-grid">';

  const sortedCategories = [...state.categories].sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""))
  );

  sortedCategories.forEach(cat => {
    const categoryAddons = normalizeAddonCollection(cat?.addons || [], `addon-${String(cat?.id || "cat")}`);
    const addonSummaryText = categoryAddons.length
      ? `${categoryAddons.length} add-on option${categoryAddons.length === 1 ? "" : "s"}`
      : "No add-ons configured";
    html += '<div class="card admin-category-card">' +
            '<div class="admin-category-icon">' + escapeHtml(cat.icon || "☕") + '</div>' +
            '<div class="admin-category-meta">' +
              '<div class="admin-category-name">' + escapeHtml(cat.name) + '</div>' +
              '<div class="admin-category-addons">' + escapeHtml(addonSummaryText) + '</div>' +
            '</div>' +
            '<div class="admin-category-actions">' +
              '<button class="admin-category-action addons" onclick=\'window._adminEditCategoryAddons(' + JSON.stringify(String(cat.id || "")) + ')\' title="Edit add-ons"><i class="ri-list-settings-line"></i></button>' +
              '<button class="admin-category-action edit" onclick=\'window._adminEditCategory(' + JSON.stringify(String(cat.id || "")) + ')\' title="Edit category"><i class="ri-pencil-line"></i></button>' +
              '<button class="admin-category-action delete" onclick=\'window._adminDeleteCategory(' + JSON.stringify(String(cat.id || "")) + ')\' title="Delete category"><i class="ri-delete-bin-line"></i></button>' +
            '</div>' +
          '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}


window._adminAddCategory = function() {
  window._adminEditCategory(null);
};

window.__bbUpdateCategoryIconPreview = function(value) {
  const previewIcon = document.getElementById("cat_icon_preview");
  const hiddenIcon = document.getElementById("cat_icon");
  const icon = getCategoryIconForName(value);
  if (previewIcon) previewIcon.textContent = icon;
  if (hiddenIcon) hiddenIcon.value = icon;
};

window._adminEditCategory = function(id) {
  const cat = id ? state.categories.find(c => c.id === id) : null;
  const title = cat ? "Edit Category" : "Add Category";
  const currentIcon = getCategoryIconForName(cat ? cat.name : "") || (cat ? escapeHtml(cat.icon || "") : "📦");

  const content = `<div class="ls-form-grid cat-modal-form" style="display:block;">
    <div class="ls-label">Category Name*</div>
    <input type="text" class="ls-input" id="cat_name" value="${cat ? escapeHtml(cat.name || "") : ""}" placeholder="Coffee, Sandwiches..." autocomplete="off" oninput="window.__bbUpdateCategoryIconPreview && window.__bbUpdateCategoryIconPreview(this.value)">

    <div class="ls-label cat-modal-icon-label">Icon</div>
    <div class="ls-input cat-modal-icon-preview" aria-hidden="true">
      <span id="cat_icon_preview" class="cat-modal-icon-emoji">${currentIcon}</span>
      <span class="cat-modal-icon-text">Fixed icon</span>
    </div>
    <input type="hidden" id="cat_icon" value="${currentIcon}">
  </div>`;

  let nameValue = "";
  let iconValue = "";

  ModalUtils.show({
    title: title,
    html: true,
    message: content,
    buttons: [
      { text: "Cancel", type: "secondary" },
      { 
        text: "Save", 
        type: "primary",
        callback: () => {
          nameValue = document.getElementById("cat_name")?.value?.trim();
          iconValue = getCategoryIconForName(nameValue || cat?.name || "");
          const iconField = document.getElementById("cat_icon");
          if (iconField) iconField.value = iconValue;
        }
      }
    ]
  }).then(async (idx) => {
    if (idx !== 1) return; // Not the Save button

    if (!nameValue) {
      await ModalUtils.warning("Validation Error", "Name and Icon are required.");
      return;
    }

    const normalizedName = normalizeCategoryToken(nameValue);
    const duplicate = state.categories.find((entry) => {
      if (!entry?.id || (cat && entry.id === cat.id)) return false;
      return normalizeCategoryToken(entry.name) === normalizedName;
    });
    if (duplicate) {
      await ModalUtils.warning("Duplicate Category", "A category with the same name already exists.");
      return;
    }

    const genId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `cat-${Date.now()}`;
    const origId = cat ? cat.id : genId;
    const payload = {
      id: origId,
      name: nameValue,
      icon: iconValue,
      color: cat ? cat.color : "#373b40",
      addons: normalizeAddonCollection(cat?.addons || [], `addon-${origId}`),
    };

    try {
      const currentUser = getCurrentUser();
      if (currentUser) {
        try {
          const currentProfile = await getUserProfile(currentUser.uid);
          await ensureAdminAccessProfile(currentUser.uid, {
            fullName: currentProfile?.fullName || currentUser.displayName || currentUser.email || "Admin",
            displayName: currentProfile?.displayName || currentUser.displayName || currentUser.email || "Admin",
            email: currentUser.email || currentProfile?.email || "",
            status: currentProfile?.status || "active",
            isDefaultAdmin: currentProfile?.isDefaultAdmin === true,
          });
        } catch (profileBackfillError) {
          console.warn("[Category] Unable to refresh admin profile before save; continuing.", profileBackfillError);
        }
      }

      await saveCategory(payload);

      // Refresh is best-effort so a UI issue can't hide a successful save.
      try {
        state.categories = await getCategories();
        renderAdminCategories();
      } catch (refreshError) {
        console.warn("[Category] Saved, but refresh failed.", refreshError);
      }

      await ModalUtils.success("Saved", "Category saved successfully!");
    } catch (error) {
      console.error(error);
      ModalUtils.error("Save Failed", "Could not save category. Try again.");
    }
  });
};

window._adminEditCategoryAddons = async function(id) {
  const cat = state.categories.find((entry) => entry.id === id);
  if (!cat) return;

  if (!Array.isArray(state.inventoryItems) || state.inventoryItems.length === 0) {
    try {
      state.inventoryItems = await getInventoryItems();
    } catch (inventoryError) {
      console.warn("[Category Add-ons] Inventory preload failed.", inventoryError);
      state.inventoryItems = Array.isArray(state.inventoryItems) ? state.inventoryItems : [];
    }
  }

  const initialAddons = normalizeAddonCollection(cat?.addons || [], `addon-${cat.id || "category"}`);
  const unitOptions = [
    "g", "kg", "oz", "lb", "ml", "L", "fl oz", "gal", "pcs", "pack", "box", "tray",
    "bottle", "can", "jar", "sachet", "shot", "cup", "serving", "portion", "slice", "set",
  ];

  const createInventoryOptionsHtml = (selectedInventoryId = "") => {
    const selectedId = String(selectedInventoryId || "").trim();
    const options = (Array.isArray(state.inventoryItems) ? state.inventoryItems : [])
      .map((inv) => {
        const invId = String(inv?.id || "");
        const invName = String(inv?.name || invId || "Inventory item");
        const invUnit = normalizeUnit(inv?.unit || "") || String(inv?.unit || "").trim();
        const selected = selectedId && selectedId === invId ? " selected" : "";
        return `<option value="${escapeHtml(invId)}" data-unit="${escapeHtml(invUnit)}"${selected}>${escapeHtml(invName)} (${escapeHtml(invUnit || "unit")})</option>`;
      })
      .join("");

    return `<option value="" ${!selectedId ? "selected" : ""}>Select add-on ingredient...</option>${options}`;
  };

  const createUnitOptionsHtml = (selectedUnit = "") => {
    const resolvedUnit = normalizeUnit(selectedUnit || "") || String(selectedUnit || "").trim();
    const options = unitOptions
      .map((unit) => `<option value="${escapeHtml(unit)}" ${resolvedUnit === unit ? "selected" : ""}>${escapeHtml(unit)}</option>`)
      .join("");
    return `<option value="" ${!resolvedUnit ? "selected" : ""}>Unit</option>${options}`;
  };

  const createAddonRowHtml = (addon = { name: "", price: 0, recipe: [] }) => {
    const recipe = Array.isArray(addon?.recipe) && addon.recipe.length ? addon.recipe[0] : {};
    const selectedInventoryId = String(recipe?.inventoryId || "").trim();
    const selectedQty = Number(recipe?.quantity || 0);
    const selectedUnit = normalizeUnit(recipe?.unit || "") || "";
    const addonName = String(addon?.name || recipe?.name || "").trim();
    const addonPrice = Math.max(0, Number(addon?.price || 0));

    return `
      <div class="cat-addon-row" style="display:grid;grid-template-columns:1.6fr 0.9fr 0.8fr 0.9fr auto auto;gap:8px;margin-bottom:8px;">
        <select class="ls-input cat-addon-inv" style="margin-bottom:0;" onchange="window.__bbCategoryAddonEditorSyncRow && window.__bbCategoryAddonEditorSyncRow(this)">
          ${createInventoryOptionsHtml(selectedInventoryId)}
        </select>
        <input class="ls-input cat-addon-price" type="number" step="0.25" min="0" placeholder="Extra price" value="${Number.isFinite(addonPrice) ? addonPrice : 0}" style="margin-bottom:0;" />
        <input class="ls-input cat-addon-qty" type="number" step="0.01" min="0" placeholder="Qty" value="${Number.isFinite(selectedQty) && selectedQty > 0 ? selectedQty : ""}" style="margin-bottom:0;" />
        <select class="ls-input cat-addon-unit" style="margin-bottom:0;">
          ${createUnitOptionsHtml(selectedUnit)}
        </select>
        <button type="button" onclick="window.__bbCategoryAddonEditorCloneRow && window.__bbCategoryAddonEditorCloneRow(this)" style="background:transparent;border:1px solid var(--border-color);padding:8px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Copy</button>
        <button type="button" onclick="window.__bbCategoryAddonEditorRemoveRow && window.__bbCategoryAddonEditorRemoveRow(this)" style="background:transparent;border:1px solid var(--border-color);padding:8px 10px;border-radius:10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Remove</button>
        <div class="cat-addon-name-display" style="grid-column:1/-1;font-size:11px;color:var(--text-muted);margin-top:-2px;">Add-on name: ${escapeHtml(addonName || "-")}</div>
      </div>
    `;
  };

  const initialRowsHtml = initialAddons.length
    ? initialAddons.map((addon) => createAddonRowHtml(addon)).join("")
    : createAddonRowHtml({ price: 0, recipe: [] });

  let savedAddons = initialAddons;

  const attachEditorHelpers = () => {
    window.__bbCategoryAddonEditorSyncRow = (selectEl) => {
      const row = selectEl?.closest?.(".cat-addon-row");
      if (!row) return;
      const selectedOption = selectEl.options?.[selectEl.selectedIndex];
      const unitEl = row.querySelector(".cat-addon-unit");
      const qtyEl = row.querySelector(".cat-addon-qty");
      const nameEl = row.querySelector(".cat-addon-name-display");
      const selectedLabel = String(selectedOption?.textContent || "").trim();
      const derivedName = selectedLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const unit = normalizeUnit(selectedOption?.dataset?.unit || "") || "";

      if (unitEl && !unitEl.value && unit) {
        unitEl.value = unit;
      }
      if (qtyEl && !qtyEl.value) {
        qtyEl.value = "1";
      }
      if (nameEl) {
        nameEl.textContent = `Add-on name: ${derivedName || "-"}`;
      }
    };

    window.__bbCategoryAddonEditorAddRow = () => {
      const rows = document.getElementById("catAddonRows");
      if (!rows) return;
      rows.insertAdjacentHTML("beforeend", createAddonRowHtml({ price: 0, recipe: [] }));
      rows.querySelector(".cat-addon-row:last-child .cat-addon-inv")?.focus();
    };

    window.__bbCategoryAddonEditorCloneRow = (buttonEl) => {
      const row = buttonEl?.closest?.(".cat-addon-row");
      const rows = document.getElementById("catAddonRows");
      if (!row || !rows) return;
      const cloneAddon = {
        price: Number(row.querySelector(".cat-addon-price")?.value || 0),
        recipe: [],
      };
      const addonInventoryId = String(row.querySelector(".cat-addon-inv")?.value || "").trim();
      const addonQty = Number(row.querySelector(".cat-addon-qty")?.value || 0);
      const addonUnit = String(row.querySelector(".cat-addon-unit")?.value || "").trim();
      const selectedOption = row.querySelector(".cat-addon-inv")?.options?.[row.querySelector(".cat-addon-inv")?.selectedIndex || 0];
      const addonName = String(selectedOption?.textContent || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (addonInventoryId) {
        cloneAddon.recipe = [{
          inventoryId: addonInventoryId,
          name: addonName,
          quantity: Number.isFinite(addonQty) && addonQty > 0 ? addonQty : 1,
          unit: normalizeUnit(addonUnit || selectedOption?.dataset?.unit || "") || "",
        }];
      }
      rows.insertAdjacentHTML("beforeend", createAddonRowHtml(cloneAddon));
    };

    window.__bbCategoryAddonEditorRemoveRow = (buttonEl) => {
      const row = buttonEl?.closest?.(".cat-addon-row");
      if (!row) return;
      const rows = document.getElementById("catAddonRows");
      row.remove();
      if (rows && rows.children.length === 0) {
        rows.insertAdjacentHTML("beforeend", createAddonRowHtml({ price: 0, recipe: [] }));
      }
    };
  };

  const cleanupEditorHelpers = () => {
    delete window.__bbCategoryAddonEditorSyncRow;
    delete window.__bbCategoryAddonEditorAddRow;
    delete window.__bbCategoryAddonEditorCloneRow;
    delete window.__bbCategoryAddonEditorRemoveRow;
  };

  const markAddonModalLayout = () => {
    const modalEl = document.getElementById("modal-custom");
    if (!modalEl) return;
    modalEl.classList.add("modal-addon-editor");
    modalEl.querySelector(".modal-custom-body")?.classList.add("modal-addon-editor-body");
  };

  window.setTimeout(markAddonModalLayout, 0);
  window.setTimeout(markAddonModalLayout, 60);

  window.setTimeout(attachEditorHelpers, 0);

  try {
    const action = await ModalUtils.show({
      title: `${cat.name} - Category Add-ons`,
      html: true,
      message: `
        <div class="cat-addon-modal-shell">
          <div class="cat-addon-modal-note">These add-ons will be shared by all menu items under <strong>${escapeHtml(cat.name)}</strong>.</div>
          <div id="catAddonRows" class="cat-addon-modal-rows">${initialRowsHtml}</div>
          <div class="cat-addon-modal-actions">
            <button type="button" class="cat-addon-add-btn" onclick="window.__bbCategoryAddonEditorAddRow && window.__bbCategoryAddonEditorAddRow()">+ Add Add-on</button>
            <span class="cat-addon-modal-tip">Tip: Select an ingredient to auto-fill add-on name and unit.</span>
          </div>
        </div>
      `,
      buttons: [
        { text: "Cancel", type: "secondary" },
        {
          text: "Save",
          type: "primary",
          callback: () => {
            savedAddons = Array.from(document.querySelectorAll("#catAddonRows .cat-addon-row"))
              .map((row, index) => {
                const addonPrice = Number(row.querySelector(".cat-addon-price")?.value || 0);
                const addonInventoryId = String(row.querySelector(".cat-addon-inv")?.value || "").trim();
                const addonQty = Number(row.querySelector(".cat-addon-qty")?.value || 0);
                const addonUnitRaw = String(row.querySelector(".cat-addon-unit")?.value || "").trim();
                const selectedOption = row.querySelector(".cat-addon-inv")?.options?.[row.querySelector(".cat-addon-inv")?.selectedIndex || 0];
                const addonName = String(selectedOption?.textContent || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
                if (!addonInventoryId) return null;

                return {
                  id: `addon-${String(cat.id || cat.name || "category").replace(/\s+/g, "-").toLowerCase()}-${index + 1}`,
                  name: addonName,
                  price: Number.isFinite(addonPrice) ? Math.max(0, addonPrice) : 0,
                  recipe: [{
                    inventoryId: addonInventoryId,
                    name: addonName,
                    quantity: Number.isFinite(addonQty) && addonQty > 0 ? addonQty : 1,
                    unit: normalizeUnit(addonUnitRaw || selectedOption?.dataset?.unit || "") || "",
                  }],
                };
              })
              .filter(Boolean);
          },
        },
      ],
    });

    if (action !== 1) return;

    const payload = {
      id: cat.id,
      name: String(cat.name || "").trim(),
      icon: getCategoryIconForName(cat.name || ""),
      color: String(cat.color || "#373b40").trim() || "#373b40",
      addons: normalizeAddonCollection(savedAddons, `addon-${cat.id || "category"}`),
    };

    await saveCategory(payload);
    state.categories = await getCategories();
    renderAdminCategories();
    await ModalUtils.success("Category Add-ons Saved", `${cat.name} add-ons updated successfully.`);
  } catch (error) {
    console.error("[Category Add-ons] Save failed", error);
    await ModalUtils.error("Save Failed", error?.message || "Unable to save category add-ons.");
  } finally {
    const modalEl = document.getElementById("modal-custom");
    modalEl?.classList?.remove("modal-addon-editor");
    modalEl?.querySelector(".modal-custom-body")?.classList?.remove("modal-addon-editor-body");
    cleanupEditorHelpers();
  }
};

window._adminDeleteCategory = async function(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;

  const confirm = await ModalUtils.confirm("Delete Category", `Are you sure you want to delete "${escapeHtml(cat.name)}"?\
\
This will not delete existing menu items bound to this category.`);
  if (!confirm) return;

  try {
    await deleteCategory(id);
    state.categories = await getCategories();
    renderAdminCategories();
    await ModalUtils.success("Deleted", "Category deleted successfully!");
  } catch (error) {
    console.error(error);
    ModalUtils.error("Deletion Failed", "Could not delete category.");
  }
};
