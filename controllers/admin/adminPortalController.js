import { logout as authLogout, watchAuth, createAuthUserByAdmin, getCurrentUser } from "../auth/firebaseAuth.js";
import { getUserRole, getUserProfile, listUsers, setUserRole, setUserProfile, ensureAdminAccessProfile } from "../../models/userModel.js";
import { getMenuItems, saveMenuItem, deleteMenuItem, clearMenuItems } from "../../models/menuModel.js";
import { getCategories, saveCategory, deleteCategory, getCategoryIconForName } from "../../models/categoryModel.js";
import { getTodayOrders, getAllOrders, deleteOrder, clearAllOrders } from "../../models/orderModel.js";
import { resetDay as archiveResetDay } from "../../models/resetModel.js";
import { getInventoryItems, saveInventoryItem, deleteInventoryItem, clearInventoryItems, convertQuantityBetweenUnits, normalizeUnit } from "../../models/inventoryModel.js";
import { inventorySeedItems } from "../../models/defaultSeedData.js";
import { getAllStaff as getStaff, getSchedule, getOnDutyNowFromSchedule, addStaff, removeStaff, removeStaffByName, removeStaffByAccountUid, updateStaffAccountLink, saveSchedule } from "../../models/staffModel.js";
import { renderStats, renderRecentOrders, renderTopItems, renderStaffOnDuty } from "../../views/dashboardView.js";
import { renderAdminMenu } from "../../views/menuView.js";
import { renderStaffList, renderScheduleEditor, readScheduleFromDOM } from "../../views/staffView.js";
import { navigateTo } from "../utils/routes.js";

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

const state = {
  page: "dashboard",
  categories: [],
  menuItems: [],
  soldMap: {},
  ordersToday: [],
  allOrders: [],
  filteredOrders: [],
  pagedOrders: [],
  inventoryItems: [],
  lastInventorySyncMs: 0,
  accounts: [],
  lastAccountsSyncMs: 0,
  staff: [],
  schedule: {},
  orderStockExpanded: {},
};

const DASHBOARD_SYNC_INTERVAL_MS = 60_000;
let dashboardSyncInProgress = false;
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
}

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
    const [menuItems, ordersToday, staff, schedule] = await Promise.all([
      getMenuItems(),
      getTodayOrders(),
      getStaff(),
      getSchedule(),
    ]);

    // Inventory should not block dashboard rendering in slow/unreliable networks.
    const inventoryItems = await getInventoryItems().catch((error) => {
      console.warn("[Inventory] Dashboard prefetch failed:", error);
      return state.inventoryItems || [];
    });

    state.menuItems = menuItems;
    state.ordersToday = ordersToday;
    state.staff = staff;
    state.schedule = schedule;
    state.inventoryItems = inventoryItems;

    const navBadge = document.getElementById("inventoryNavBadge");
    if (navBadge) navBadge.textContent = String(inventoryItems.length);

    const totalSales = ordersToday.reduce((s, o) => s + (o.total || 0), 0);
    const totalOrders = ordersToday.length;

    // Best seller
    state.soldMap = buildSoldMapFromOrders(ordersToday);
    const bestByName = {};
    ordersToday.forEach((o) => (o.items || []).forEach((i) => {
      const label = String(i?.name || "").trim();
      if (!label) return;
      bestByName[label] = (bestByName[label] || 0) + (Number(i?.quantity || 1) || 1);
    }));
    const best = Object.entries(bestByName).sort((a, b) => b[1] - a[1])[0];

    // Staff on duty should be time-aware, not just checkbox-based.
    const { onDuty } = getOnDutyNowFromSchedule(staff, schedule, new Date());

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
  } finally {
    showApp();
  }
}

function startDashboardAutoSync() {
  window.setInterval(async () => {
    if (state.page !== "dashboard") return;
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
    state.allOrders = await getAllOrders();
    bindOrdersControls();
    applyOrderFilters();
  } catch (error) {
    wrap.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px 0;">Failed to load transactions: ${error?.message || "Unknown error"}</div>`;
  } finally {
    showApp();
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
      remainingQty: Number(entry?.remainingQty || 0),
    };

    existing.totalDeducted += Number(entry?.deductedQty || 0);
    existing.remainingQty = Number(entry?.remainingQty || existing.remainingQty || 0);
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

function buildInventoryPreview(summary) {
  if (!Array.isArray(summary) || !summary.length) return "";
  const preview = summary.slice(0, 2).map((entry) => `${entry.name} (${formatInventoryQty(entry.totalDeducted)} ${entry.unit || "unit"})`).join(", ");
  return summary.length > 2 ? `${preview}...` : preview;
}

function findOrderByKey(orderKey) {
  const key = String(orderKey || "").trim();
  return state.allOrders.find((order) => String(order.id || order.orderId || "") === key);
}

function toggleOrderStockDetails(orderKey) {
  const key = String(orderKey || "").trim();
  if (!key) return;
  const next = { ...(state.orderStockExpanded || {}) };
  next[key] = !next[key];
  state.orderStockExpanded = next;
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
    const orderKey = String(order.id || order.orderId || "");
    const { summary: stockSummary, recorded: stockRecorded } = getOrderInventorySummary(order);
    const stockPreview = buildInventoryPreview(stockSummary);
    const stockExpanded = !!state.orderStockExpanded?.[orderKey];
    const stockCountLabel = stockSummary.length ? `${stockSummary.length} item(s)` : "—";
    const stockCell = stockSummary.length
      ? `<div class="orders-stock-cell">
          <div class="orders-stock-summary" title="${escapeHtml(stockRecorded ? stockPreview : `${stockPreview} (estimated)`)}">${escapeHtml(stockPreview)}</div>
          ${stockRecorded ? "" : `<div class="orders-stock-empty-note">Estimated from recipe</div>`}
          <button class="orders-btn ghost inventory-mini-btn order-stock-btn" type="button" data-order-action="toggle-stock" data-order-id="${escapeHtml(orderKey)}" title="${stockExpanded ? "Hide stock used" : "Show stock used"}" aria-label="${stockExpanded ? "Hide stock used" : "Show stock used"}">${stockExpanded ? "Hide" : "View"}</button>
        </div>`
      : `<span class="orders-stock-empty">—</span>`;
    const detailRow = stockSummary.length
      ? `<tr class="orders-stock-detail-row-wrap ${stockExpanded ? "is-open" : ""}" data-order-stock-detail="${escapeHtml(orderKey)}">
          <td colspan="8">
            <div class="orders-stock-detail-panel">
              <div class="orders-stock-detail-card">
                <div class="orders-stock-detail-meta">${stockRecorded ? "Recorded audit" : "Estimated from recipe"}</div>
                <div class="orders-stock-detail-items">${escapeHtml(items || "-")}</div>
                <div class="orders-stock-detail-meta" style="margin-top:6px;">${escapeHtml(stockCountLabel)} used</div>
                ${stockRecorded ? "" : `<div class="orders-stock-empty-note">Estimated from recipe. No audit record available.</div>`}
              </div>
              <div class="orders-stock-detail-list">
                ${stockSummary.map((entry) => `
                  <div class="orders-stock-detail-row">
                    <div>
                      <div class="orders-stock-detail-name">${escapeHtml(entry.name)}</div>
                      <div class="orders-stock-detail-meta">${entry.remainingQty === null || entry.remainingQty === undefined
                        ? "Remaining stock not recorded"
                        : `Remaining stock: ${escapeHtml(formatInventoryQty(entry.remainingQty))} ${escapeHtml(entry.unit || "unit")}`
                      }</div>
                    </div>
                    <div class="orders-stock-detail-value">− ${escapeHtml(formatInventoryQty(entry.totalDeducted))} ${escapeHtml(entry.unit || "unit")}</div>
                  </div>
                `).join("")}
              </div>
            </div>
          </td>
        </tr>`
      : "";

    return `
      <tr>
      <td>#${shortId}</td>
      <td>${items || "-"}</td>
      <td>${type}</td>
      <td>${time}</td>
      <td>₱${total}</td>
      <td>${status}</td>
      <td>${stockCell}</td>
      <td>
        <button class="orders-btn ghost inventory-mini-btn danger order-delete-btn" type="button" data-order-action="delete" data-order-id="${escapeHtml(orderKey)}" title="Delete transaction" aria-label="Delete transaction"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
      </td>
    </tr>
    ${detailRow}`;
  }).join("");

  wrap.innerHTML = `<table>
    <tr><th>#</th><th>Items</th><th>Type</th><th>Time</th><th>Amount</th><th>Status</th><th>Stock Used</th><th>Action</th></tr>
    ${rows}
  </table>`;

  wrap.querySelectorAll("button[data-order-action]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const orderId = btn.dataset.orderId;
      const action = btn.dataset.orderAction;
      const order = findOrderByKey(orderId);
      if (!order) return;

      if (action === "toggle-stock") {
        toggleOrderStockDetails(orderId);
        renderOrdersTable(state.pagedOrders);
        return;
      }

      if (action === "delete") {
        const confirmed = await ModalUtils.confirm("Delete Transaction", "This will permanently delete this transaction. Continue?");
        if (confirmed !== 1) return;

        try {
          await deleteOrder(orderId);
          await ModalUtils.success("Transaction Deleted", "The transaction has been removed successfully.");
          await loadOrdersPage();
        } catch (error) {
          await ModalUtils.error("Delete Failed", error?.message || "Unable to delete transaction.");
        }
      }
    });
  });
}

function exportOrdersCsv() {
  if (!state.filteredOrders.length) {
    (async () => await ModalUtils.warning("No Data", "No transactions to export."))();
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
}

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

function renderInventorySection() {
  const listWrap = document.getElementById("inventoryListWrap");
  const strip = document.getElementById("inventoryAlertStrip");
  const pageSub = document.getElementById("inventoryPageSub");
  const navBadge = document.getElementById("inventoryNavBadge");
  if (!listWrap || !strip) return;

  const syncText = state.lastInventorySyncMs ? ` • Last synced ${formatSyncTime(state.lastInventorySyncMs)}` : "";

  if (navBadge) navBadge.textContent = String(state.inventoryItems.length);

  if (!state.inventoryItems.length) {
    strip.innerHTML = `<span class="badge b-blue">No inventory items yet. Add your first item above.</span>`;
    listWrap.innerHTML = renderSectionState("No inventory items found.", "warning");
    if (pageSub) pageSub.textContent = `Track your ingredients and supplies${syncText}`;
    return;
  }

  const low = state.inventoryItems.filter((i) => inventoryStatus(i) === "low").length;
  const critical = state.inventoryItems.filter((i) => inventoryStatus(i) === "critical").length;
  const out = state.inventoryItems.filter((i) => inventoryStatus(i) === "out").length;
  if (pageSub) pageSub.textContent = `${out} out, ${critical} critical, ${low} low stock item(s)${syncText}`;

  strip.innerHTML = `
    <span class="badge b-red">Out: ${out}</span>
    <span class="badge b-red">Critical: ${critical}</span>
    <span class="badge b-orange">Low: ${low}</span>
    <span class="badge b-green">Total: ${state.inventoryItems.length}</span>
  `;

  listWrap.innerHTML = state.inventoryItems.map((item) => {
    const quantity = Number(item.quantity || 0);
    const reorderLevel = Math.max(1, Number(item.reorderLevel || 1));
    const price = Number(item.price || 0).toFixed(2);
    const percent = Math.max(5, Math.min(100, Math.round((quantity / (reorderLevel * 2)) * 100)));
    const status = inventoryStatus(item);
    const statusBadge = status === "out"
      ? `<span class="badge b-red">Out</span>`
      : status === "critical"
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
        <div class="inv-qty">Stock: ${quantity} ${escapeHtml(item.unit)} &middot; Restock alert at: ${reorderLevel} &middot; Cost: ₱${price}/unit</div>
        <div class="inv-bar-bg"><div class="inv-bar ${status === "critical" ? "crit" : status === "low" ? "low" : ""}" style="width:${percent}%"></div></div>
      </div>
      ${statusBadge}
      <div class="inventory-row-actions">
        <button class="orders-btn ghost inventory-mini-btn row-action-btn" type="button" data-inv-action="edit" data-inv-id="${escapeHtml(item.id)}" title="Edit inventory item" aria-label="Edit inventory item"><i class="ri-pencil-line" aria-hidden="true"></i></button>
        <button class="orders-btn ghost inventory-mini-btn danger row-action-btn" type="button" data-inv-action="delete" data-inv-id="${escapeHtml(item.id)}" title="Delete inventory item" aria-label="Delete inventory item"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
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
      const priceEl = document.getElementById("invPrice");
      const saveBtn = document.getElementById("invSaveBtn");

      if (idEl) idEl.value = item.id;
      if (nameEl) nameEl.value = item.name || "";
      if (catEl) catEl.value = item.category || "";
      if (unitEl) {
        const nextUnit = String(item.unit || "").trim();
        if (nextUnit) {
          ensureInventoryUnitOption(unitEl, nextUnit);
          unitEl.value = nextUnit;
        } else {
          unitEl.value = "";
        }
      }
      if (qtyEl) qtyEl.value = String(item.quantity || 0);
      if (reorderEl) reorderEl.value = String(item.reorderLevel || 0);
      if (priceEl) priceEl.value = String(item.price || 0);
      if (saveBtn) saveBtn.textContent = "Update Item";
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

    if (!name || !category || !unit) {
      await ModalUtils.warning("Validation Error", "Name, category, and unit are required.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isFinite(price) || price < 0) {
      await ModalUtils.warning("Validation Error", "Quantity, reorder level, and price must be valid positive values.");
      return;
    }

    await saveInventoryItem({ id: id || undefined, name, category, unit, quantity, reorderLevel, price });
    await ModalUtils.success("Success", "Inventory item has been saved successfully.");
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
  const text = String(value || "").trim();
  if (!text) return false;

  const twelveOrTwentyFour = /^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?\s*-\s*(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?$/i;
  if (!twelveOrTwentyFour.test(text)) return false;

  const match = text.match(twelveOrTwentyFour);
  if (!match) return false;

  const fromHour = Number(match[1]);
  const toHour = Number(match[4]);
  if (fromHour < 0 || fromHour > 24 || toHour < 0 || toHour > 24) return false;

  return true;
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
      const confirmed = await ModalUtils.confirm("Change Role", `Change role for <strong>${escapeHtml(account.fullName || account.email || uid)}</strong> to <strong>${escapeHtml(nextRole)}</strong>?`);
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
        `${nextStatus === "suspended" ? "Suspend" : "Activate"} <strong>${escapeHtml(account.fullName || account.email || uid)}</strong>?`
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

      const label = account.fullName || account.email || account.uid;
      const confirmed = await ModalUtils.confirm("Delete Staff Account", `This will disable access and hide the account for <strong>${label}</strong> from this list. This action cannot be undone.`);
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

  const SETTINGS_STORAGE_KEY = "bb_admin_settings_v1";
  const DEFAULT_SETTINGS = {
    shop: {
      name: "Brother Bean Coffee House",
      openingHours: "7:00 AM - 9:00 PM",
      location: "Imus, Cavite",
      currency: "Philippine Peso (PHP)",
      phone: "+63 (0)2 1234 5678",
    },
    preferences: {
      lowStockAlerts: true,
      transactionNotifications: true,
      orderSyncToasts: true,
      compactTableRows: false,
    },
    notifications: {
      modalOnSave: true,
      warningOnDestructive: true,
    },
  };

  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const mergeSettings = (base, incoming) => {
    const next = deepClone(base);
    if (!incoming || typeof incoming !== "object") return next;

    Object.keys(next).forEach((section) => {
      if (!incoming[section] || typeof incoming[section] !== "object") return;
      Object.keys(next[section]).forEach((key) => {
        if (incoming[section][key] === undefined) return;
        next[section][key] = incoming[section][key];
      });
    });

    return next;
  };

  const loadSavedSettings = () => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return deepClone(DEFAULT_SETTINGS);
      return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw));
    } catch {
      return deepClone(DEFAULT_SETTINGS);
    }
  };

  const settings = loadSavedSettings();

  const persistSettings = () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  };

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

      persistSettings();
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
    toggle.addEventListener("change", () => {
      const setting = String(toggle.dataset.setting || "");
      const [section, key] = setting.split(".");
      if (!section || !key) return;
      if (!settings[section]) return;

      settings[section][key] = !!toggle.checked;
      persistSettings();
      showSavedHint("Preference updated.");
    });
  });

  document.getElementById("resetSettingsBtn")?.addEventListener("click", async () => {
    const confirmed = await ModalUtils.confirm(
      "Reset to Defaults",
      "This will restore settings on this page to default values. Continue?"
    );
    if (confirmed !== 1) return;

    const reset = deepClone(DEFAULT_SETTINGS);
    Object.keys(settings).forEach((section) => {
      settings[section] = reset[section];
    });

    persistSettings();
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
        .filter((key) => key.startsWith("bb_") || key.startsWith("brother-bean"))
        .forEach((key) => localStorage.removeItem(key));
      sessionStorage.clear();

      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
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
  state.page = pageId;
  setActiveNav(navEl);
  setTopbarTitle(title || "Admin");
  showPage(pageId);
  try {
    if (pageId === "dashboard") await loadDashboard();
    if (pageId === "orders") await loadOrdersPage();
    if (pageId === "menu") await loadMenuPage();
    if (pageId === "inventory") await loadInventoryPage();
    if (pageId === "staff") await loadStaffPage();
    if (pageId === "accounts") await loadAccountsPage();
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
  document.getElementById("addStaffForm").style.display = "block";
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
  await ModalUtils.success("Transactions Archived", `Archived ${result.totalArchived} transactions for ${result.date}.`);
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
  if (!modal || modal.style.display === "none") return;
  window.closeLogoutModal();
});

document.addEventListener("DOMContentLoaded", async () => {
  setupTopbarDate();
  setupTopbarActions();
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
        profile = await getUserProfile(activeUser.uid);
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
        role = await getUserRole(activeUser.uid);
      } catch (roleError) {
        console.warn("[Auth] Unable to read user role; defaulting to admin access path.", roleError);
      }

      if (!role) {
        try {
          await ensureAdminAccessProfile(activeUser.uid, {
            fullName: profile?.fullName || activeUser.displayName || activeUser.email || "Admin",
            displayName: profile?.displayName || activeUser.displayName || activeUser.email || "Admin",
            email: activeUser.email || profile?.email || "",
            status: profile?.status || "active",
            isDefaultAdmin: profile?.isDefaultAdmin === true,
          });
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
    } catch (error) {
      console.error("[Auth] watchAuth error:", error);
      authSettled = true;
      window.clearTimeout(authTimeoutId);
      // Keep user on admin UI if already authenticated; avoid redirect loops on transient failures.
      showApp();
    }
  });
});

function openMenuEditor(itemId, preset = {}) {
  const slot = document.getElementById("menuEditorSlot");
  if (!slot) return;

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

  slot.innerHTML = `
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
    slot.innerHTML = "";
  });

  document.getElementById("mm_save")?.addEventListener("click", async () => {
    const err = (msg) => alert(msg);
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
      slot.innerHTML = "";
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
              '<button class="admin-category-action addons" onclick="window._adminEditCategoryAddons(\'' + String(cat.id).replace(/'/g, "\\\'") + '\')" title="Edit add-ons"><i class="ri-list-settings-line"></i></button>' +
              '<button class="admin-category-action edit" onclick="window._adminEditCategory(\'' + String(cat.id).replace(/'/g, "\\\'") + '\')" title="Edit category"><i class="ri-pencil-line"></i></button>' +
              '<button class="admin-category-action delete" onclick="window._adminDeleteCategory(\'' + String(cat.id).replace(/'/g, "\\\'") + '\')" title="Delete category"><i class="ri-delete-bin-line"></i></button>' +
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
      console.log("Saving category...");
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
      console.log("Category saved successfully!");

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

  const confirm = await ModalUtils.confirm("Delete Category", `Are you sure you want to delete "${cat.name}"?\
\
This will not delete existing menu items bound to this category.`);
  if (!confirm) return;

  try {
    console.log("Deleting category...");
    await deleteCategory(id);
    console.log("Deleted successfully!");
    state.categories = await getCategories();
    renderAdminCategories();
    await ModalUtils.success("Deleted", "Category deleted successfully!");
  } catch (error) {
    console.error(error);
    ModalUtils.error("Deletion Failed", "Could not delete category.");
  }
};
