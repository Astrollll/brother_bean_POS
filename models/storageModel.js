// ── LOCAL STORAGE MODEL ──
// Hybrid LocalStorage + Firebase backup

const STORAGE_KEYS = {
  salesHistory:  "brotherBean_salesHistory",
  dailyStats:    "brotherBean_dailyStats", 
  lastResetDate: "brotherBean_lastResetDate",
  orderOutbox:   "brotherBean_orderOutbox",
  kitchenOrders: "brotherBean_kitchenOrders"
};

export function saveToStorage(salesHistory, dailyStats) {
  try {
    localStorage.setItem(STORAGE_KEYS.salesHistory, JSON.stringify(salesHistory));
    localStorage.setItem(STORAGE_KEYS.dailyStats, JSON.stringify(dailyStats));
    localStorage.setItem(STORAGE_KEYS.lastResetDate, new Date().toDateString());
    return true;
  } catch (e) {
    console.error("Storage save failed:", e);
    return false;
  }
}

export function loadFromStorage() {
  try {
    const history = localStorage.getItem(STORAGE_KEYS.salesHistory);
    const stats   = localStorage.getItem(STORAGE_KEYS.dailyStats);
    
    return {
      salesHistory: history ? JSON.parse(history) : [],
      dailyStats:   stats ? JSON.parse(stats) : { orders: 0, totalSales: 0, discountsApplied: 0 },
    };
  } catch (e) {
    console.error("Storage load failed:", e);
    return { salesHistory: [], dailyStats: { orders: 0, totalSales: 0, discountsApplied: 0 } };
  }
}

export function checkDailyReset() {
  const lastReset = localStorage.getItem(STORAGE_KEYS.lastResetDate);
  const today = new Date().toDateString();
  if (lastReset !== today) {
    return true; // needs reset
  }
  return false;
}

export function getStorageCount() {
  return localStorage.getItem(STORAGE_KEYS.salesHistory) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.salesHistory)).length : 0;
}

export function getOrderOutbox() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.orderOutbox);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function queueOrder(orderData) {
  const outbox = getOrderOutbox();
  outbox.push({
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    payload: orderData,
  });
  localStorage.setItem(STORAGE_KEYS.orderOutbox, JSON.stringify(outbox));
  return outbox.length;
}

export function removeQueuedOrder(queueId) {
  const outbox = getOrderOutbox().filter((o) => o.id !== queueId);
  localStorage.setItem(STORAGE_KEYS.orderOutbox, JSON.stringify(outbox));
  return outbox.length;
}

export function getKitchenOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.kitchenOrders);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveKitchenOrder(orderData) {
  const orders = getKitchenOrders();
  const kitchenOrder = {
    id: String(orderData.orderId || orderData.id || `k_${Date.now()}`),
    createdAt: orderData.createdAt ? (new Date(orderData.createdAt).getTime ? new Date(orderData.createdAt).getTime() : orderData.createdAt) : Date.now(),
    payload: orderData,
  };
  const filtered = orders.filter((o) => o.id !== kitchenOrder.id);
  filtered.unshift(kitchenOrder);
  localStorage.setItem(STORAGE_KEYS.kitchenOrders, JSON.stringify(filtered));
  return filtered.length;
}

export function removeKitchenOrder(orderId) {
  const orders = getKitchenOrders().filter((o) => String(o.id) !== String(orderId));
  localStorage.setItem(STORAGE_KEYS.kitchenOrders, JSON.stringify(orders));
  return orders.length;
}


