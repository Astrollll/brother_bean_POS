// ── POS CONTROLLER ──
// Connects models (data) to views (UI) for the POS/cashier page

import { getMenuItems, watchMenuItems, getCachedMenuItems }  from "../models/menuModel.js";
import { getCategories } from "../models/categoryModel.js";
import { getCategoryIconForName } from "../models/categoryModel.js";
import { isDefaultTemplateMenuItem } from "../models/defaultSeedData.js";
import { saveOrder, voidOrder, syncQueuedOrders, getPendingOrderCount, getTodayOrders, watchTodayOrders, retryFailedInventoryDeduction, getQueuedOrders } from "../models/orderModel.js";
import { restoreInventoryForOrder } from "../models/inventoryModel.js";
import {
  isSupported as isPrinterSupported,
  getStatus as getPrinterStatus,
  getSettings as getPrinterSettings,
  updateSettings as updatePrinterSettings,
  connectPrinter as connectThermalPrinter,
  disconnectPrinter as disconnectThermalPrinter,
  reconnectSavedPrinter as reconnectThermalPrinter,
  printReceipt as printThermalReceipt,
  onPrinterStatus,
} from "./printer/thermalPrinter.js";
import { watchAuth, getCurrentUser, logout as authLogout } from "./auth/firebaseAuth.js";
import { getUserProfile, getUserRole } from "../models/userModel.js";
import { navigateTo } from "./utils/routes.js";
import { db } from "./firebase.js";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, query, where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { 
  saveToStorage, 
  loadFromStorage, 
  loadStatsFromFirestore,
  checkDailyReset, 
  getStorageCount,
  getKitchenOrders,
  saveKitchenOrder,
  removeKitchenOrder,
  purgeSavedSale,
  recordDrawerLogEntry,
  syncDrawerLogOutbox,
  getSharedDrawerState,
  readLocalPosState
} from "../models/storageModel.js";

// ── STATE ──
let menuItems        = [];
let globalCategories = [];
let cart             = [];
let currentCategory  = "all";
let currentPayMethod = "cash";
let isPwdSenior      = false;
let isEmployeeOrder  = false;
let enteredAmount    = "";
let selectedVariant  = null;
let selectedTemp     = null;
let selectedAddons   = [];
let selectedQty      = 1;
let activeProductId  = null;
let cashierName      = "Staff";
let salesHistory     = [];
let dailyStats       = { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, openingFloat: 0, cashIn: 0, cashOut: 0 };
let isOnline         = navigator.onLine;

// Shared-drawer refresh bookkeeping: a local write short-circuits the next
// poll so a re-render can never discard a value that is still saving.
let drawerLastLocalWrite = 0;
let drawerRefreshTimer = null;

// Persist today's stats (localStorage + Firestore mirror). Declared at module
// scope so both the init flow and the drawer block can call it.
const persistPosState = () => saveToStorage(salesHistory, dailyStats);
let posReady = false;

// The sale shown in the receipt modal right now. Kept so the "Cancel" button
// can void it and return the items to the cart.
let currentReceiptSale = null;

// Admin deletions in Firestore are authoritative. A local order copy is kept
// only when the order is still in today's Firestore feed or still queued for
// offline sync; anything else is a stale local copy (deleted elsewhere) and
// must not inflate the dashboard totals.
function pruneStaleLocalOrders(orders, authoritative, queued) {
  const known = new Set();
  for (const o of [...authoritative, ...queued]) {
    const key = String(o?.orderId || o?.id || "");
    if (key) known.add(key);
  }
  return orders.filter((o) => {
    const key = String(o?.orderId || o?.id || "");
    return !key || known.has(key);
  });
}
const CART_DENSITY_STORAGE_KEY = "bb-pos-cart-density";
const UNPAID_ORDER_STORAGE_KEY = "bb-pos-unpaid-order";
const AUTH_OPERATION_TIMEOUT_MS = 6000;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getCartSummary(sourceCart = cart) {
  const items = Array.isArray(sourceCart) ? sourceCart : [];
  const subtotal = items.reduce((sum, item) => {
    const addonTotal = (item.addons || []).reduce((addonSum, addon) => addonSum + (Number(addon?.price) || 0), 0);
    const basePrice = Number(item.price) || 0;
    const discountedUnitPrice = (basePrice + addonTotal) * (1 - (Number(item.discountPercent) || 0));
    return sum + discountedUnitPrice * (Number(item.quantity) || 1);
  }, 0);
  const total = isEmployeeOrder ? 0 : (isPwdSenior ? subtotal * 0.8 : subtotal);
  return { subtotal, total };
}

function loadUnpaidOrders() {
  try {
    const raw = localStorage.getItem(UNPAID_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return [parsed];
    return [];
  } catch {
    return [];
  }
}

async function loadUnpaidOrdersFromFirestore() {
  try {
    const uid = getCurrentUser()?.uid;
    if (!uid) return loadUnpaidOrders();
    const snap = await getDocs(
      query(collection(db, "unpaidOrders"), where("cashierUid", "==", uid))
    );
    const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (remote.length > 0) {
      localStorage.setItem(UNPAID_ORDER_STORAGE_KEY, JSON.stringify(remote));
      return remote;
    }
  } catch (error) {
    console.warn("[POS] Firestore unpaid orders read failed.", error);
  }
  return loadUnpaidOrders();
}

function saveUnpaidOrders(orders) {
  localStorage.setItem(UNPAID_ORDER_STORAGE_KEY, JSON.stringify(orders));
}

async function addUnpaidOrder(order) {
  const orders = loadUnpaidOrders();
  orders.push(order);
  saveUnpaidOrders(orders);
  try {
    const orderId = String(order.id || `unpaid_${Date.now()}`);
    await setDoc(doc(db, "unpaidOrders", orderId), {
      ...order,
      id: orderId,
      savedAtMs: Date.now(),
    });
  } catch (error) {
    console.warn("[POS] Firestore unpaid order write failed.", error);
  }
}

async function removeUnpaidOrderById(orderId) {
  const orders = loadUnpaidOrders();
  const filtered = orders.filter(o => String(o.id) !== String(orderId));
  if (filtered.length !== orders.length) {
    saveUnpaidOrders(filtered);
  }
  try {
    await deleteDoc(doc(db, "unpaidOrders", String(orderId)));
  } catch (error) {
    console.warn("[POS] Firestore unpaid order delete failed.", error);
  }
}

async function clearUnpaidOrders() {
  const orders = loadUnpaidOrders();
  localStorage.removeItem(UNPAID_ORDER_STORAGE_KEY);
  for (const order of orders) {
    try {
      await deleteDoc(doc(db, "unpaidOrders", String(order.id)));
    } catch {}
  }
}

function getUnpaidOrders() {
  return loadUnpaidOrders();
}

function setButtonBusyState(button, isBusy, busyLabel = "Working...") {
  if (!button) return;
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = String(button.textContent || "").trim() || "Button";
  }
  button.disabled = !!isBusy;
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
  button.textContent = isBusy ? busyLabel : button.dataset.originalLabel;
}

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


// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  let initialized = false;

  getCategories()
    .then((categories) => {
      globalCategories = Array.isArray(categories) ? categories : [];
      if (initialized) {
        renderCategoryControls();
        renderProducts(currentCategory);
      }
    })
    .catch((error) => {
      console.warn("[POS] Category load failed; using fallback labels.", error);
      globalCategories = [];
    });

  closeSidebar();
  setMainView("menu");

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1199) {
      document.body.classList.remove("sidebar-collapsed", "main-view-menu", "main-view-order");
    } else {
      if (!document.body.classList.contains("main-view-menu") && !document.body.classList.contains("main-view-order")) {
        setMainView("menu");
      }
    }
  });

  watchAuth(async (user) => {
    if (!user) {
      navigateTo("login", { replace: true });
      return;
    }

    const [profileResult, roleResult] = await Promise.allSettled([
      getUserProfile(user.uid),
      getUserRole(user.uid),
    ]);

    const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
    if (String(profile?.status || "active").toLowerCase() === "suspended") {
      await authLogout();
      alert("Your account is suspended. Please contact an administrator.");
      navigateTo("login", { replace: true });
      return;
    }

    cashierName = profile?.fullName || profile?.displayName || profile?.email || "Staff";

    const role = roleResult.status === "fulfilled" ? roleResult.value : null;
    if (role && !["admin", "staff"].includes(role)) {
      navigateTo("login", { replace: true });
      return;
    }

    if (initialized) return;
    initialized = true;

    // Instant first paint: render the last known menu from the local cache
    // right away instead of waiting for the network below, so the grid never
    // sits blank during refresh/login. The fresh Firestore fetch and the
    // watchMenuItems() listener below replace it with current data moments later.
    const cachedMenu = getCachedMenuItems();
    if (Array.isArray(cachedMenu) && cachedMenu.length) {
      menuItems = sanitizePosMenuItems(cachedMenu);
      renderCategoryControls();
      renderProducts();
    }

    // Instant sidebar paint: render the persisted local stats/orders right away
    // (no network) so the stats bar, sales trend, and drawer summary are never
    // blank while the Firestore sync below runs. The authoritative merge a few
    // lines down overwrites these moments later.
    try {
      const localState = readLocalPosState();
      if (localState) {
        const nowMs = Date.now();
        const dayStart = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth(), new Date(nowMs).getDate()).getTime();
        const dayEnd = dayStart + 86400000;
        salesHistory = (localState.salesHistory || []).filter((o) => {
          const ts = getSaleTimestampMs(o);
          return ts >= dayStart && ts < dayEnd;
        });
        dailyStats = recomputeDailyStats(salesHistory, localState.dailyStats || {});
        updateStats();
        updateUnpaidOrderSidebar();
      }
    } catch (error) {
      console.warn("[POS] Instant sidebar paint skipped.", error);
    }

    // Load from storage first
    const storageData = await loadFromStorage().catch(() => ({
      salesHistory: [],
      dailyStats: { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, gcashReceived: 0, openingFloat: 0, cashIn: 0, cashOut: 0, actualCash: null, cashOnHandAuto: true, ledgerEntries: [] },
    }));
    salesHistory = storageData.salesHistory;
    dailyStats = storageData.dailyStats;
    posReady = true;

    if (checkDailyReset()) {
      dailyStats = { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, gcashReceived: 0, openingFloat: 0, cashIn: 0, cashOut: 0, actualCash: null, cashOnHandAuto: true, ledgerEntries: [] };
      salesHistory = [];
      showToast("Daily stats reset for new day", "info");
      persistPosState();
      // Another terminal may have already recorded today's drawer (e.g. the
      // opening float) before this terminal's first load of the new day, so
      // re-apply the shared drawer state instead of keeping the zeroed reset.
      if (typeof getSharedDrawerState === "function") {
        getSharedDrawerState().then(applySharedDrawer).catch(() => {});
      }
    }

    // Seed stats from Firestore so all cashiers see today's shared sales.
    // Sales-derived stats are ALWAYS recomputed from the merged order list so
    // a stale value in the shared stats mirror (or a failed Firestore read)
    // can never leave the drawer showing outdated cash.
    const now = Date.now();
    const startOfDay = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
    const endOfDay = startOfDay + 86400000;

    // Purge stale entries (previous days) from localStorage data
    salesHistory = salesHistory.filter(o => {
      const ts = getSaleTimestampMs(o);
      return ts >= startOfDay && ts < endOfDay;
    });

    let todayOrders = [];
    let todayOrdersFetched = false;
    try {
      const firestoreOrders = await getTodayOrders();
      todayOrders = (Array.isArray(firestoreOrders) ? firestoreOrders : []).filter(o => {
        const ts = getSaleTimestampMs(o);
        return ts >= startOfDay && ts < endOfDay;
      });
      todayOrdersFetched = true;
    } catch (err) {
      console.warn("[POS] Failed to fetch today's orders from Firestore:", err);
    }
    // Only prune when Firestore was reachable AND the server feed is
    // authoritative: offline, cached local orders are still the best view
    // available and must not be dropped. A feed that is empty because today's
    // orders were archived by a day-end reset is also non-authoritative — a
    // mid-day reset deletes today's orders from the live feed, and wiping local
    // drawer/stats on that empty feed would zero out every terminal.
    if (todayOrdersFetched && (await hasTodayResetMarker()) === false) {
      salesHistory = pruneStaleLocalOrders(
        salesHistory,
        todayOrders,
        (typeof getQueuedOrders === "function" ? getQueuedOrders() : []).map((q) => q?.payload || q)
      );
    }
    salesHistory = mergeOrderLists(
      salesHistory,
      todayOrders,
      (typeof getQueuedOrders === "function" ? getQueuedOrders() : []).map((q) => q?.payload || q)
    ).filter(o => {
      const ts = getSaleTimestampMs(o);
      return ts >= startOfDay && ts < endOfDay;
    });
    dailyStats = recomputeDailyStats(salesHistory, dailyStats);
    persistPosState();

    menuItems = sanitizePosMenuItems(await getMenuItems().catch(() => []));

    // Load unpaid orders from Firestore so they survive cache clears
    await loadUnpaidOrdersFromFirestore().catch((error) => {
      console.warn("[POS] Failed to load unpaid orders from Firestore; using local fallback.", error);
      return loadUnpaidOrders();
    });
    updateUnpaidOrderSidebar();

    // Clear any stale cart data from previous sessions
    try { localStorage.removeItem("bb-pos-active-cart"); } catch {}

    persistPosState();
    renderCategoryControls();
    renderProducts();
    updateCart();
    applySavedCartDensity();
    updateStats();

    // Thermal printer: restore a previously connected printer and keep the UI
    // status in sync with connection state.
    onPrinterStatus(renderPrinterStatus);
    renderPrinterStatus(getPrinterStatus());
    if (isPrinterSupported()) {
      reconnectThermalPrinter().then((status) => renderPrinterStatus(status)).catch(() => {});
    }

    // Live update POS menu whenever Firestore changes
    watchMenuItems((items) => {
      if (Array.isArray(items) && items.length > 0) {
        menuItems = sanitizePosMenuItems(items);
      } else {
        menuItems = [];
      }
      persistPosState();
      renderCategoryControls();
      renderProducts(currentCategory);
      updateCart();
    }, (error) => {
      console.error("Menu listener failed:", error);
    });

    // Live-sync daily stats from Firestore so all terminals see shared sales
    watchTodayOrders(async (todayOrders, metadata) => {
      const now = Date.now();
      const startOfDay = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
      const endOfDay = startOfDay + 86400000;

      const queued = (typeof getQueuedOrders === "function" ? getQueuedOrders() : []).map((q) => q?.payload || q);
      // Only a server-confirmed snapshot is authoritative enough to prune:
      // offline cached snapshots can be stale/partial and would wrongly drop
      // orders that exist locally but have not been re-received yet. An EMPTY
      // snapshot is also treated as non-authoritative when today's orders were
      // archived by a day-end reset, because that empty feed then comes from
      // the reset deleting today's orders and pruning would wipe every
      // terminal's live drawer/stats mid-shift.
      if ((!metadata || metadata.fromCache !== true) && (await hasTodayResetMarker()) === false) {
        salesHistory = pruneStaleLocalOrders(salesHistory, todayOrders, queued);
      }
      salesHistory = mergeOrderLists(
        salesHistory,
        todayOrders,
        queued
      ).filter(o => {
        const ts = getSaleTimestampMs(o);
        return ts >= startOfDay && ts < endOfDay;
      });
      dailyStats = recomputeDailyStats(salesHistory, dailyStats);
      persistPosState();
      updateStats();
      refreshDrawerIfOpen();
    }, (error) => {
      console.warn("[POS] Order listener failed:", error);
    });

    // Storage indicator
    updateConnectivityStatus();

    // Show stats bar
    const statsBar = document.querySelector(".stats-bar");
    if (statsBar) statsBar.style.display = "flex";

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeMenuItemModal();
        closePaymentModal();
        closeReceipt();
        closeDrawerModal();
        closeLogoutModal();
        closeSalesDashboard();
        closePendingOrdersModal();
        closeDiscountPicker();
      }
    });

    window.addEventListener("online", async () => {
      isOnline = true;
      let result = { synced: 0, syncedAlerts: 0, deductionFailures: 0 };
      try {
        result = await syncQueuedOrders();
      } catch (error) {
        console.warn("[POS] Order sync failed:", error);
      }
      updateConnectivityStatus();
      let drawerSync = { synced: 0 };
      try {
        drawerSync = await syncDrawerLogOutbox();
      } catch (error) {
        console.warn("[POS] Drawer log sync failed:", error);
      }
      if (Number(drawerSync?.synced || 0) > 0) {
        showToast(`Synced ${drawerSync.synced} pending drawer log entr${drawerSync.synced > 1 ? "ies" : "y"}`, "success");
      }
      if (result.synced > 0) {
        showToast(`Synced ${result.synced} pending order(s)`, "success");
      }
      if (Number(result?.syncedAlerts || 0) > 0) {
        showToast(`${result.syncedAlerts} ingredient stock item(s) reached zero after sync.`, "warning");
      }
      if (Number(result?.deductionFailures || 0) > 0) {
        showToast(`${result.deductionFailures} synced order(s) were saved but inventory deduction failed. Please contact admin.`, "warning");
      }
    });

    window.addEventListener("offline", () => {
      isOnline = false;
      updateConnectivityStatus();
      showToast("You are offline. Orders will queue automatically.", "warning");
    });

    window.addEventListener("bb:inventory:deduction-failed", async (e) => {
      const orderId = e?.detail?.orderId;
      showToast("Inventory deduction failed. Retrying...", "warning");
      try {
        const retried = await retryFailedInventoryDeduction(orderId);
        if (retried) {
          showToast("Inventory deduction recovered on retry.", "success");
        } else {
          showToast("Inventory deduction still failing. Please contact admin.", "warning");
        }
      } catch {
        showToast("Inventory retry failed. Please contact admin.", "warning");
      }
    });

    if (navigator.onLine) {
      try {
        await syncQueuedOrders();
      } catch (error) {
        console.warn("[POS] Order sync failed:", error);
      }
      try {
        await syncDrawerLogOutbox();
      } catch (error) {
        console.warn("[POS] Drawer log sync failed:", error);
      }
      updateConnectivityStatus();
    }
  });
});

// ── PRODUCTS ──
export function renderProducts(filter = "all") {
  currentCategory = filter;
  const grid       = document.getElementById("productsGrid");
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();

  // Exclude any add-ons category variants (e.g. "addons", "Add-ons", "Add-ons Drink")
  let filtered = menuItems.filter(p => normalizeCategoryKey(p.category || "") !== "addons");
  if (filter !== "all") {
    filtered = filtered.filter(p => (p.category || "").toLowerCase() === filter.toLowerCase());
  }

  if (searchTerm) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchTerm) ||
      (p.category || '').toLowerCase().includes(searchTerm)
    );
  }

  const grouped = filtered.reduce((acc, item) => {
    const rawCategory = item.category || 'Uncategorized';
    const cat = getCategoryMeta(rawCategory).name || rawCategory;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  if (!Object.keys(grouped).length) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);">No items found</div>';
    return;
  }

  let html = "";
  // Order groups using the menu categories order so UI matches category chips.
  const orderKeys = getMenuCategories().map((c) => normalizeCategoryKey(getCategoryMeta(c).name || c));

  const sortedGroups = Object.entries(grouped)
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => {
      const aKey = normalizeCategoryKey(getCategoryMeta(a.category).name || a.category);
      const bKey = normalizeCategoryKey(getCategoryMeta(b.category).name || b.category);
      const ai = orderKeys.indexOf(aKey);
      const bi = orderKeys.indexOf(bKey);
      if (ai === -1 && bi === -1) return aKey.localeCompare(bKey);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  sortedGroups.forEach((group) => {
    const { category } = group;
    const items = [...group.items].sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
    const catData = getCategoryMeta(category);
    html += `
      <section class="products-category-section">
        <div class="products-category-heading"><span class="products-category-icon">${catData.icon}</span><span>${escapeHtml(catData.name)}</span></div>
        <div class="products-category-items">${items.map(p => buildProductCard(p)).join("")}</div>
      </section>
    `;
  });

  grid.innerHTML = html;
}

function getCategoryDisplay(catParam) {
  if (catParam === 'all') return '<span class="category-chip-icon-wrap"><span class="category-chip-icon">📑</span></span><span class="category-chip-label">All Items</span>';
  const c = getCategoryMeta(catParam);
  const icon = c.icon;
  const name = c.name;
  return `<span class="category-chip-icon-wrap"><span class="category-chip-icon">${escapeHtml(icon)}</span></span><span class="category-chip-label">${escapeHtml(name)}</span>`;
}

function getCategoryOptionLabel(catParam) {
  if (catParam === "all") return "All Items";
  return getCategoryMeta(catParam).name;
}

function getCategoryMeta(catParam) {
  const raw = String(catParam || "").trim();
  if (!raw) return { name: "Uncategorized", icon: "📦" };

  const normalized = normalizeCategoryKey(raw);
  const category = globalCategories.find((entry) => {
    const idMatch = String(entry?.id || "").trim().toLowerCase() === normalized;
    const name = String(entry?.name || "").trim();
    const nameNormalized = normalizeCategoryKey(name);
    return idMatch || nameNormalized === normalized;
  });

  if (category) {
    return {
      name: category.name || raw,
      icon: category.icon || getCategoryIconForName(category.name || raw),
    };
  }

  return {
    name: toTitleCase(raw),
    icon: getCategoryIconForName(raw),
  };
}

function getMenuCategories() {
  const available = new Set(
    menuItems
      .map((item) => String(item?.category || "").trim())
      .filter((category) => category && category.toLowerCase() !== "addons")
  );

  const ordered = [];
  for (const category of globalCategories) {
    const match = Array.from(available).find((value) => normalizeCategoryKey(getCategoryMeta(value).name) === normalizeCategoryKey(getCategoryMeta(category.id || category.name).name));
    if (match && !ordered.includes(match)) {
      ordered.push(match);
      available.delete(match);
    }
  }

  // Ensure Coffee appears first (if present) and Add-ons appears last (if present).
  const normalizedName = (val) => normalizeCategoryKey(getCategoryMeta(val).name || String(val || ""));

  // Find any coffee-like and addons-like entries from the ordered list or remaining available set
  const allCandidates = [...ordered, ...Array.from(available)];
  const coffeeMatch = allCandidates.find((v) => normalizedName(v).includes("coffee"));
  const addonsMatch = allCandidates.find((v) => normalizedName(v).includes("addon") || normalizedName(v).includes("add-ons"));

  const finalOrdered = [];
  const seen = new Set();
  const pushUnique = (value) => {
    const key = normalizedName(value);
    if (seen.has(key)) return;
    seen.add(key);
    finalOrdered.push(value);
  };

  if (coffeeMatch) {
    pushUnique(coffeeMatch);
  }

  // Add remaining categories except coffee/addons, preserving the earlier ordering
  for (const c of ordered) {
    if (coffeeMatch && normalizedName(c) === normalizedName(coffeeMatch)) continue;
    if (addonsMatch && normalizedName(c) === normalizedName(addonsMatch)) continue;
    pushUnique(c);
  }

  // Finally append any leftover available categories (that weren't in ordered),
  // collapsed by normalized name so case/whitespace variants like "starter" and
  // "Starter" never render as two separate chips.
  for (const c of Array.from(available).sort((a, b) => a.localeCompare(b))) {
    if (coffeeMatch && normalizedName(c) === normalizedName(coffeeMatch)) continue;
    if (addonsMatch && normalizedName(c) === normalizedName(addonsMatch)) continue;
    pushUnique(c);
  }

  if (addonsMatch) {
    pushUnique(addonsMatch);
  }

  return finalOrdered;
}

function canonicalizeCategorySelection(category, categories = getMenuCategories()) {
  const raw = String(category || "").trim();
  if (!raw || normalizeCategoryKey(raw) === "all") return "all";

  const exactMatch = categories.find((value) => normalizeCategoryKey(value) === normalizeCategoryKey(raw));
  return exactMatch || raw;
}

function isSameCategory(left, right) {
  return normalizeCategoryKey(left) === normalizeCategoryKey(right);
}

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/\s+/g, " ");
}

function toTitleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Uncategorized";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function updateCategorySelectLabel(cat) {
  const button = document.getElementById("categoryQuickSelectButton");
  if (!button) return;
  button.innerHTML = getCategoryDisplay(cat);
  button.setAttribute("aria-expanded", "false");
  closeCategoryQuickMenu();
}

function syncCategorySelectionUi(cat) {
  document.querySelectorAll("#categories .category-chip").forEach(chip => {
    chip.classList.toggle("active", isSameCategory(chip.dataset.category, cat));
  });
}

function renderCategoryControls() {
  const categoriesHost = document.getElementById("categories");
  const quickButton = document.getElementById("categoryQuickSelectButton");
  const quickMenu = document.getElementById("categoryQuickMenu");
  if (!categoriesHost || !quickButton || !quickMenu) return;

  const categories = getMenuCategories();
  currentCategory = canonicalizeCategorySelection(currentCategory, categories);

  categoriesHost.innerHTML = ["all", ...categories]
    .map(cat => `<button type="button" class="category-chip ${isSameCategory(cat, currentCategory) ? "active" : ""}" data-category="${escapeHtml(cat)}" onclick='selectCategory(${JSON.stringify(cat)}, this)'>${getCategoryDisplay(cat)}</button>`)
    .join("");

  quickButton.innerHTML = getCategoryDisplay(currentCategory);
  quickMenu.innerHTML = ["all", ...categories]
    .map(cat => `<button type="button" class="category-quick-menu-item${isSameCategory(cat, currentCategory) ? " is-selected" : ""}" onclick='selectCategory(${JSON.stringify(cat)})'>${getCategoryDisplay(cat)}</button>`)
    .join("");
}

window.toggleCategoryQuickMenu = function() {
  const wrap = document.getElementById("categoryQuickSelectWrap");
  if (!wrap) return;
  const isOpen = wrap.classList.toggle("is-open");
  document.getElementById("categoryQuickSelectButton").setAttribute("aria-expanded", String(isOpen));
};

function closeCategoryQuickMenu() {
  const wrap = document.getElementById("categoryQuickSelectWrap");
  if (!wrap) return;
  wrap.classList.remove("is-open");
  document.getElementById("categoryQuickSelectButton").setAttribute("aria-expanded", "false");
}

window.addEventListener("click", (event) => {
  const wrap = document.getElementById("categoryQuickSelectWrap");
  if (!wrap) return;
  if (!wrap.contains(event.target)) {
    closeCategoryQuickMenu();
  }
});

window.selectCategory = function(cat, chipEl = null) {
  currentCategory = canonicalizeCategorySelection(cat);
  // Rebuild controls so the quick-menu selected row stays in sync with the header button.
  renderCategoryControls();
  syncCategorySelectionUi(currentCategory);
  renderProducts(currentCategory);
  updateCategorySelectLabel(currentCategory);
};

window.scrollCategories = function(direction = 1) {
  const host = document.getElementById("categories");
  if (!host) return;
  host.scrollBy({ left: direction * 220, behavior: "smooth" });
};
function buildProductCard(product) {
  const badge = product.bestseller ? "BEST" : product.popular ? "POP" : "";
  const productMeta = getCategoryMeta(product.category);
  const productIdLiteral = JSON.stringify(String(product.id ?? ""));
  return `<div class="product-card" onclick='openMenuItemModal(${productIdLiteral})'>
    <div class="product-card-top">
      <div class="product-icon-badge">${productMeta.icon}</div>
      ${badge ? `<span class="product-badge">${badge}</span>` : ""}
    </div>
    <div class="product-name">${escapeHtml(product.name)}${product.note ? `<span class="product-note">${escapeHtml(product.note)}</span>` : ""}</div>
    <div class="product-price">₱${Number(product.price || 0).toFixed(2)}</div>
    <div class="product-category">${escapeHtml(productMeta.name)}</div>
  </div>`;
}

function sanitizePosMenuItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    // If item is persisted in Firestore (has a firestoreId), prefer it
    // over template defaults so user-created items aren't hidden.
    if (item?.firestoreId) return true;
    if (item?.previewOnly === true || item?.templateOnly === true) return false;
    if (isDefaultTemplateMenuItem(item)) return false;
    return true;
  });
}

// ── MENU ITEM MODAL ──
window.openMenuItemModal = function(productId) {
  const normalizedId = String(productId ?? "");
  const product = menuItems.find((p) => String(p.id ?? "") === normalizedId);
  if (!product) return;

  activeProductId = productId;
  selectedVariant = null;
  selectedTemp = null;
  selectedAddons = [];
  selectedQty = 1;

  const overlay = document.getElementById("variantModal");
  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
  document.getElementById("menuModalTitle").textContent = product.name;

  renderMenuItemModal();
};

window.closeMenuItemModal = function() {
  const overlay = document.getElementById("variantModal");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
  activeProductId = null;
};

function getEligibleAddons(product) {
  const normalizeAddons = (addons, idPrefix) => {
    if (!Array.isArray(addons)) return [];
    return addons
      .map((addon, index) => ({
        id: String(addon?.id || `${idPrefix}-${index + 1}`),
        name: String(addon?.name || "").trim(),
        price: Number(addon?.price || 0),
        recipe: Array.isArray(addon?.recipe)
          ? addon.recipe
              .map((ingredient) => ({
                inventoryId: String(ingredient?.inventoryId || "").trim(),
                name: String(ingredient?.name || "").trim(),
                quantity: Number(ingredient?.quantity || 0),
                unit: String(ingredient?.unit || "").trim(),
              }))
              .filter((ingredient) => ingredient.inventoryId && ingredient.quantity > 0)
          : [],
      }))
      .filter((addon) => addon.name);
  };

  const normalizedProductCategory = normalizeCategoryKey(product?.category || "");
  const matchedCategory = (Array.isArray(globalCategories) ? globalCategories : []).find((category) => {
    const idKey = normalizeCategoryKey(category?.id || "");
    const nameKey = normalizeCategoryKey(category?.name || "");
    return normalizedProductCategory && (normalizedProductCategory === idKey || normalizedProductCategory === nameKey);
  });

  const categoryHasAddonConfig = !!(matchedCategory && Array.isArray(matchedCategory.addons));
  const categoryAddons = categoryHasAddonConfig
    ? normalizeAddons(matchedCategory?.addons || [], `addon-cat-${matchedCategory?.id || matchedCategory?.name || "category"}`)
    : [];
  if (categoryHasAddonConfig) {
    return { label: "Add-ons", addons: categoryAddons };
  }

  if (Array.isArray(product?.addons) && product.addons.length > 0) {
    const normalizedAddons = normalizeAddons(product.addons, `addon-${product.id || "item"}`);
    return { label: "Add-ons", addons: normalizedAddons };
  }

  const rawDrinkAddons = menuItems.filter(i =>
    i.category === "addons" || i.category === "Add-ons" || i.category === "Add-ons Drink"
  );
  const drinkAddons = normalizeAddons(rawDrinkAddons, "fallback-drink");
  const rawFoodAddons = menuItems.filter(i =>
    i.category === "addons" || i.category === "Add-ons" || i.category === "Add-ons Food"
  );
  const foodAddons = normalizeAddons(rawFoodAddons, "fallback-food");
  const productCategory = product.category;
  const drinkCats = ["coffee", "oat series", "coconut series", "matcha series", "non-dairy specials", "non-coffee"];  

  if (drinkCats.includes(productCategory)) {
    return { label: "Add-ons", addons: drinkAddons };
  }

  if (["rice meals", "starter", "sandwiches", "pasta"].includes(productCategory)) {
    return { label: "Add-ons", addons: foodAddons };
  }

  return { label: "Add-ons", addons: [] };
}

function computeActiveItemTotal(product) {
  const basePrice = selectedVariant ? selectedVariant.price : product.price;
  const addonsTotal = (selectedAddons || []).reduce((s, a) => s + (a.price || 0), 0);
  return (basePrice + addonsTotal) * (selectedQty || 1);
}

function canConfirmMenuItem(product) {
  if (product.hasVariant && !selectedVariant) return false;
  if (product.hasTemp && !selectedTemp) return false;
  return true;
}

function renderMenuItemModal() {
  const product = menuItems.find(p => p.id === activeProductId);
  if (!product) return;

  const body = document.getElementById("menuModalBody");
  const { addons } = getEligibleAddons(product);

  const variantBlock = product.hasVariant && Array.isArray(product.variants) ? `
    <div class="bb-field">
      <div class="bb-field-label">Choose size</div>
      <div class="bb-choice-grid">
        ${product.variants.map(v => `
          <button class="bb-choice ${selectedVariant?.name === v.name ? "is-selected" : ""}" type="button"
            onclick='selectMenuVariant(${JSON.stringify(v.name)}, ${v.price})'>
            <span class="bb-choice-main">${escapeHtml(v.name)}</span>
            <span class="bb-choice-sub">₱${Number(v.price).toFixed(2)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  ` : "";

  const tempBlock = product.hasTemp ? `
    <div class="bb-field">
      <div class="bb-field-label">Temperature</div>
      <div class="bb-pill-row">
        <button class="bb-pill hot ${selectedTemp === "Hot" ? "is-selected" : ""}" type="button" onclick="selectMenuTemp('Hot')"><i class="ri-fire-line" aria-hidden="true"></i> Hot</button>
        <button class="bb-pill iced ${selectedTemp === "Iced" ? "is-selected" : ""}" type="button" onclick="selectMenuTemp('Iced')"><i class="ri-snowy-line" aria-hidden="true"></i> Iced</button>
      </div>
    </div>
  ` : "";

  const addonsBlock = addons.length ? `
    <div class="bb-field">
      <div class="bb-field-label">Add-ons <span class="bb-field-hint">(optional)</span></div>
      <div class="bb-addon-grid">
        ${addons.map((a) => {
          const addonIdLiteral = JSON.stringify(String(a.id ?? ""));
          return `
          <button class="bb-addon ${selectedAddons.some(x => String(x.id ?? "") === String(a.id ?? "")) ? "is-selected" : ""}" type="button"
            onclick='toggleMenuAddon(${addonIdLiteral})'>
            <span class="bb-addon-name">${escapeHtml(a.name)}</span>
            <span class="bb-addon-price">+₱${Number(a.price).toFixed(2)}</span>
          </button>
        `;
        }).join("")}
      </div>
    </div>
  ` : "";

  body.innerHTML = `
    <div class="bb-modal-grid">
      <div class="bb-left">
        ${variantBlock}
        ${tempBlock}
        ${addonsBlock}
      </div>
      <div class="bb-right">
        <div class="bb-qty-card">
          <div class="bb-field-label">Quantity</div>
          <div class="bb-stepper" role="group" aria-label="Quantity">
            <button class="bb-step" type="button" onclick="changeMenuQty(-1)" ${selectedQty <= 1 ? "disabled" : ""}>−</button>
            <div class="bb-step-value">${selectedQty}</div>
            <button class="bb-step" type="button" onclick="changeMenuQty(1)">+</button>
          </div>
          <div class="bb-mini-note">${escapeHtml(product.category || "")}</div>
        </div>

        <div class="bb-recap">
          <div class="bb-recap-row"><span>Retail</span><span>₱${(selectedVariant ? selectedVariant.price : product.price).toFixed(2)}</span></div>
          <div class="bb-recap-row"><span>Add-ons</span><span>₱${selectedAddons.reduce((s,a)=>s+a.price,0).toFixed(2)}</span></div>
          <div class="bb-recap-row bb-recap-strong"><span>Total</span><span>₱${computeActiveItemTotal(product).toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("menuQtySummary").textContent = String(selectedQty);
  document.getElementById("menuItemTotal").textContent = `₱${computeActiveItemTotal(product).toFixed(2)}`;
  document.getElementById("menuAddBtn").disabled = !canConfirmMenuItem(product);
}

window.selectMenuVariant = function(name, price) {
  selectedVariant = { name, price };
  renderMenuItemModal();
};

window.selectMenuTemp = function(temp) {
  selectedTemp = temp;
  renderMenuItemModal();
};

window.toggleMenuAddon = function(addonId) {
  const product = menuItems.find((p) => String(p.id ?? "") === String(activeProductId ?? ""));
  const { addons: eligibleAddons } = getEligibleAddons(product || {});
  const addon = eligibleAddons.find((i) => String(i.id ?? "") === String(addonId ?? ""));
  if (!addon) return;
  const idx = selectedAddons.findIndex(a => String(a.id ?? "") === String(addonId ?? ""));
  if (idx > -1) selectedAddons.splice(idx, 1);
  else selectedAddons.push(addon);
  renderMenuItemModal();
};

window.changeMenuQty = function(delta) {
  selectedQty = Math.max(1, (selectedQty || 1) + delta);
  renderMenuItemModal();
};

window.confirmMenuItem = function() {
  const productId = activeProductId;
  const product = menuItems.find(p => p.id === productId);
  if (!product) return;

  if (!canConfirmMenuItem(product)) return;

  const price    = selectedVariant ? selectedVariant.price : product.price;
  const variant  = selectedVariant ? selectedVariant.name  : null;
  const temp     = product.hasTemp ? (selectedTemp || null) : null;
  const addons   = [...selectedAddons];

  const existingIdx = cart.findIndex(i =>
    i.id === product.id &&
    i.variant     === variant &&
    i.temperature === temp &&
    JSON.stringify(i.addons) === JSON.stringify(addons) &&
    Number(i.discountPercent || 0) === 0
  );

  const qtyToAdd = Math.max(1, selectedQty || 1);
  if (existingIdx > -1) {
    cart[existingIdx].quantity += qtyToAdd;
  } else {
    const baseRecipe = Array.isArray(product.recipe)
      ? product.recipe.map((ing) => ({
          inventoryId: ing.inventoryId,
          name: ing.name || "",
          quantity: Number(ing.quantity || 0),
          unit: String(ing.unit || "").trim(),
        }))
      : [];

    const addonRecipe = selectedAddons.flatMap((addon) =>
      Array.isArray(addon?.recipe)
        ? addon.recipe.map((ing) => ({
            inventoryId: ing.inventoryId,
            name: ing.name || addon.name || "",
            quantity: Number(ing.quantity || 0),
            unit: String(ing.unit || "").trim(),
          }))
        : []
    );

    const recipe = [...baseRecipe, ...addonRecipe].filter(
      (ing) => String(ing.inventoryId || "").trim() && Number(ing.quantity || 0) > 0
    );

    cart.push({ id: product.id, name: product.name, price, variant, temperature: temp, addons, quantity: qtyToAdd, discountPercent: 0, recipe });
  }

  selectedVariant   = null;
  selectedTemp      = null;
  selectedAddons    = [];
  selectedQty       = 1;
  closeMenuItemModal();
  renderProducts(currentCategory);
  updateCart();
  showToast(`${product.name} added to order!`, "success");
};

// ── CART ──
export function updateCart() {
  const cartEl    = document.getElementById("cartItems");
  const subtotalEl = document.getElementById("subtotal");
  const totalEl   = document.getElementById("total");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const moveUnpaidBtn = document.getElementById("moveUnpaidBtn");
  const clearOrderBtn = document.getElementById("clearOrderBtn");
  updateUnpaidOrderSidebar();

  if (!cart.length) {
    cartEl.innerHTML = `<div class="empty-cart"><div class="empty-cart-icon"><i class="ri-shopping-cart-line" aria-hidden="true"></i></div><p>Your order is empty</p><p style="font-size:13px;margin-top:5px;">Click items from the menu to add</p></div>`;
    subtotalEl.textContent = "₱0.00";
    totalEl.textContent    = "₱0.00";
    checkoutBtn.disabled   = true;
    if (moveUnpaidBtn) moveUnpaidBtn.disabled = true;
    if (clearOrderBtn) clearOrderBtn.disabled = true;
    const discountRow      = document.getElementById("discountRow");
    const originalTotalRow = document.getElementById("originalTotalRow");
    if (discountRow) discountRow.classList.add("hidden");
    if (originalTotalRow) originalTotalRow.classList.add("hidden");
    updateUnpaidOrderSidebar();
    return;
  }

  const { subtotal, total } = getCartSummary(cart);

  cartEl.innerHTML = cart.map((item, idx) => {
    const addonTotal = (item.addons || []).reduce((a, x) => a + x.price, 0);
    const discountedUnit = (item.price + addonTotal) * (1 - (item.discountPercent || 0));
    const lineTotal  = discountedUnit * item.quantity;
    return `<div class="cart-item">
      <div class="cart-item-details">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        ${item.variant ? `<div class="cart-item-variant">${escapeHtml(item.variant)}</div>` : ""}
        ${item.temperature && item.temperature !== "N/A" ? `<div class="cart-item-variant">${escapeHtml(item.temperature)}</div>` : ""}
        ${(item.addons||[]).length ? `<div class="cart-item-addons">${item.addons.map(a=>`<span class="cart-addon-tag">+${escapeHtml(a.name)}</span>`).join("")}</div>` : ""}
        ${item.discountPercent > 0 ? `<div class="cart-item-discount">-${Math.round(item.discountPercent * 100)}% OFF</div>` : ''}
        <div class="cart-item-price">₱${lineTotal.toFixed(2)}</div>
      </div>
      <div class="discount-controls">
        <button class="discount-toggle-btn" onclick="window.toggleItemDiscount(${idx})">
          ${item.discountPercent > 0 ? '<i class="ri-money-dollar-circle-line" aria-hidden="true"></i> OFF' : '<i class="ri-money-dollar-circle-line" aria-hidden="true"></i> 20%'}
        </button>
      </div>
      <div class="quantity-controls">
        <button class="qty-btn" onclick="window._updateQty(${idx},-1)">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button class="qty-btn" onclick="window._updateQty(${idx},1)">+</button>
      </div>
      <span class="remove-btn" onclick="window._removeItem(${idx})"><i class="ri-close-line" aria-hidden="true"></i></span>
    </div>`;
  }).join("");

  subtotalEl.textContent = `₱${subtotal.toFixed(2)}`;
  totalEl.textContent    = `₱${total.toFixed(2)}`;
  checkoutBtn.disabled   = false;
  if (moveUnpaidBtn) moveUnpaidBtn.disabled = false;
  if (clearOrderBtn) clearOrderBtn.disabled = false;

  // Discount rows
  const discountRow      = document.getElementById("discountRow");
  const originalTotalRow = document.getElementById("originalTotalRow");
  const discountAmount   = document.getElementById("discountAmount");
  const originalTotal    = document.getElementById("originalTotal");
  if (isPwdSenior) {
    discountRow.classList.remove("hidden");
    originalTotalRow.classList.remove("hidden");
    discountAmount.textContent = `-₱${(subtotal * 0.2).toFixed(2)}`;
    originalTotal.textContent  = `₱${subtotal.toFixed(2)}`;
  } else {
    discountRow.classList.add("hidden");
    originalTotalRow.classList.add("hidden");
  }

  updateUnpaidOrderSidebar();
}

window._updateQty = function(idx, change) {
  cart[idx].quantity += change;
  if (cart[idx].quantity <= 0) cart.splice(idx, 1);
  updateCart();
};

window._removeItem = function(idx) {
  cart.splice(idx, 1);
  updateCart();
};

window.toggleItemDiscount = function(idx) {
  const item = cart[idx];
  if (!item) return;

  if (item.quantity > 1) {
    openDiscountPicker(idx);
    return;
  }

  const isTurningOn = item.discountPercent <= 0;
  item.discountPercent = isTurningOn ? 0.20 : 0;

  if (!isTurningOn) {
    const matchIdx = cart.findIndex((other, i) =>
      i !== idx &&
      other.id === item.id &&
      other.variant === item.variant &&
      other.temperature === item.temperature &&
      other.discountPercent <= 0 &&
      JSON.stringify(other.addons) === JSON.stringify(item.addons)
    );
    if (matchIdx > -1) {
      cart[matchIdx].quantity += item.quantity;
      cart.splice(idx, 1);
    }
  }

  showToast(isTurningOn ? 'Item discount enabled (20%)' : 'Item discount disabled', 'success');
  updateCart();
};

// ── DISCOUNT PICKER ──
let _discountPickerIdx = -1;
let _discountPickerSelected = 0;

window.openDiscountPicker = function(idx) {
  const item = cart[idx];
  if (!item || item.quantity <= 1) return;

  _discountPickerIdx = idx;

  const totalQty = getTotalMatchingQty(item);
  const alreadyDiscountedUnits = getAlreadyDiscountedCount(item);
  _discountPickerSelected = Math.min(alreadyDiscountedUnits, totalQty);

  document.getElementById("discountPickerItemName").textContent = item.name;
  renderDiscountPickerGrid(totalQty, _discountPickerSelected);
  updateDiscountPickerHint(totalQty);
  updateDiscountPickerApplyBtn();

  const modal = document.getElementById("discountPickerModal");
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

function getTotalMatchingQty(item) {
  return cart.reduce((sum, ci) => {
    if (ci.id !== item.id || ci.variant !== item.variant || ci.temperature !== item.temperature) return sum;
    if (JSON.stringify(ci.addons) !== JSON.stringify(item.addons)) return sum;
    return sum + ci.quantity;
  }, 0);
}

function getAlreadyDiscountedCount(item) {
  return cart.reduce((count, ci) => {
    if (ci.id !== item.id || ci.variant !== item.variant || ci.temperature !== item.temperature) return count;
    if (JSON.stringify(ci.addons) !== JSON.stringify(item.addons)) return count;
    if (ci.discountPercent > 0) return count + ci.quantity;
    return count;
  }, 0);
}

function renderDiscountPickerGrid(maxQty, alreadyDiscounted) {
  const grid = document.getElementById("discountPickerGrid");
  let html = "";
  for (let n = 0; n <= maxQty; n++) {
    const isSelected = n === _discountPickerSelected;
    const label = n === 0 ? "None" : `${n}`;
    const sub = n === 0 ? "No discount" : n === maxQty ? "All units" : "";
    html += `<button class="bb-discount-picker-btn${isSelected ? " is-selected" : ""}" type="button" onclick="selectDiscountPickerQty(${n})">
      <span>${label}</span>
      ${sub ? `<span class="bb-discount-picker-btn-sub">${sub}</span>` : ""}
    </button>`;
  }
  grid.innerHTML = html;
}

function updateDiscountPickerHint(maxQty) {
  const hint = document.getElementById("discountPickerHint");
  const unitPrice = cart[_discountPickerIdx]?.price || 0;
  const savings = (_discountPickerSelected * unitPrice * 0.20).toFixed(2);
  hint.textContent = _discountPickerSelected > 0
    ? `${_discountPickerSelected} of ${maxQty} unit(s) will be 20% off — saves ₱${savings}`
    : `Select how many of ${maxQty} unit(s) to discount`;
}

function updateDiscountPickerApplyBtn() {
  const btn = document.getElementById("discountPickerApplyBtn");
  btn.disabled = false;
}

window.selectDiscountPickerQty = function(qty) {
  _discountPickerSelected = qty;
  const item = cart[_discountPickerIdx];
  if (!item) return;
  const totalQty = getTotalMatchingQty(item);
  renderDiscountPickerGrid(totalQty, qty);
  updateDiscountPickerHint(totalQty);
};

window.applyDiscountPicker = function() {
  const idx = _discountPickerIdx;
  const item = cart[idx];
  if (!item) { closeDiscountPicker(); return; }

  const targetDiscountedQty = _discountPickerSelected;
  const currentDiscountedQty = getAlreadyDiscountedCount(item);

  if (targetDiscountedQty === currentDiscountedQty) {
    closeDiscountPicker();
    return;
  }

  const matchEntries = cart.filter((ci, i) =>
    i !== idx &&
    ci.id === item.id &&
    ci.variant === item.variant &&
    ci.temperature === item.temperature &&
    JSON.stringify(ci.addons) === JSON.stringify(item.addons)
  );

  const mergedQty = matchEntries.reduce((s, ci) => s + ci.quantity, 0) + item.quantity;
  const matchIndices = matchEntries.map((_, i) => cart.indexOf(matchEntries[i])).sort((a, b) => b - a);

  let removalsBefore = 0;
  for (const mi of matchIndices) {
    if (mi < idx) removalsBefore++;
    cart.splice(mi, 1);
  }

  const adjustedIdx = idx - removalsBefore;
  if (adjustedIdx < 0 || adjustedIdx >= cart.length) { closeDiscountPicker(); updateCart(); return; }

  const base = cart[adjustedIdx];
  const baseClone = { ...base, addons: cloneValue(base.addons || []), recipe: cloneValue(base.recipe || []) };

  cart.splice(adjustedIdx, 1);

  const insertAt = Math.min(adjustedIdx, cart.length);
  if (targetDiscountedQty > 0 && targetDiscountedQty < mergedQty) {
    const discounted = { ...baseClone, quantity: targetDiscountedQty, discountPercent: 0.20 };
    const remaining = { ...baseClone, quantity: mergedQty - targetDiscountedQty, discountPercent: 0 };
    cart.splice(insertAt, 0, discounted, remaining);
  } else if (targetDiscountedQty >= mergedQty) {
    cart.splice(insertAt, 0, { ...baseClone, quantity: mergedQty, discountPercent: 0.20 });
  } else {
    cart.splice(insertAt, 0, { ...baseClone, quantity: mergedQty, discountPercent: 0 });
  }

  closeDiscountPicker();
  showToast(targetDiscountedQty > 0 ? `${targetDiscountedQty} unit(s) discounted (20%)` : 'Discount removed', 'success');
  updateCart();
};

window.closeDiscountPicker = function() {
  const modal = document.getElementById("discountPickerModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
  _discountPickerIdx = -1;
  _discountPickerSelected = 0;
};

window.clearCart = function() {
  if (!cart.length) return;

  cart = [];
  isPwdSenior = false;
  isEmployeeOrder = false;
  const nameInput = document.getElementById("orderNameInput");
  if (nameInput) nameInput.value = "";
  const pwdCheck = document.getElementById("pwdSeniorCheck");
  const discountToggle = document.getElementById("discountToggle");
  if (pwdCheck) { pwdCheck.checked = false; pwdCheck.disabled = false; }
  if (discountToggle) discountToggle.classList.remove("active");
  document.querySelector(".discount-section")?.classList.remove("is-active");
  const empCheck = document.getElementById("employeeOrderCheck");
  empCheck.checked = false;
  empCheck.disabled = false;
  document.getElementById("employeeOrderToggle")?.classList.remove("active");
  document.querySelector(".employee-order-section")?.classList.remove("is-active");
  updateCart();
  showToast("Order cleared", "success");
};

function updateUnpaidOrderSidebar() {
  const unpaidCountEl = document.getElementById("unpaidOrderOpenCount");
  const unpaidBtn = document.getElementById("unpaidOrderOpenBtn");
  const unpaidOrders = getUnpaidOrders();
  const unpaidCount = Array.isArray(unpaidOrders) ? unpaidOrders.length : 0;

  if (unpaidCountEl) unpaidCountEl.textContent = String(unpaidCount);
  if (unpaidBtn) {
    unpaidBtn.textContent = "View unpaid orders";
  }
}

function buildUnpaidOrderFromCart() {
  const summary = getCartSummary(cart);
  return {
    id: `unpaid_${Date.now()}`,
    orderId: `UN-${String(Date.now()).slice(-6)}`,
    timestamp: new Date().toLocaleString(),
    paymentMethod: currentPayMethod,
    isPwdSenior,
    isEmployeeOrder,
    subtotal: summary.subtotal,
    discountAmount: isPwdSenior ? summary.subtotal * 0.2 : 0,
    total: summary.total,
    amountTendered: summary.total,
    change: 0,
    items: cloneValue(cart) || [],
    cashierUid: getCurrentUser()?.uid || "",
    cashierName,
    customerName: (document.getElementById("orderNameInput")?.value || "").trim(),
    unpaid: true,
  };
}

window.moveCurrentOrderToUnpaid = async function() {
  if (!cart.length) return;

  await addUnpaidOrder(buildUnpaidOrderFromCart());
  cart = [];
  isPwdSenior = false;
  isEmployeeOrder = false;
  enteredAmount = "";
  const nameInput = document.getElementById("orderNameInput");
  if (nameInput) nameInput.value = "";
  const pwdCheck = document.getElementById("pwdSeniorCheck");
  const discountToggle = document.getElementById("discountToggle");
  if (pwdCheck) { pwdCheck.checked = false; pwdCheck.disabled = false; }
  if (discountToggle) discountToggle.classList.remove("active");
  document.querySelector(".discount-section")?.classList.remove("is-active");
  const empCheck = document.getElementById("employeeOrderCheck");
  empCheck.checked = false;
  empCheck.disabled = false;
  document.getElementById("employeeOrderToggle")?.classList.remove("active");
  document.querySelector(".employee-order-section")?.classList.remove("is-active");
  updateCart();
  updateUnpaidOrderSidebar();
  showToast("Current order moved to unpaid.", "success");
};

window.openUnpaidOrdersModal = function() {
  const modal = document.getElementById("unpaidOrdersModal");
  if (!modal) return;
  renderUnpaidOrdersList();
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

window.closeUnpaidOrdersModal = function() {
  const modal = document.getElementById("unpaidOrdersModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
};

function renderUnpaidOrdersList() {
  const orders = getUnpaidOrders();
  const listEl = document.getElementById("unpaidOrdersModalList");
  if (!listEl) return;

  if (!orders.length) {
    listEl.innerHTML = '<div class="sidebar-pending-empty">No unpaid orders</div>';
    return;
  }

  listEl.innerHTML = orders.map((order) => {
    const itemNames = Array.isArray(order.items)
      ? order.items.slice(0, 2).map(i => escapeHtml(i.name)).join(", ") + (order.items.length > 2 ? ", ..." : "")
      : "No items";
    const timestamp = order.timestamp || "--";
    const total = Number(order.total) || 0;
    return `
      <div class="sidebar-pending-item">
        <div onclick='openUnpaidOrderReceipt(${JSON.stringify(order.id)})'>
          <div class="sidebar-pending-order">#${String(order.orderId || order.id || "").slice(-6) || "—"}</div>
          <div class="sidebar-pending-meta">${timestamp} · ${itemNames}</div>
          <div class="sidebar-pending-meta">Total: ₱${total.toFixed(2)}</div>
        </div>
        <div class="unpaid-item-actions">
          <button class="sidebar-pending-button" type="button" onclick='event.stopPropagation(); restoreUnpaidOrderToCart(${JSON.stringify(order.id)})'>Restore</button>
          <button class="sidebar-pending-button unpaid-delete-btn" type="button" onclick='event.stopPropagation(); deleteUnpaidOrder(${JSON.stringify(order.id)})'>Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

window.openUnpaidOrderReceipt = function(orderId) {
  const orders = getUnpaidOrders();
  const order = orders.find((o) => String(o.id) === String(orderId));
  if (!order) {
    showToast("Unpaid order not found.", "warning");
    return;
  }

  generateReceipt({ ...order, unpaid: true, _id: order.id });
  const receiptModal = document.getElementById("receiptModal");
  if (receiptModal) {
    const restoreBtn = document.getElementById("receiptRestoreBtn");
    if (restoreBtn) {
      restoreBtn.onclick = function() { restoreUnpaidOrderToCart(orderId); };
    }
    receiptModal.style.zIndex = '11000';
    receiptModal.classList.add("active");
    receiptModal.setAttribute('aria-hidden', 'false');
  }
};

window.restoreUnpaidOrderToCart = async function(orderId) {
  const orders = getUnpaidOrders();
  const unpaid = orderId ? orders.find((o) => String(o.id) === String(orderId)) : null;
  if (!unpaid) {
    showToast("Unpaid order not found.", "warning");
    return;
  }

  if (cart.length) {
    const replace = await window.askConfirm({
      title: "Replace current order",
      message: "Current order has items. Replace it with the unpaid order?",
      okText: "Replace",
      danger: true,
    });
    if (!replace) return;
  }

  cart = cloneValue(unpaid.items) || [];
  isPwdSenior = !!unpaid.isPwdSenior;
  isEmployeeOrder = !!unpaid.isEmployeeOrder;
  currentPayMethod = unpaid.paymentMethod || currentPayMethod;
  const nameInput = document.getElementById("orderNameInput");
  if (nameInput) nameInput.value = String(unpaid.customerName || "");
  const pwdCheck = document.getElementById("pwdSeniorCheck");
  const discountToggle = document.getElementById("discountToggle");
  const empCheck = document.getElementById("employeeOrderCheck");
  const empToggle = document.getElementById("employeeOrderToggle");
  const empSection = document.querySelector(".employee-order-section");
  if (pwdCheck) pwdCheck.checked = isPwdSenior;
  if (discountToggle) discountToggle.classList.toggle("active", isPwdSenior);
  document.querySelector(".discount-section")?.classList.toggle("is-active", isPwdSenior);
  if (empCheck) empCheck.checked = isEmployeeOrder;
  if (empToggle) empToggle.classList.toggle("active", isEmployeeOrder);
  if (empSection) empSection.classList.toggle("is-active", isEmployeeOrder);
  if (isPwdSenior) {
    if (empCheck) empCheck.disabled = true;
  } else if (isEmployeeOrder) {
    if (pwdCheck) pwdCheck.disabled = true;
  }
  await removeUnpaidOrderById(unpaid.id);
  closeReceipt();
  closeUnpaidOrdersModal();
  updateCart();
  updateUnpaidOrderSidebar();
  setMainView("order");
  showToast("Unpaid order moved back to current order.", "success");
};

window.deleteUnpaidOrder = async function(orderId) {
  if (!orderId) return;
  const confirmed = await window.askConfirm({
    title: "Delete unpaid order",
    message: "Delete this unpaid order? This cannot be undone.",
    okText: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  await removeUnpaidOrderById(orderId);
  renderUnpaidOrdersList();
  updateUnpaidOrderSidebar();
  showToast("Unpaid order deleted.", "success");
};

window.toggleDiscount = function() {
  isPwdSenior = document.getElementById("pwdSeniorCheck").checked;
  document.getElementById("discountToggle").classList.toggle("active", isPwdSenior);
  document.querySelector(".discount-section")?.classList.toggle("is-active", isPwdSenior);
  const empCheck = document.getElementById("employeeOrderCheck");
  const empSection = document.querySelector(".employee-order-section");
  if (isPwdSenior) {
    isEmployeeOrder = false;
    empCheck.checked = false;
    empCheck.disabled = true;
    empSection?.classList.remove("is-active");
    document.getElementById("employeeOrderToggle")?.classList.remove("active");
  } else {
    empCheck.disabled = false;
  }
  updateCart();
};

window.toggleEmployeeOrder = function() {
  isEmployeeOrder = document.getElementById("employeeOrderCheck").checked;
  document.getElementById("employeeOrderToggle")?.classList.toggle("active", isEmployeeOrder);
  document.querySelector(".employee-order-section")?.classList.toggle("is-active", isEmployeeOrder);
  const pwdCheck = document.getElementById("pwdSeniorCheck");
  const pwdSection = document.querySelector(".discount-section");
  if (isEmployeeOrder) {
    isPwdSenior = false;
    pwdCheck.checked = false;
    pwdCheck.disabled = true;
    pwdSection?.classList.remove("is-active");
    document.getElementById("discountToggle")?.classList.remove("active");
  } else {
    pwdCheck.disabled = false;
  }
  updateCart();
};

window.searchProducts = function() {
  renderProducts(currentCategory);
};

// ── PAYMENT ──
let capturedPaymentTotal = 0;

window.openPaymentModal = function() {
  capturedPaymentTotal = parseFloat(document.getElementById("total").textContent.replace("₱","").replace(/,/g,""));
  document.getElementById("paymentAmount").textContent = `₱${capturedPaymentTotal.toFixed(2)}`;
  document.getElementById("paymentModal").classList.add("active");
  enteredAmount = "";
  // Keep the method buttons in sync with the current (default) payment method
  // so a previous order's selection never silently sticks.
  document.querySelectorAll(".bb-method").forEach((btn) => {
    const isActive = (btn.dataset.method || "").toLowerCase() === currentPayMethod;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const splitDisp = document.getElementById("splitDisplay");
  if (splitDisp) splitDisp.style.display = "none";
  const numpad = document.getElementById("cashNumpad");
  const methodsEl = document.querySelector(".bb-methods");
  const noteWrap = document.getElementById("orderNoteWrap");
  const amountSubgrid = document.querySelector(".bb-amount-subgrid");
  if (isEmployeeOrder) {
    if (numpad) numpad.style.display = "none";
    if (methodsEl) methodsEl.style.display = "none";
    if (noteWrap) noteWrap.style.display = "block";
    if (amountSubgrid) amountSubgrid.style.display = "none";
    document.getElementById("paymentAmount").textContent = "₱0.00";
    document.getElementById("paymentTitle").textContent = "Employee Order";
  } else {
    if (numpad) numpad.style.display = "";
    if (methodsEl) methodsEl.style.display = "";
    if (noteWrap) noteWrap.style.display = "block";
    if (amountSubgrid) amountSubgrid.style.display = "";
    document.getElementById("paymentTitle").textContent = "Take payment";
  }
  updateChangeDisplay();
  updateDoneButton();
};

window.closePaymentModal = function() {
  document.getElementById("paymentModal").classList.remove("active");
  enteredAmount = "";
  currentPayMethod = "cash";
  const numpad = document.getElementById("cashNumpad");
  const methodsEl = document.querySelector(".bb-methods");
  const amountSubgrid = document.querySelector(".bb-amount-subgrid");
  if (numpad) numpad.style.display = "";
  if (methodsEl) methodsEl.style.display = "";
  if (amountSubgrid) amountSubgrid.style.display = "";
};

window.selectPaymentMethod = function(method) {
  currentPayMethod = method;
  document.querySelectorAll(".bb-method").forEach((btn) => {
    const isActive = (btn.dataset.method || "").toLowerCase() === method;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const numpad      = document.getElementById("cashNumpad");
  const changeDisp  = document.getElementById("changeDisplay");
  const splitDisp   = document.getElementById("splitDisplay");
  numpad.style.display     = method === "gcash" ? "none" : "grid";
  changeDisp.style.display = method === "cash" ? "block" : "none";
  splitDisp.style.display  = method === "split" ? "block" : "none";
  updateChangeDisplay();
  updateDoneButton();
};

window.enterDigit = function(digit) {
  if (enteredAmount.length >= 10) return;
  if (digit === "." && enteredAmount.includes(".")) return;
  enteredAmount += digit;
  updateChangeDisplay();
  updateDoneButton();
};

window.clearAmount = function() {
  enteredAmount = "";
  updateChangeDisplay();
  updateDoneButton();
};

// ── KEYBOARD NUMPAD SUPPORT ──
// Allows 0-9, period, and Backspace/Delete keys when the payment modal is open.
document.addEventListener("keydown", function(e) {
  const modal = document.getElementById("paymentModal");
  if (!modal || !modal.classList.contains("active")) return;

  // Ignore when the user is typing inside an actual input/textarea
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  const numpadVisible = document.getElementById("cashNumpad");
  const isNumpadShowing = numpadVisible && numpadVisible.style.display !== "none";

  if (e.key >= "0" && e.key <= "9") {
    if (isNumpadShowing) {
      e.preventDefault();
      window.enterDigit(e.key);
      // Visual flash on the matching button
      _flashNumpadBtn(e.key);
    }
  } else if (e.key === ".") {
    if (isNumpadShowing) {
      e.preventDefault();
      window.enterDigit(".");
      _flashNumpadBtn(".");
    }
  } else if (e.key === "Backspace" || e.key === "Delete") {
    if (isNumpadShowing) {
      e.preventDefault();
      // Backspace removes last character; Delete clears all
      if (e.key === "Backspace" && enteredAmount.length > 0) {
        enteredAmount = enteredAmount.slice(0, -1);
        updateChangeDisplay();
        updateDoneButton();
      } else {
        window.clearAmount();
      }
      _flashNumpadBtn("clear");
    }
  } else if (e.key === "Enter") {
    const doneBtn = document.getElementById("doneBtn");
    if (doneBtn && !doneBtn.disabled) {
      e.preventDefault();
      window.completePayment();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    window.closePaymentModal();
  }
});

/** Briefly highlights a numpad button to give visual keyboard feedback. */
function _flashNumpadBtn(value) {
  const buttons = document.querySelectorAll("#cashNumpad .bb-pad");
  buttons.forEach(btn => {
    const matches =
      value === "clear"
        ? btn.textContent.trim().toLowerCase() === "clear"
        : btn.textContent.trim() === value;
    if (matches) {
      btn.classList.add("bb-pad-active");
      setTimeout(() => btn.classList.remove("bb-pad-active"), 120);
    }
  });
}

function updateDoneButton() {
  const doneBtn = document.getElementById("doneBtn");
  if (currentPayMethod === "cash") {
    doneBtn.disabled = (parseFloat(enteredAmount) || 0) < capturedPaymentTotal;
  } else if (currentPayMethod === "split") {
    const cashEntered = parseFloat(enteredAmount) || 0;
    doneBtn.disabled = cashEntered <= 0 || cashEntered >= capturedPaymentTotal;
  } else {
    doneBtn.disabled = false;
  }
}

function updateChangeDisplay() {
  const entered = parseFloat(enteredAmount) || 0;

  if (currentPayMethod === "split") {
    const cashAmount = entered;
    const gcashAmount = Math.round(Math.max(0, capturedPaymentTotal - cashAmount) * 100) / 100;
    document.getElementById("tenderedDisplay").textContent = enteredAmount ? `₱${cashAmount.toFixed(2)}` : "₱0.00";
    const display = document.getElementById("changeDisplay");
    display.innerHTML = "";
    document.getElementById("splitCashAmount").textContent = `₱${cashAmount.toFixed(2)}`;
    document.getElementById("splitGcashAmount").textContent = `₱${gcashAmount.toFixed(2)}`;
    const hint = document.getElementById("splitHint");
    if (cashAmount <= 0) {
      hint.textContent = "Enter cash amount on the numpad";
    } else if (cashAmount >= capturedPaymentTotal) {
      hint.textContent = "Cash covers the full amount. Use Cash payment instead.";
    } else {
      hint.textContent = `GCash portion: ₱${gcashAmount.toFixed(2)}`;
    }
    return;
  }

  const change  = entered - capturedPaymentTotal;
  document.getElementById("tenderedDisplay").textContent = enteredAmount ? `₱${entered.toFixed(2)}` : "₱0.00";
  const display = document.getElementById("changeDisplay");
  if (enteredAmount && change >= 0) {
    display.innerHTML = `<span style="color:var(--success);">Change: ₱${change.toFixed(2)}</span>`;
  } else if (enteredAmount) {
    display.innerHTML = `<span style="color:var(--danger);">Insufficient: ₱${Math.abs(change).toFixed(2)}</span>`;
  } else {
    display.innerHTML = "";
  }
}

window.completePayment = async function() {
  const doneBtn = document.getElementById("doneBtn");
  const total    = capturedPaymentTotal;
  const { subtotal } = getCartSummary(cart);
  const noteEl = document.getElementById("orderNoteInput");
  const orderNote = noteEl ? noteEl.value.trim() : "";
  const nameEl = document.getElementById("orderNameInput");
  const customerName = nameEl ? nameEl.value.trim() : "";

  let amountTendered;
  let cashAmount = null;
  let gcashAmount = null;

  if (isEmployeeOrder) {
    amountTendered = 0;
  } else if (currentPayMethod === "cash") {
    amountTendered = parseFloat(enteredAmount) || total;
  } else if (currentPayMethod === "split") {
    cashAmount = parseFloat(enteredAmount) || 0;
    gcashAmount = Math.round(Math.max(0, total - cashAmount) * 100) / 100;
    amountTendered = total;
  } else {
    amountTendered = total;
  }

  const paymentMethod = isEmployeeOrder ? "employee" : currentPayMethod;

  setButtonBusyState(doneBtn, true, "Saving...");
  try {
    // Save to Firebase via model
    const user = getCurrentUser();
    const sale = await saveOrder(cart, total, subtotal, paymentMethod, isPwdSenior, amountTendered, user?.uid || null, cashierName, cashAmount, gcashAmount, { orderType: isEmployeeOrder ? "employee" : "regular", note: orderNote, customerName });

    // Add to kitchen pending queue so the order appears in the sidebar
    await saveKitchenOrder(sale);

    // Update local stats. The live order listener may have already folded this
    // sale into salesHistory from the Firestore snapshot (its own write
    // triggers the listener), so merge de-duped instead of blindly pushing and
    // incrementing — otherwise the order is counted twice until refresh.
    salesHistory = mergeOrderLists(salesHistory, [sale]);
    dailyStats = recomputeDailyStats(salesHistory, dailyStats);
    saveToStorage(salesHistory, dailyStats);
    refreshDrawerIfOpen();

    // Generate receipt
    currentReceiptSale = { ...sale, items: cart, amountTendered, change: amountTendered - total };
    generateReceipt(currentReceiptSale);

    // Reset state
    cart        = [];
    isPwdSenior = false;
    isEmployeeOrder = false;
    enteredAmount = "";
    currentPayMethod = "cash";
    if (noteEl) noteEl.value = "";
    if (nameEl) nameEl.value = "";
    document.getElementById("pwdSeniorCheck").checked = false;
    document.getElementById("pwdSeniorCheck").disabled = false;
    document.getElementById("discountToggle").classList.remove("active");
    document.querySelector(".discount-section")?.classList.remove("is-active");
    document.getElementById("employeeOrderToggle")?.classList.remove("active");
    document.querySelector(".employee-order-section")?.classList.remove("is-active");
    document.getElementById("employeeOrderCheck").checked = false;
    document.getElementById("employeeOrderCheck").disabled = false;
    updateCart();
    updateStats();
    closePaymentModal();

    document.getElementById("receiptModal").classList.add("active");
    updateConnectivityStatus();
    showToast(sale.queued ? "Payment saved offline and queued for sync." : "Payment successful! Thank you!", "success");
    if (!sale.queued && sale.inventoryDeductionError) {
      showToast("Order saved, but inventory deduction failed. Please contact admin.", "warning");
    }
    if (Array.isArray(sale.inventoryAlerts) && sale.inventoryAlerts.length > 0) {
      const alertNames = sale.inventoryAlerts.slice(0, 2).map((entry) => entry.name).join(", ");
      const suffix = sale.inventoryAlerts.length > 2 ? "..." : "";
      showToast(`Stock reached zero: ${alertNames}${suffix}`, "warning");
    }
  } catch (error) {
    console.error("[POS] Complete payment failed:", error);
    showToast(error?.message || "Unable to save the order right now.", "warning");
  } finally {
    setButtonBusyState(doneBtn, false);
  }
};

function generateReceipt(sale) {
  const formatMoney = (n) => `₱${(Number(n) || 0).toFixed(2)}`;
  const orderShort = sale.orderId ? String(sale.orderId).slice(-6) : "—";
  const titleEl = document.getElementById("receiptTitle");
  if (titleEl) {
    titleEl.textContent = sale.unpaid ? "Unpaid order" : sale.queued ? "Pending order" : "Receipt";
  }

  // Only a sale just completed in this terminal can be canceled (voided and
  // returned to the cart). Pending/queued/unpaid receipts cannot, so the
  // Cancel order button below the receipt is only shown for a fresh PAID sale.
  currentReceiptSale = sale;
  const cancelBtn = document.getElementById("cancelReceiptBtn");
  if (cancelBtn) cancelBtn.style.display = (!sale.unpaid && !sale.queued) ? "" : "none";

  const itemRows = (sale.items || []).map((item) => {
    const basePrice = Number(item.price) || 0;
    const qty = Number(item.quantity) || 1;
    const addons = Array.isArray(item.addons) ? item.addons : [];
    const addonsTotal = addons.reduce((sum, addon) => sum + (Number(addon?.price) || 0), 0);
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = basePrice + addonsTotal;
    const discountedUnitPrice = originalUnit * (1 - discountPct);
    const lineTotal = discountedUnitPrice * qty;
    const variantText = [item.variant, item.temperature && item.temperature !== "N/A" ? item.temperature : null]
      .filter(Boolean)
      .join(" · ");
    const priceDisplay = discountPct > 0
      ? `<span class="qty">${qty} x <span class="item-price-original">${formatMoney(originalUnit)}</span> <span class="item-price-arrow">&rarr;</span> ${formatMoney(discountedUnitPrice)} <span class="item-price-label">(-${Math.round(discountPct * 100)}%)</span></span>`
      : `<span class="qty">${qty} x ${formatMoney(discountedUnitPrice)}</span>`;

    return `
      <div class="item">
        <div class="item-name"><span>${escapeHtml(item.name)}</span></div>
        ${variantText ? `<div class="item-variant">${escapeHtml(variantText)}</div>` : ""}
        <div class="item-calc">
          ${priceDisplay}
          <span>${formatMoney(lineTotal)}</span>
        </div>
      </div>
    `;
  }).join("");

  const totalItemSavings = (sale.items || []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 1;
    const addons = Array.isArray(item.addons) ? item.addons : [];
    const addonsTotal = addons.reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = (Number(item.price) || 0) + addonsTotal;
    return sum + (originalUnit * discountPct * qty);
  }, 0);
  const originalSubtotal = (sale.items || []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 1;
    const addons = Array.isArray(item.addons) ? item.addons : [];
    const addonsTotal = addons.reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const originalUnit = (Number(item.price) || 0) + addonsTotal;
    return sum + originalUnit * qty;
  }, 0);

  const subtotalRounded = Math.round(originalSubtotal * 100) / 100;
  const savingsRounded = Math.round(totalItemSavings * 100) / 100;
  const totalRounded = Math.round((Number(sale.total) || 0) * 100) / 100;

  const isEmployeeOrder = sale.orderType === "employee" || sale.paymentMethod === "employee" || sale.isEmployeeOrder === true;

  let itemDiscountBlock = "";
  let discountBlock = "";

  if (isEmployeeOrder) {
    const employeeDiscount = Math.max(0, subtotalRounded - totalRounded);
    if (employeeDiscount > 0) {
      discountBlock = `<div class="totals-row sub"><span>Employee discount</span><span>− ${formatMoney(employeeDiscount)}</span></div>`;
    }
  } else {
    let displayItemSavings = 0;
    if (totalItemSavings > 0) {
      displayItemSavings = sale.isPwdSenior ? savingsRounded : (subtotalRounded - totalRounded);
    }
    const displayDiscount = sale.isPwdSenior
      ? Math.max(0, subtotalRounded - displayItemSavings - totalRounded)
      : 0;

    itemDiscountBlock = displayItemSavings > 0
      ? `<div class="totals-row sub"><span>Item discounts</span><span>− ${formatMoney(displayItemSavings)}</span></div>`
      : "";
    discountBlock = displayDiscount > 0
      ? `<div class="totals-row sub"><span>Discount</span><span>− ${formatMoney(displayDiscount)}</span></div>`
      : "";
  }

  const paidStamp = sale.unpaid ? "UNPAID" : sale.cancelled ? "CANCELLED" : "PAID";

  const receiptHTML = `
    <div class="receipt-wrap">
      <button
        type="button"
        class="receipt-close-btn"
        aria-label="Close receipt"
        title="Close receipt"
        onclick="closeReceipt()"
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

        <div class="meta-row"><span class="label">Date</span><span class="value">${sale.timestamp || "—"}</span></div>
        <div class="meta-row"><span class="label">Order #</span><span class="value">${orderShort}</span></div>
        ${sale.customerName ? `<div class="meta-row"><span class="label">Order for</span><span class="value">${escapeHtml(sale.customerName)}</span></div>` : ""}
        <div class="meta-row"><span class="label">Payment</span><span class="value">${(sale.paymentMethod || "—").toUpperCase()}</span></div>
        ${sale.paymentMethod === "split" ? `
        <div class="meta-row"><span class="label">Cash</span><span class="value">${formatMoney(sale.cashAmount || 0)}</span></div>
        <div class="meta-row"><span class="label">GCash</span><span class="value">${formatMoney(sale.gcashAmount || 0)}</span></div>
        ` : ""}
        <div class="meta-row"><span class="label">Cashier</span><span class="value">${escapeHtml(sale.cashierName || "Staff")}</span></div>

        <hr class="rule">

        ${itemRows}

        <hr class="rule">

        <div class="totals-row sub"><span>Subtotal</span><span>${formatMoney(originalSubtotal)}</span></div>
        ${itemDiscountBlock}
        ${discountBlock}
        <div class="totals-row grand"><span>TOTAL</span><span>${formatMoney(sale.total)}</span></div>
        ${sale.paymentMethod === "split" ? `
        <div class="totals-row sub"><span>Paid</span><span>Cash ${formatMoney(sale.cashAmount || 0)} + GCash ${formatMoney(sale.gcashAmount || 0)}</span></div>
        ` : `
        <div class="totals-row sub"><span>Tendered</span><span>${formatMoney(sale.amountTendered)}</span></div>
        <div class="totals-row sub"><span>Change</span><span>${formatMoney(sale.change)}</span></div>
        `}

        <div class="stamp"><span>${paidStamp}</span></div>

        <div class="barcode" aria-hidden="true"></div>

        <hr class="rule">

        <div class="center">
          <div class="footer-msg">Thank you for visiting!</div>
          <div class="footer-sub">Please come again</div>
          <div class="footer-legal">
            VAT Registered TIN: 000-000-000-000<br>
            Permit No: 0000000
          </div>
          ${sale.unpaid ? `
            <button type="button" id="receiptRestoreBtn" class="receipt-return-btn">Move to current order</button>
          ` : ""}
        </div>
      </div>
      <div class="zigzag-bottom" aria-hidden="true"></div>
    </div>
  `;
  document.getElementById("receiptContent").innerHTML = receiptHTML;
}

window.closeReceipt = function() {
  const receiptModal = document.getElementById("receiptModal");
  if (receiptModal) {
    receiptModal.classList.remove("active");
    // reset any inline z-index applied when opening over other overlays
    receiptModal.style.zIndex = '';
  }
  const titleEl = document.getElementById("receiptTitle");
  if (titleEl) titleEl.textContent = "Receipt";
  currentReceiptSale = null;
};

window.openPendingOrder = async function(orderId) {
  const pending = await getPendingOrders();
  const order = pending.find((o) => String(o.id) === String(orderId));
  if (!order) return;

  const payload = order.payload || {};
  const sale = {
    orderId: payload.orderId || payload.id || order.id,
    timestamp: payload.timestamp || (payload.createdAt ? new Date(payload.createdAt).toLocaleString() : new Date(order.createdAt).toLocaleString()),
    paymentMethod: payload.paymentMethod || "cash",
    isPwdSenior: payload.isPwdSenior || false,
    subtotal: payload.subtotal || 0,
    discountAmount: payload.discountAmount || 0,
    total: payload.total || 0,
    amountTendered: payload.amountTendered || payload.total || 0,
    change: payload.change || 0,
    items: Array.isArray(payload.items) ? payload.items : [],
    cashierName: payload.cashierName || "Staff",
    customerName: String(payload.customerName || "").trim(),
    queued: true,
  };

  generateReceipt(sale);
  const receiptModal = document.getElementById("receiptModal");
  if (receiptModal) {
    // Ensure receipt modal overlays other open modals (pending orders)
    receiptModal.style.zIndex = '11000';
    receiptModal.classList.add("active");
    receiptModal.setAttribute('aria-hidden', 'false');
  }
};

window.printReceipt = async function() {
  // Thermal printer only — no browser print window fallback. The receipt is
  // laid out for the paper width selected in the printer modal; if no printer
  // is connected the cashier gets a hint instead of a confusing print dialog.
  if (!currentReceiptSale) return;
  const result = await printThermalReceipt(currentReceiptSale);
  if (result.status === "sent") {
    showToast("Receipt sent to printer", "success");
    return;
  }
  if (result.status === "not-connected") {
    showToast("No printer connected. Open Thermal Printer and tap Connect printer.", "warning");
    return;
  }
  if (result.status === "unsupported") {
    showToast("Bluetooth printing not supported. Use Chrome or Edge.", "warning");
    return;
  }
  showToast(`Thermal print failed: ${result.message || "unknown error"}`, "warning");
};

// ── CANCEL ORDER (void sale, return items to cart) ──

// Cancel the sale whose receipt is open — only reachable right after a
// completed payment (the button is hidden on pending/queued/unpaid receipts).
// Voids the Firestore order, restores deducted stock, and returns the items
// to the cart so the cashier can re-sell or re-quote them.
window.cancelReceiptOrder = async function() {
  const sale = currentReceiptSale;
  if (!sale) return;

  const orderShort = String(sale.orderId || sale.id || "—").slice(-6);
  const confirmed = await window.askConfirm({
    title: "Cancel this order?",
    message: `Cancel order #${orderShort} and return the items to the cart?`,
    hint: "The order will be removed from the sales records, deducted stock will be restored, and the payment must be returned to the customer.",
    okText: "Cancel order",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const result = await voidSale(sale);
    closeReceipt();
    updateConnectivityStatus();
    if (result?.inventoryRestoredSkipped === true) {
      showToast("Order canceled. No stock was deducted for this order, so none was restored.", "warning");
    } else if (result?.inventoryRestored === false) {
      showToast("Order canceled. Inventory could not be restored — please notify admin.", "warning");
    } else {
      showToast("Order canceled. Items returned to the cart.", "success");
    }
  } catch (error) {
    const denied = /permission|denied|permission-denied/i.test(String(error?.message || error?.code || ""));
    console.error("[POS] Cancel receipt order failed:", error);
    showToast(
      denied
        ? "Unable to cancel the order — cancel requires permission. Please notify admin."
        : "Unable to cancel the order. Please try again.",
      "warning"
    );
  }
};

// Rebuild cart entries from a just-completed sale's items, merging any that
// already exist (same product, variant, temperature, addons, discount).
function restoreSaleItemsToCart(items) {
  for (const item of Array.isArray(items) ? items : []) {
    const id = item?.menuItemId || item?.id;
    if (!id) continue;
    const addons = Array.isArray(item?.addons) ? item.addons : [];
    const variant = item?.variant || null;
    const temperature = item?.temperature || null;
    const discountPercent = Number(item?.discountPercent || 0);
    const quantity = Math.max(1, Number(item?.quantity) || 1);

    const existingIdx = cart.findIndex((i) =>
      i.id === id &&
      (i.variant || null) === variant &&
      (i.temperature || null) === temperature &&
      JSON.stringify(i.addons) === JSON.stringify(addons) &&
      Number(i.discountPercent || 0) === discountPercent
    );

    if (existingIdx > -1) {
      cart[existingIdx].quantity += quantity;
    } else {
      cart.push({
        id,
        name: item?.name,
        price: Number(item?.price) || 0,
        variant,
        temperature,
        addons,
        quantity,
        discountPercent,
        recipe: Array.isArray(item?.recipe) ? item.recipe : [],
      });
    }
  }
}

// Shared void flow: soft-void the sale in Firestore, remove it from the kitchen
// queue and local history/outbox, restore deducted stock, and put the items
// back into the cart. The Firestore record is flagged voided (staff can't hard
// delete orders) and every read path filters voided orders out.
async function voidSale(sale) {
  const orderId = String(sale?.orderId || sale?.id);
  if (!orderId) throw new Error("missing orderId");

  // 1) Void the sale: Firestore soft-void + kitchen queue + local history/outbox.
  //    If the Firestore void fails (rules/network), abort BEFORE touching the
  //    kitchen queue or local records so the sale is never falsely reported as
  //    cancelled while still live in Firestore (where admin/other POS see it).
  await voidOrder(orderId, {
    voidedBy: cashierName || "Staff",
    voidReason: "Canceled from pending orders",
  });
  try { await removeKitchenOrder(orderId); } catch (error) {
    console.warn("[POS] Cancel: kitchen order delete failed.", error);
  }
  purgeSavedSale(orderId);

  // 2) Recompute local stats without the canceled sale
  salesHistory = salesHistory.filter((o) => {
    const key = String(o?.orderId || o?.id || "");
    return key !== orderId;
  });
  dailyStats = recomputeDailyStats(salesHistory, dailyStats);
  persistPosState();
  refreshDrawerIfOpen();

  // 3) Restore deducted inventory stock
  const restoreResult = await restoreInventoryForOrder(sale);

  // 4) Return items to the cart (re-applying PWD/employee flags so the
  //    cart totals match what was originally charged)
  restoreSaleItemsToCart(sale.items || []);
  if (sale.isPwdSenior === true) {
    isPwdSenior = true;
    const pwdCheck = document.getElementById("pwdSeniorCheck");
    if (pwdCheck) pwdCheck.checked = true;
    document.getElementById("discountToggle")?.classList.add("active");
    document.querySelector(".discount-section")?.classList.add("is-active");
  } else if (sale.orderType === "employee" || sale.paymentMethod === "employee") {
    isEmployeeOrder = true;
    const empCheck = document.getElementById("employeeOrderCheck");
    if (empCheck) empCheck.checked = true;
    document.getElementById("employeeOrderToggle")?.classList.add("active");
    document.querySelector(".employee-order-section")?.classList.add("is-active");
  }

  updateCart();
  updateStats();

  return {
    inventoryRestored: !restoreResult || restoreResult.success !== false,
    inventoryRestoredSkipped: restoreResult?.skipped === true,
  };
}

window.cancelPendingOrder = async function(orderId) {
  if (!orderId) return;
  const pending = await getPendingOrders();
  const order = pending.find((o) => String(o.id) === String(orderId));
  if (!order) return;

  const sale = {
    ...(order.payload || {}),
    orderId: order.payload?.orderId || order.payload?.id || order.id,
  };

  const confirmed = await window.askConfirm({
    title: "Cancel pending order",
    message: `Cancel pending order #${String(sale.orderId).replace(/^q_/, "").slice(-6)} and return the items to the cart?`,
    hint: "The order will be removed from the queue and sales records, deducted stock will be restored, and the payment must be returned to the customer.",
    okText: "Cancel order",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const result = await voidSale(sale);
    closeReceipt();
    updateConnectivityStatus();
    if (result?.inventoryRestoredSkipped === true) {
      showToast("Pending order canceled. No stock was deducted for this order, so none was restored.", "warning");
    } else if (result?.inventoryRestored === false) {
      showToast("Pending order canceled. Inventory could not be restored — please notify admin.", "warning");
    } else {
      showToast("Pending order canceled. Items returned to the cart.", "success");
    }
  } catch (error) {
    const denied = /permission|denied|permission-denied/i.test(String(error?.message || error?.code || ""));
    console.error("[POS] Cancel pending order failed:", error);
    showToast(
      denied
        ? "Unable to cancel the order — cancel requires permission (rules may need redeploy). Please notify admin."
        : "Unable to cancel the pending order. Please try again.",
      "warning"
    );
  }
};

// ── DRAWER MATH ──
// Merge order lists (Firestore snapshot, local history, queued outbox) into
// one de-duplicated list so no sale is counted twice or dropped.
function mergeOrderLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const order of Array.isArray(list) ? list : []) {
      if (!order) continue;
      const key = String(order?.orderId || order?.id || order?.queueId || "");
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(order);
    }
  }
  return merged;
}

// Rebuild daily stats from the authoritative, de-duplicated order list. The
// drawer-only fields (opening float, cash in/out, manual count) are shared
// across terminals and are carried over from the previous stats untouched.
function recomputeDailyStats(orders, prev = dailyStats) {
  return {
    orders: orders.length,
    totalSales: orders.reduce((sum, s) => sum + (Number(s.total) || 0), 0),
    discountsApplied: orders.filter(s => s.isPwdSenior || s.discount).length,
    cashReceived: computeDrawerCashReceived(orders),
    gcashReceived: computeDrawerGcashReceived(orders),
    openingFloat: Number(prev.openingFloat || 0),
    cashIn: Number(prev.cashIn || 0),
    cashOut: Number(prev.cashOut || 0),
    actualCash: prev.actualCash ?? null,
    cashOnHandAuto: prev.cashOnHandAuto !== false,
    ledgerEntries: Array.isArray(prev.ledgerEntries) ? prev.ledgerEntries : [],
  };
}

function drawerPaymentMethod(order) {
  return String(order?.paymentMethod || "cash").toLowerCase();
}

// Today's orders (from all sources) de-duplicated and filtered to the current
// day. This single list feeds every drawer figure so the drawer always
// matches the actual orders exactly.
function getDrawerOrders(orders) {
  const now = Date.now();
  const startOfDay = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  const endOfDay = startOfDay + 86400000;
  const queued = (typeof getQueuedOrders === "function" ? getQueuedOrders() : [])
    .map((q) => q?.payload || q);
  return mergeOrderLists(orders, queued).filter((order) => {
    if (!order) return false;
    const ts = getSaleTimestampMs(order);
    return ts !== null && ts >= startOfDay && ts < endOfDay;
  });
}

// Sales-derived drawer figures, ALWAYS recomputed from the actual order list
// (plus the queued offline outbox) so the drawer can never show stale values.
// Employee orders are excluded: they are comped, not paid into the drawer.
function computeDrawerTotals(orders) {
  const totals = { cash: 0, gcash: 0, cashTransactions: 0, gcashTransactions: 0, paidSales: 0 };

  for (const order of getDrawerOrders(orders)) {
    const method = drawerPaymentMethod(order);
    if (method === "employee") continue;
    const total = Number(order.total) || 0;

    if (method === "split") {
      const cash = Number(order.cashAmount) || 0;
      const gcash = Number(order.gcashAmount) || 0;
      totals.cash += cash;
      totals.gcash += gcash;
      if (cash > 0) totals.cashTransactions += 1;
      if (gcash > 0) totals.gcashTransactions += 1;
      totals.paidSales += total;
    } else if (method === "gcash") {
      totals.gcash += total;
      totals.gcashTransactions += 1;
      totals.paidSales += total;
    } else {
      totals.cash += total;
      totals.cashTransactions += 1;
      totals.paidSales += total;
    }
  }

  totals.cash = Math.round(totals.cash * 100) / 100;
  totals.gcash = Math.round(totals.gcash * 100) / 100;
  totals.paidSales = Math.round(totals.paidSales * 100) / 100;
  return totals;
}

// Cash actually received from sales: full cash sales plus the cash portion of
// split payments. Employee and e-wallet sales are excluded. Queued (offline)
// orders are included so the drawer stays accurate until they sync.
function computeDrawerCashReceived(orders) {
  return computeDrawerTotals(orders).cash;
}

function computeDrawerGcashReceived(orders) {
  return computeDrawerTotals(orders).gcash;
}

function computeDrawerMath(stats) {
  const openingFloat = Number(stats?.openingFloat || 0);
  const cashIn = Number(stats?.cashIn || 0);
  const cashOut = Number(stats?.cashOut || 0);
  const cashReceived = Number(stats?.cashReceived || 0);
  const expected = Math.round((openingFloat + cashReceived + cashIn - cashOut) * 100) / 100;
  const gcashReceived = Number(stats?.gcashReceived || 0);
  const expectedGcash = Math.round(gcashReceived * 100) / 100;
  return { expected, expectedGcash };
}

function renderDrawerModal() {
  const formatPeso = (n) => `₱${(Number(n) || 0).toFixed(2)}`;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const totals = computeDrawerTotals(salesHistory);
  // Expected cash/GCash is always derived from the freshly recomputed order
  // totals, so a stale cached cashReceived can never skew the drawer math.
  const { expected, expectedGcash } = computeDrawerMath({
    ...dailyStats,
    cashReceived: totals.cash,
    gcashReceived: totals.gcash,
  });

  // The cash on hand follows today's orders automatically unless staff has
  // recorded a manual count.
  autoTrackCashOnHand(expected);

  setText("drawerCashValue", formatPeso(totals.cash));
  setText("drawerCashTxnValue", String(totals.cashTransactions));
  setText("drawerFloatValue", formatPeso(dailyStats.openingFloat || 0));
  setText("drawerExpectedValue", formatPeso(expected));
  setText("drawerGcashValue", formatPeso(totals.gcash));
  setText("drawerGcashTxnValue", String(totals.gcashTransactions));
  setText("drawerExpectedGcashValue", formatPeso(expectedGcash));
  setText("drawerTotalSalesValue", formatPeso(totals.paidSales));
  setText("drawerLedgerNote", `Cash in ${formatPeso(dailyStats.cashIn || 0)} · Cash out ${formatPeso(dailyStats.cashOut || 0)}`);
  renderDrawerVariance(expected);
  renderDrawerHistory();
  renderDrawerCashOrders();
}

// Itemized list of today's cash orders (full cash payments plus the cash
// portion of split payments) so the drawer can be verified order by order.
// Employee and GCash-only orders are excluded, matching the totals above.
function renderDrawerCashOrders() {
  const headEl = document.getElementById("drawerCashOrdersHead");
  const listEl = document.getElementById("drawerCashOrdersList");
  if (!listEl) return;
  const formatPeso = (n) => `₱${(Number(n) || 0).toFixed(2)}`;

  const orders = getDrawerOrders(salesHistory)
    .map((order) => ({ order, method: drawerPaymentMethod(order) }))
    .filter(({ order, method }) => {
      if (method === "employee") return false;
      if (method === "gcash") return false;
      if (method === "split") return (Number(order.cashAmount) || 0) > 0;
      return true;
    })
    .sort((a, b) => (getSaleTimestampMs(a.order) || 0) - (getSaleTimestampMs(b.order) || 0));

  const total = Math.round(orders.reduce((sum, { order, method }) =>
    sum + (method === "split" ? Number(order.cashAmount) || 0 : Number(order.total) || 0), 0) * 100) / 100;
  if (headEl) headEl.textContent = `Today's cash orders · ${formatPeso(total)}`;

  if (orders.length === 0) {
    listEl.innerHTML = `<li class="bb-drawer-history-empty">No cash orders yet today.</li>`;
    return;
  }

  listEl.innerHTML = orders
    .map(({ order, method }) => {
      const ts = getSaleTimestampMs(order);
      const time = ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
      const isSplit = method === "split";
      const amount = isSplit ? Number(order.cashAmount) || 0 : Number(order.total) || 0;
      return `<li class="bb-drawer-history-item is-in">
        <span class="bb-drawer-history-label">${isSplit ? "Split · Cash" : "Cash"}</span>
        <span class="bb-drawer-history-time">${time}</span>
        <span class="bb-drawer-history-amount">${formatPeso(amount)}</span>
      </li>`;
    })
    .join("");
}

function refreshDrawerIfOpen() {
  const modal = document.getElementById("drawerModal");
  if (modal && modal.classList.contains("active")) renderDrawerModal();
}

// Copy the shared drawer fields into dailyStats. Used by both the open-drawer
// poll and the day-rollover re-apply so the two paths stay in sync.
function applySharedDrawer(shared) {
  if (!shared) return;
  dailyStats.openingFloat = Number(shared.openingFloat || 0);
  dailyStats.cashIn = Number(shared.cashIn || 0);
  dailyStats.cashOut = Number(shared.cashOut || 0);
  dailyStats.actualCash = shared.actualCash ?? null;
  dailyStats.cashOnHandAuto = shared.cashOnHandAuto;
  if (Array.isArray(shared.ledgerEntries)) dailyStats.ledgerEntries = shared.ledgerEntries;
}

// Pull the shared drawer state (all terminals) from Firestore so one terminal
// immediately sees another's float, cash in/out, or manual count. Skipped while
// staff is mid-edit or right after a local write so a poll can never discard a
// value that is still saving.
async function refreshSharedDrawer() {
  if (Date.now() - drawerLastLocalWrite < 3000) return;
  if (typeof getSharedDrawerState !== "function") return;
  const floatEdit = document.getElementById("drawerFloatEdit");
  if (floatEdit && floatEdit.classList.contains("is-open")) return;
  const actualInput = document.getElementById("drawerActualInput");
  if (actualInput && actualInput.matches && actualInput.matches(":focus")) return;
  try {
    const shared = await getSharedDrawerState();
    applySharedDrawer(shared);
    refreshDrawerIfOpen();
  } catch {}
}

// Since there is no physical drawer connection, the cash on hand is tracked
// automatically: it always equals starting cash + today's cash orders + cash
// in − cash out, live-updated with every order. Staff may still override it
// with a manual count via "Record count", after which auto-tracking stops.
function autoTrackCashOnHand(expected) {
  if (dailyStats.cashOnHandAuto === false) return;
  const autoValue = Math.round((Number(expected) || 0) * 100) / 100;
  if (Number(dailyStats.actualCash) !== autoValue) {
    dailyStats.actualCash = autoValue;
    persistPosState();
  }
}

function renderDrawerVariance(expected) {
  const badge = document.getElementById("drawerVarianceBadge");
  const note = document.getElementById("drawerVarianceNote");
  const input = document.getElementById("drawerActualInput");
  if (!badge) return;
  const formatPeso = (n) => `₱${(Number(n) || 0).toFixed(2)}`;
  const expectedCash = Number.isFinite(Number(expected))
    ? Number(expected)
    : computeDrawerMath({ ...dailyStats, cashReceived: computeDrawerTotals(salesHistory).cash }).expected;
  const actual = dailyStats.actualCash;
  // Never overwrite the counted amount while staff is editing it — incidental
  // re-renders (order sync, stats refresh) must not silently discard typing.
  const canWriteInput = input && (!input.matches || !input.matches(":focus"));
  const writeInput = (value) => {
    if (canWriteInput) input.value = value;
  };

  // Auto-tracking active: cash on hand follows the orders automatically, so the
  // drawer shows as Balanced without staff needing to press "Record count".
  if (dailyStats.cashOnHandAuto !== false) {
    badge.textContent = "Balanced";
    badge.className = "bb-drawer-actual-variance is-balanced";
    if (note) note.textContent = `Cash on hand follows today's orders automatically (${formatPeso(expectedCash)}). Record a manual count anytime to compare the physical cash.`;
    writeInput(String(Math.round(expectedCash * 100) / 100));
    return;
  }

  if (actual === undefined || actual === null || actual === "" || !Number.isFinite(Number(actual))) {
    badge.textContent = "Not recorded";
    badge.className = "bb-drawer-actual-variance is-neutral";
    if (note) note.textContent = "No manual count recorded for today.";
    writeInput("");
    return;
  }

  const variance = Math.round((Number(actual) - expectedCash) * 100) / 100;
  if (variance === 0) {
    badge.textContent = "Balanced";
    badge.className = "bb-drawer-actual-variance is-balanced";
  } else if (variance > 0) {
    badge.textContent = `Over ${formatPeso(variance)}`;
    badge.className = "bb-drawer-actual-variance is-over";
  } else {
    badge.textContent = `Short ${formatPeso(Math.abs(variance))}`;
    badge.className = "bb-drawer-actual-variance is-short";
  }
  if (note) note.textContent = `Expected ${formatPeso(expectedCash)} · Counted ${formatPeso(actual)}`;
  writeInput(String(actual));
}

function drawerLedgerEntries() {
  if (!Array.isArray(dailyStats.ledgerEntries)) dailyStats.ledgerEntries = [];
  return dailyStats.ledgerEntries;
}

function renderDrawerHistory() {
  const listEl = document.getElementById("drawerHistoryList");
  if (!listEl) return;
  const entries = drawerLedgerEntries();
  if (entries.length === 0) {
    listEl.innerHTML = `<li class="bb-drawer-history-empty">No drawer activity yet today.</li>`;
    return;
  }
  const formatPeso = (n) => `₱${(Number(n) || 0).toFixed(2)}`;
  listEl.innerHTML = entries
    .slice()
    .reverse()
    .map((entry) => {
      const time = new Date(Number(entry.t) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const isIn = entry.kind === "in";
      const isOut = entry.kind === "out";
      const isFloat = entry.kind === "float";
      const isCount = entry.kind === "count";
      const label = isIn ? "Cash in" : isOut ? "Cash out" : isFloat ? "Starting cash" : isCount ? "Cash count" : "Drawer";
      const sign = isIn ? "+" : isOut ? "−" : "";
      const rowClass = isIn ? "is-in" : isOut ? "is-out" : "is-neutral";
      const note = entry.note ? `<span class="bb-drawer-history-note">${escapeDrawerText(entry.note)}</span>` : "";
      return `<li class="bb-drawer-history-item ${rowClass}">
        <span class="bb-drawer-history-label">${escapeDrawerText(label)}</span>
        ${note}
        <span class="bb-drawer-history-time">${time}</span>
        <span class="bb-drawer-history-amount">${sign}${formatPeso(entry.amount)}</span>
      </li>`;
    })
    .join("");
}

window.openDrawer = function() {
  if (!posReady) {
    showToast("Cash drawer is still loading - please wait a moment.", "warning");
    return;
  }
  const modal = document.getElementById("drawerModal");
  if (!modal) return;
  renderDrawerModal();
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  // Refresh once on open, then poll every 30s while the drawer stays open so
  // another terminal's drawer activity appears here without a reload.
  refreshSharedDrawer();
  if (!drawerRefreshTimer) {
    drawerRefreshTimer = setInterval(refreshSharedDrawer, 30000);
  }
};

window.drawerSwitchTab = function(tab) {
  const pane = tab === "gcash" ? "gcash" : "cash";
  if (document.querySelectorAll) {
    document.querySelectorAll("[data-drawer-pane]").forEach((el) => {
      el.classList.toggle("is-active", el.getAttribute("data-drawer-pane") === pane);
    });
  }
  const cashTab = document.getElementById("drawerTabCash");
  const gcashTab = document.getElementById("drawerTabGcash");
  if (cashTab) cashTab.classList.toggle("is-active", pane === "cash");
  if (cashTab) cashTab.setAttribute("aria-selected", String(pane === "cash"));
  if (gcashTab) gcashTab.classList.toggle("is-active", pane === "gcash");
  if (gcashTab) gcashTab.setAttribute("aria-selected", String(pane === "gcash"));
};

window.toggleDrawerFloatEdit = function() {
  const editRow = document.getElementById("drawerFloatEdit");
  const btn = document.getElementById("drawerFloatEditBtn");
  const input = document.getElementById("drawerFloatInput");
  if (!editRow || !btn) return;
  const isOpen = editRow.classList.contains("is-open");
  editRow.classList.toggle("is-open", !isOpen);
  btn.textContent = isOpen ? "Set / Edit" : "Cancel";
  if (!isOpen && input) {
    input.value = dailyStats.openingFloat ? String(dailyStats.openingFloat) : "";
    input.focus();
  }
};

window.saveDrawerOpeningFloat = function() {
  const input = document.getElementById("drawerFloatInput");
  const amount = parseFloat(input?.value || "");
  if (!Number.isFinite(amount) || amount < 0) {
    showToast("Enter a valid starting cash amount.", "warning");
    return;
  }
  dailyStats.openingFloat = Math.round(amount * 100) / 100;
  drawerLastLocalWrite = Date.now();
  persistPosState();
  // Log the starting cash to the shared drawer log so every terminal and the
  // admin Logs page see the same float (the shared dailyStats doc is
  // last-writer-wins across terminals, so it cannot hold the drawer state).
  if (typeof recordDrawerLogEntry === "function") {
    recordDrawerLogEntry({
      kind: "float",
      amount: Math.round(amount * 100) / 100,
      note: "Starting cash",
      t: Date.now()
    }).catch(() => {});
  }
  renderDrawerModal();
  window.toggleDrawerFloatEdit();
  showToast("Starting cash set.", "success");
};

// Since there is no physical drawer connected to the cashier terminal, the
// counted cash on hand is entered manually and compared to the expected cash.
window.recordDrawerActual = function() { askDrawerConfirm("count"); };
window.drawerCashIn = function() { askDrawerConfirm("in"); };
window.drawerCashOut = function() { askDrawerConfirm("out"); };

// Draws attention to an input that was used without a valid value (shake +
// red outline) so the button press never feels like a silent no-op.
function flagDrawerAttention(el) {
  if (!el) return;
  if (el.classList) {
    el.classList.remove("is-attention");
    void el.offsetWidth;
    el.classList.add("is-attention");
    setTimeout(() => el.classList.remove("is-attention"), 600);
  }
  if (typeof el.focus === "function") el.focus();
}

function escapeDrawerText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// ── Confirmation popup ──
// Every drawer mutation (record count, cash in, cash out) goes through a
// popup: staff sees exactly what will be recorded and taps Record to apply
// it immediately. Nothing is recorded while the popup is open.
let drawerPendingConfirm = null;

window.askDrawerConfirm = function(kind) {
  let amount, note = "";
  if (kind === "count") {
    const input = document.getElementById("drawerActualInput");
    amount = parseFloat(input?.value || "");
    if (!Number.isFinite(amount) || amount < 0) {
      flagDrawerAttention(input);
      showToast("Enter a valid counted amount.", "warning");
      return;
    }
  } else {
    const input = document.getElementById("drawerLedgerAmount");
    const noteInput = document.getElementById("drawerLedgerReason");
    amount = parseFloat(input?.value || "");
    if (!Number.isFinite(amount) || amount <= 0) {
      flagDrawerAttention(input);
      showToast("Enter a valid amount first.", "warning");
      return;
    }
    note = String(noteInput?.value || "").trim().slice(0, 80);
  }

  const rounded = Math.round(amount * 100) / 100;
  drawerPendingConfirm = { kind, amount: rounded, note };

  const formatPeso = (n) => `₱${(Number(n) || 0).toFixed(2)}`;
  const modal = document.getElementById("drawerConfirmModal");
  const titleEl = document.getElementById("drawerConfirmTitle");
  const messageEl = document.getElementById("drawerConfirmMessage");
  const hintEl = document.getElementById("drawerConfirmHint");
  const okBtn = document.getElementById("drawerConfirmOkBtn");
  if (!modal || !titleEl || !messageEl || !hintEl || !okBtn) return;

  if (kind === "count") {
    titleEl.textContent = "Record cash count";
    messageEl.textContent = `Record counted cash on hand as ${formatPeso(rounded)}?`;
    const expected = computeDrawerMath({
      ...dailyStats,
      cashReceived: computeDrawerTotals(salesHistory).cash,
    }).expected;
    hintEl.textContent = dailyStats.cashOnHandAuto !== false
      ? `Cash on hand is currently auto-tracked at ${formatPeso(expected)}. Recording a manual count switches to manual tracking.`
      : "";
  } else {
    const label = kind === "in" ? "Cash in" : "Cash out";
    titleEl.textContent = `Record ${label}`;
    messageEl.textContent = kind === "in"
      ? `Add ${formatPeso(rounded)} to the cash drawer?`
      : `Remove ${formatPeso(rounded)} from the cash drawer?`;
    hintEl.textContent = note ? `Reason: ${note}` : "";
  }
  okBtn.classList.toggle("bb-drawer-btn-out", kind === "out");
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  okBtn.focus();
};

window.confirmDrawerAction = function() {
  const pending = drawerPendingConfirm;
  if (!pending) return;
  drawerPendingConfirm = null;
  closeDrawerConfirmPopup();

  if (pending.kind === "count") {
    dailyStats.actualCash = pending.amount;
    dailyStats.cashOnHandAuto = false;
    // Publish the manual count to the shared drawer log so other terminals
    // stop auto-tracking and show the same counted cash on hand.
    if (typeof recordDrawerLogEntry === "function") {
      recordDrawerLogEntry({
        kind: "count",
        amount: pending.amount,
        note: "Manual count",
        t: Date.now()
      }).catch(() => {});
    }
  } else {
    if (pending.kind === "in") {
      dailyStats.cashIn = Number(dailyStats.cashIn || 0) + pending.amount;
    } else {
      dailyStats.cashOut = Number(dailyStats.cashOut || 0) + pending.amount;
    }
    const entries = drawerLedgerEntries();
    const entry = {
      id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      t: Date.now(),
      kind: pending.kind,
      amount: pending.amount,
      ...(pending.note ? { note: pending.note } : {})
    };
    entries.push(entry);
    if (entries.length > 100) entries.splice(0, entries.length - 100);
    // Append-only per-entry Firestore write; offline writes queue for retry.
    // Guarded so the smoke-test eval scope (no Firestore import) still runs.
    if (typeof recordDrawerLogEntry === "function") {
      recordDrawerLogEntry(entry).catch(() => {});
    }
    const input = document.getElementById("drawerLedgerAmount");
    const noteInput = document.getElementById("drawerLedgerReason");
    if (input) input.value = "";
    if (noteInput) noteInput.value = "";
  }

  drawerLastLocalWrite = Date.now();
  persistPosState();
  renderDrawerModal();
  const label = pending.kind === "in" ? "Cash in" : pending.kind === "out" ? "Cash out" : "Cash count";
  showToast(`${label} of ₱${pending.amount.toFixed(2)} recorded.`, "success");
};

window.cancelDrawerConfirm = function() {
  drawerPendingConfirm = null;
  closeDrawerConfirmPopup();
};

function closeDrawerConfirmPopup() {
  const modal = document.getElementById("drawerConfirmModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

// Escape closes the popup first (before the drawer modal), Enter records.
document.addEventListener("keydown", (e) => {
  const popup = document.getElementById("drawerConfirmModal");
  if (!popup || !popup.classList.contains("active")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelDrawerConfirm();
  } else if (e.key === "Enter") {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag !== "button") {
      e.preventDefault();
      confirmDrawerAction();
    }
  }
}, true);

// ── Generic confirmation popup ──
// Promise-based in-app confirm (replaces window.confirm so the UI matches the
// drawer popup instead of a native browser dialog). askConfirm returns a
// Promise that resolves true/false once the staff taps Confirm/Cancel.
let confirmPending = null;

window.askConfirm = function(options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const kickerEl = document.getElementById("confirmKicker");
    const titleEl = document.getElementById("confirmTitle");
    const messageEl = document.getElementById("confirmMessage");
    const hintEl = document.getElementById("confirmHint");
    const okBtn = document.getElementById("confirmOkBtn");
    if (!modal || !titleEl || !messageEl || !okBtn) {
      resolve(true);
      return;
    }
    confirmPending = resolve;
    if (kickerEl) kickerEl.textContent = options.kicker || "Confirmation";
    titleEl.textContent = options.title || "Confirm";
    messageEl.textContent = options.message || "Are you sure?";
    if (hintEl) {
      hintEl.textContent = options.hint || "";
      hintEl.style.display = options.hint ? "" : "none";
    }
    okBtn.textContent = options.okText || "Confirm";
    okBtn.classList.toggle("bb-drawer-btn-out", options.danger === true);
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    okBtn.focus();
  });
};

window.resolveConfirm = function(ok) {
  const resolve = confirmPending;
  confirmPending = null;
  const modal = document.getElementById("confirmModal");
  if (modal) {
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
  }
  if (typeof resolve === "function") resolve(ok === true);
};

document.addEventListener("keydown", (e) => {
  const modal = document.getElementById("confirmModal");
  if (!modal || !modal.classList.contains("active")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    resolveConfirm(false);
  } else if (e.key === "Enter") {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag !== "button") {
      e.preventDefault();
      resolveConfirm(true);
    }
  }
}, true);
// ── END DRAWER MATH ──

window.closeDrawerModal = function() {
  const modal = document.getElementById("drawerModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
  if (drawerRefreshTimer) {
    clearInterval(drawerRefreshTimer);
    drawerRefreshTimer = null;
  }
};

window.logout = function() {
  const modal = document.getElementById("logoutConfirmModal");
  if (!modal) {
    authLogout();
    return;
  }
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

window.closeLogoutModal = function() {
  const modal = document.getElementById("logoutConfirmModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
};

window.confirmLogout = async function() {
  const modal = document.getElementById("logoutConfirmModal");
  const signOutBtn = modal?.querySelector(".bb-primary-btn.bb-danger-btn");
  setButtonBusyState(signOutBtn, true, "Signing out...");
  try {
    await withTimeout(authLogout(), AUTH_OPERATION_TIMEOUT_MS, "logout");
  } catch (error) {
    console.error("[Auth] POS logout failed:", error);
    showToast(error?.message === "logout_timeout" ? "Logout is taking too long. Please try again." : "Unable to sign out right now.", "warning");
  } finally {
    setButtonBusyState(signOutBtn, false);
    closeLogoutModal();
  }
};

function setCartDensityButton(density) {
  const btn = document.getElementById("densityToggleBtn");
  if (!btn) return;
  btn.innerHTML = density === "compact"
    ? '<i class="ri-list-check" aria-hidden="true"></i> Regular View'
    : '<i class="ri-layout-grid-line" aria-hidden="true"></i> Compact View';
}

function applyCartDensity(density) {
  const normalized = density === "compact" ? "compact" : "regular";
  document.body.setAttribute("data-cart-density", normalized);
  setCartDensityButton(normalized);
  localStorage.setItem(CART_DENSITY_STORAGE_KEY, normalized);
}

function applySavedCartDensity() {
  const saved = localStorage.getItem(CART_DENSITY_STORAGE_KEY);
  applyCartDensity(saved === "compact" ? "compact" : "regular");
}

window.toggleCartDensity = function() {
  const current = document.body.getAttribute("data-cart-density") === "compact" ? "compact" : "regular";
  applyCartDensity(current === "compact" ? "regular" : "compact");
};

function getSaleTimestampMs(sale) {
  if (!sale) return null;
  if (typeof sale.createdAtMs === "number") return sale.createdAtMs;
  if (sale.createdAt?.toDate) {
    const d = sale.createdAt.toDate();
    return Number.isFinite(d?.getTime?.()) ? d.getTime() : null;
  }
  if (typeof sale.createdAt?.seconds === "number") {
    return sale.createdAt.seconds * 1000;
  }
  if (typeof sale.createdAt === "string") {
    const parsedCreatedAt = Date.parse(sale.createdAt);
    if (Number.isFinite(parsedCreatedAt)) return parsedCreatedAt;
  }
  if (typeof sale.timestamp === "string") {
    const parsed = Date.parse(sale.timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// True when today's orders were archived by a day-end reset (resets/{todayKey}
// exists). A reset deletes today's docs from the live `orders` feed, so an
// empty feed after a reset is EXPECTED and must not be used to prune local
// sales — otherwise every other open terminal would zero out its drawer/stats
// mid-shift. Returns null when the marker could not be read (offline/flaky):
// callers treat that as "do not prune" because pruning is destructive.
async function hasTodayResetMarker() {
  try {
    const snap = await getDoc(doc(db, "resets", toDateKey(new Date())));
    return snap.exists();
  } catch (error) {
    console.warn("[POS] Failed to read reset marker; skipping prune.", error);
    return null;
  }
}

function formatHourLabel24To12(hour24) {
  const normalized = ((hour24 % 24) + 24) % 24;
  const period = normalized >= 12 ? "PM" : "AM";
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${hour12} ${period}`;
}

function formatHourLabelCompact(hour24) {
  const normalized = ((hour24 % 24) + 24) % 24;
  const period = normalized >= 12 ? "PM" : "AM";
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${hour12}${period}`;
}

function getHourlySlotLabel(slotIndex) {
  return formatHourLabel24To12(slotIndex);
}

function getSalesByHourlySlots() {
  const slots = Array.from({ length: 24 }, (_, i) => ({
    slot: i,
    label: getHourlySlotLabel(i),
    total: 0,
    orders: 0,
  }));

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + (24 * 60 * 60 * 1000);

  for (const sale of salesHistory) {
    const ts = getSaleTimestampMs(sale);
    if (!ts || ts < startOfDay || ts >= endOfDay) continue;
    const hour = new Date(ts).getHours();
    const idx = hour;
    if (!slots[idx]) continue;
    slots[idx].total += Number(sale.total) || 0;
    slots[idx].orders += 1;
  }

  return slots;
}

function renderSalesBars(barsId, axisId) {
  const barsEl = document.getElementById(barsId);
  const axisEl = document.getElementById(axisId);
  if (!barsEl || !axisEl) return;

  const slots = getSalesByHourlySlots();
  const maxTotal = Math.max(...slots.map(s => s.total), 1);
  const isLarge = barsId === "salesDashboardBars";

  barsEl.innerHTML = slots
    .map((s, i) => {
      const h = Math.max(8, Math.round((s.total / maxTotal) * 100));
      const idleClass = s.orders === 0 ? " is-idle" : "";
      const delay = i * 50;
      const label = isLarge && s.orders > 0 ? `<span class="sales-chart-bar-label">₱${s.total.toFixed(0)}</span>` : "";
      return `<div class="sales-chart-bar-wrap">
        ${label}
        <div class="sales-chart-bar${idleClass}" style="height:${h}%;animation-delay:${delay}ms" title="${s.label}: ₱${s.total.toFixed(2)} (${s.orders} orders)"></div>
      </div>`;
    })
    .join("");

  const hourLabels = Array.from({ length: 24 }, (_, i) => formatHourLabelCompact(i));
  axisEl.innerHTML = hourLabels.map((label, i) => `<span${i % 2 === 1 ? ' class="axis-muted"' : ""}>${label}</span>`).join("");
}

function renderSalesDashboardDetails() {
  const slots = getSalesByHourlySlots();
  const total = dailyStats.totalSales;
  const orders = dailyStats.orders;
  const avg = orders > 0 ? total / orders : 0;
  const peak = slots.reduce((best, cur) => (cur.total > best.total ? cur : best), { label: "N/A", total: 0 });

  const totalEl = document.getElementById("salesDashTotal");
  const ordersEl = document.getElementById("salesDashOrders");
  const avgEl = document.getElementById("salesDashAvg");
  const peakEl = document.getElementById("salesDashPeak");
  const discountsEl = document.getElementById("salesDashDiscounts");
  const listEl = document.getElementById("salesSlotList");

  if (totalEl) totalEl.textContent = `₱${total.toFixed(2)}`;
  if (ordersEl) ordersEl.textContent = String(orders);
  if (avgEl) avgEl.textContent = `₱${avg.toFixed(2)}`;
  if (peakEl) peakEl.textContent = peak.total > 0 ? peak.label : "N/A";
  if (discountsEl) discountsEl.textContent = String(dailyStats.discountsApplied || 0);

  if (listEl) {
    listEl.innerHTML = slots
      .filter(s => s.orders > 0)
      .sort((a, b) => b.total - a.total)
      .map(s => `
        <div class="sales-slot-row">
          <span class="sales-slot-label">${s.label}</span>
          <span class="sales-slot-value">₱${s.total.toFixed(2)} · ${s.orders} orders</span>
        </div>
      `)
      .join("") || '<div class="sales-slot-row"><span class="sales-slot-label">No sales yet</span><span class="sales-slot-value">Complete an order to populate this view</span></div>';
  }
}

function renderSidebarSalesSummary() {
  const total = dailyStats.totalSales;
  const totalEl = document.getElementById("salesSummaryTotal");
  if (totalEl) totalEl.textContent = `₱${total.toFixed(2)}`;
}

function refreshSalesVisuals() {
  renderSalesBars("salesDashboardBars", "salesDashboardAxis");
  renderSalesDashboardDetails();
  renderSidebarSalesSummary();
}

window.openSalesDashboard = function() {
  const modal = document.getElementById("salesDashboardModal");
  if (!modal) return;
  refreshSalesVisuals();
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

window.closeSalesDashboard = function() {
  const modal = document.getElementById("salesDashboardModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
};

window.toggleSidebar = function() {
  document.body.classList.toggle("sidebar-collapsed");
};

window.closeSidebar = function() {
  document.body.classList.add("sidebar-collapsed");
};

window.setMainView = function(view) {
  const normalized = view === "order" ? "order" : "menu";
  document.body.classList.remove("main-view-menu", "main-view-order");
  document.body.classList.add(normalized === "menu" ? "main-view-menu" : "main-view-order");

  const menuBtn = document.getElementById("menuViewBtn");
  const orderBtn = document.getElementById("orderViewBtn");
  const menuToOrderBtn = document.getElementById("menuToOrderBtn");
  const orderToMenuBtn = document.getElementById("orderToMenuBtn");

  if (menuBtn) {
    menuBtn.classList.toggle("active", normalized === "menu");
    menuBtn.setAttribute("aria-pressed", normalized === "menu" ? "true" : "false");
  }
  if (orderBtn) {
    orderBtn.classList.toggle("active", normalized === "order");
    orderBtn.setAttribute("aria-pressed", normalized === "order" ? "true" : "false");
  }
  if (menuToOrderBtn) {
    menuToOrderBtn.classList.toggle("active", normalized === "order");
    menuToOrderBtn.setAttribute("aria-pressed", normalized === "order" ? "true" : "false");
  }
  if (orderToMenuBtn) {
    orderToMenuBtn.classList.toggle("active", normalized === "menu");
    orderToMenuBtn.setAttribute("aria-pressed", normalized === "menu" ? "true" : "false");
  }
};

window.closeAdminDashboard = function() {
  const modal = document.getElementById("adminModal");
  if (!modal) return;
  modal.classList.remove("active");
};

function updateStats() {
  const el1 = document.getElementById("todayOrders");
  const el2 = document.getElementById("totalSales");
  const el3 = document.getElementById("activeDiscounts");
  if (el1) el1.textContent = dailyStats.orders;
  if (el2) el2.textContent = `₱${dailyStats.totalSales.toFixed(2)}`;
  if (el3) el3.textContent = dailyStats.discountsApplied;
  
  // Sidebar stats
  const sidebarOrders = document.getElementById("todayOrders");
  const sidebarSales = document.getElementById("totalSales");
  if (sidebarOrders) sidebarOrders.textContent = dailyStats.orders;
  if (sidebarSales) sidebarSales.textContent = `₱${dailyStats.totalSales.toFixed(2)}`;

  refreshSalesVisuals();
}

async function getPendingOrders() {
  return getKitchenOrders();
}

window.openPendingOrdersModal = function() {
  const modal = document.getElementById("pendingOrdersModal");
  if (!modal) return;
  renderPendingOrdersList();
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

window.closePendingOrdersModal = function() {
  const modal = document.getElementById("pendingOrdersModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
};

window.refreshPendingOrders = function() {
  updateConnectivityStatus();
};

window.markPendingOrderPrepared = async function(orderId) {
  if (!orderId) return;
  const pending = await getPendingOrders();
  const kitchen = pending.find((o) => String(o.id) === String(orderId));
  const docId = String(kitchen?.payload?.orderId || kitchen?.payload?.id || orderId).replace(/^q_/, "");
  await removeKitchenOrder(orderId);
  // Flip the order's status to "done" so the admin transactions page shows it
  // as prepared. Best-effort: if the doc isn't in Firestore yet (offline queued
  // sale) or the write fails, keep the pending list working — the status just
  // stays "pending" and will read from the synced doc later.
  try {
    await updateDoc(doc(db, "orders", docId), {
      status: "done",
      preparedAtMs: Date.now(),
      preparedBy: cashierName || "Staff",
    });
  } catch (error) {
    console.warn("[POS] Mark prepared: order status update failed.", error);
  }
  updateConnectivityStatus();
  showToast("Order marked as prepared and removed from pending list", "success");
};

async function renderPendingOrdersList() {
  const pending = await getPendingOrders();
  const listEl = document.getElementById("pendingOrdersModalList");
  if (!listEl) return;

  if (!pending.length) {
    listEl.innerHTML = '<div class="sidebar-pending-empty">No pending orders</div>';
    return;
  }

  listEl.innerHTML = pending.map((order) => {
    const itemNames = Array.isArray(order.payload?.items)
      ? order.payload.items.slice(0, 2).map(i => escapeHtml(i.name)).join(", ") + (order.payload.items.length > 2 ? ", ..." : "")
      : "No items";
    const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
    const total = Number(order.payload?.total) || 0;
    const note = order.payload?.note || "";
    const customerName = String(order.payload?.customerName || "").trim();
    const noteId = `note_${order.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const maxNoteLen = 100;
    const noteTruncated = note.length > maxNoteLen;
    const noteEscaped = escapeHtml(note);
    const noteDisplay = noteTruncated ? escapeHtml(note.slice(0, maxNoteLen)) + "..." : noteEscaped;
    return `
      <div class="sidebar-pending-item">
        <div>
          ${customerName ? `<div class="sidebar-pending-name">${escapeHtml(customerName)}</div>` : ""}
          <div class="sidebar-pending-order">#${String(order.id).replace(/^q_/, "").slice(-6)}</div>
          <div class="sidebar-pending-meta">${createdAt} · ${itemNames}</div>
          <div class="sidebar-pending-meta">Total: ₱${total.toFixed(2)}</div>
          ${note ? `<div class="sidebar-pending-note" id="${noteId}" data-full="${noteEscaped.replace(/"/g, "&quot;")}" data-short="${noteDisplay.replace(/"/g, "&quot;")}">Note: ${noteDisplay}</div>${noteTruncated ? `<button class="sidebar-pending-note-toggle" type="button" onclick="togglePendingNote('${noteId}')">See more</button>` : ""}` : ""}
        </div>
        <div class="pending-item-actions">
          <button class="sidebar-pending-button" type="button" onclick='event.stopPropagation(); openPendingOrder(${JSON.stringify(order.id)})'>View Receipt</button>
          <button class="sidebar-pending-button" type="button" onclick='event.stopPropagation(); markPendingOrderPrepared(${JSON.stringify(order.id)})'>Done preparing</button>
          <button class="sidebar-pending-button pending-cancel-btn" type="button" onclick='event.stopPropagation(); cancelPendingOrder(${JSON.stringify(order.id)})'>Cancel order</button>
        </div>
      </div>
    `;
  }).join("");
}

window.togglePendingNote = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const full = el.getAttribute("data-full");
  const short = el.getAttribute("data-short");
  if (!short) return;

  if (full) {
    el.textContent = "Note: " + full;
    el.removeAttribute("data-full");
    const btn = el.nextElementSibling;
    if (btn && btn.classList.contains("sidebar-pending-note-toggle")) {
      btn.textContent = "See less";
      btn.onclick = function() {
        el.setAttribute("data-full", full);
        el.textContent = "Note: " + short;
        btn.textContent = "See more";
        btn.onclick = function() { togglePendingNote(id); };
      };
    }
  }
};

function updateConnectivityStatus() {
  const indicator = document.getElementById("storageStatus");
  const pendingSyncCount = getPendingOrderCount();
  const savedCount = getStorageCount();

  // The Cloud/Queue/Local card only needs local, synchronous data — render it
  // immediately so it never waits on the network.
  if (indicator) {
    const cloudLabel = isOnline ? "Online" : "Offline";
    indicator.innerHTML = `<i class="ri-wifi-line" aria-hidden="true"></i><span>Cloud: ${cloudLabel}</span><span class="storage-dot" aria-hidden="true">•</span><span>Queue: ${pendingSyncCount}</span><span class="storage-dot" aria-hidden="true">•</span><span>Local: ${savedCount}</span>`;
    indicator.setAttribute("title", `Cloud ${cloudLabel}; ${pendingSyncCount} order(s) waiting sync; ${savedCount} local record(s)`);
  }

  // Kitchen pending count and list are Firestore reads — refresh them in the
  // background so the stats card above never blocks on the network.
  refreshKitchenPendingIndicators().catch(() => {});
}

async function refreshKitchenPendingIndicators() {
  const pendingKitchenOrders = await getPendingOrders();
  const pendingKitchenCount = Array.isArray(pendingKitchenOrders) ? pendingKitchenOrders.length : 0;
  const pendingEl = document.getElementById("pendingOrdersSidebar");
  if (pendingEl) pendingEl.textContent = String(pendingKitchenCount);
  const pendingModalCountEl = document.getElementById("pendingOrdersOpenCount");
  if (pendingModalCountEl) pendingModalCountEl.textContent = String(pendingKitchenCount);
  await renderPendingOrdersList();
}

function showToast(message, type = "success") {
  const toast    = document.getElementById("toast");
  const iconMap  = {
    success: '<i class="ri-checkbox-circle-line" aria-hidden="true"></i>',
    error: '<i class="ri-close-circle-line" aria-hidden="true"></i>',
    warning: '<i class="ri-alert-line" aria-hidden="true"></i>',
  };
  toast.className = `toast ${type}`;
  document.getElementById("toastIcon").innerHTML = iconMap[type] || iconMap.success;
  document.getElementById("toastMessage").textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ── THERMAL PRINTER UI ──

function renderPrinterStatus(status) {
  const connected = !!(status && status.connected);
  const reconnecting = !!(status && status.reconnecting && !connected);
  const name = (status && status.deviceName) || "";
  const supported = !status || status.supported !== false;

  const sidebarEl = document.getElementById("printerStatus");
  if (sidebarEl) {
    sidebarEl.className = "printer-status" + (connected ? " is-connected" : "");
    sidebarEl.innerHTML = connected
      ? `<i class="ri-printer-fill" aria-hidden="true"></i><span>${name ? "Printer: " + escapeHtml(name) : "Printer: Connected"}</span>`
      : reconnecting
        ? `<i class="ri-printer-line" aria-hidden="true"></i><span>Printer: Reconnecting...</span>`
        : `<i class="ri-printer-line" aria-hidden="true"></i><span>Printer: Not connected</span>`;
  }

  const textEl = document.getElementById("printerStatusText");
  if (textEl) {
    textEl.textContent = connected
      ? `Connected: ${name || "thermal printer"}`
      : reconnecting
        ? "Reconnecting to printer..."
        : supported
          ? "Not connected"
          : "Bluetooth not supported by this browser (use Chrome or Edge)";
  }

  const dotEl = document.getElementById("printerStatusDot");
  if (dotEl) dotEl.className = "bb-printer-dot" + (connected ? " is-on" : "");

  const deviceEl = document.getElementById("printerDeviceName");
  if (deviceEl) {
    deviceEl.textContent = connected && name ? name : "No printer connected";
  }

  const connectBtn = document.getElementById("connectPrinterBtn");
  if (connectBtn) {
    connectBtn.textContent = connected ? "Disconnect" : reconnecting ? "Reconnecting..." : supported ? "Connect printer" : "Unsupported browser";
    connectBtn.disabled = !supported || reconnecting;
    connectBtn.onclick = connected ? () => window.disconnectPrinter() : () => window.connectPrinter();
  }

  const settings = getPrinterSettings();
  const w58 = document.getElementById("paperWidth58");
  const w80 = document.getElementById("paperWidth80");
  if (w58) w58.classList.toggle("active", settings.paperWidth !== 80);
  if (w80) w80.classList.toggle("active", settings.paperWidth === 80);
}

window.openPrinterSettings = function() {
  const modal = document.getElementById("printerModal");
  if (!modal) return;
  renderPrinterStatus(getPrinterStatus());
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

window.closePrinterSettings = function() {
  const modal = document.getElementById("printerModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
};

window.connectPrinter = async function() {
  if (!isPrinterSupported()) {
    showToast("Web Bluetooth is not available in this browser. Use Chrome or Edge.", "warning");
    return;
  }
  const btn = document.getElementById("connectPrinterBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
  try {
    await connectThermalPrinter();
    const status = getPrinterStatus();
    if (status.connected) {
      showToast(`Printer connected: ${status.deviceName || "thermal printer"}`, "success");
    }
  } catch (error) {
    if (!/cancelled|cancel/i.test(String(error?.message || ""))) {
      showToast(error?.message || "Unable to connect to the printer.", "warning");
    }
  } finally {
    renderPrinterStatus(getPrinterStatus());
  }
};

window.disconnectPrinter = async function() {
  await disconnectThermalPrinter();
  renderPrinterStatus(getPrinterStatus());
  showToast("Printer disconnected.", "info");
};

window.setPaperWidth = function(width) {
  updatePrinterSettings({ paperWidth: width === 80 ? 80 : 58 });
  renderPrinterStatus(getPrinterStatus());
};
