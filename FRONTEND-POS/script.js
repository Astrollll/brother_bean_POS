// ─── Menu Nigga───────────────────────────────────────────
const menuItems = [
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

// ─── State ───────────────────────────────────────────────────
let cart                = [];
let currentCategory     = "all";
let currentPaymentMethod = "cash";
let isPwdSenior         = false;
let enteredAmount       = "";
let salesHistory        = [];
let dailyStats          = { orders: 0, totalSales: 0, discountsApplied: 0 };
let pendingItem         = null;
let selectedVariant     = null;
let selectedTemp        = null;

// ─── LocalStorage Keys ───────────────────────────────────────
const STORAGE_KEYS = {
  salesHistory:  "brotherBean_salesHistory",
  dailyStats:    "brotherBean_dailyStats",
  lastResetDate: "brotherBean_lastResetDate",
};

// ─── Init ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadFromStorage();
  checkDailyReset();
  renderProducts();
  updateCart();
  updateStats();
  updateStorageIndicator();
  
  // Close modals when clicking outside
  document.getElementById('menuModal').addEventListener('click', (e) => {
    if (e.target.id === 'menuModal') closeMenuModal();
  });
  document.getElementById('drawerModal').addEventListener('click', (e) => {
    if (e.target.id === 'drawerModal') closeDrawerModal();
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
    if (savedHistory) salesHistory = JSON.parse(savedHistory);
    if (savedStats)   dailyStats   = JSON.parse(savedStats);
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
    });
    showToast(`${product.name} added to order`, "success");
  }
  updateCart();
}

function toggleDiscount() {
  const checkbox = document.getElementById("pwdSeniorCheck");
  const toggle   = document.getElementById("discountToggle");
  isPwdSenior    = !isPwdSenior;
  checkbox.checked = isPwdSenior;

  if (isPwdSenior) {
    toggle.classList.add("active");
    if (cart.length > 0) showToast("20% PWD/Senior discount applied!", "success");
  } else {
    toggle.classList.remove("active");
    if (cart.length > 0) showToast("Discount removed", "warning");
  }
  updateCart();
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
        <div class="cart-item-details">
          <div class="cart-item-name">${item.name}</div>
          ${item.variant ? `<div class="cart-item-variant">${item.variant}${item.temperature !== "N/A" ? ` • ${item.temperature}` : ""}</div>` : ""}
          ${!item.variant && item.temperature !== "N/A" ? `<div class="cart-item-variant">${item.temperature}</div>` : ""}
          <div class="cart-item-price">₱${item.price.toFixed(2)} each</div>
        </div>
        <div class="quantity-controls">
          <button class="qty-btn" onclick="updateQuantity(${item.id}, -1)">−</button>
          <span class="qty-value">${item.quantity}</span>
          <button class="qty-btn" onclick="updateQuantity(${item.id}, 1)">+</button>
        </div>
        <div class="remove-btn" onclick="removeFromCart(${item.id})">🗑️</div>
      </div>
    `).join("");
    checkoutBtn.disabled = false;
  }

  const subtotal      = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  let discountAmount  = 0;
  let finalTotal      = subtotal;

  if (isPwdSenior && subtotal > 0) {
    discountAmount = subtotal * 0.2;
    finalTotal     = subtotal - discountAmount;
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
  isPwdSenior = false;
  document.getElementById("pwdSeniorCheck").checked = false;
  document.getElementById("discountToggle").classList.remove("active");
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

  dailyStats.orders++;
  dailyStats.totalSales += total;
  if (isPwdSenior) dailyStats.discountsApplied++;

  const subtotalAmt = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const sale = {
    id: Date.now(),
    items: cart.map(item => ({
      name:        item.name,
      price:       item.price,
      quantity:    item.quantity,
      variant:     item.variant,
      temperature: item.temperature,
      subtotal:    item.price * item.quantity,
    })),
    subtotal:       subtotalAmt,
    total:          total,
    paymentMethod:  currentPaymentMethod,
    timestamp:      new Date().toLocaleString(),
    isPwdSenior:    isPwdSenior,
    discountAmount: isPwdSenior ? subtotalAmt * 0.2 : 0,
  };
  salesHistory.push(sale);
  saveToStorage();

  generateReceipt(sale);

  cart = [];
  isPwdSenior = false;
  document.getElementById("pwdSeniorCheck").checked = false;
  document.getElementById("discountToggle").classList.remove("active");
  enteredAmount = "";
  updateCart();
  updateStats();
  closePaymentModal();

  document.body.classList.add('modal-open');
  document.getElementById("receiptModal").classList.add("active");
  showToast("Payment successful! Thank you!", "success");
}

// ─── Receipt ─────────────────────────────────────────────────
function generateReceipt(sale) {
  window.scrollTo(0, 0);
  document.getElementById("receiptContent").innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-title">Brother Bean</div>
        <div class="receipt-subtitle">Coffee first, then the world.</div>
        <div class="receipt-info">
          ${sale.timestamp}<br>
          Order #${sale.id.toString().slice(-6)}<br>
          Payment: ${sale.paymentMethod.toUpperCase()}<br>
          ${sale.isPwdSenior ? "<strong>♿ PWD/Senior Citizen</strong><br>" : ""}
          Cashier: Staff
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
          </div>
        `).join("")}
      </div>
      <div class="receipt-totals">
        <div class="receipt-row"><span>Subtotal</span><span>₱${sale.subtotal.toFixed(2)}</span></div>
        ${sale.isPwdSenior ? `<div class="receipt-row discount"><span>PWD/Senior Discount (20%)</span><span>-₱${sale.discountAmount.toFixed(2)}</span></div>` : ""}
        <div class="receipt-row total"><span>TOTAL</span><span>₱${sale.total.toFixed(2)}</span></div>
      </div>
      <div class="receipt-footer">
        Thank you for visiting Brother Bean!<br>
        Please come again 🫘<br><br>
        VAT Registered TIN: 000-000-000-000<br>
        Permit No: 0000000
      </div>
    </div>
  `;
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
  const totalDiscounts = salesHistory.filter(s => s.isPwdSenior).length;

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
            ${sale.isPwdSenior ? '<span class="sale-badge pwd">PWD/SR</span>' : ""}
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
          ${sale.isPwdSenior ? `<span style="color:var(--success);">Discount: -₱${sale.discountAmount.toFixed(2)}</span>` : ""}
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
      csv += `${sale.id},${sale.timestamp},"${item.name}","${item.variant || ""}","${item.temperature || ""}",${item.quantity},${item.price},${item.subtotal},${sale.isPwdSenior ? sale.discountAmount : 0},${sale.total},${sale.paymentMethod}\n`;
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

// ─── Keyboard Shortcuts ──────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closePaymentModal();
    closeReceipt();
    closeMenuModal();
    closeDrawerModal();
    closeSalesReport();
    closeVariantModal();
  }
});
