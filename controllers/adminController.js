// ── ADMIN CONTROLLER ──
import { getTodayOrders }                            from "../models/orderModel.js";
import { getAllOrders }                              from "../models/orderModel.js";
import { getMenuItems }                              from "../models/menuModel.js";
import { getAllStaff, addStaff, removeStaff,
         getSchedule, saveSchedule, getTodayOnDuty } from "../models/staffModel.js";
import { resetDay }                                  from "../models/resetModel.js";
import { renderStats, renderRecentOrders,
         renderTopItems, renderStaffOnDuty }         from "../views/dashboardView.js";
import { renderAdminMenu }                           from "../views/menuView.js";
import { renderStaffList, renderScheduleEditor,
         readScheduleFromDOM }                       from "../views/staffView.js";

// ── TRANSACTIONS STATE ──
let allTx      = [];
let filteredTx = [];
let currentTx  = null;

// ── DASHBOARD ──
export async function loadDashboard() {
  const [orders, { onDuty, total }] = await Promise.all([
    getTodayOrders(),
    getTodayOnDuty()
  ]);

  const totalSales  = orders.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = orders.length;

  const soldMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      soldMap[item.name] = (soldMap[item.name] || 0) + (item.quantity || 1);
    });
  });
  const [bestSeller, bestSellerCount] = Object.entries(soldMap)
    .sort((a, b) => b[1] - a[1])[0] || ["—", 0];

  renderStats({ totalSales, totalOrders, bestSeller, bestSellerCount, staffOnDuty: onDuty.length, totalStaff: total });
  renderRecentOrders(orders);
  renderTopItems(orders);
  renderStaffOnDuty(onDuty);
}

// ── MENU ──
export async function loadMenu() {
  const [menuItems, orders] = await Promise.all([getMenuItems(), getTodayOrders()]);
  const soldMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      soldMap[item.name] = (soldMap[item.name] || 0) + (item.quantity || 1);
    });
  });
  renderAdminMenu(menuItems, soldMap);
}

// ── STAFF ──
export async function loadStaff() {
  const [staff, schedule] = await Promise.all([getAllStaff(), getSchedule()]);
  renderStaffList(staff, handleRemoveStaff);
  renderScheduleEditor(staff, schedule);
}

async function handleRemoveStaff(id) {
  if (!confirm("Remove this staff member?")) return;
  await removeStaff(id);
  await loadStaff();
}

export function showAddStaffForm() {
  document.getElementById("addStaffForm").style.display = "block";
}

export async function handleAddStaff() {
  const name = document.getElementById("newStaffName").value.trim();
  const role = document.getElementById("newStaffRole").value.trim();
  if (!name || !role) { alert("Please enter name and role."); return; }
  await addStaff(name, role);
  document.getElementById("newStaffName").value = "";
  document.getElementById("newStaffRole").value = "";
  document.getElementById("addStaffForm").style.display = "none";
  await loadStaff();
}

export async function handleSaveSchedule() {
  const scheduleData = readScheduleFromDOM();
  await saveSchedule(scheduleData);
  alert("Schedule saved! ✅");
  await loadDashboard();
}

// ── RESET DAY ──
export async function handleResetDay() {
  if (!confirm("Reset today? All orders will be archived and cleared.")) return;
  const result = await resetDay();
  if (!result.success) { alert(result.reason); return; }
  alert(`Day reset! ${result.totalArchived} orders archived to resets/${result.date} ✅`);
  await loadDashboard();
}

// ── TRANSACTIONS ──
export async function loadTransactions() {
  const wrap = document.getElementById("txTableWrap");
  wrap.innerHTML = `<div class="tx-loading"><div class="tx-spinner"></div><p>Loading transactions…</p></div>`;

  try {
    const from = document.getElementById("txFrom").value || null;
    const to   = document.getElementById("txTo").value   || null;
    allTx = await getAllOrders(from, to);
    applyTxFilters();
  } catch (err) {
    wrap.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px 0;">Failed to load: ${err.message}</div>`;
  }
}

function applyTxFiltersInternal() {
  const search  = (document.getElementById("txSearch").value || "").toLowerCase();
  const payType = document.getElementById("txPay").value;
  const fromVal = document.getElementById("txFrom").value; // "YYYY-MM-DD"
  const toVal   = document.getElementById("txTo").value;   // "YYYY-MM-DD"

  // Build date boundaries in local time
  const fromDate = fromVal ? new Date(fromVal + "T00:00:00") : null;
  const toDate   = toVal   ? new Date(toVal   + "T23:59:59") : null;

  filteredTx = allTx.filter(tx => {
    // ── Date filter ──
    if (fromDate || toDate) {
      let txDate = null;
      if (tx.createdAt?.toDate) {
        txDate = tx.createdAt.toDate();
      } else if (tx.timestamp) {
        txDate = new Date(tx.timestamp);
      }
      if (txDate) {
        if (fromDate && txDate < fromDate) return false;
        if (toDate   && txDate > toDate)   return false;
      }
    }

    // ── Payment filter ──
    if (payType && payType !== "All" && tx.paymentMethod !== payType) return false;

    // ── Search filter ──
    if (search) {
      const id    = (tx.orderId || tx.id || "").toLowerCase();
      const items = (tx.items || []).map(i => i.name.toLowerCase()).join(" ");
      const pay   = (tx.paymentMethod || "").toLowerCase();
      if (!id.includes(search) && !items.includes(search) && !pay.includes(search)) return false;
    }
    return true;
  });

  renderTxStats();
  renderTxTable();
}

function renderTxStats() {
  const revenue   = filteredTx.reduce((s, t) => s + (t.total || 0), 0);
  const cashCount = filteredTx.filter(t => t.paymentMethod === "cash").length;
  const gcashCount= filteredTx.filter(t => t.paymentMethod === "gcash").length;

  document.getElementById("txStatOrders").textContent  = filteredTx.length;
  document.getElementById("txStatRevenue").textContent = `₱${revenue.toFixed(2)}`;
  document.getElementById("txStatCash").textContent    = cashCount;
  document.getElementById("txStatGcash").textContent   = gcashCount;
  document.getElementById("txResultCount").textContent = `${filteredTx.length} result${filteredTx.length !== 1 ? "s" : ""}`;
}

function renderTxTable() {
  const wrap = document.getElementById("txTableWrap");

  if (!filteredTx.length) {
    wrap.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:20px 0;text-align:center;">No transactions found for this period.</div>`;
    return;
  }

  // Sort newest first
  const sorted = [...filteredTx].sort((a, b) =>
    (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
  );

  wrap.innerHTML = `<div class="tbl-wrap"><table>
    <tr>
      <th>Order #</th>
      <th>Items</th>
      <th>Date & Time</th>
      <th>Payment</th>
      <th>Discount</th>
      <th style="text-align:right;">Total</th>
      <th></th>
    </tr>
    ${sorted.map(tx => {
      const shortId   = (tx.orderId || tx.id || "").slice(-6);
      const itemNames = (tx.items || [])
        .map(i => `${i.name}${i.quantity > 1 ? " ×" + i.quantity : ""}`)
        .join(", ");
      const timeStr = tx.createdAt?.toDate
        ? tx.createdAt.toDate().toLocaleString("en-PH", { month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit" })
        : tx.timestamp || "—";
      const payBadge = tx.paymentMethod === "gcash"
        ? `<span class="badge b-blue">GCash</span>`
        : `<span class="badge b-gray">Cash</span>`;
      const discBadge = tx.isPwdSenior
        ? `<span class="badge b-green">♿ PWD</span>`
        : `<span style="color:var(--muted);font-size:12px;">—</span>`;
      const txId = tx.id || tx.orderId;

      return `<tr class="tx-table-row" onclick="window.openTxDetail('${txId}')">
        <td><span style="font-weight:500;font-family:'DM Mono',monospace,sans-serif;">#${shortId}</span></td>
        <td><span class="tx-items-cell">${itemNames}</span></td>
        <td style="font-size:12px;color:var(--muted);">${timeStr}</td>
        <td>${payBadge}</td>
        <td>${discBadge}</td>
        <td style="text-align:right;font-weight:500;">₱${(tx.total || 0).toFixed(2)}</td>
        <td style="color:var(--muted);font-size:16px;padding-left:8px;">›</td>
      </tr>`;
    }).join("")}
  </table></div>`;
}

// ── TX DETAIL MODAL ──
function openTxDetailInternal(txId) {
  const tx = filteredTx.find(t => (t.id || t.orderId) === txId)
          || allTx.find(t => (t.id || t.orderId) === txId);
  if (!tx) return;

  currentTx = tx;
  const shortId = (tx.orderId || tx.id || "").slice(-6);
  document.getElementById("txDetailTitle").textContent = `Order #${shortId}`;
  document.getElementById("txDetailBody").innerHTML = buildTxDetailHTML(tx);
  document.getElementById("txDetailOverlay").classList.add("active");
}

function buildTxDetailHTML(tx) {
  const timeStr = tx.createdAt?.toDate
    ? tx.createdAt.toDate().toLocaleString("en-PH", { dateStyle:"full", timeStyle:"short" })
    : tx.timestamp || "—";

  const itemRows = (tx.items || []).map(item => {
    const addonTotal = (item.addons || []).reduce((s, a) => s + a.price, 0);
    const lineTotal  = (item.price + addonTotal) * item.quantity;
    return `<div class="tx-detail-item">
      <div class="tx-detail-item-info">
        <div class="tx-detail-item-name">${item.name}</div>
        ${item.variant     ? `<div class="tx-detail-item-meta">${item.variant}</div>` : ""}
        ${item.temperature && item.temperature !== "N/A" ? `<div class="tx-detail-item-meta">${item.temperature}</div>` : ""}
        ${(item.addons || []).map(a => `<div class="tx-detail-item-meta">+ ${a.name} (₱${a.price})</div>`).join("")}
      </div>
      <div class="tx-detail-item-right">
        <span class="tx-detail-item-qty">×${item.quantity}</span>
        <span class="tx-detail-item-price">₱${lineTotal.toFixed(2)}</span>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="tx-detail-meta">
      <div class="tx-detail-meta-row"><span>Date & Time</span><span>${timeStr}</span></div>
      <div class="tx-detail-meta-row"><span>Payment</span><span>${tx.paymentMethod === "gcash" ? "📱 GCash" : "💵 Cash"}</span></div>
      ${tx.isPwdSenior ? `<div class="tx-detail-meta-row"><span>Discount</span><span style="color:var(--green);">♿ PWD / Senior (20%)</span></div>` : ""}
    </div>

    <div class="tx-detail-section-label">Items Ordered</div>
    <div class="tx-detail-items">${itemRows}</div>

    <div class="tx-detail-totals">
      <div class="tx-detail-total-row"><span>Subtotal</span><span>₱${(tx.subtotal || 0).toFixed(2)}</span></div>
      ${tx.isPwdSenior ? `<div class="tx-detail-total-row" style="color:var(--green);font-weight:500;"><span>Discount (20%)</span><span>−₱${(tx.discountAmount || 0).toFixed(2)}</span></div>` : ""}
      <div class="tx-detail-total-row tx-detail-grand"><span>Total</span><span>₱${(tx.total || 0).toFixed(2)}</span></div>
      <div class="tx-detail-total-row" style="margin-top:8px;"><span>Amount Tendered</span><span>₱${(tx.amountTendered || 0).toFixed(2)}</span></div>
      <div class="tx-detail-total-row"><span>Change</span><span>₱${Math.max(0, (tx.amountTendered || 0) - (tx.total || 0)).toFixed(2)}</span></div>
    </div>`;
}

function closeTxDetailInternal() {
  document.getElementById("txDetailOverlay").classList.remove("active");
  currentTx = null;
}

function reprintTxInternal() {
  if (!currentTx) return;
  const content = document.getElementById("txDetailBody").innerHTML;
  const shortId = (currentTx.orderId || currentTx.id || "").slice(-6);
  doPrint(shortId, currentTx, content);
}

function doPrint(shortId, tx, detailHTML) {
  const existing = document.getElementById("adminPrintFrame");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "adminPrintFrame";
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;";
  document.body.appendChild(iframe);

  const timeStr = tx.createdAt?.toDate
    ? tx.createdAt.toDate().toLocaleString()
    : tx.timestamp || "";

  const itemRows = (tx.items || []).map(item => {
    const addonTotal = (item.addons || []).reduce((s, a) => s + a.price, 0);
    const lineTotal  = (item.price + addonTotal) * item.quantity;
    return `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
      <div>
        <div style="font-weight:bold;">${item.name}</div>
        ${item.variant ? `<div style="font-size:11px;color:#888;font-style:italic;">${item.variant}</div>` : ""}
        ${item.temperature && item.temperature !== "N/A" ? `<div style="font-size:11px;color:#888;font-style:italic;">${item.temperature}</div>` : ""}
        ${(item.addons || []).map(a => `<div style="font-size:11px;color:#888;font-style:italic;">+ ${a.name} (₱${a.price})</div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;align-items:flex-start;flex-shrink:0;">
        <span style="color:#888;">×${item.quantity}</span>
        <span style="font-weight:700;">₱${lineTotal.toFixed(2)}</span>
      </div>
    </div>`;
  }).join("");

  const docRef = (iframe.contentDocument || iframe.contentWindow.document);
  docRef.open();
  docRef.write(`<html><head><title>Receipt #${shortId}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Courier New',monospace;padding:20px;background:white;}
    .receipt{max-width:380px;margin:0 auto;}
    @media print{body{padding:0;}}
  </style></head><body><div class="receipt">
    <div style="text-align:center;margin-bottom:16px;border-bottom:2px dashed #ccc;padding-bottom:16px;">
      <div style="font-size:28px;margin-bottom:4px;">🐻</div>
      <div style="font-size:20px;font-weight:bold;margin-bottom:3px;">Brother Bean Cafe</div>
      <div style="font-size:12px;font-style:italic;color:#666;margin-bottom:10px;">Warmth in Every Cup</div>
      <div style="border-top:1px dashed #ccc;margin:8px 0;"></div>
      <div style="font-size:12px;color:#444;">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span>Date</span><span>${timeStr}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span>Order #</span><span>#${shortId}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span>Payment</span><span>${(tx.paymentMethod || "").toUpperCase()}</span></div>
        ${tx.isPwdSenior ? `<div style="margin-top:6px;font-weight:bold;color:#555;">♿ PWD / Senior Citizen</div>` : ""}
      </div>
    </div>
    <div style="margin:12px 0;">${itemRows}</div>
    <div style="border-top:2px dashed #ccc;padding-top:10px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px;"><span>Subtotal</span><span>₱${(tx.subtotal||0).toFixed(2)}</span></div>
      ${tx.isPwdSenior ? `<div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px;color:green;font-weight:bold;"><span>PWD/Senior Discount (20%)</span><span>−₱${(tx.discountAmount||0).toFixed(2)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:bold;margin-top:6px;padding-top:6px;border-top:2px solid #333;"><span>TOTAL</span><span>₱${(tx.total||0).toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px;"><span>Tendered</span><span>₱${(tx.amountTendered||0).toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;"><span>Change</span><span>₱${Math.max(0,(tx.amountTendered||0)-(tx.total||0)).toFixed(2)}</span></div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:11px;color:#888;border-top:1px dashed #ccc;padding-top:14px;line-height:1.8;">
      <div style="font-weight:bold;color:#555;margin-bottom:2px;">Thank you for visiting Brother Bean Cafe!</div>
      <div>Please come again 🐻</div>
      <div style="margin-top:8px;font-size:10px;">VAT Registered TIN: 000-000-000-000<br>Permit No: 0000000</div>
    </div>
  </div></body></html>`);
  docRef.close();
  iframe.onload = () => { iframe.contentWindow.focus(); iframe.contentWindow.print(); };
}

// ── QUICK DATE FILTERS ──
function setActiveQuickBtn(activeId) {
  ["qbtn-today","qbtn-week","qbtn-month","qbtn-all"].forEach(id => {
    document.getElementById(id)?.classList.remove("tx-quick-active");
  });
  document.getElementById(activeId)?.classList.add("tx-quick-active");
}

function setTxTodayInternal(btn) {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("txFrom").value = today;
  document.getElementById("txTo").value   = today;
  setActiveQuickBtn("qbtn-today");
  loadTransactions();
}

function setTxWeekInternal(btn) {
  const now    = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  document.getElementById("txFrom").value = monday.toISOString().split("T")[0];
  document.getElementById("txTo").value   = now.toISOString().split("T")[0];
  setActiveQuickBtn("qbtn-week");
  loadTransactions();
}

function setTxMonthInternal(btn) {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  document.getElementById("txFrom").value = first.toISOString().split("T")[0];
  document.getElementById("txTo").value   = now.toISOString().split("T")[0];
  setActiveQuickBtn("qbtn-month");
  loadTransactions();
}

function setTxAllInternal(btn) {
  document.getElementById("txFrom").value = "";
  document.getElementById("txTo").value   = "";
  setActiveQuickBtn("qbtn-all");
  loadTransactions();
}

function clearTxFiltersInternal() {
  document.getElementById("txFrom").value   = "";
  document.getElementById("txTo").value     = "";
  document.getElementById("txPay").value    = "";
  document.getElementById("txSearch").value = "";
  setActiveQuickBtn("qbtn-all");
  loadTransactions();
}

// ── NAV ──
export function showPage(id, el, title) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  if (el) el.classList.add("active");
  document.getElementById("topbar-page").textContent = title;

  if (id === "dashboard")    loadDashboard();
  if (id === "menu")         loadMenu();
  if (id === "staff")        loadStaff();
  if (id === "transactions") {
    // Default to today on first open
    const from = document.getElementById("txFrom").value;
    if (!from) setTxTodayInternal();
    else loadTransactions();
  }
}

// ── AUTH ──
export function login() {
  const u   = document.getElementById("u").value.trim();
  const p   = document.getElementById("p").value;
  const err = document.getElementById("err");

  if (u === "admin" && p === "admin123") {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app").style.display = "flex";
    err.textContent = "";

    // Set live date in topbar
    document.getElementById("topbar-date").textContent =
      new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

    loadDashboard();
  } else {
    err.textContent = "Incorrect username or password.";
    document.getElementById("p").value = "";
  }
}

export function logout() {
  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("u").value = "";
  document.getElementById("p").value = "";
  document.getElementById("err").textContent = "";
}

// ── INIT ──
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("p").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });

  // Escape closes tx detail modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeTxDetailInternal();
  });

  // Click outside tx detail modal to close
  document.getElementById("txDetailOverlay")?.addEventListener("click", e => {
    if (e.target === document.getElementById("txDetailOverlay")) closeTxDetailInternal();
  });

  // Expose to HTML onclick
  window.login           = login;
  window.logout          = logout;
  window.showPage        = showPage;
  window.showAddStaff    = showAddStaffForm;
  window.addStaff        = handleAddStaff;
  window.saveSchedule    = handleSaveSchedule;
  window.resetDay        = handleResetDay;

  window.applyTxFilters     = applyTxFiltersInternal;
  window.openTxDetail       = openTxDetailInternal;
  window.closeTxDetailBtn   = closeTxDetailInternal;
  window.reprintTx          = reprintTxInternal;
  window.clearTxFilters     = clearTxFiltersInternal;
  window.setTxToday         = setTxTodayInternal;
  window.setTxWeek          = setTxWeekInternal;
  window.setTxMonth         = setTxMonthInternal;
  window.setTxAll           = setTxAllInternal;
});