// ── POS CONTROLLER ──
// Connects models (data) to views (UI) for the POS/cashier page

import { getMenuItems, watchMenuItems }  from "../models/menuModel.js";
import { getCategories } from "../models/categoryModel.js";
import { getCategoryIconForName } from "../models/categoryModel.js";
import { saveOrder, syncQueuedOrders, getPendingOrderCount } from "../models/orderModel.js";
import { watchAuth, getCurrentUser, logout as authLogout } from "./auth/firebaseAuth.js";
import { getUserProfile, getUserRole } from "../models/userModel.js";
import { navigateTo } from "./utils/routes.js";
import { 
  saveToStorage, 
  loadFromStorage, 
  checkDailyReset, 
  getStorageCount,
  getKitchenOrders,
  saveKitchenOrder,
  removeKitchenOrder,
  getOrderOutbox,
  removeQueuedOrder
} from "../models/storageModel.js";

// ── STATE ──
let menuItems        = [];
let globalCategories = [];
let cart             = [];
let currentCategory  = "all";
let currentPayMethod = "cash";
let isPwdSenior      = false;
let enteredAmount    = "";
let selectedVariant  = null;
let selectedTemp     = null;
let selectedAddons   = [];
let selectedQty      = 1;
let activeProductId  = null;
let salesHistory     = [];
let dailyStats       = { orders: 0, totalSales: 0, discountsApplied: 0 };
let isOnline         = navigator.onLine;
const THEME_STORAGE_KEY = "bb-pos-theme";
const CART_DENSITY_STORAGE_KEY = "bb-pos-cart-density";


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

    const role = roleResult.status === "fulfilled" ? roleResult.value : null;
    if (role && !["admin", "staff"].includes(role)) {
      navigateTo("login", { replace: true });
      return;
    }

    if (initialized) return;
    initialized = true;

    // Load from storage first
    const storageData = loadFromStorage();
    salesHistory = storageData.salesHistory;
    dailyStats = storageData.dailyStats;

    if (checkDailyReset()) {
      dailyStats = { orders: 0, totalSales: 0, discountsApplied: 0 };
      showToast("Daily stats reset for new day", "info");
      persistPosState();
    }

    menuItems = sanitizePosMenuItems(await getMenuItems());

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

  let filtered = menuItems.filter(p => (p.category || "").toLowerCase() !== "addons");
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
    const catMeta = getCategoryMeta(item.category || "Uncategorized");
    const cat = catMeta.name || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  if (!Object.keys(grouped).length) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);">No items found</div>';
    return;
  }

  let html = "";
  const sortedGroups = Object.entries(grouped)
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => getCategoryMeta(a.category).name.localeCompare(getCategoryMeta(b.category).name));

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
    return idMatch || nameNormalized === normalized || nameNormalized.includes(normalized) || normalized.includes(nameNormalized);
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
  const availableByNormalized = new Map();
  menuItems
    .map((item) => String(item?.category || "").trim())
    .filter((category) => category && category.toLowerCase() !== "addons")
    .forEach((category) => {
      const key = normalizeCategoryKey(category);
      if (!key || availableByNormalized.has(key)) return;
      availableByNormalized.set(key, category);
    });

  const ordered = [];
  for (const category of globalCategories) {
    const key = normalizeCategoryKey(getCategoryMeta(category.id || category.name).name);
    const match = availableByNormalized.get(key);
    if (!match) continue;
    ordered.push(match);
    availableByNormalized.delete(key);
  }

  const remaining = Array.from(availableByNormalized.values()).sort((a, b) =>
    String(getCategoryMeta(a).name || a).localeCompare(String(getCategoryMeta(b).name || b))
  );
  return ordered.concat(remaining);
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
  return items;
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
    normalizeCategoryKey(i.category) === "addons" || normalizeCategoryKey(i.category) === "add-ons" || normalizeCategoryKey(i.category) === "add-ons drink"
  );
  const foodAddons = menuItems.filter(i =>
    normalizeCategoryKey(i.category) === "addons" || normalizeCategoryKey(i.category) === "add-ons" || normalizeCategoryKey(i.category) === "add-ons food"
  );
  const productCategory = normalizeCategoryKey(product.category);
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
  const clearOrderBtn = document.getElementById("clearOrderBtn");

  if (!cart.length) {
    cartEl.innerHTML = `<div class="empty-cart"><div class="empty-cart-icon"><i class="ri-shopping-cart-line" aria-hidden="true"></i></div><p>Your order is empty</p><p style="font-size:13px;margin-top:5px;">Click items from the menu to add</p></div>`;
    subtotalEl.textContent = "₱0.00";
    totalEl.textContent    = "₱0.00";
    checkoutBtn.disabled   = true;
    if (clearOrderBtn) clearOrderBtn.disabled = true;
    return;
  }

const subtotal = cart.reduce((s, item) => {
    const addonTotal = (item.addons || []).reduce((a, x) => a + x.price, 0);
    const discountedUnitPrice = (item.price + addonTotal) * (1 - (item.discountPercent || 0));
    return s + discountedUnitPrice * item.quantity;
  }, 0);

  const total = isPwdSenior ? subtotal * 0.8 : subtotal;

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
        ${item.discountPercent > 0 ? `<div class="cart-item-discount">-20% OFF</div>` : ''}
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
  cart[idx].discountPercent = cart[idx].discountPercent > 0 ? 0 : 0.20;
  showToast(`Item discount ${cart[idx].discountPercent ? 'enabled' : 'disabled'} (20%)`, 'success');
  updateCart();
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

window.toggleDiscount = function() {
  isPwdSenior = !isPwdSenior;
  document.getElementById("pwdSeniorCheck").checked = isPwdSenior;
  document.getElementById("discountToggle").classList.toggle("active", isPwdSenior);
  document.querySelector(".discount-section")?.classList.toggle("is-active", isPwdSenior);
  updateCart();
};

window.searchProducts = function() {
  renderProducts(currentCategory);
};

// ── PAYMENT ──
window.openPaymentModal = function() {
  const total = parseFloat(document.getElementById("total").textContent.replace("₱","").replace(",",""));
  document.getElementById("paymentAmount").textContent = `₱${total.toFixed(2)}`;
  document.getElementById("paymentModal").classList.add("active");
  enteredAmount = "";
  updateChangeDisplay();
  updateDoneButton();
};

window.closePaymentModal = function() {
  document.getElementById("paymentModal").classList.remove("active");
  enteredAmount = "";
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
  numpad.style.display     = method === "cash" ? "grid"  : "none";
  changeDisp.style.display = method === "cash" ? "block" : "none";
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

function updateDoneButton() {
  const doneBtn = document.getElementById("doneBtn");
  const total   = parseFloat(document.getElementById("total").textContent.replace("₱","").replace(",",""));
  doneBtn.disabled = currentPayMethod === "cash" ? (parseFloat(enteredAmount) || 0) < total : false;
}

function updateChangeDisplay() {
  const total   = parseFloat(document.getElementById("total").textContent.replace("₱","").replace(",",""));
  const entered = parseFloat(enteredAmount) || 0;
  const change  = entered - total;
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
  const total    = parseFloat(document.getElementById("total").textContent.replace("₱","").replace(",",""));
  const subtotal = cart.reduce((s, item) => {
    const addonTotal = (item.addons || []).reduce((a, x) => a + x.price, 0);
    return s + (item.price + addonTotal) * item.quantity;
  }, 0);
  const amountTendered = currentPayMethod === "cash" ? (parseFloat(enteredAmount) || total) : total;

  // Save to Firebase via model
  const user = getCurrentUser();
  const sale = await saveOrder(cart, total, subtotal, currentPayMethod, isPwdSenior, amountTendered, user?.uid || null);

  // Add to kitchen pending queue so the order appears in the sidebar
  saveKitchenOrder(sale);

  // Update local stats
  dailyStats.orders++;
  dailyStats.totalSales += total;
  if (isPwdSenior) dailyStats.discountsApplied++;
  salesHistory.push(sale);
  saveToStorage(salesHistory, dailyStats);

  // Generate receipt
  generateReceipt({ ...sale, items: cart, amountTendered, change: amountTendered - total });

  // Reset state
  cart        = [];
  isPwdSenior = false;
  enteredAmount = "";
  document.getElementById("pwdSeniorCheck").checked = false;
  document.getElementById("discountToggle").classList.remove("active");
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
};

function generateReceipt(sale) {
  const formatMoney = (n) => `₱${(Number(n) || 0).toFixed(2)}`;
  const orderShort = sale.orderId ? String(sale.orderId).slice(-6) : "—";
  const titleEl = document.getElementById("receiptTitle");
  if (titleEl) {
    titleEl.textContent = sale.queued ? "Pending order" : "Receipt";
  }

  const receiptHTML = `
    <div class="receipt">
      <div class="receipt-brand">
        <div class="receipt-mark"><i class="ri-cup-line" aria-hidden="true"></i></div>
        <div class="receipt-brand-text">
          <div class="receipt-title">Brother Bean Cafe</div>
          <div class="receipt-subtitle">Warmth in Every Cup</div>
        </div>
      </div>

      <div class="receipt-meta">
        <div class="receipt-meta-row"><span>Date</span><span>${sale.timestamp || "—"}</span></div>
        <div class="receipt-meta-row"><span>Order</span><span>#${orderShort}</span></div>
        <div class="receipt-meta-row"><span>Payment</span><span>${(sale.paymentMethod || "—").toUpperCase()}</span></div>
        <div class="receipt-meta-row"><span>Cashier</span><span>Staff</span></div>
        ${sale.isPwdSenior ? `<div class="receipt-badge"><i class="ri-wheelchair-line" aria-hidden="true"></i> PWD / Senior (20% OFF)</div>` : ""}
      </div>

      <div class="receipt-divider"></div>

      <div class="receipt-items">
        ${(sale.items || []).map(item => {
          const basePrice = Number(item.price) || 0;
          const addons = (item.addons || []).map(a => ({ name: a.name, price: Number(a.price) || 0 }));
          const addonsTotal = addons.reduce((s, a) => s + a.price, 0);
          const unitPrice = basePrice + addonsTotal;
          const qty = Number(item.quantity) || 1;
          const lineTotal = unitPrice * qty;

          const meta = [
            item.variant ? String(item.variant) : null,
            item.temperature && item.temperature !== "N/A" ? String(item.temperature) : null,
          ].filter(Boolean);

          return `
            <div class="receipt-item">
              <div class="receipt-item-main">
                <div class="receipt-item-name">${item.name}</div>
                ${(meta.length || addons.length) ? `
                  <div class="receipt-item-details">
                    ${meta.map(m => `<span>${m}</span>`).join("")}
                    <span>Retail: ${formatMoney(basePrice)}</span>
                    ${addons.map(a => `<span>+ ${a.name}: ${formatMoney(a.price)}</span>`).join("")}
                    ${qty > 1 ? `<span>Unit: ${formatMoney(unitPrice)} × ${qty}</span>` : `<span>Unit: ${formatMoney(unitPrice)}</span>`}
                  </div>
                ` : `
                  <div class="receipt-item-details">
                    <span>Retail: ${formatMoney(basePrice)}</span>
                    <span>Unit: ${formatMoney(unitPrice)}</span>
                  </div>
                `}
              </div>
              <div class="receipt-item-right">
                <div class="receipt-item-qty">×${qty}</div>
                <div class="receipt-item-total">${formatMoney(lineTotal)}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="receipt-divider"></div>

      <div class="receipt-totals">
        <div class="receipt-row"><span>Subtotal</span><span>${formatMoney(sale.subtotal)}</span></div>
        ${sale.isPwdSenior ? `<div class="receipt-row discount"><span>Discount</span><span>− ${formatMoney(sale.discountAmount)}</span></div>` : ""}
        <div class="receipt-row total"><span>Total</span><span>${formatMoney(sale.total)}</span></div>
        <div class="receipt-row"><span>Tendered</span><span>${formatMoney(sale.amountTendered)}</span></div>
        <div class="receipt-row"><span>Change</span><span>${formatMoney(sale.change)}</span></div>
      </div>

      <div class="receipt-footer">
        <div class="receipt-thanks">Thank you for visiting Brother Bean Cafe!</div>
        <div class="receipt-small">Please come again</div>
        <div class="receipt-small" style="margin-top:10px;">VAT Registered TIN: 000-000-000-000</div>
        <div class="receipt-small">Permit No: 0000000</div>
      </div>
    </div>
  `;
  document.getElementById("receiptContent").innerHTML = receiptHTML;
}

window.closeReceipt = function() {
  document.getElementById("receiptModal").classList.remove("active");
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
    queued: true,
  };

  generateReceipt(sale);
  document.getElementById("receiptModal").classList.add("active");
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

      .receipt {
        max-width: 76mm;
        margin: 0 auto;
        padding: 0;
        border: none;
        box-shadow: none;
        background: transparent;
      }

      .receipt-brand { display:flex; align-items:center; gap:8px; justify-content:center; margin-bottom: 10px; }
      .receipt-mark { display:none; } /* keep it ink-friendly */
      .receipt-title { font-size: 14px; font-weight: 800; text-align:center; }
      .receipt-subtitle { font-size: 10px; text-align:center; color:#444; margin-top: 2px; }

      .receipt-meta {
        border: none;
        background: transparent;
        padding: 0;
        display: grid;
        gap: 4px;
        margin-top: 8px;
      }
      .receipt-meta-row { display:flex; justify-content:space-between; gap:10px; font-weight: 700; font-size: 10.5px; }
      .receipt-meta-row span:first-child { color:#444; font-weight: 700; }
      .receipt-badge {
        margin-top: 6px;
        padding: 4px 0;
        border-top: 1px dashed #bbb;
        border-bottom: 1px dashed #bbb;
        color:#111;
        font-weight: 800;
      }

      .receipt-divider { height: 0; border-top: 1px dashed #bbb; margin: 10px 0; }

      .receipt-items { display:grid; gap: 8px; }
      .receipt-item {
        display:grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        padding: 0;
        border: none;
        background: transparent;
      }
      .receipt-item-name { font-weight: 800; font-size: 11px; }
      .receipt-item-details { margin-top: 4px; display:grid; gap: 2px; color:#333; font-weight: 600; font-size: 10px; }
      .receipt-item-right { text-align:right; display:grid; gap: 2px; align-content:start; min-width: 18mm; }
      .receipt-item-qty { color:#333; font-weight: 700; font-size: 10px; }
      .receipt-item-total { font-weight: 900; font-size: 11px; }

      .receipt-totals {
        border: none;
        background: transparent;
        padding: 0;
        display: grid;
        gap: 5px;
      }
      .receipt-row { display:flex; justify-content:space-between; gap: 10px; font-size: 10.5px; font-weight: 800; }
      .receipt-row span:first-child { color:#444; font-weight: 700; }
      .receipt-row.total {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 2px solid #111;
        font-size: 12px;
      }

      .receipt-footer { margin-top: 10px; text-align:center; color:#333; }
      .receipt-thanks { font-weight: 900; font-size: 11px; }
      .receipt-small { font-weight: 600; font-size: 10px; margin-top: 2px; }

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

  if (cashEl) cashEl.textContent = `₱${dailyStats.totalSales.toFixed(2)}`;
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
  try {
    await authLogout();
  } finally {
    closeLogoutModal();
  }
};

function setThemeButton(theme) {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  btn.innerHTML = theme === "dark"
    ? '<i class="ri-sun-line" aria-hidden="true"></i> Light'
    : '<i class="ri-moon-line" aria-hidden="true"></i> Dark';
}

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", normalized);
  setThemeButton(normalized);
  localStorage.setItem(THEME_STORAGE_KEY, normalized);
}

function applySavedTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(saved === "dark" ? "dark" : "light");
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
  const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
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

  barsEl.innerHTML = slots
    .map((s) => {
      const h = Math.max(8, Math.round((s.total / maxTotal) * 100));
      const idleClass = s.orders === 0 ? " is-idle" : "";
      return `<div class="sales-chart-bar${idleClass}" style="height:${h}%" title="${s.label}: ₱${s.total.toFixed(2)} (${s.orders} orders)"></div>`;
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

function getPendingOrders() {
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

window.markPendingOrderPrepared = function(orderId) {
  if (!orderId) return;
  removeKitchenOrder(orderId);
  renderPendingOrdersList();
  updateConnectivityStatus();
  showToast("Order marked as prepared and removed from pending list", "success");
};

function renderPendingOrdersList() {
  const pending = getPendingOrders();
  const listEl = document.getElementById("pendingOrdersModalList");
  const modalCountEl = document.getElementById("pendingOrdersModalCount");
  if (!listEl) return;
  if (modalCountEl) modalCountEl.textContent = String(Array.isArray(pending) ? pending.length : 0);

  if (!pending.length) {
    listEl.innerHTML = `
      <div class="sidebar-pending-empty bb-pending-empty-state">
        <i class="ri-checkbox-circle-line" aria-hidden="true"></i>
        <div>No pending orders</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = pending.map((order) => {
    const items = Array.isArray(order.payload?.items) ? order.payload.items : [];
    const itemCount = items.reduce((sum, item) => sum + (Number(item?.quantity) || 1), 0);
    const itemNames = items.length
      ? items.slice(0, 2).map((i) => String(i?.name || "").trim()).join(", ") + (items.length > 2 ? ", ..." : "")
      : "No items";
    const total = Number(order.payload?.total || 0);
    const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
    const orderLabel = String(order.id).replace(/^q_/, "");
    return `
      <div class="sidebar-pending-item bb-pending-card" onclick="openPendingOrder('${order.id}')" role="button" tabindex="0" aria-label="Open pending order ${escapeHtml(orderLabel)}">
        <div class="bb-pending-main">
          <div class="sidebar-pending-order">#${escapeHtml(orderLabel)}</div>
          <div class="sidebar-pending-meta bb-pending-meta-row">
            <span>${escapeHtml(createdAt)}</span>
            <span aria-hidden="true">•</span>
            <span>${itemCount} item${itemCount === 1 ? "" : "s"}</span>
          </div>
          <div class="bb-pending-items-preview" title="${escapeHtml(itemNames)}">${escapeHtml(itemNames)}</div>
        </div>
        <div class="bb-pending-side">
          <div class="bb-pending-total">₱${total.toFixed(2)}</div>
          <button class="sidebar-pending-button" type="button" onclick="event.stopPropagation(); markPendingOrderPrepared('${order.id}')">Done preparing</button>
        </div>
      </div>
    `;
  }).join("");
}

function updateConnectivityStatus() {
  const indicator = document.getElementById("storageStatus");
  const pendingKitchenOrders = getPendingOrders();
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
  renderPendingOrdersList();
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
