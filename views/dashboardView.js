// ── DASHBOARD VIEW ──
// Responsible for rendering all dashboard UI — no data fetching here

export function renderStats({ totalSales, totalOrders, bestSeller, bestSellerCount, staffOnDuty, totalStaff }) {
  document.getElementById("statSales").textContent       = `₱${totalSales.toFixed(2)}`;
  document.getElementById("statOrders").textContent      = totalOrders;
  document.getElementById("statBestSeller").textContent  = bestSeller || "—";
  document.getElementById("bestSellerCount").textContent = bestSellerCount > 0 ? `${bestSellerCount} sold` : "—";
  document.getElementById("statStaff").textContent       = staffOnDuty;
  document.getElementById("staffTotal").textContent      = `of ${totalStaff}`;
}

export function renderRecentOrders(orders) {
  const el = document.getElementById("recentOrdersList");
  if (!orders.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:10px 0;">No orders yet today.</div>';
    return;
  }

  const sorted = [...orders]
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 5);

  el.innerHTML = sorted.map(o => {
    const itemNames = (o.items || [])
      .map(i => `${i.name}${i.quantity > 1 ? " ×" + i.quantity : ""}`)
      .join(", ");
    const time = o.createdAt?.toDate
      ? o.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : o.timestamp || "";
    const shortId = (o.orderId || "").slice(-6);

    return `<div class="order-row">
      <div>
        <div class="order-num">#${shortId}</div>
        <div class="order-items">${itemNames}</div>
        <div class="order-type">${(o.paymentMethod || "").toUpperCase()} · ${time}</div>
      </div>
      <div class="order-right">
        <div class="order-amt">₱${(o.total || 0).toFixed(2)}</div>
        <span class="badge b-green">Done</span>
      </div>
    </div>`;
  }).join("");
}

export function renderTopItems(orders, menuItems) {
  const el = document.getElementById("topItemsList");

  // Build sold map
  const soldMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      if (!soldMap[item.name]) soldMap[item.name] = { qty: 0, price: item.price };
      soldMap[item.name].qty += item.quantity || 1;
    });
  });

  const sorted = Object.entries(soldMap)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  if (!sorted.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:10px 0;">No sales yet today.</div>';
    return;
  }

  el.innerHTML = sorted.map(([name, data], i) => {
    const rev = data.qty * data.price;
    return `<div class="top-item-row">
      <div class="top-rank ${i === 0 ? "gold" : ""}">${i + 1}</div>
      <div class="top-item-name">${name}</div>
      <div class="top-item-sold">${data.qty} sold</div>
      <div class="top-item-rev">₱${rev.toFixed(2)}</div>
    </div>`;
  }).join("");
}

export function renderStaffOnDuty(onDuty) {
  const el = document.getElementById("dashStaffList");
  if (!onDuty.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:10px 0;">No staff scheduled today.</div>';
    return;
  }
  el.innerHTML = onDuty.map(s => {
    const initials = s.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    return `<div class="staff-row">
      <div class="avatar">${initials}</div>
      <div class="staff-info">
        <div class="staff-name">${s.name}</div>
        <div class="staff-role">${s.role}</div>
      </div>
      <div class="staff-shift">${s.shift}</div>
    </div>`;
  }).join("");
}
