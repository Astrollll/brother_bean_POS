// ── POS CONTROLLER ──
// Connects models (data) to views (UI) for the POS/cashier page

import { getMenuItems, watchMenuItems }  from "../models/menuModel.js";
import { getCategories } from "../models/categoryModel.js";
import { getCategoryIconForName } from "../models/categoryModel.js";
import { isDefaultTemplateMenuItem } from "../models/defaultSeedData.js";
import { saveOrder, syncQueuedOrders, getPendingOrderCount, getTodayOrders, watchTodayOrders, retryFailedInventoryDeduction } from "../models/orderModel.js";
import { watchAuth, getCurrentUser, logout as authLogout } from "./auth/firebaseAuth.js";
import { getUserProfile, getUserRole } from "../models/userModel.js";
import { navigateTo } from "./utils/routes.js";
import { db } from "./firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { 
  saveToStorage, 
  loadFromStorage, 
  loadStatsFromFirestore,
  checkDailyReset, 
  getStorageCount,
  getKitchenOrders,
  saveKitchenOrder,
  removeKitchenOrder
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
let dailyStats       = { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0 };
let isOnline         = navigator.onLine;
const THEME_STORAGE_KEY = "bb-pos-theme";
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

  const persistPosState = () => saveToStorage(salesHistory, dailyStats);

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

    // Load from storage first
    const storageData = await loadFromStorage();
    salesHistory = storageData.salesHistory;
    dailyStats = storageData.dailyStats;

    if (checkDailyReset()) {
      dailyStats = { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0 };
      salesHistory = [];
      showToast("Daily stats reset for new day", "info");
      persistPosState();
    }

    // Seed stats from Firestore so all cashiers see today's shared sales
    try {
      const now = Date.now();
      const startOfDay = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
      const endOfDay = startOfDay + 86400000;

      // Purge stale entries (previous days) from localStorage data
      salesHistory = salesHistory.filter(o => {
        const ts = getSaleTimestampMs(o);
        return ts >= startOfDay && ts < endOfDay;
      });

      const firestoreOrders = await getTodayOrders();
      const todayOrders = (Array.isArray(firestoreOrders) ? firestoreOrders : []).filter(o => {
        const ts = getSaleTimestampMs(o);
        return ts >= startOfDay && ts < endOfDay;
      });
      if (todayOrders.length > 0) {
        const seenOrderIds = new Set(
          salesHistory.map(s => String(s.orderId || s.id || ""))
        );
        for (const order of todayOrders) {
          const oid = String(order.orderId || order.id || "");
          if (!oid || seenOrderIds.has(oid)) continue;
          salesHistory.push(order);
          seenOrderIds.add(oid);
        }
      }
      dailyStats = {
        orders: salesHistory.length,
        totalSales: salesHistory.reduce((sum, s) => sum + (Number(s.total) || 0), 0),
        discountsApplied: salesHistory.filter(s => s.isPwdSenior || s.discount).length,
        cashReceived: salesHistory.reduce((sum, s) => {
          if (s.paymentMethod === "split") return sum + (Number(s.cashAmount) || 0);
          if (s.paymentMethod === "cash") return sum + (Number(s.total) || 0);
          return sum;
        }, 0),
      };
      persistPosState();
    } catch (err) {
      console.warn("[POS] Failed to seed stats from Firestore:", err);
    }

    menuItems = sanitizePosMenuItems(await getMenuItems());

    // Load unpaid orders from Firestore so they survive cache clears
    await loadUnpaidOrdersFromFirestore();
    updateUnpaidOrderSidebar();

    // Clear any stale cart data from previous sessions
    try { localStorage.removeItem("bb-pos-active-cart"); } catch {}

    persistPosState();
    renderCategoryControls();
    renderProducts();
    updateCart();
    applySavedTheme();
    applySavedCartDensity();
    updateStats();

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
    watchTodayOrders((todayOrders) => {
      const now = Date.now();
      const startOfDay = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
      const endOfDay = startOfDay + 86400000;

      salesHistory = todayOrders.filter(o => {
        const ts = getSaleTimestampMs(o);
        return ts >= startOfDay && ts < endOfDay;
      });
      dailyStats = {
        orders: salesHistory.length,
        totalSales: salesHistory.reduce((sum, s) => sum + (Number(s.total) || 0), 0),
        discountsApplied: salesHistory.filter(s => s.isPwdSenior || s.discount).length,
        cashReceived: salesHistory.reduce((sum, s) => {
          if (s.paymentMethod === "split") return sum + (Number(s.cashAmount) || 0);
          if (s.paymentMethod === "cash") return sum + (Number(s.total) || 0);
          return sum;
        }, 0),
      };
      persistPosState();
      updateStats();
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
      const result = await syncQueuedOrders();
      updateConnectivityStatus();
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
      await syncQueuedOrders();
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
    const cat = item.category || 'Uncategorized';
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
  return `<span class="category-chip-icon-wrap"><span class="category-chip-icon">${icon}</span></span><span class="category-chip-label">${name}</span>`;
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
  if (coffeeMatch) {
    finalOrdered.push(coffeeMatch);
  }

  // Add remaining categories except coffee/addons, preserving the earlier ordering
  for (const c of ordered) {
    if (coffeeMatch && normalizedName(c) === normalizedName(coffeeMatch)) continue;
    if (addonsMatch && normalizedName(c) === normalizedName(addonsMatch)) continue;
    finalOrdered.push(c);
  }

  // Finally append any leftover available categories (that weren't in ordered)
  for (const c of Array.from(available).sort((a, b) => a.localeCompare(b))) {
    if (coffeeMatch && normalizedName(c) === normalizedName(coffeeMatch)) continue;
    if (addonsMatch && normalizedName(c) === normalizedName(addonsMatch)) continue;
    finalOrdered.push(c);
  }

  if (addonsMatch) {
    finalOrdered.push(addonsMatch);
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
    .map(cat => `<button type="button" class="category-chip ${isSameCategory(cat, currentCategory) ? "active" : ""}" data-category="${cat}" onclick="selectCategory('${cat}', this)">${getCategoryDisplay(cat)}</button>`)
    .join("");

  quickButton.innerHTML = getCategoryDisplay(currentCategory);
  quickMenu.innerHTML = ["all", ...categories]
    .map(cat => `<button type="button" class="category-quick-menu-item${isSameCategory(cat, currentCategory) ? " is-selected" : ""}" onclick="selectCategory('${cat}')">${getCategoryDisplay(cat)}</button>`)
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

  const drinkAddons = menuItems.filter(i =>
    i.category === "addons" || i.category === "Add-ons" || i.category === "Add-ons Drink"
  );
  const foodAddons = menuItems.filter(i =>
    i.category === "addons" || i.category === "Add-ons" || i.category === "Add-ons Food"
  );
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
            onclick="selectMenuVariant('${v.name}', ${v.price})">
            <span class="bb-choice-main">${v.name}</span>
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
            <span class="bb-addon-name">${a.name}</span>
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
          <div class="bb-mini-note">${product.category || ""}</div>
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
  const temp     = product.hasTemp ? (selectedTemp || null) : "N/A";
  const addons   = [...selectedAddons];

  const existingIdx = cart.findIndex(i =>
    i.id === product.id &&
    i.variant     === variant &&
    i.temperature === temp &&
    JSON.stringify(i.addons) === JSON.stringify(addons)
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
        <div class="cart-item-name">${item.name}</div>
        ${item.variant ? `<div class="cart-item-variant">${item.variant}</div>` : ""}
        ${item.temperature && item.temperature !== "N/A" ? `<div class="cart-item-variant">${item.temperature}</div>` : ""}
        ${(item.addons||[]).length ? `<div class="cart-item-addons">${item.addons.map(a=>`<span class="cart-addon-tag">+${a.name}</span>`).join("")}</div>` : ""}
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
  const pwdCheck = document.getElementById("pwdSeniorCheck");
  const discountToggle = document.getElementById("discountToggle");
  if (pwdCheck) pwdCheck.checked = false;
  if (discountToggle) discountToggle.classList.remove("active");
  document.querySelector(".discount-section")?.classList.remove("is-active");
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
    subtotal: summary.subtotal,
    discountAmount: isPwdSenior ? summary.subtotal * 0.2 : 0,
    total: summary.total,
    amountTendered: summary.total,
    change: 0,
    items: cloneValue(cart) || [],
    cashierName,
    unpaid: true,
  };
}

window.moveCurrentOrderToUnpaid = async function() {
  if (!cart.length) return;

  await addUnpaidOrder(buildUnpaidOrderFromCart());
  cart = [];
  isPwdSenior = false;
  enteredAmount = "";
  const pwdCheck = document.getElementById("pwdSeniorCheck");
  const discountToggle = document.getElementById("discountToggle");
  if (pwdCheck) pwdCheck.checked = false;
  if (discountToggle) discountToggle.classList.remove("active");
  document.querySelector(".discount-section")?.classList.remove("is-active");
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
      ? order.items.slice(0, 2).map(i => i.name).join(", ") + (order.items.length > 2 ? ", ..." : "")
      : "No items";
    const timestamp = order.timestamp || "--";
    const total = Number(order.total) || 0;
    return `
      <div class="sidebar-pending-item">
        <div onclick="openUnpaidOrderReceipt('${order.id}')">
          <div class="sidebar-pending-order">${order.orderId || order.id}</div>
          <div class="sidebar-pending-meta">${timestamp} · ${itemNames}</div>
          <div class="sidebar-pending-meta">Total: ₱${total.toFixed(2)}</div>
        </div>
        <div class="unpaid-item-actions">
          <button class="sidebar-pending-button" type="button" onclick="event.stopPropagation(); restoreUnpaidOrderToCart('${order.id}')">Restore</button>
          <button class="sidebar-pending-button unpaid-delete-btn" type="button" onclick="event.stopPropagation(); deleteUnpaidOrder('${order.id}')">Delete</button>
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
    const replace = window.confirm("Current order has items. Replace it with the unpaid order?");
    if (!replace) return;
  }

  cart = cloneValue(unpaid.items) || [];
  isPwdSenior = !!unpaid.isPwdSenior;
  currentPayMethod = unpaid.paymentMethod || currentPayMethod;
  const pwdCheck = document.getElementById("pwdSeniorCheck");
  const discountToggle = document.getElementById("discountToggle");
  if (pwdCheck) pwdCheck.checked = isPwdSenior;
  if (discountToggle) discountToggle.classList.toggle("active", isPwdSenior);
  document.querySelector(".discount-section")?.classList.toggle("is-active", isPwdSenior);
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
  const confirmed = window.confirm("Delete this unpaid order? This cannot be undone.");
  if (!confirmed) return;
  await removeUnpaidOrderById(orderId);
  renderUnpaidOrdersList();
  updateUnpaidOrderSidebar();
  showToast("Unpaid order deleted.", "success");
};

window.toggleDiscount = function() {
  isPwdSenior = !isPwdSenior;
  document.getElementById("pwdSeniorCheck").checked = isPwdSenior;
  document.getElementById("discountToggle").classList.toggle("active", isPwdSenior);
  document.querySelector(".discount-section")?.classList.toggle("is-active", isPwdSenior);
  updateCart();
};

window.toggleEmployeeOrder = function() {
  isEmployeeOrder = !isEmployeeOrder;
  document.getElementById("employeeOrderCheck").checked = isEmployeeOrder;
  document.getElementById("employeeOrderToggle")?.classList.toggle("active", isEmployeeOrder);
  document.querySelector(".employee-order-section")?.classList.toggle("is-active", isEmployeeOrder);
  updateCart();
};

window.searchProducts = function() {
  renderProducts(currentCategory);
};

// ── PAYMENT ──
let capturedPaymentTotal = 0;

window.openPaymentModal = function() {
  capturedPaymentTotal = parseFloat(document.getElementById("total").textContent.replace("₱","").replace(",",""));
  document.getElementById("paymentAmount").textContent = `₱${capturedPaymentTotal.toFixed(2)}`;
  document.getElementById("paymentModal").classList.add("active");
  enteredAmount = "";
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
  if (enteredAmount.length < 10) {
    enteredAmount += digit;
    updateChangeDisplay();
    updateDoneButton();
  }
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
    const gcashAmount = Math.max(0, capturedPaymentTotal - cashAmount);
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

  let amountTendered;
  let cashAmount = null;
  let gcashAmount = null;

  if (isEmployeeOrder) {
    amountTendered = 0;
  } else if (currentPayMethod === "cash") {
    amountTendered = parseFloat(enteredAmount) || total;
  } else if (currentPayMethod === "split") {
    cashAmount = parseFloat(enteredAmount) || 0;
    gcashAmount = Math.max(0, total - cashAmount);
    amountTendered = total;
  } else {
    amountTendered = total;
  }

  const paymentMethod = isEmployeeOrder ? "employee" : currentPayMethod;

  setButtonBusyState(doneBtn, true, "Saving...");
  try {
    // Save to Firebase via model
    const user = getCurrentUser();
    const sale = await saveOrder(cart, total, subtotal, paymentMethod, isPwdSenior, amountTendered, user?.uid || null, cashierName, cashAmount, gcashAmount, { orderType: isEmployeeOrder ? "employee" : "regular", note: orderNote });

    // Add to kitchen pending queue so the order appears in the sidebar
    await saveKitchenOrder(sale);

    // Notify other parts of the app (analytics/dashboard) about the new order
    try {
      if (typeof window !== "undefined" && window.dispatchEvent) {
        const ev = new CustomEvent("bb:order:saved", { detail: sale });
        window.dispatchEvent(ev);
      }
    } catch (err) {
      console.warn("[POS] failed to dispatch order saved event", err);
    }
    // store in a global buffer so other components can pick it up even if they weren't listening yet
    try {
      if (typeof window !== "undefined") {
        window.__bbOrderEventBuffer = window.__bbOrderEventBuffer || [];
        window.__bbOrderEventBuffer.unshift(sale);
        // keep buffer bounded
        if (window.__bbOrderEventBuffer.length > 200) window.__bbOrderEventBuffer.length = 200;
      }
    } catch (err) {
      // non-fatal
    }

    // Update local stats
    dailyStats.orders++;
    dailyStats.totalSales += total;
    if (isPwdSenior) dailyStats.discountsApplied++;
    if (currentPayMethod === "cash") {
      dailyStats.cashReceived += parseFloat(enteredAmount) || total;
    } else if (currentPayMethod === "split") {
      dailyStats.cashReceived += parseFloat(enteredAmount) || 0;
    }
    salesHistory.push(sale);
    saveToStorage(salesHistory, dailyStats);

    // Generate receipt
    generateReceipt({ ...sale, items: cart, amountTendered, change: amountTendered - total });

    // Reset state
    cart        = [];
    isPwdSenior = false;
    isEmployeeOrder = false;
    enteredAmount = "";
    if (noteEl) noteEl.value = "";
    document.getElementById("pwdSeniorCheck").checked = false;
    document.getElementById("discountToggle").classList.remove("active");
    document.getElementById("employeeOrderToggle")?.classList.remove("active");
    document.querySelector(".employee-order-section")?.classList.remove("is-active");
    document.getElementById("employeeOrderCheck").checked = false;
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

  const discountBlock = `<div class="totals-row sub"><span>Discount</span><span>− ${formatMoney(sale.isPwdSenior ? sale.discountAmount : 0)}</span></div>`;

  const totalItemSavings = (sale.items || []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 1;
    const addons = Array.isArray(item.addons) ? item.addons : [];
    const addonsTotal = addons.reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = (Number(item.price) || 0) + addonsTotal;
    return sum + (originalUnit * discountPct * qty);
  }, 0);
  const itemDiscountBlock = `<div class="totals-row sub"><span>Item discounts</span><span>− ${formatMoney(totalItemSavings)}</span></div>`;

  const paidStamp = sale.unpaid ? "UNPAID" : sale.queued ? "PENDING" : "PAID";

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
            <img src="/assets/icons/brother-bean-logo.jpg" alt="Brother Bean Coffeehouse logo" />
          </div>
          <div class="brand-name">Brother Bean Coffee House</div>
          <div class="brand-tag">anytime is coffee time.</div>
          <div class="brand-addr">N. Guevarra St. Brgy. Zone 1 Poblacion Dasmariñas City Cavite</div>
        </div>

        <hr class="rule">

        <div class="meta-row"><span class="label">Date</span><span class="value">${sale.timestamp || "—"}</span></div>
        <div class="meta-row"><span class="label">Order #</span><span class="value">${orderShort}</span></div>
        <div class="meta-row"><span class="label">Payment</span><span class="value">${(sale.paymentMethod || "—").toUpperCase()}</span></div>
        ${sale.paymentMethod === "split" ? `
        <div class="meta-row"><span class="label">Cash</span><span class="value">${formatMoney(sale.cashAmount || 0)}</span></div>
        <div class="meta-row"><span class="label">GCash</span><span class="value">${formatMoney(sale.gcashAmount || 0)}</span></div>
        ` : ""}
        <div class="meta-row"><span class="label">Cashier</span><span class="value">${escapeHtml(sale.cashierName || "Staff")}</span></div>

        <hr class="rule">

        ${itemRows}

        <hr class="rule">

        <div class="totals-row sub"><span>Subtotal</span><span>${formatMoney(sale.subtotal)}</span></div>
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
};

window.openPendingOrder = function(orderId) {
  const pending = getPendingOrders();
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

window.printReceipt = function() {
  const receiptContent = document.getElementById("receiptContent").innerHTML;
  const existing = document.getElementById("printFrame");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "printFrame";
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;";
  document.body.appendChild(iframe);
  const docRef = iframe.contentDocument || iframe.contentWindow.document;
  docRef.open();
  docRef.write(`<html><head><title>Brother Bean Receipt</title>
    <style>
      /* Print-optimized receipt (58–80mm) */
      * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 6mm; }
      body {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        background: #fff;
        color: #111;
        font-size: 11px;
        line-height: 1.35;
      }

      .receipt-wrap { width: 320px; margin: 0 auto; }
      .receipt-close-btn { display: none; }
      .zigzag-top, .zigzag-bottom { height: 12px; width: 100%; background: #fbf9f4; }
      .zigzag-top { clip-path: polygon(0% 100%, 4% 0%, 8% 100%, 12% 0%, 16% 100%, 20% 0%, 24% 100%, 28% 0%, 32% 100%, 36% 0%, 40% 100%, 44% 0%, 48% 100%, 52% 0%, 56% 100%, 60% 0%, 64% 100%, 68% 0%, 72% 100%, 76% 0%, 80% 100%, 84% 0%, 88% 100%, 92% 0%, 96% 100%, 100% 0%, 100% 100%); }
      .zigzag-bottom { clip-path: polygon(0% 0%, 4% 100%, 8% 0%, 12% 100%, 16% 0%, 20% 100%, 24% 0%, 28% 100%, 32% 0%, 36% 100%, 40% 0%, 44% 100%, 48% 0%, 52% 100%, 56% 0%, 60% 100%, 64% 0%, 68% 100%, 72% 0%, 76% 100%, 80% 0%, 84% 100%, 88% 0%, 92% 100%, 96% 0%, 100% 100%, 100% 0%); }

      .receipt { background: #fbf9f4; color: #2b2620; padding: 20px 26px 20px; font-size: 13px; line-height: 1.55; }
      .center { text-align: center; }
      .brand-mark { width: 34px; height: 34px; margin: 4px auto 8px; border: 2px solid #2b2620; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .brand-mark img { width: 100%; height: 100%; object-fit: cover; filter: none; }
      .brand-name { font-weight: 700; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; }
      .brand-tag { color: #6b6255; font-size: 11px; font-style: italic; margin-top: 2px; }
      .brand-addr { color: #6b6255; font-size: 11px; margin-top: 6px; }
      .rule { border: none; border-top: 1px dashed #cfc7b8; margin: 12px 0; }
      .meta-row { display: flex; justify-content: space-between; font-size: 12px; }
      .meta-row .label { color: #6b6255; }
      .meta-row .value { font-weight: 700; }
      .item { margin-bottom: 10px; }
      .item-name { display: flex; justify-content: space-between; font-weight: 700; }
      .item-variant { color: #6b6255; font-size: 11px; margin-top: 1px; }
      .item-calc { display: flex; justify-content: space-between; margin-top: 2px; }
      .item-calc .qty { color: #6b6255; }
      .item-price-original { text-decoration: line-through; color: #6b6255; margin-right: 2px; }
      .item-price-arrow { margin: 0 2px; color: #6b6255; }
      .item-price-label { font-size: 10px; color: #6b6255; }
      .totals-row { display: flex; justify-content: space-between; }
      .totals-row.grand { font-weight: 700; font-size: 15px; margin-top: 4px; }
      .totals-row.sub { color: #6b6255; }
      .stamp { position: relative; text-align: center; margin: 18px 0 6px; }
      .stamp span { display: inline-block; border: 2.5px solid #a6493a; color: #a6493a; font-weight: 800; letter-spacing: 3px; padding: 3px 14px; border-radius: 4px; transform: rotate(-6deg); font-size: 13px; opacity: 0.85; }
      .barcode { margin: 14px 0 4px; height: 34px; background: repeating-linear-gradient(90deg, #2b2620 0px, #2b2620 2px, transparent 2px, transparent 4px, #2b2620 4px, #2b2620 5px, transparent 5px, transparent 9px); }
      .footer-msg { font-weight: 700; margin-bottom: 2px; }
      .footer-sub { color: #6b6255; font-size: 11px; margin-bottom: 10px; }
      .footer-legal { color: #6b6255; font-size: 10px; line-height: 1.6; }

      /* Ensure buttons/controls never print */
      button { display:none !important; }
      @media print { body { margin: 0; } }
    </style></head><body>${receiptContent}</body></html>`);
  docRef.close();
  iframe.onload = () => { iframe.contentWindow.focus(); iframe.contentWindow.print(); };
};

// ── MISC ──
window.openDrawer = function() {
  const modal = document.getElementById("drawerModal");
  if (!modal) return;

  const cashEl = document.getElementById("drawerCashValue");
  const txnEl = document.getElementById("drawerTxnValue");

  if (cashEl) cashEl.textContent = `₱${(dailyStats.cashReceived || 0).toFixed(2)}`;
  if (txnEl) txnEl.textContent = String(dailyStats.orders);

  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

window.closeDrawerModal = function() {
  const modal = document.getElementById("drawerModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
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

function setThemeButton(theme) {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  if (theme === "dark") {
    btn.innerHTML = '<i class="ri-moon-line" aria-hidden="true"></i> Dark Mode';
  } else {
    btn.innerHTML = '<i class="ri-sun-line" aria-hidden="true"></i> Light Mode';
  }
  btn.disabled = false;
}

function applyTheme(theme) {
  // Dark mode removed: always use light theme and do not persist.
  const normalized = "light";
  document.body.setAttribute("data-theme", normalized);
  setThemeButton(normalized);
}

function applySavedTheme() {
  // Ensure theme stays light; ignore saved preference.
  applyTheme('light');
}

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

window.toggleTheme = function() {
  // Theme toggling removed; keep light theme for compatibility.
  applyTheme('light');
};

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

function getTwoHourWindowLabel(slotIndex) {
  const startHour = slotIndex * 2;
  const endHour = (startHour + 2) % 24;
  return `${formatHourLabel24To12(startHour)} - ${formatHourLabel24To12(endHour)}`;
}

function getTwoHourWindowCompactLabel(slotIndex) {
  const startHour = slotIndex * 2;
  const endHour = (startHour + 2) % 24;
  return `${formatHourLabelCompact(startHour)}-${formatHourLabelCompact(endHour)}`;
}

function formatPesoSummary(value) {
  const n = Number(value) || 0;
  if (n >= 1000) return `₱${(n / 1000).toFixed(1)}K`;
  return `₱${n.toFixed(0)}`;
}

function getSalesByTwoHourSlots() {
  const slots = Array.from({ length: 12 }, (_, i) => ({
    slot: i,
    label: getTwoHourWindowLabel(i),
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
    const idx = Math.floor(hour / 2);
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

  const slots = getSalesByTwoHourSlots();
  const maxTotal = Math.max(...slots.map(s => s.total), 1);
  const bucketLabels = ["12A", "2A", "4A", "6A", "8A", "10A", "12P", "2P", "4P", "6P", "8P", "10P"];
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

  axisEl.innerHTML = bucketLabels.map(label => `<span>${label}</span>`).join("");
}

function renderSalesDashboardDetails() {
  const slots = getSalesByTwoHourSlots();
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
  const slots = getSalesByTwoHourSlots();
  const total = dailyStats.totalSales;
  const orders = dailyStats.orders;
  const peak = slots.reduce((best, cur) => (cur.total > best.total ? cur : best), { slot: -1, label: "N/A", total: 0 });

  const totalEl = document.getElementById("salesSummaryTotal");
  const ordersEl = document.getElementById("salesSummaryOrders");
  const peakEl = document.getElementById("salesSummaryPeak");

  if (totalEl) totalEl.textContent = formatPesoSummary(total);
  if (ordersEl) ordersEl.textContent = String(orders);
  if (peakEl) peakEl.textContent = peak.total > 0 ? getTwoHourWindowCompactLabel(peak.slot) : "N/A";
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
  renderPendingOrdersList();
  updateConnectivityStatus();
};

window.markPendingOrderPrepared = async function(orderId) {
  if (!orderId) return;
  await removeKitchenOrder(orderId);
  renderPendingOrdersList();
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
      ? order.payload.items.slice(0, 2).map(i => i.name).join(", ") + (order.payload.items.length > 2 ? ", ..." : "")
      : "No items";
    const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
    const total = Number(order.payload?.total) || 0;
    return `
      <div class="sidebar-pending-item" onclick="openPendingOrder('${order.id}')">
        <div>
          <div class="sidebar-pending-order">#${String(order.id).replace(/^q_/, "")}</div>
          <div class="sidebar-pending-meta">${createdAt} · ${itemNames}</div>
          <div class="sidebar-pending-meta">Total: ₱${total.toFixed(2)}</div>
        </div>
        <button class="sidebar-pending-button" type="button" onclick="event.stopPropagation(); markPendingOrderPrepared('${order.id}')">Done preparing</button>
      </div>
    `;
  }).join("");
}

async function updateConnectivityStatus() {
  const indicator = document.getElementById("storageStatus");
  const pendingKitchenOrders = await getPendingOrders();
  const pendingKitchenCount = Array.isArray(pendingKitchenOrders) ? pendingKitchenOrders.length : 0;
  const pendingSyncCount = getPendingOrderCount();
  const pendingEl = document.getElementById("pendingOrdersSidebar");
  if (pendingEl) pendingEl.textContent = String(pendingKitchenCount);
  const pendingModalCountEl = document.getElementById("pendingOrdersOpenCount");
  if (pendingModalCountEl) pendingModalCountEl.textContent = String(pendingKitchenCount);

  if (!indicator) return;
  const savedCount = getStorageCount();
  const cloudLabel = isOnline ? "Online" : "Offline";
  indicator.innerHTML = `<i class="ri-wifi-line" aria-hidden="true"></i><span>Cloud: ${cloudLabel}</span><span class="storage-dot" aria-hidden="true">•</span><span>Queue: ${pendingSyncCount}</span><span class="storage-dot" aria-hidden="true">•</span><span>Local: ${savedCount}</span>`;
  indicator.setAttribute("title", `Cloud ${cloudLabel}; ${pendingSyncCount} order(s) waiting sync; ${savedCount} local record(s)`);
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
