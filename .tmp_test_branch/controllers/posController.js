// ── POS CONTROLLER ──
// Connects models (data) to views (UI) for the POS/cashier page

import { getMenuItems }  from "../models/menuModel.js";
import { saveOrder, syncQueuedOrders, getPendingOrderCount } from "../models/orderModel.js";
import { watchAuth, getCurrentUser, logout as authLogout } from "./auth/firebaseAuth.js";
import { getUserProfile, getUserRole } from "../models/userModel.js";
import { navigateTo } from "./utils/routes.js";
import { 
  saveToStorage, 
  loadFromStorage, 
  checkDailyReset, 
  getStorageCount 
} from "../models/storageModel.js";

// ── STATE ──
let menuItems        = [];
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

// #region agent log
const __bbDebugLog = (hypothesisId, location, message, data) => {
  try { console.log("[BB_DEBUG]", { runId: "pre-fix", hypothesisId, location, message, data }); } catch {}
  fetch('http://127.0.0.1:7280/ingest/428e4471-6b9b-4d77-83c3-f16307fb5c61',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a577ca'},body:JSON.stringify({sessionId:'a577ca',runId:'pre-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
};
// #endregion

// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  let initialized = false;

  const persistPosState = () => saveToStorage(salesHistory, dailyStats, menuItems);

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
    __bbDebugLog("C","controllers/posController.js:watchAuth","auth_state",{hasUser: !!user});
    if (!user) {
      __bbDebugLog("C","controllers/posController.js:watchAuth","redirect_to_login_no_user",{});
      navigateTo("login", { replace: true });
      return;
    }

    const profile = await getUserProfile(user.uid);
    if (String(profile?.status || "active").toLowerCase() === "suspended") {
      await authLogout();
      alert("Your account is suspended. Please contact an administrator.");
      navigateTo("login", { replace: true });
      return;
    }

    const role = await getUserRole(user.uid);
    __bbDebugLog("C","controllers/posController.js:watchAuth","role_loaded",{role: role || null});
    if (role && !["admin", "staff"].includes(role)) {
      __bbDebugLog("C","controllers/posController.js:watchAuth","redirect_to_login_bad_role",{});
      navigateTo("login", { replace: true });
      return;
    }

    if (initialized) return;
    initialized = true;
    __bbDebugLog("C","controllers/posController.js:watchAuth","pos_init_start",{});

    // Load from storage first
    const storageData = loadFromStorage();
    salesHistory = storageData.salesHistory;
    dailyStats = storageData.dailyStats;

    if (checkDailyReset()) {
      dailyStats = { orders: 0, totalSales: 0, discountsApplied: 0 };
      showToast("Daily stats reset for new day", "info");
      persistPosState();
    }

    menuItems = Array.isArray(storageData.menuItems) && storageData.menuItems.length > 0
      ? storageData.menuItems
      : await getMenuItems();
    persistPosState();
    __bbDebugLog("C","controllers/posController.js:watchAuth","menu_loaded",{count: Array.isArray(menuItems) ? menuItems.length : null, fromStorage: Array.isArray(storageData.menuItems) && storageData.menuItems.length > 0});
    renderCategoryControls();
    renderProducts();
    updateCart();
    applySavedTheme();
    applySavedCartDensity();
    updateStats();

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
      }
    });

    window.addEventListener("online", async () => {
      isOnline = true;
      const result = await syncQueuedOrders();
      updateConnectivityStatus();
      if (result.synced > 0) {
        showToast(`Synced ${result.synced} pending order(s)`, "success");
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

  let filtered = menuItems.filter(p => p.category !== "addons");
  if (filter !== "all") filtered = filtered.filter(p => p.category === filter);
  if (searchTerm) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchTerm) ||
      p.subcategory.toLowerCase().includes(searchTerm)
    );
  }

  const grouped = filtered.reduce((acc, item) => {
    if (!acc[item.subcategory]) acc[item.subcategory] = [];
    acc[item.subcategory].push(item);
    return acc;
  }, {});

  let html = "";
  for (const [subcategory, items] of Object.entries(grouped)) {
    html += `<div style="grid-column:1/-1;font-weight:700;color:var(--primary);margin-top:10px;margin-bottom:5px;font-size:14px;text-transform:uppercase;letter-spacing:1px;">${subcategory}</div>`;
    html += items.map(p => buildProductCard(p)).join("");
  }

  grid.innerHTML = html || '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--gray);">No items found</div>';
}

function getMenuCategories() {
  const discovered = Array.from(new Set(
    (menuItems || [])
      .map(item => String(item?.category || "").trim().toLowerCase())
      .filter(cat => cat && cat !== "addons")
  ));
  return discovered.sort((a, b) => a.localeCompare(b));
}

function toTitleCase(text) {
  return String(text)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, m => m.toUpperCase());
}

function getCategoryIconUrl(cat) {
  const key = String(cat || "").trim().toLowerCase();
  const iconBase = "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg";
  const iconMap = {
    all: `${iconBase}/1F4DD.svg`,
    coffee: `${iconBase}/2615.svg`,
    signature: `${iconBase}/2B50.svg`,
    matcha: `${iconBase}/1F343.svg`,
    noncoffee: `${iconBase}/1F9CB.svg`,
    "non-coffee": `${iconBase}/1F9CB.svg`,
    starters: `${iconBase}/1F35F.svg`,
    ricemeals: `${iconBase}/1F35A.svg`,
    "rice-meals": `${iconBase}/1F35A.svg`,
    pasta: `${iconBase}/1F35D.svg`,
    addons: `${iconBase}/2795.svg`,
    "add-ons": `${iconBase}/2795.svg`,
  };
  return iconMap[key] || `${iconBase}/1F37D.svg`;
}

function getCategoryDisplay(cat) {
  const key = String(cat || "").trim().toLowerCase();
  const baseLabel = key === "all" ? "All Items" : toTitleCase(cat);
  return `<img class="category-chip-icon" src="${getCategoryIconUrl(key)}" alt="" aria-hidden="true" loading="lazy" decoding="async">${baseLabel}`;
}

function getCategoryOptionLabel(cat) {
  const key = String(cat || "").trim().toLowerCase();
  return key === "all" ? "All Items" : toTitleCase(cat);
}

function syncCategorySelectionUi(cat) {
  document.querySelectorAll("#categories .category-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.category === cat);
  });

  const quickSelect = document.getElementById("categoryQuickSelect");
  if (quickSelect) quickSelect.value = cat;
}

function renderCategoryControls() {
  const categoriesHost = document.getElementById("categories");
  const quickSelect = document.getElementById("categoryQuickSelect");
  if (!categoriesHost || !quickSelect) return;

  const categories = getMenuCategories();
  const available = ["all", ...categories];
  if (!available.includes(currentCategory)) currentCategory = "all";

  categoriesHost.innerHTML = ["all", ...categories]
    .map(cat => `<button type="button" class="category-chip ${cat === currentCategory ? "active" : ""}" data-category="${cat}" onclick="selectCategory('${cat}', this)">${getCategoryDisplay(cat)}</button>`)
    .join("");

  quickSelect.innerHTML = ["all", ...categories]
    .map(cat => `<option value="${cat}">${getCategoryOptionLabel(cat)}</option>`)
    .join("");

  quickSelect.value = currentCategory;
}

window.scrollCategories = function(direction = 1) {
  const host = document.getElementById("categories");
  if (!host) return;
  host.scrollBy({ left: direction * 220, behavior: "smooth" });
};
function buildProductCard(product) {
  const badge = product.bestseller ? "BEST" : product.popular ? "POP" : "";
  return `<div class="product-card" onclick="openMenuItemModal(${product.id})">
    <div class="product-header">
      <div class="product-name">${product.name}${product.note ? `<span style="font-size:10px;color:var(--gray);display:block;">${product.note}</span>` : ""}</div>
      ${badge ? `<span class="product-badge">${badge}</span>` : ""}
    </div>
    <div class="product-price">₱${product.price.toFixed(2)}</div>
    <div class="product-category">${product.subcategory}</div>
  </div>`;
}

// ── MENU ITEM MODAL ──
window.openMenuItemModal = function(productId) {
  const product = menuItems.find(p => p.id === productId);
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
  const drinkAddons = menuItems.filter(i => i.subcategory === "Add-ons Drink");
  const foodAddons = menuItems.filter(i => i.subcategory === "Add-ons Food");
  const drinkCats = ["coffee", "signature", "matcha", "noncoffee"];

  if (drinkCats.includes(product.category)) {
    return { label: "Add-ons", addons: drinkAddons };
  }

  if (["starters", "ricemeals", "pasta"].includes(product.category)) {
    const riceAddons = foodAddons.filter(a => ["Rice", "Egg"].includes(a.name));
    return { label: "Add-ons", addons: riceAddons };
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
        <button class="bb-pill ${selectedTemp === "Hot" ? "is-selected" : ""}" type="button" onclick="selectMenuTemp('Hot')"><i class="ri-fire-line" aria-hidden="true"></i> Hot</button>
        <button class="bb-pill ${selectedTemp === "Iced" ? "is-selected" : ""}" type="button" onclick="selectMenuTemp('Iced')"><i class="ri-snowy-line" aria-hidden="true"></i> Iced</button>
      </div>
    </div>
  ` : "";

  const addonsBlock = addons.length ? `
    <div class="bb-field">
      <div class="bb-field-label">Add-ons <span class="bb-field-hint">(optional)</span></div>
      <div class="bb-addon-grid">
        ${addons.map(a => `
          <button class="bb-addon ${selectedAddons.some(x => x.id === a.id) ? "is-selected" : ""}" type="button"
            onclick="toggleMenuAddon(${a.id})">
            <span class="bb-addon-name">${a.name}</span>
            <span class="bb-addon-price">+₱${Number(a.price).toFixed(2)}</span>
          </button>
        `).join("")}
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
          <div class="bb-mini-note">${product.subcategory || ""}</div>
        </div>

        <div class="bb-recap">
          <div class="bb-recap-row"><span>Base</span><span>₱${(selectedVariant ? selectedVariant.price : product.price).toFixed(2)}</span></div>
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
  const addon = menuItems.find(i => i.id === addonId);
  if (!addon) return;
  const idx = selectedAddons.findIndex(a => a.id === addonId);
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
    cart.push({ id: product.id, name: product.name, price, variant, temperature: temp, addons, quantity: qtyToAdd, discountPercent: 0 });
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

window.selectCategory = function(cat, chipEl = null) {
  currentCategory = cat;
  syncCategorySelectionUi(cat);
  if (chipEl) {
    document.querySelectorAll("#categories .category-chip").forEach(c => c.classList.remove("active"));
    chipEl.classList.add("active");
  }
  renderProducts(cat);
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

  // Update local stats
  dailyStats.orders++;
  dailyStats.totalSales += total;
  if (isPwdSenior) dailyStats.discountsApplied++;
  salesHistory.push(sale);
  saveToStorage(salesHistory, dailyStats, menuItems);

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
};

// ── RECEIPT ──
function generateReceipt(sale) {
  const formatMoney = (n) => `₱${(Number(n) || 0).toFixed(2)}`;
  const orderShort = sale.orderId ? String(sale.orderId).slice(-6) : "—";

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
                    <span>Base: ${formatMoney(basePrice)}</span>
                    ${addons.map(a => `<span>+ ${a.name}: ${formatMoney(a.price)}</span>`).join("")}
                    ${qty > 1 ? `<span>Unit: ${formatMoney(unitPrice)} × ${qty}</span>` : `<span>Unit: ${formatMoney(unitPrice)}</span>`}
                  </div>
                ` : `
                  <div class="receipt-item-details">
                    <span>Base: ${formatMoney(basePrice)}</span>
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

function updateConnectivityStatus() {
  const indicator = document.getElementById("storageStatus");
  const pending = getPendingOrderCount();
  const pendingEl = document.getElementById("pendingOrdersSidebar");
  if (pendingEl) pendingEl.textContent = String(pending);

  if (!indicator) return;
  const savedCount = getStorageCount();
  const netLabel = isOnline ? "Online" : "Offline";
  const queueLabel = pending > 0 ? ` | ${pending} pending sync order(s)` : "";
  const localLabel = savedCount > 0 ? ` | ${savedCount} local` : "";
  indicator.textContent = `${netLabel}${queueLabel}${localLabel}`;
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
