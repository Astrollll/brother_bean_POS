// ─── Menu Data ───────────────────────────────────────────
const DEFAULT_MENU_ITEMS = [
  // Coffee
  { id: 1,  name: "Americano",              price: 90,  category: "coffee",    subcategory: "Coffee",       hasVariant: true,  variants: [{ name: "Plain", price: 90 }, { name: "Chocolate", price: 120 }, { name: "Caramel", price: 120 }] },
  { id: 2,  name: "Cafe Latte",             price: 120, category: "coffee",    subcategory: "Coffee",       hasTemp: true },
  { id: 3,  name: "Brown Sugar Latte",      price: 130, category: "coffee",    subcategory: "Coffee",       hasTemp: true },
  { id: 4,  name: "Vanilla Latte",          price: 140, category: "coffee",    subcategory: "Coffee",       hasTemp: true },
  { id: 5,  name: "Spanish Latte",          price: 140, category: "coffee",    subcategory: "Coffee",       hasTemp: true, popular: true },
  { id: 6,  name: "Caramel Latte",          price: 140, category: "coffee",    subcategory: "Coffee",       hasTemp: true, popular: true },
  { id: 7,  name: "Cafe Mocha",             price: 140, category: "coffee",    subcategory: "Coffee",       hasTemp: true },
  { id: 8,  name: "White Choco Mocha",      price: 150, category: "coffee",    subcategory: "Coffee",       hasTemp: true },
  { id: 9,  name: "Mocha Caramel",          price: 150, category: "coffee",    subcategory: "Coffee",       hasTemp: true },

  // Signature
  { id: 10, name: "Creamy Coconut Latte",   price: 170, category: "signature", subcategory: "Signature",    hasTemp: true, bestseller: true },
  { id: 11, name: "Honey Oat Espresso",     price: 175, category: "signature", subcategory: "Signature",    hasTemp: true, bestseller: true },
  { id: 12, name: "Ube Coconut Brew",       price: 180, category: "signature", subcategory: "Signature",    hasTemp: true, bestseller: true },

  // Matcha Series
  { id: 13, name: "Matcha Latte",           price: 180, category: "matcha",    subcategory: "Matcha Series", hasTemp: true, popular: true },
  { id: 14, name: "Strawberry Matcha",      price: 220, category: "matcha",    subcategory: "Matcha Series", hasTemp: true },
  { id: 15, name: "Salted Cream Matcha",    price: 195, category: "matcha",    subcategory: "Matcha Series", hasTemp: true },
  { id: 16, name: "Coconut Matcha",         price: 210, category: "matcha",    subcategory: "Matcha Series", hasTemp: true },
  { id: 17, name: "Dirty Matcha",           price: 220, category: "matcha",    subcategory: "Matcha Series", hasTemp: true, note: "Coffee-based" },

  // Non-Coffee
  { id: 18, name: "Tsoko Latte",            price: 130, category: "noncoffee", subcategory: "Non-Coffee",   hasTemp: true },
  { id: 19, name: "Strawberry Milkshake",   price: 150, category: "noncoffee", subcategory: "Non-Coffee",   hasTemp: false },
  { id: 20, name: "Ube Milkshake",          price: 140, category: "noncoffee", subcategory: "Non-Coffee",   hasTemp: false },
  { id: 21, name: "Calamansi Cooler",       price: 90,  category: "noncoffee", subcategory: "Non-Coffee",   hasTemp: true },

  // Starters
  { id: 22, name: "French Fries",                price: 90,  category: "starters", subcategory: "Starters", hasTemp: false },
  { id: 23, name: "Hotdog Sandwich w/ Nachos",   price: 110, category: "starters", subcategory: "Starters", hasTemp: false },
  { id: 24, name: "Burger w/ Nachos",            price: 140, category: "starters", subcategory: "Starters", hasTemp: false },
  { id: 25, name: "Nachos w/ Dip",               price: 130, category: "starters", subcategory: "Starters", hasTemp: false, note: "Salsa/Cheese" },

  // Rice Meals
  { id: 26, name: "Fried Chicken - Plain",        price: 180, category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 27, name: "Fried Chicken - Salted Egg",   price: 210, category: "ricemeals", subcategory: "Rice Meals", hasTemp: false, popular: true },
  { id: 28, name: "Fried Chicken - Yangnyeom",    price: 220, category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 29, name: "Black Pepper Beef",            price: 195, category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 30, name: "Burger Steak",                 price: 150, category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 31, name: "Corned Beef",                  price: 115, category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 32, name: "Longganisa (Sweet)",           price: 99,  category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 33, name: "Tocino",                       price: 99,  category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 34, name: "Lumpiang Shanghai",            price: 95,  category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },
  { id: 35, name: "Hotdog",                       price: 95,  category: "ricemeals", subcategory: "Rice Meals", hasTemp: false },

  // Pasta
  { id: 36, name: "Meatball Marinara", price: 195, category: "pasta", subcategory: "Pasta", hasTemp: false },
  { id: 37, name: "Creamy Chicken",    price: 220, category: "pasta", subcategory: "Pasta", hasTemp: false, popular: true },

  // Add-ons (Drink)
  { id: 38, name: "Espresso Shot",            price: 40, category: "addons", subcategory: "Add-ons Drink", hasTemp: false },
  { id: 39, name: "Oat Milk",                 price: 50, category: "addons", subcategory: "Add-ons Drink", hasTemp: false },
  { id: 40, name: "Coconut Milk",             price: 60, category: "addons", subcategory: "Add-ons Drink", hasTemp: false },
  { id: 41, name: "Syrup",                    price: 30, category: "addons", subcategory: "Add-ons Drink", hasTemp: false },
  { id: 42, name: "Salted Cream",             price: 45, category: "addons", subcategory: "Add-ons Drink", hasTemp: false },

  // Add-ons (Food)
  { id: 43, name: "Rice",                         price: 20, category: "addons", subcategory: "Add-ons Food", hasTemp: false },
  { id: 44, name: "Egg",                          price: 20, category: "addons", subcategory: "Add-ons Food", hasTemp: false },
  { id: 45, name: "Nacho Dip - Tomato Salsa",     price: 45, category: "addons", subcategory: "Add-ons Food", hasTemp: false },
  { id: 46, name: "Nacho Dip - Cheesy Jalapeño",  price: 40, category: "addons", subcategory: "Add-ons Food", hasTemp: false },

  // Pastries
  { id: 47, name: "Brownies",            price: 70,  category: "Pastries", subcategory: "Pastries", hasTemp: false },
  { id: 48, name: "Dubai Chewy Cookies", price: 100, category: "Pastries", subcategory: "Pastries", hasVariant: true, variants: [{ name: "1pc", price: 100 }, { name: "2pc", price: 190 }, { name: "4pc", price: 375 }] },
  { id: 49, name: "Cake",               price: 180, category: "Pastries", subcategory: "Pastries", hasVariant: true, variants: [{ name: "Slice", price: 180 }, { name: "Whole", price: 1500 }] },
];

let menuItems       = [...DEFAULT_MENU_ITEMS];
let extraCategories = [];

// ─── State ───────────────────────────────────────────────────
let cart                = [];
let currentCategory     = "all";
let currentPaymentMethod = "cash";

let enteredAmount       = "";
let salesHistory        = [];
let dailyStats          = { orders: 0, totalSales: 0, discountsApplied: 0 };
let pendingItem         = null;
let selectedVariant     = null;
let selectedTemp        = null;
let adminCurrentSection = "overview";
let pendingOrders       = []; // orders waiting to be served

// ─── LocalStorage Keys ───────────────────────────────────────
const STORAGE_KEYS = {
  salesHistory:  "brotherBean_salesHistory",
  dailyStats:    "brotherBean_dailyStats",
  lastResetDate: "brotherBean_lastResetDate",
  menuConfig:    "brotherBean_menuConfig",
  menuCategories:"brotherBean_menuCategories",
};

// ─── Init ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadFromStorage();
  checkDailyReset();
  renderProducts();
  updateCart();
  updateStats();
  updateStorageIndicator();
  renderPendingOrders();
  
  // Close modals when clicking outside
  document.getElementById('menuModal').addEventListener('click', (e) => {
    if (e.target.id === 'menuModal') closeMenuModal();
  });
  document.getElementById('drawerModal').addEventListener('click', (e) => {
    if (e.target.id === 'drawerModal') closeDrawerModal();
  });
  document.getElementById('salesReportModal').addEventListener('click', (e) => {
    if (e.target.id === 'salesReportModal') closeSalesReport();
  });
  document.getElementById('adminDashboardModal').addEventListener('click', (e) => {
    if (e.target.id === 'adminDashboardModal') closeAdminDashboard();
  });
});

// ─── Daily Reset ─────────────────────────────────────────────
function checkDailyReset() {
  const lastReset = localStorage.getItem(STORAGE_KEYS.lastResetDate);
  const today     = new Date().toDateString();
  if (lastReset !== today) {
    dailyStats = { orders: 0, totalSales: 0, discountsApplied: 0 };
    localStorage.setItem(STORAGE_KEYS.lastResetDate, today);
    saveToStorage();
    showToast("New day! Daily stats reset.", "warning");
  }
}

// ─── Storage ─────────────────────────────────────────────────
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.salesHistory, JSON.stringify(salesHistory));
    localStorage.setItem(STORAGE_KEYS.dailyStats,   JSON.stringify(dailyStats));
    localStorage.setItem(STORAGE_KEYS.menuConfig,   JSON.stringify(menuItems));
    localStorage.setItem(STORAGE_KEYS.menuCategories, JSON.stringify(extraCategories));
    updateStorageIndicator();
  } catch (e) {
    console.error("Storage error:", e);
    showToast("Warning: Storage full! Export data soon.", "error");
  }
}

function loadFromStorage() {
  try {
    const savedHistory = localStorage.getItem(STORAGE_KEYS.salesHistory);
    const savedStats   = localStorage.getItem(STORAGE_KEYS.dailyStats);
    const savedMenu    = localStorage.getItem(STORAGE_KEYS.menuConfig);
    const savedCats    = localStorage.getItem(STORAGE_KEYS.menuCategories);
    if (savedHistory) salesHistory = JSON.parse(savedHistory);
    if (savedStats)   dailyStats   = JSON.parse(savedStats);
    if (savedMenu)    menuItems    = JSON.parse(savedMenu);
    if (savedCats)    extraCategories = JSON.parse(savedCats);
  } catch (e) {
    console.error("Load error:", e);
    showToast("Error loading saved data", "error");
  }
}

function updateStorageIndicator() {
  const indicator = document.getElementById("storageStatus");
  indicator.textContent = salesHistory.length > 0
    ? `💾 ${salesHistory.length} orders saved`
    : "💾 Ready";
}

// ─── Render Products ─────────────────────────────────────────
function renderProducts(filter = "all") {
  const grid       = document.getElementById("productsGrid");
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();

  let filtered = filter === "all" ? menuItems : menuItems.filter(p => p.category === filter);

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
    html += `
      <div class="category-group">
        <div class="category-label">${subcategory}</div>
        <div class="category-cards">
          ${items.map(product => `
            <div class="product-card" onclick="handleProductClick(${product.id})">
              <div class="product-header">
                <div class="product-name">
                  ${product.name}
                  ${product.bestseller ? '<span class="product-badge">★ SIGNATURE</span>' : ""}
                  ${product.popular    ? '<span class="product-badge" style="background:var(--secondary);">♥ BEST</span>' : ""}
                </div>
              </div>
              <div class="product-price">₱${product.price.toFixed(2)}</div>
              ${product.note       ? `<div class="product-category">${product.note}</div>` : ""}
              ${product.hasTemp    ? '<div class="product-category" style="color:var(--primary);">☕ Hot / Iced</div>' : ""}
              ${product.hasVariant ? '<div class="product-category" style="color:var(--secondary);">⚡ Options Available</div>' : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  grid.innerHTML = html || '<div style="text-align:center;padding:40px;color:var(--gray);">No items found</div>';
}

// ─── Product Click ───────────────────────────────────────────
function handleProductClick(productId) {
  const product = menuItems.find(p => p.id === productId);
  (product.hasVariant || product.hasTemp) ? openVariantModal(product) : addToCart(productId);
}

// ─── Variant / Temp Modal ────────────────────────────────────
function openVariantModal(product) {
  window.scrollTo(0, 0);
  pendingItem     = product;
  selectedVariant = null;
  selectedTemp    = null;

  document.body.classList.add('modal-open');
  document.getElementById("variantTitle").textContent = product.name;
  const content     = document.getElementById("variantContent");
  const tempSection = document.getElementById("tempSection");

  let html = "";
  if (product.hasVariant && product.variants) {
    html += '<div style="margin-bottom:15px;font-weight:600;color:var(--gray);">Select Variant:</div>';
    html += '<div class="variant-options">';
    product.variants.forEach(v => {
      html += `<button class="variant-btn" onclick="selectVariant('${v.name}', ${v.price})"><span>${v.name}</span><span>₱${v.price.toFixed(2)}</span></button>`;
    });
    html += "</div>";
  } else {
    html += `<div style="text-align:center;padding:20px;background:var(--cream);border-radius:10px;margin-bottom:15px;">
               <div style="font-size:24px;font-weight:800;color:var(--primary);">₱${product.price.toFixed(2)}</div>
             </div>`;
  }
  content.innerHTML = html;

  if (product.hasTemp) {
    tempSection.classList.remove("hidden");
    document.querySelectorAll(".temp-btn").forEach(btn => btn.classList.remove("selected"));
  } else {
    tempSection.classList.add("hidden");
    selectedTemp = "N/A";
  }

  document.getElementById("confirmVariantBtn").disabled = true;
  document.getElementById("variantModal").classList.add("active");
}

function selectVariant(name, price) {
  selectedVariant = { name, price };
  document.querySelectorAll(".variant-btn").forEach(btn => btn.classList.remove("selected"));
  event.currentTarget.classList.add("selected");
  checkCanConfirm();
}

function selectTemp(temp) {
  selectedTemp = temp;
  document.querySelectorAll(".temp-btn").forEach(btn => btn.classList.remove("selected"));
  event.currentTarget.classList.add("selected");
  checkCanConfirm();
}

function checkCanConfirm() {
  const variantOk = !pendingItem.hasVariant || selectedVariant;
  const tempOk    = !pendingItem.hasTemp    || selectedTemp;
  document.getElementById("confirmVariantBtn").disabled = !(variantOk && tempOk);
}

function confirmVariant() {
  if (!pendingItem) return;

  const itemToAdd = {
    ...pendingItem,
    id:          Date.now(),
    baseId:      pendingItem.id,
    price:       selectedVariant ? selectedVariant.price : pendingItem.price,
    variant:     selectedVariant ? selectedVariant.name  : null,
    temperature: selectedTemp,
  };

  const existing = cart.find(i =>
    i.baseId === pendingItem.id &&
    i.variant === itemToAdd.variant &&
    i.temperature === itemToAdd.temperature
  );

  if (existing) {
    existing.quantity++;
    showToast(`Added another ${itemToAdd.name}`, "success");
  } else {
    cart.push({ ...itemToAdd, quantity: 1 });
    showToast(`${itemToAdd.name} added to order`, "success");
  }

  updateCart();
  closeVariantModal();
}

function closeVariantModal() {
  document.getElementById("variantModal").classList.remove("active");
  document.body.classList.remove('modal-open');
  pendingItem = selectedVariant = selectedTemp = null;
}

// ─── Category & Search ───────────────────────────────────────
function selectCategory(category) {
  currentCategory = category;
  document.querySelectorAll(".category-chip").forEach(chip => {
    chip.classList.remove("active");
    if (
      (category === "all" && chip.textContent.includes("All")) ||
      chip.getAttribute("onclick").includes(`'${category}'`)
    ) chip.classList.add("active");
  });
  renderProducts(category);
}

function searchProducts() {
  renderProducts(currentCategory);
}

// ─── Cart ────────────────────────────────────────────────────
function addToCart(productId) {
  const product  = menuItems.find(p => p.id === productId);
  const existing = cart.find(i => i.baseId === productId);

  if (existing) {
    existing.quantity++;
    showToast(`Added another ${product.name}`, "success");
  } else {
    cart.push({
      id: Date.now(), baseId: product.id,
      name: product.name, price: product.price,
      category: product.category,
      variant: null, temperature: "N/A",
      quantity: 1,
      hasDiscount: false,
    });
    showToast(`${product.name} added to order`, "success");
  }
  updateCart();
}

function toggleItemDiscount(itemId) {
  const item = cart.find(i => i.id === itemId);
  if (item) {
    item.hasDiscount = !item.hasDiscount;
    updateCart();
  }
}

function toggleSelectAllDiscount() {
  const allSelected = cart.every(i => i.hasDiscount);
  cart.forEach(i => i.hasDiscount = !allSelected);
  updateCart();
  showToast(allSelected ? "Discounts removed" : "20% discount applied to all items", allSelected ? "warning" : "success");
}



function updateCart() {
  const cartItemsEl    = document.getElementById("cartItems");
  const subtotalEl     = document.getElementById("subtotal");
  const totalEl        = document.getElementById("total");
  const checkoutBtn    = document.getElementById("checkoutBtn");
  const discountRow    = document.getElementById("discountRow");
  const discountAmtEl  = document.getElementById("discountAmount");
  const origTotalRow   = document.getElementById("originalTotalRow");
  const origTotalEl    = document.getElementById("originalTotal");

  if (cart.length === 0) {
    cartItemsEl.classList.remove("has-items");
    cartItemsEl.innerHTML = `
      <div class="empty-cart">
        <div class="empty-cart-icon">🛒</div>
        <p>Your order is empty</p>
        <p style="font-size:13px;margin-top:5px;">Click items from the menu to add</p>
      </div>`;
    checkoutBtn.disabled = true;
    discountRow.classList.add("hidden");
    origTotalRow.classList.add("hidden");
  } else {
    cartItemsEl.classList.add("has-items");
    cartItemsEl.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-top">
          <button class="discount-item-btn ${item.hasDiscount ? 'active' : ''}" onclick="toggleItemDiscount(${item.id})" title="Apply 20% discount">♿ 20% OFF</button>
          <div class="remove-btn" onclick="removeFromCart(${item.id})">🗑️</div>
        </div>
        <div class="cart-item-bottom">
          <div class="cart-item-details">
            <div class="cart-item-name">${item.name}</div>
            ${item.variant ? `<div class="cart-item-variant">${item.variant}${item.temperature !== "N/A" ? ` • ${item.temperature}` : ""}</div>` : ""}
            ${!item.variant && item.temperature !== "N/A" ? `<div class="cart-item-variant">${item.temperature}</div>` : ""}
            <div class="cart-item-price">₱${item.price.toFixed(2)} each ${item.hasDiscount ? '<span style="color:var(--success);font-weight:700;">-20%</span>' : ""}</div>
          </div>
          <div class="quantity-controls">
            <button class="qty-btn" onclick="updateQuantity(${item.id}, -1)">−</button>
            <span class="qty-value">${item.quantity}</span>
            <button class="qty-btn" onclick="updateQuantity(${item.id}, 1)">+</button>
          </div>
        </div>
      </div>
    `).join("");
    checkoutBtn.disabled = false;
  }

  const subtotal      = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const discountAmount = cart.reduce((s, i) => i.hasDiscount ? s + (i.price * i.quantity * 0.2) : s, 0);
  const finalTotal     = subtotal - discountAmount;

  if (discountAmount > 0) {
    discountRow.classList.remove("hidden");
    origTotalRow.classList.remove("hidden");
    discountAmtEl.textContent = `-₱${discountAmount.toFixed(2)}`;
    origTotalEl.textContent   = `₱${subtotal.toFixed(2)}`;
  } else {
    discountRow.classList.add("hidden");
    origTotalRow.classList.add("hidden");
  }

  subtotalEl.textContent = `₱${subtotal.toFixed(2)}`;
  totalEl.textContent    = `₱${finalTotal.toFixed(2)}`;
}

function updateQuantity(itemId, change) {
  const item = cart.find(i => i.id === itemId);
  if (!item) return;
  const newQty = item.quantity + change;
  newQty > 0 ? (item.quantity = newQty) : removeFromCart(itemId);
  updateCart();
}

function removeFromCart(itemId) {
  const item = cart.find(i => i.id === itemId);
  cart = cart.filter(i => i.id !== itemId);
  updateCart();
  showToast(`${item.name} removed`, "success");
}

function clearCart() {
  if (!cart.length) return;
  if (!confirm("Are you sure you want to clear this order?")) return;
  cart = [];
  updateCart();
  showToast("Order cleared", "success");
}

// ─── Payment ─────────────────────────────────────────────────
function openPaymentModal() {
  window.scrollTo(0, 0);
  document.getElementById("paymentAmount").textContent = document.getElementById("total").textContent;
  document.body.classList.add('modal-open');
  document.getElementById("paymentModal").classList.add("active");
  enteredAmount = "";
  updateChangeDisplay();
  updateDoneButton();
}

function closePaymentModal() {
  document.getElementById("paymentModal").classList.remove("active");
  document.body.classList.remove('modal-open');
  enteredAmount = "";
}

function selectPaymentMethod(method) {
  currentPaymentMethod = method;
  document.querySelectorAll(".payment-method").forEach(el => el.classList.remove("active"));
  event.currentTarget.classList.add("active");

  const numpad        = document.getElementById("cashNumpad");
  const changeDisplay = document.getElementById("changeDisplay");

  if (method === "cash") {
    numpad.style.display        = "grid";
    changeDisplay.style.display = "block";
  } else {
    numpad.style.display        = "none";
    changeDisplay.style.display = "none";
  }
  updateDoneButton();
}

function updateDoneButton() {
  const doneBtn = document.getElementById("doneBtn");
  const total   = parseFloat(document.getElementById("total").textContent.replace("₱", "").replace(",", ""));
  doneBtn.disabled = currentPaymentMethod === "cash"
    ? (parseFloat(enteredAmount) || 0) < total
    : false;
}

function enterDigit(digit) {
  if (enteredAmount.length < 10) {
    enteredAmount += digit;
    updateChangeDisplay();
    updateDoneButton();
  }
}

function clearAmount() {
  enteredAmount = "";
  updateChangeDisplay();
  updateDoneButton();
}

function exactAmount() {
  const total   = parseFloat(document.getElementById("total").textContent.replace("₱", "").replace(",", ""));
  enteredAmount = total.toFixed(2);
  updateChangeDisplay();
  updateDoneButton();
}

function quickAmount(amount) {
  enteredAmount = ((parseFloat(enteredAmount) || 0) + amount).toFixed(2);
  updateChangeDisplay();
  updateDoneButton();
}

function updateChangeDisplay() {
  const total   = parseFloat(document.getElementById("total").textContent.replace("₱", "").replace(",", ""));
  const entered = parseFloat(enteredAmount) || 0;
  const change  = entered - total;
  const display = document.getElementById("changeDisplay");

  if (enteredAmount && change >= 0) {
    display.innerHTML = `<span style="color:var(--success);">Change: ₱${change.toFixed(2)}</span>`;
  } else if (enteredAmount) {
    display.innerHTML = `<span style="color:var(--danger);">Insufficient: ₱${Math.abs(change).toFixed(2)}</span>`;
  } else {
    display.innerHTML = "";
  }
}

function completePayment() {
  const total = parseFloat(document.getElementById("total").textContent.replace("₱", "").replace(",", ""));

  const discountAmount = cart.reduce((s, i) => i.hasDiscount ? s + (i.price * i.quantity * 0.2) : s, 0);
  const hasDiscount = cart.some(i => i.hasDiscount);

  // Track cash received & change
  const amountPaid  = currentPaymentMethod === "cash" ? (parseFloat(enteredAmount) || total) : total;
  const changeGiven = currentPaymentMethod === "cash" ? Math.max(0, amountPaid - total) : 0;
  
  dailyStats.orders++;
  dailyStats.totalSales += total;
  if (hasDiscount) dailyStats.discountsApplied++;

  const subtotalAmt = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const sale = {
    id: Date.now(),
    items: cart.map(item => ({
      name:           item.name,
      price:          item.price,
      quantity:       item.quantity,
      variant:        item.variant,
      temperature:    item.temperature,
      subtotal:       item.price * item.quantity,
      hasDiscount:    item.hasDiscount,
      discountAmount: item.hasDiscount ? item.price * item.quantity * 0.2 : 0,
    })),
    subtotal:       subtotalAmt,
    total:          total,
    amountPaid:     amountPaid,
    changeGiven:    changeGiven,
    paymentMethod:  currentPaymentMethod,
    timestamp:      new Date().toLocaleString(),
    cashier:        "Staff",
    note:           "",
    discountAmount: discountAmount,
  };
  salesHistory.push(sale);
  saveToStorage();

  // Add to pending orders queue
  pendingOrders.push({
    id:        sale.id,
    orderNum:  sale.id.toString().slice(-6),
    items:     sale.items,
    total:     sale.total,
    timestamp: sale.timestamp,
    served:    false,
  });
  renderPendingOrders();

  generateReceipt(sale);

  cart = [];
  enteredAmount = "";
  updateCart();
  updateStats();
  closePaymentModal();

  document.body.classList.add('modal-open');
  document.getElementById("receiptModal").classList.add("active");
  showToast("Payment successful! Thank you!", "success");
}

// ─── Receipt Builder (reusable) ──────────────────────────────
function buildReceiptHTML(sale) {
  return `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-title">Brother Bean</div>
        <div class="receipt-subtitle">Coffee first, then the world.</div>
        <div class="receipt-info">
          ${sale.timestamp}<br>
          Order #${sale.id.toString().slice(-6)}<br>
          Payment: ${sale.paymentMethod.toUpperCase()}<br>
          Cashier: ${sale.cashier || "Staff"}<br>
        </div>
      </div>
      <div class="receipt-items">
        ${sale.items.map(item => `
          <div class="receipt-item">
            <span class="receipt-item-name">
              ${item.name}
              ${item.variant     ? `<div class="receipt-item-variant">${item.variant}</div>` : ""}
              ${item.temperature !== "N/A" ? `<div class="receipt-item-variant">${item.temperature}</div>` : ""}
            </span>
            <span class="receipt-item-qty">x${item.quantity}</span>
            <span>₱${(item.price * item.quantity).toFixed(2)}</span>
            ${item.hasDiscount ? `
              <div style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:0.9em;color:var(--success);">
                <span>↳ Discount (20%): -₱${item.discountAmount.toFixed(2)}</span>
                <span style="font-weight:700;">₱${((item.price * item.quantity) - item.discountAmount).toFixed(2)}</span>
              </div>` : ""}
          </div>`).join("")}
      </div>
      <div class="receipt-totals">
        <div class="receipt-row"><span>Subtotal</span><span>₱${sale.subtotal.toFixed(2)}</span></div>
        ${sale.discountAmount > 0 ? `<div class="receipt-row discount"><span>Discount (20%)</span><span>-₱${sale.discountAmount.toFixed(2)}</span></div>` : ""}
        <div class="receipt-row total"><span>TOTAL</span><span>₱${sale.total.toFixed(2)}</span></div>
        ${sale.paymentMethod === "cash" ? `
        <div class="receipt-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
          <span>Cash Received</span><span>₱${(sale.amountPaid || sale.total).toFixed(2)}</span>
        </div>
        <div class="receipt-row" style="font-weight:700;color:var(--success);">
          <span>Change</span><span>₱${(sale.changeGiven || 0).toFixed(2)}</span>
        </div>` : `
        <div class="receipt-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);color:var(--primary);font-weight:700;">
          <span>Paid via GCash</span><span>✓</span>
        </div>`}
        ${sale.note ? `<div style="margin-top:10px;padding:8px;background:var(--light);border-radius:6px;font-size:12px;color:var(--gray);">📝 ${sale.note}</div>` : ""}
      </div>
      <div class="receipt-footer">
        Thank you for visiting Brother Bean!<br>
        Please come again 🫘<br><br>
        VAT Registered TIN: 000-000-000-000<br>
        Permit No: 0000000
      </div>
    </div>`;
}

// ─── Receipt ─────────────────────────────────────────────────
function generateReceipt(sale) {
  window.scrollTo(0, 0);
  document.getElementById("receiptContent").innerHTML = buildReceiptHTML(sale);
}

function closeReceipt() {
  document.getElementById("receiptModal").classList.remove("active");
  document.body.classList.remove('modal-open');
}

function printReceipt() {
  const receiptWindow = window.open("", "_blank");
  receiptWindow.document.write(`
    <html><head><title>Brother Bean Receipt</title>
    <style>
      body { font-family: 'Courier New', monospace; padding: 20px; background: #f5f5f5; }
      .receipt { max-width: 400px; margin: 0 auto; background: white; padding: 30px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    </style></head><body>
    ${document.getElementById("receiptContent").innerHTML}
    <script>window.print(); window.close();<\/script>
    </body></html>
  `);
  receiptWindow.document.close();
}

// ─── Stats ───────────────────────────────────────────────────
function updateStats() {
  document.getElementById("todayOrders").textContent   = dailyStats.orders;
  document.getElementById("totalSales").textContent    = `₱${dailyStats.totalSales.toFixed(2)}`;
  document.getElementById("activeDiscounts").textContent = dailyStats.discountsApplied;
}

// ─── Toast ───────────────────────────────────────────────────
function showToast(message, type = "success") {
  const iconMap = { success: "✅", error: "❌", warning: "⚠️" };
  const toast   = document.getElementById("toast");
  toast.className = `toast ${type}`;
  document.getElementById("toastIcon").textContent    = iconMap[type];
  document.getElementById("toastMessage").textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ─── Sales Report ────────────────────────────────────────────
function showSalesReport() {
  window.scrollTo(0, 0);
  if (!salesHistory.length) { showToast("No sales recorded today", "error"); return; }

  document.body.classList.add('modal-open');
  const content      = document.getElementById("salesReportContent");
  const totalRevenue = salesHistory.reduce((s, sale) => s + sale.total, 0);
  const totalDiscounts = salesHistory.filter(s => s.discountAmount > 0).length;

  let html = `
    <div class="report-summary">
      <div class="report-summary-item"><h4>Total Orders</h4><p>${salesHistory.length}</p></div>
      <div class="report-summary-item"><h4>Revenue</h4><p>₱${totalRevenue.toFixed(2)}</p></div>
      <div class="report-summary-item"><h4>Discounts</h4><p>${totalDiscounts}</p></div>
    </div>
    <div class="sales-report-content">
  `;

  salesHistory.slice().reverse().forEach(sale => {
    html += `
      <div class="sale-entry">
        <div class="sale-header">
          <div>
            <span class="sale-order-num">Order #${sale.id.toString().slice(-6)}</span>
            ${sale.discountAmount > 0 ? '<span class="sale-badge discount">20% OFF</span>' : ""}
            <span class="sale-badge payment-${sale.paymentMethod}">${sale.paymentMethod.toUpperCase()}</span>
          </div>
          <span class="sale-total">₱${sale.total.toFixed(2)}</span>
        </div>
        <div class="sale-time">${sale.timestamp}</div>
        <div class="sale-items-list">
          ${sale.items.map(item => {
            const variantText = item.variant ? ` (${item.variant})` : "";
            const tempText    = item.temperature && item.temperature !== "N/A" ? ` - ${item.temperature}` : "";
            return `
              <div class="sale-item-row">
                <span class="sale-item-name">
                  ${item.name}${variantText}${tempText}
                  <span class="sale-item-details">x${item.quantity}</span>
                </span>
                <span class="sale-item-price">₱${item.subtotal.toFixed(2)}</span>
              </div>
            `;
          }).join("")}
        </div>
        <div class="sale-summary">
          <span>Subtotal: ₱${sale.subtotal.toFixed(2)}</span>
          ${sale.discountAmount > 0 ? `<span style="color:var(--success);">Discount: -₱${sale.discountAmount.toFixed(2)}</span>` : ""}
        </div>
      </div>
    `;
  });

  html += `</div>
    <div style="display:flex;gap:10px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="exportToCSV()" style="flex:1;">📥 Export to Excel</button>
      <button class="btn btn-danger"    onclick="clearAllData()" style="flex:1;">🗑️ Clear All Data</button>
    </div>`;

  content.innerHTML = html;
  document.getElementById("salesReportModal").classList.add("active");
}

function closeSalesReport() {
  document.getElementById("salesReportModal").classList.remove("active");
  document.body.classList.remove('modal-open');
}

function exportToCSV() {
  let csv = "Order ID,Date/Time,Item Name,Variant,Temperature,Quantity,Price,Subtotal,Discount,Total,Payment Method\n";
  salesHistory.forEach(sale => {
    sale.items.forEach(item => {
      csv += `${sale.id},${sale.timestamp},"${item.name}","${item.variant || ""}","${item.temperature || ""}",${item.quantity},${item.price},${item.subtotal},${item.hasDiscount ? item.discountAmount : 0},${sale.total},${sale.paymentMethod}\n`;
    });
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `brother_bean_sales_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Data exported successfully!", "success");
}

function clearAllData() {
  if (!confirm("⚠️ WARNING: This will permanently delete ALL sales history!\n\nAre you sure?")) return;
  if (!confirm("Final confirmation: Delete all saved transactions?")) return;

  localStorage.removeItem(STORAGE_KEYS.salesHistory);
  localStorage.removeItem(STORAGE_KEYS.dailyStats);
  salesHistory = [];
  dailyStats   = { orders: 0, totalSales: 0, discountsApplied: 0 };
  updateStats();
  updateStorageIndicator();
  closeSalesReport();
  showToast("All data cleared successfully", "success");
}

// ─── Admin Dashboard (Tabbed) ──────────────────────────────────
function showAdminDashboard() {
  window.scrollTo(0, 0);

  if (!salesHistory.length) {
    showToast("No sales data yet for admin view", "warning");
  }

  adminCurrentSection = "overview";
  renderAdminDashboard();
  document.body.classList.add("modal-open");
  document.getElementById("adminDashboardModal").classList.add("active");
}

function setAdminSection(section) {
  adminCurrentSection = section;
  renderAdminDashboard();
}

function renderAdminDashboard() {
  const totalOrders   = salesHistory.length;
  const totalRevenue  = salesHistory.reduce((s, sale) => s + sale.total, 0);
  const totalDiscount = salesHistory.reduce((s, sale) => s + sale.discountAmount, 0);

  const paymentCounts = salesHistory.reduce((acc, sale) => {
    acc[sale.paymentMethod] = (acc[sale.paymentMethod] || 0) + 1;
    return acc;
  }, {});

  const itemMap = {};
  salesHistory.forEach(sale => {
    sale.items.forEach(item => {
      if (!itemMap[item.name]) {
        itemMap[item.name] = { quantity: 0, revenue: 0 };
      }
      itemMap[item.name].quantity += item.quantity;
      itemMap[item.name].revenue  += item.subtotal;
    });
  });

  const topItems = Object.entries(itemMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5);

  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

  const content = document.getElementById("adminDashboardContent");

  let sectionHtml = "";

  if (adminCurrentSection === "overview") {
    sectionHtml = `
      <div class="admin-grid">
        <div class="admin-card">
          <h4>Total Orders</h4>
          <p>${totalOrders}</p>
        </div>
        <div class="admin-card">
          <h4>Total Revenue</h4>
          <p>₱${totalRevenue.toFixed(2)}</p>
        </div>
        <div class="admin-card">
          <h4>Total Discounts</h4>
          <p>₱${totalDiscount.toFixed(2)}</p>
        </div>
        <div class="admin-card">
          <h4>Average Order Value</h4>
          <p>₱${avgOrderValue.toFixed(2)}</p>
        </div>
      </div>
    `;
  } else if (adminCurrentSection === "sales") {
    sectionHtml = `
      <div class="admin-section">
        <h3>Daily Sales Summary</h3>
        <p style="font-size:13px;color:var(--gray);margin-bottom:10px;">
          Quick view of today's recorded sales. Use the full Daily Sales modal for detailed per-order breakdown.
        </p>
        <div class="admin-grid small">
          <div class="admin-card">
            <h4>Orders</h4>
            <p>${totalOrders}</p>
          </div>
          <div class="admin-card">
            <h4>Revenue</h4>
            <p>₱${totalRevenue.toFixed(2)}</p>
          </div>
          <div class="admin-card">
            <h4>Discounted Orders</h4>
            <p>${salesHistory.filter(s => s.discountAmount > 0).length}</p>
          </div>
        </div>
      </div>
    `;
  } else if (adminCurrentSection === "items") {
    sectionHtml = `
      <div class="admin-section">
        <h3>Top Items (by revenue)</h3>
        ${
          topItems.length
            ? `<div class="admin-table">
                 <div class="admin-table-header">
                   <span>Item</span>
                   <span>Qty</span>
                   <span>Revenue</span>
                 </div>
                 ${topItems
                   .map(
                     ([name, data]) => `
                       <div class="admin-table-row">
                         <span>${name}</span>
                         <span>${data.quantity}</span>
                         <span>₱${data.revenue.toFixed(2)}</span>
                       </div>
                     `
                   )
                   .join("")}
               </div>`
            : `<p style="color: var(--gray); font-size: 14px;">No sales data yet.</p>`
        }
      </div>
    `;
  } else if (adminCurrentSection === "data") {
    sectionHtml = `
      <div class="admin-section">
        <h3>Data Tools</h3>
        <p style="font-size:13px;color:var(--gray);margin-bottom:10px;">
          Export your sales data or clear everything when starting fresh.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary" style="flex:1;min-width:160px;" onclick="exportToCSV()">
            📥 Export to Excel
          </button>
          <button class="btn btn-danger" style="flex:1;min-width:160px;" onclick="clearAllData()">
            🗑️ Clear All Data
          </button>
        </div>
      </div>
    `;
  } else if (adminCurrentSection === "menu") {
    const categoryPairsFromMenu = menuItems.reduce((acc, m) => {
      const key   = m.category;
      const label = m.subcategory || m.category;
      if (!acc.find(c => c.key === key && c.label === label)) {
        acc.push({ key, label });
      }
      return acc;
    }, []);
    const allCategoryPairs = [...categoryPairsFromMenu, ...extraCategories];
    const categories    = Array.from(new Set(allCategoryPairs.map(c => c.key)));
    const subcategories = Array.from(new Set(allCategoryPairs.map(c => c.label)));
    sectionHtml = `
      <div class="admin-section">
        <h3>Menu Manager</h3>
        <p style="font-size:13px;color:var(--gray);margin-bottom:10px;">
          Add or remove items from the POS menu. Changes are saved in this browser.
        </p>
        <div class="menu-category-manager">
          <div class="menu-form-row">
            <label>New category key</label>
            <input id="newCategoryKey" type="text" placeholder="e.g. breakfast, promos" />
          </div>
          <div class="menu-form-row">
            <label>New display group</label>
            <input id="newCategoryLabel" type="text" placeholder="e.g. Breakfast, Promos" />
          </div>
          <button class="btn btn-secondary" style="margin-top:4px;width:100%;" onclick="addCustomCategory()">
            ➕ Add Category
          </button>
        </div>
        <div class="menu-manager">
          <div class="menu-form">
            <div class="menu-form-row">
              <label>Name</label>
              <input id="menuItemName" type="text" placeholder="Item name" />
            </div>
            <div class="menu-form-row">
              <label>Price (₱)</label>
              <input id="menuItemPrice" type="number" min="0" step="1" placeholder="100" />
            </div>
            <div class="menu-form-row">
              <label>Category key</label>
              <select id="menuItemCategory">
                <option value="">Select category key…</option>
                ${categories.map(c => `<option value="${c}">${c}</option>`).join("")}
                <option value="__custom__">Custom…</option>
              </select>
            </div>
            <div class="menu-form-row">
              <label>Display group</label>
              <select id="menuItemSubcategory">
                <option value="">Select display group…</option>
                ${subcategories.map(s => `<option value="${s}">${s}</option>`).join("")}
                <option value="__custom__">Custom…</option>
              </select>
            </div>
            <button class="btn btn-primary" style="width:100%;margin-top:6px;" onclick="addMenuItemFromForm()">
              ➕ Add Menu Item
            </button>
          </div>
          <div class="menu-list">
            <div class="admin-table">
              <div class="admin-table-header">
                <span>Item</span>
                <span>Category</span>
                <span>₱</span>
              </div>
              ${menuItems.map(item => `
                <div class="admin-table-row">
                  <span>${item.name}</span>
                  <span>${item.subcategory || item.category}</span>
                  <span>
                    ₱${item.price.toFixed(2)}
                    <button class="menu-remove-btn" onclick="removeMenuItem(${item.id})">✕</button>
                  </span>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div class="admin-dashboard">
      <div class="admin-layout">
        <aside class="admin-sidebar">
          <div class="admin-nav">
            <button class="admin-nav-item ${adminCurrentSection === "overview" ? "active" : ""}" onclick="setAdminSection('overview')">Overview</button>
            <button class="admin-nav-item ${adminCurrentSection === "sales" ? "active" : ""}" onclick="setAdminSection('sales')">Sales</button>
            <button class="admin-nav-item ${adminCurrentSection === "items" ? "active" : ""}" onclick="setAdminSection('items')">Items</button>
            <button class="admin-nav-item ${adminCurrentSection === "menu" ? "active" : ""}" onclick="setAdminSection('menu')">Menu</button>
            <button class="admin-nav-item ${adminCurrentSection === "data" ? "active" : ""}" onclick="setAdminSection('data')">Data</button>
          </div>
        </aside>
        <div class="admin-content">
          ${sectionHtml}
          <div class="admin-meta">
            <span>Totals based on ${salesHistory.length} recorded orders.</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function addMenuItemFromForm() {
  const nameEl   = document.getElementById("menuItemName");
  const priceEl  = document.getElementById("menuItemPrice");
  const catEl    = document.getElementById("menuItemCategory");
  const subcatEl = document.getElementById("menuItemSubcategory");

  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value);
  let   category = catEl.value;
  let   subcategory = subcatEl.value;

  if (category === "__custom__") {
    const input = prompt("Enter a custom category key (e.g. coffee, pasta):", "");
    category = input && input.trim() ? input.trim() : "";
  }
  if (subcategory === "__custom__") {
    const input = prompt("Enter a custom display group name (e.g. Coffee, Starters):", "");
    subcategory = input && input.trim() ? input.trim() : "";
  }

  category    = (category && category.trim()) || "custom";
  subcategory = (subcategory && subcategory.trim()) || "Custom";

  if (!name || isNaN(price) || price <= 0) {
    showToast("Please provide a valid name and price", "error");
    return;
  }

  const maxId = menuItems.reduce((max, item) => Math.max(max, item.id || 0), 0);
  const newItem = {
    id: maxId + 1,
    name,
    price,
    category,
    subcategory,
  };

  menuItems.push(newItem);
  saveToStorage();
  renderProducts(currentCategory);
  showMenu(); // refresh menu modal content if open
  setAdminSection("menu");

  nameEl.value = "";
  priceEl.value = "";
  catEl.value = "";
  subcatEl.value = "";

  showToast("Menu item added", "success");
}

function removeMenuItem(id) {
  if (!confirm("Remove this menu item from the POS?")) return;
  menuItems = menuItems.filter(item => item.id !== id);
  saveToStorage();
  renderProducts(currentCategory);
  showMenu();
  setAdminSection("menu");
  showToast("Menu item removed", "success");
}

function addCustomCategory() {
  const keyEl   = document.getElementById("newCategoryKey");
  const labelEl = document.getElementById("newCategoryLabel");

  const key   = (keyEl.value || "").trim();
  const label = (labelEl.value || "").trim();

  if (!key || !label) {
    showToast("Please enter both category key and display name", "error");
    return;
  }

  if (!extraCategories.find(c => c.key === key && c.label === label)) {
    extraCategories.push({ key, label });
    saveToStorage();
  }

  keyEl.value = "";
  labelEl.value = "";
  setAdminSection("menu");
  showToast("Category added", "success");
}

function closeAdminDashboard() {
  document.getElementById("adminDashboardModal").classList.remove("active");
  document.body.classList.remove("modal-open");
}

// ─── Utility Modals ──────────────────────────────────────────
function showMenu() {
  window.scrollTo(0, 0);
  const categories = {};
  menuItems.forEach(item => {
    if (!categories[item.subcategory]) categories[item.subcategory] = [];
    categories[item.subcategory].push(item);
  });

  let menuHTML = '';
  for (const [cat, items] of Object.entries(categories)) {
    menuHTML += `<div class="menu-category">
                  <h4 class="menu-category-title">${cat}</h4>
                  <div class="menu-items-list">`;
    items.forEach(item => { 
      menuHTML += `<div class="menu-item">
                    <span class="menu-item-name">${item.name}</span>
                    <span class="menu-item-price">₱${item.price}</span>
                   </div>`;
    });
    menuHTML += `</div></div>`;
  }
  
  document.getElementById('menuContent').innerHTML = menuHTML;
  document.body.classList.add('modal-open');
  document.getElementById('menuModal').classList.add('active');
}

function closeMenuModal() {
  document.getElementById('menuModal').classList.remove('active');
  document.body.classList.remove('modal-open');
}

function openDrawer() {
  window.scrollTo(0, 0);
  document.getElementById('drawerCash').textContent = `₱${dailyStats.totalSales.toFixed(2)}`;
  document.getElementById('drawerTransactions').textContent = dailyStats.orders;
  document.getElementById('drawerOrders').textContent = salesHistory.length;
  document.body.classList.add('modal-open');
  document.getElementById('drawerModal').classList.add('active');
}

function closeDrawerModal() {
  document.getElementById('drawerModal').classList.remove('active');
  document.body.classList.remove('modal-open');
}

// ═══════════════════════════════════════════════════════════
//  TRANSACTION HISTORY
// ═══════════════════════════════════════════════════════════

function showTransactionHistory() {
  window.scrollTo(0, 0);
  if (!salesHistory.length) { showToast("No transactions yet", "error"); return; }

  const totalRevenue   = salesHistory.reduce((s, sale) => s + sale.total, 0);
  const totalDiscounts = salesHistory.filter(s => s.discountAmount > 0).length;

  let html = `
    <div class="report-summary">
      <div class="report-summary-item"><h4>Total Orders</h4><p>${salesHistory.length}</p></div>
      <div class="report-summary-item"><h4>Revenue</h4><p>₱${totalRevenue.toFixed(2)}</p></div>
      <div class="report-summary-item"><h4>Discounts</h4><p>${totalDiscounts}</p></div>
    </div>
    <div class="sales-report-content">`;

  salesHistory.slice().reverse().forEach(sale => {
    html += `
      <div class="tx-entry">
        <div class="tx-left">
          <div class="tx-order">Order #${sale.id.toString().slice(-6)}</div>
          <div class="tx-time">${sale.timestamp}</div>
          <div class="tx-items-preview">
            ${sale.items.map(i =>
              `<div class="tx-item-line">• ${i.name}${i.variant ? ` (${i.variant})` : ""}${i.temperature && i.temperature !== "N/A" ? ` - ${i.temperature}` : ""} <span class="tx-item-qty">x${i.quantity}</span> <span class="tx-item-price">₱${i.subtotal.toFixed(2)}</span></div>`
            ).join("")}
          </div>
        </div>
        <div class="tx-right">
          <div class="tx-total">₱${sale.total.toFixed(2)}</div>
          <span class="sale-badge payment-${sale.paymentMethod}">${sale.paymentMethod.toUpperCase()}</span>
          ${sale.discountAmount > 0 ? '<span class="sale-badge discount">20% OFF</span>' : ""}
          <div class="tx-actions">
            <button class="btn-tx-view" onclick="viewReceiptFromHistory(${sale.id})">🧾 View</button>
            <button class="btn-tx-edit" onclick="editReceiptFromHistory(${sale.id})">✏️ Edit</button>
            <button class="btn-tx-del"  onclick="deleteTransaction(${sale.id})">🗑️</button>
          </div>
        </div>
      </div>`;
  });

  html += `</div>
    <div style="display:flex;gap:10px;margin-top:20px;">
      <button class="btn btn-secondary" onclick="exportToCSV()" style="flex:1;">📥 Export CSV</button>
      <button class="btn btn-danger"    onclick="clearAllData()" style="flex:1;">🗑️ Clear All</button>
    </div>`;

  document.getElementById("transactionListContent").innerHTML = html;
  document.body.classList.add("modal-open");
  document.getElementById("transactionModal").classList.add("active");
}

function closeTransactionHistory() {
  document.getElementById("transactionModal").classList.remove("active");
  document.body.classList.remove("modal-open");
}

// ─── View Receipt ─────────────────────────────────────────────
function viewReceiptFromHistory(saleId) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale) return;
  document.getElementById("receiptViewerTitle").textContent = `🧾 Receipt — Order #${sale.id.toString().slice(-6)}`;
  document.getElementById("receiptViewerContent").innerHTML = buildReceiptHTML(sale);
  document.getElementById("receiptViewerActions").innerHTML = `
    <button class="btn btn-secondary" onclick="closeReceiptViewer()" style="flex:1">Close</button>
    <button class="btn btn-secondary" onclick="editReceiptFromHistory(${saleId})" style="flex:1">✏️ Edit</button>
    <button class="btn btn-primary"   onclick="printFromViewer(${saleId})" style="flex:1">🖨️ Print</button>`;
  document.getElementById("receiptViewerModal").classList.add("active");
}

function printFromViewer(saleId) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale) return;
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>Brother Bean Receipt</title>
    <style>body{font-family:'Courier New',monospace;padding:20px;background:#f5f5f5;}
    .receipt{max-width:400px;margin:0 auto;background:white;padding:30px;}</style></head><body>
    ${buildReceiptHTML(sale)}<script>window.print();window.close();<\/script></body></html>`);
  w.document.close();
}

// ─── Edit Receipt ─────────────────────────────────────────────
function editReceiptFromHistory(saleId) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale) return;

  document.getElementById("receiptViewerTitle").textContent = `✏️ Edit — Order #${sale.id.toString().slice(-6)}`;

  const itemRows = sale.items.map((item, idx) => `
    <tr>
      <td><input class="edit-input" value="${item.name}" onchange="updateEditItem(${saleId},${idx},'name',this.value)"/></td>
      <td><input class="edit-input edit-qty" type="number" min="1" value="${item.quantity}" onchange="updateEditItem(${saleId},${idx},'quantity',+this.value)"/></td>
      <td><input class="edit-input edit-price" type="number" min="0" value="${item.price}" onchange="updateEditItem(${saleId},${idx},'price',+this.value)"/></td>
      <td id="edit-sub-${saleId}-${idx}">₱${item.subtotal.toFixed(2)}</td>
      <td><button class="btn-tx-del" onclick="removeEditItem(${saleId},${idx})">🗑️</button></td>
    </tr>`).join("");

  document.getElementById("receiptViewerContent").innerHTML = `
    <div class="edit-form">
      <div class="edit-section-title">📋 Order Items</div>
      <table class="edit-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th><th></th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="edit-section-title" style="margin-top:16px;">💳 Payment Details</div>

      <div class="edit-field-row">
        <label>Payment Method</label>
        <select class="edit-input" onchange="updateEditField(${saleId},'paymentMethod',this.value)">
          <option value="cash"  ${sale.paymentMethod === "cash"  ? "selected" : ""}>Cash</option>
          <option value="gcash" ${sale.paymentMethod === "gcash" ? "selected" : ""}>GCash</option>
        </select>
      </div>
      <div class="edit-field-row">
        <label>Cash Received (₱)</label>
        <input class="edit-input" type="number" min="0" value="${sale.amountPaid || sale.total}"
          onchange="updateEditField(${saleId},'amountPaid',+this.value)"/>
      </div>
      <div class="edit-field-row">
        <label>Cashier Name</label>
        <input class="edit-input" value="${sale.cashier || 'Staff'}"
          onchange="updateEditField(${saleId},'cashier',this.value)"/>
      </div>
      <div class="edit-field-row">
        <label>Note / Remarks</label>
        <input class="edit-input" value="${sale.note || ''}" placeholder="Optional note..."
          onchange="updateEditField(${saleId},'note',this.value)"/>
      </div>
    </div>`;

  document.getElementById("receiptViewerActions").innerHTML = `
    <button class="btn btn-danger"    onclick="closeReceiptViewer()" style="flex:1">Cancel</button>
    <button class="btn btn-secondary" onclick="previewEditedReceipt(${saleId})" style="flex:1">👁️ Preview</button>
    <button class="btn btn-primary"   onclick="saveEditedReceipt(${saleId})" style="flex:1">💾 Save</button>`;

  document.getElementById("receiptViewerModal").classList.add("active");
}

function closeReceiptViewer() {
  document.getElementById("receiptViewerModal").classList.remove("active");
}

// ─── Edit Helpers ─────────────────────────────────────────────
function updateEditItem(saleId, idx, field, value) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale) return;
  sale.items[idx][field] = value;
  sale.items[idx].subtotal = sale.items[idx].price * sale.items[idx].quantity;
  const subEl = document.getElementById(`edit-sub-${saleId}-${idx}`);
  if (subEl) subEl.textContent = `₱${sale.items[idx].subtotal.toFixed(2)}`;
  recalculateSale(sale);
}

function removeEditItem(saleId, idx) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale || sale.items.length <= 1) { showToast("Cannot remove last item", "error"); return; }
  sale.items.splice(idx, 1);
  recalculateSale(sale);
  editReceiptFromHistory(saleId);
}

function updateEditField(saleId, field, value) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale) return;
  sale[field] = value;
  recalculateSale(sale);
}

function recalculateSale(sale) {
  const subtotal      = sale.items.reduce((s, i) => s + i.subtotal, 0);
  sale.subtotal       = subtotal;
  sale.discountAmount = sale.items.reduce((s, i) => i.hasDiscount ? s + i.discountAmount : s, 0);
  sale.total          = subtotal - sale.discountAmount;
  if (sale.paymentMethod === "cash") {
    sale.changeGiven = Math.max(0, (sale.amountPaid || sale.total) - sale.total);
  } else {
    sale.amountPaid  = sale.total;
    sale.changeGiven = 0;
  }
}

function previewEditedReceipt(saleId) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale) return;
  recalculateSale(sale);
  document.getElementById("receiptViewerTitle").textContent = `👁️ Preview — Order #${sale.id.toString().slice(-6)}`;
  document.getElementById("receiptViewerContent").innerHTML = buildReceiptHTML(sale);
  document.getElementById("receiptViewerActions").innerHTML = `
    <button class="btn btn-secondary" onclick="editReceiptFromHistory(${saleId})" style="flex:1">← Back to Edit</button>
    <button class="btn btn-primary"   onclick="saveEditedReceipt(${saleId})" style="flex:1">💾 Save Changes</button>`;
}

function saveEditedReceipt(saleId) {
  const sale = salesHistory.find(s => s.id === saleId);
  if (!sale) return;
  recalculateSale(sale);
  dailyStats.totalSales       = salesHistory.reduce((s, x) => s + x.total, 0);
  dailyStats.discountsApplied = salesHistory.filter(x => x.discountAmount > 0).length;
  saveToStorage();
  updateStats();
  showToast("Receipt updated successfully!", "success");
  viewReceiptFromHistory(saleId);
}

// ─── Delete Transaction ───────────────────────────────────────
function deleteTransaction(saleId) {
  if (!confirm("Delete this transaction permanently?")) return;
  salesHistory = salesHistory.filter(s => s.id !== saleId);
  dailyStats.orders           = salesHistory.length;
  dailyStats.totalSales       = salesHistory.reduce((s, x) => s + x.total, 0);
  dailyStats.discountsApplied = salesHistory.filter(x => x.discountAmount > 0).length;
  saveToStorage();
  updateStats();
  showToast("Transaction deleted", "success");
  if (salesHistory.length) showTransactionHistory();
  else closeTransactionHistory();
}

// ═══════════════════════════════════════════════════════════
//  PENDING ORDERS (Kitchen Queue)
// ═══════════════════════════════════════════════════════════

function renderPendingOrders() {
  const container = document.getElementById("pendingOrdersList");
  const countBadge = document.getElementById("pendingCount");
  if (!container) return;

  const active = pendingOrders.filter(o => !o.served);
  if (countBadge) countBadge.textContent = active.length;
  countBadge && (countBadge.style.display = active.length > 0 ? "inline-flex" : "none");

  if (active.length === 0) {
    container.innerHTML = `
      <div class="pending-empty">
        <span style="font-size:28px;">✅</span>
        <p>No pending orders</p>
      </div>`;
    return;
  }

  container.innerHTML = active.map(order => `
    <div class="pending-card" id="pending-${order.id}">
      <div class="pending-header">
        <span class="pending-order-num">Order #${order.orderNum}</span>
        <span class="pending-time">${order.timestamp.split(",")[1]?.trim() || order.timestamp}</span>
      </div>
      <div class="pending-items">
        ${order.items.map(i => `
          <div class="pending-item-row">
            <span class="pending-item-name">${i.name}${i.variant ? ` (${i.variant})` : ""}${i.temperature && i.temperature !== "N/A" ? ` — ${i.temperature}` : ""}</span>
            <span class="pending-item-qty">x${i.quantity}</span>
          </div>`).join("")}
      </div>
      <button class="btn-served" onclick="markServed(${order.id})">
        ✅ Done / Served
      </button>
    </div>
  `).join("");
}

function markServed(orderId) {
  const order = pendingOrders.find(o => o.id === orderId);
  if (!order) return;
  order.served = true;

  // Animate out then re-render
  const card = document.getElementById(`pending-${orderId}`);
  if (card) {
    card.classList.add("served-out");
    setTimeout(() => renderPendingOrders(), 400);
  } else {
    renderPendingOrders();
  }
  showToast(`Order #${order.orderNum} marked as served!`, "success");
}

// ─── Keyboard Shortcuts ──────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closePaymentModal();
    closeReceipt();
    closeMenuModal();
    closeDrawerModal();
    closeSalesReport();
    closeVariantModal();
    closeAdminDashboard();
    closeTransactionHistory();
    closeReceiptViewer();
  }
});