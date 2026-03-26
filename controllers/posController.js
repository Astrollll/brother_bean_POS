// ── POS CONTROLLER ──
// Connects models (data) to views (UI) for the POS/cashier page

import { getMenuItems }  from "../models/menuModel.js";
import { saveOrder }     from "../models/orderModel.js";

// ── STATE ──
let menuItems        = [];
let cart             = [];
let currentCategory  = "all";
let currentPayMethod = "cash";
let isPwdSenior      = false;
let enteredAmount    = "";
let expandedProductId = null;
let selectedVariant  = null;
let selectedTemp     = null;
let selectedAddons   = [];
let salesHistory     = [];
let dailyStats       = { orders: 0, totalSales: 0, discountsApplied: 0 };

// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  menuItems = await getMenuItems();
  renderProducts();
  updateCart();
  updateStats();

  document.getElementById("p")?.addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closePaymentModal();
      closeReceipt();
      if (expandedProductId !== null) {
        expandedProductId = null;
        selectedVariant = null;
        selectedTemp    = null;
        selectedAddons  = [];
        renderProducts(currentCategory);
      }
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
    html += items.map(p => buildProductCard(p, p.id === expandedProductId)).join("");
  }

  grid.innerHTML = html || '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--gray);">No items found</div>';
}

function buildProductCard(product, expanded = false) {
  const drinkAddons = menuItems.filter(i => i.subcategory === "Add-ons Drink");
  const foodAddons  = menuItems.filter(i => i.subcategory === "Add-ons Food");

  let expandedHtml = "";
  if (expanded) {
    if (product.hasVariant && product.variants) {
      expandedHtml += `<div class="expand-label">Select Variant</div><div class="variant-options">`;
      product.variants.forEach(v => {
        expandedHtml += `<button class="variant-btn" onclick="event.stopPropagation();window._selectVariant(${product.id},'${v.name}',${v.price},this)"><span>${v.name}</span><span>₱${v.price.toFixed(2)}</span></button>`;
      });
      expandedHtml += `</div>`;
    }

    if (product.hasTemp) {
      expandedHtml += `<div class="expand-label" style="margin-top:10px;">Temperature</div><div class="temperature-options">`;
      expandedHtml += `<button class="temp-btn" onclick="event.stopPropagation();window._selectTemp(${product.id},'Hot',this)">🔥 Hot</button>`;
      expandedHtml += `<button class="temp-btn" onclick="event.stopPropagation();window._selectTemp(${product.id},'Iced',this)">🧊 Iced</button>`;
      expandedHtml += `</div>`;
    }

    const drinkCats = ["coffee","signature","matcha","noncoffee"];
    expandedHtml += `<div class="addon-section"><div class="addon-section-label">➕ Add-ons <span style="font-weight:400;font-size:11px;">(optional)</span></div>`;

    if (drinkCats.includes(product.category)) {
      expandedHtml += `<div style="font-size:11px;color:var(--gray);margin-bottom:5px;font-weight:600;">Drink</div><div class="addon-options">`;
      drinkAddons.forEach(a => {
        expandedHtml += `<button class="addon-btn" onclick="event.stopPropagation();window._toggleAddon(${product.id},${a.id},this)"><span>${a.name}</span><span class="addon-price">+₱${a.price}</span></button>`;
      });
      expandedHtml += `</div>`;
    }

    if (["starters","ricemeals","pasta"].includes(product.category)) {
      const riceAddons = foodAddons.filter(a => ["Rice","Egg"].includes(a.name));
      expandedHtml += `<div style="font-size:11px;color:var(--gray);margin:5px 0;font-weight:600;">Food Add-ons</div><div class="addon-options">`;
      riceAddons.forEach(a => {
        expandedHtml += `<button class="addon-btn" onclick="event.stopPropagation();window._toggleAddon(${product.id},${a.id},this)"><span>${a.name}</span><span class="addon-price">+₱${a.price}</span></button>`;
      });
      expandedHtml += `</div>`;
    }

    expandedHtml += `</div>`;

    const canAdd = (!product.hasVariant || selectedVariant) && (!product.hasTemp || selectedTemp);
    expandedHtml += `<button class="add-to-order-btn" id="addBtn_${product.id}" onclick="event.stopPropagation();window._confirmAdd(${product.id})" ${canAdd ? "" : "disabled"}>Add to Order</button>`;
  }

  const badge = product.bestseller ? "BEST" : product.popular ? "POP" : "";
  return `<div class="product-card ${expanded ? "expanded" : ""}" onclick="window._expandProduct(${product.id})">
    <div class="product-header">
      <div class="product-name">${product.name}${product.note ? `<span style="font-size:10px;color:var(--gray);display:block;">${product.note}</span>` : ""}</div>
      ${badge ? `<span class="product-badge">${badge}</span>` : ""}
    </div>
    <div class="product-price">₱${product.price.toFixed(2)}</div>
    <div class="product-category">${product.subcategory}</div>
    ${expanded ? `<div class="expanded-body">${expandedHtml}</div>` : ""}
  </div>`;
}

// ── PRODUCT INTERACTIONS ──
window._expandProduct = function(id) {
  if (expandedProductId === id) {
    expandedProductId = null;
    selectedVariant   = null;
    selectedTemp      = null;
    selectedAddons    = [];
  } else {
    expandedProductId = id;
    selectedVariant   = null;
    selectedTemp      = null;
    selectedAddons    = [];
  }
  renderProducts(currentCategory);
};

window._selectVariant = function(productId, name, price, btn) {
  selectedVariant = { name, price };
  btn.closest(".variant-options").querySelectorAll(".variant-btn").forEach(b => {
    b.classList.toggle("selected", b === btn);
    b.classList.toggle("unselected", b !== btn);
  });
  updateAddBtn(productId);
};

window._selectTemp = function(productId, temp, btn) {
  selectedTemp = temp;
  btn.closest(".temperature-options").querySelectorAll(".temp-btn").forEach(b => {
    b.classList.toggle("selected", b === btn);
    b.classList.toggle("unselected", b !== btn);
  });
  updateAddBtn(productId);
};

window._toggleAddon = function(productId, addonId, btn) {
  const addon = menuItems.find(i => i.id === addonId);
  if (!addon) return;
  const idx = selectedAddons.findIndex(a => a.id === addonId);
  if (idx > -1) {
    selectedAddons.splice(idx, 1);
    btn.classList.remove("selected");
  } else {
    selectedAddons.push(addon);
    btn.classList.add("selected");
  }
};

function updateAddBtn(productId) {
  const product = menuItems.find(p => p.id === productId);
  if (!product) return;
  const canAdd = (!product.hasVariant || selectedVariant) && (!product.hasTemp || selectedTemp);
  const btn = document.getElementById(`addBtn_${productId}`);
  if (btn) btn.disabled = !canAdd;
}

window._confirmAdd = function(productId) {
  const product = menuItems.find(p => p.id === productId);
  if (!product) return;

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

  if (existingIdx > -1) {
    cart[existingIdx].quantity++;
  } else {
    cart.push({
      id: product.id, name: product.name, price, variant, temperature: temp,
      addons, quantity: 1
    });
  }

  expandedProductId = null;
  selectedVariant   = null;
  selectedTemp      = null;
  selectedAddons    = [];
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

  if (!cart.length) {
    cartEl.innerHTML = `<div class="empty-cart"><div class="empty-cart-icon">🛒</div><p>Your order is empty</p><p style="font-size:13px;margin-top:5px;">Click items from the menu to add</p></div>`;
    subtotalEl.textContent = "₱0.00";
    totalEl.textContent    = "₱0.00";
    checkoutBtn.disabled   = true;
    return;
  }

  const subtotal = cart.reduce((s, item) => {
    const addonTotal = (item.addons || []).reduce((a, x) => a + x.price, 0);
    return s + (item.price + addonTotal) * item.quantity;
  }, 0);

  const total = isPwdSenior ? subtotal * 0.8 : subtotal;

  cartEl.innerHTML = cart.map((item, idx) => {
    const addonTotal = (item.addons || []).reduce((a, x) => a + x.price, 0);
    const lineTotal  = (item.price + addonTotal) * item.quantity;
    return `<div class="cart-item">
      <div class="cart-item-details">
        <div class="cart-item-name">${item.name}</div>
        ${item.variant ? `<div class="cart-item-variant">${item.variant}</div>` : ""}
        ${item.temperature && item.temperature !== "N/A" ? `<div class="cart-item-variant">${item.temperature}</div>` : ""}
        ${(item.addons||[]).length ? `<div class="cart-item-addons">${item.addons.map(a=>`<span class="cart-addon-tag">+${a.name}</span>`).join("")}</div>` : ""}
        <div class="cart-item-price">₱${lineTotal.toFixed(2)}</div>
      </div>
      <div class="quantity-controls">
        <button class="qty-btn" onclick="window._updateQty(${idx},-1)">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button class="qty-btn" onclick="window._updateQty(${idx},1)">+</button>
      </div>
      <span class="remove-btn" onclick="window._removeItem(${idx})">✕</span>
    </div>`;
  }).join("");

  subtotalEl.textContent = `₱${subtotal.toFixed(2)}`;
  totalEl.textContent    = `₱${total.toFixed(2)}`;
  checkoutBtn.disabled   = false;

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

window.clearCart = function() {
  cart = [];
  updateCart();
};

window.toggleDiscount = function() {
  isPwdSenior = !isPwdSenior;
  document.getElementById("pwdSeniorCheck").checked = isPwdSenior;
  document.getElementById("discountToggle").classList.toggle("active", isPwdSenior);
  updateCart();
};

window.selectCategory = function(cat) {
  currentCategory = cat;
  document.querySelectorAll(".category-chip").forEach(c => c.classList.remove("active"));
  event.currentTarget.classList.add("active");
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
  document.querySelectorAll(".payment-method").forEach(el => el.classList.remove("active"));
  event.currentTarget.classList.add("active");
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
  const sale = await saveOrder(cart, total, subtotal, currentPayMethod, isPwdSenior, amountTendered);

  // Update local stats
  dailyStats.orders++;
  dailyStats.totalSales += total;
  if (isPwdSenior) dailyStats.discountsApplied++;
  salesHistory.push(sale);

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
  showToast("Payment successful! Thank you!", "success");
};

// ── RECEIPT ──
function generateReceipt(sale) {
  const receiptHTML = `<div class="receipt">
    <div class="receipt-header">
      <div class="receipt-title">Brother Bean Cafe</div>
      <div class="receipt-subtitle">Warmth in Every Cup</div>
      <div class="receipt-info">
        ${sale.timestamp}<br>
        Order #${sale.orderId?.slice(-6)}<br>
        Payment: ${sale.paymentMethod?.toUpperCase()}<br>
        ${sale.isPwdSenior ? "<strong>♿ PWD/Senior Citizen</strong><br>" : ""}
        Cashier: Staff
      </div>
    </div>
    <div class="receipt-items">
      ${(sale.items || []).map(item => {
        const addonTotal = (item.addons || []).reduce((s, a) => s + a.price, 0);
        const lineTotal  = (item.price + addonTotal) * item.quantity;
        return `<div class="receipt-item">
          <span class="receipt-item-name">
            ${item.name}
            ${item.variant ? `<div class="receipt-item-variant">${item.variant}</div>` : ""}
            ${item.temperature && item.temperature !== "N/A" ? `<div class="receipt-item-variant">${item.temperature}</div>` : ""}
            ${(item.addons || []).map(a => `<div class="receipt-item-variant">+ ${a.name} (₱${a.price})</div>`).join("")}
          </span>
          <span class="receipt-item-qty">x${item.quantity}</span>
          <span>₱${lineTotal.toFixed(2)}</span>
        </div>`;
      }).join("")}
    </div>
    <div class="receipt-totals">
      <div class="receipt-row"><span>Subtotal</span><span>₱${sale.subtotal?.toFixed(2)}</span></div>
      ${sale.isPwdSenior ? `<div class="receipt-row discount"><span>PWD/Senior Discount (20%)</span><span>-₱${sale.discountAmount?.toFixed(2)}</span></div>` : ""}
      <div class="receipt-row total"><span>TOTAL</span><span>₱${sale.total?.toFixed(2)}</span></div>
      <div class="receipt-row"><span>Amount Tendered</span><span>₱${sale.amountTendered?.toFixed(2)}</span></div>
      <div class="receipt-row"><span>Change</span><span>₱${sale.change?.toFixed(2)}</span></div>
    </div>
    <div class="receipt-footer">
      Thank you for visiting Brother Bean Cafe!<br>
      Please come again 🐻<br><br>
      VAT Registered TIN: 000-000-000-000<br>
      Permit No: 0000000
    </div>
  </div>`;
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
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:'Courier New',monospace; background:white; padding:20px; }
      .receipt { max-width:400px; margin:0 auto; }
      .receipt-header { text-align:center; margin-bottom:20px; border-bottom:2px dashed #ccc; padding-bottom:20px; }
      .receipt-title { font-size:22px; font-weight:bold; margin-bottom:5px; }
      .receipt-subtitle { font-size:13px; font-style:italic; color:#666; }
      .receipt-info { font-size:12px; color:#666; margin-top:10px; line-height:1.6; }
      .receipt-item { display:flex; justify-content:space-between; margin-bottom:10px; font-size:13px; }
      .receipt-item-name { flex:1; }
      .receipt-item-variant { font-size:11px; color:#888; font-style:italic; }
      .receipt-item-qty { margin:0 10px; color:#888; }
      .receipt-totals { border-top:2px dashed #ccc; margin-top:20px; padding-top:15px; }
      .receipt-row { display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px; }
      .receipt-row.discount { color:green; font-weight:bold; }
      .receipt-row.total { font-size:18px; font-weight:bold; margin-top:10px; padding-top:10px; border-top:2px solid #333; }
      .receipt-footer { text-align:center; margin-top:30px; font-size:11px; color:#888; line-height:1.6; }
      @media print { body { padding:0; } }
    </style></head><body>${receiptContent}</body></html>`);
  docRef.close();
  iframe.onload = () => { iframe.contentWindow.focus(); iframe.contentWindow.print(); };
};

// ── MISC ──
window.openDrawer = function() {
  alert(`💰 Cash Drawer\n\nCurrent Cash: ₱${dailyStats.totalSales.toFixed(2)}\nToday's Transactions: ${dailyStats.orders}\n\nDrawer is balanced ✅`);
};

function updateStats() {
  const el1 = document.getElementById("todayOrders");
  const el2 = document.getElementById("totalSales");
  const el3 = document.getElementById("activeDiscounts");
  if (el1) el1.textContent = dailyStats.orders;
  if (el2) el2.textContent = `₱${dailyStats.totalSales.toFixed(2)}`;
  if (el3) el3.textContent = dailyStats.discountsApplied;
}

function showToast(message, type = "success") {
  const toast    = document.getElementById("toast");
  const iconMap  = { success:"✅", error:"❌", warning:"⚠️" };
  toast.className = `toast ${type}`;
  document.getElementById("toastIcon").textContent    = iconMap[type];
  document.getElementById("toastMessage").textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}
