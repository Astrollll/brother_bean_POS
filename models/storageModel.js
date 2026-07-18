// ── STORAGE MODEL ──
// Firestore-first persistence with localStorage fallback for offline resilience

import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const STORAGE_KEYS = {
  salesHistory:  "brotherBean_salesHistory",
  dailyStats:    "brotherBean_dailyStats",
  lastResetDate: "brotherBean_lastResetDate",
  orderOutbox:   "brotherBean_orderOutbox",
  kitchenOrders: "brotherBean_kitchenOrders"
};

const KITCHEN_COLLECTION = "kitchenOrders";
const STATS_COLLECTION = "dailyStats";

// ── Daily Stats ──

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localStatsKey() {
  return `${STORAGE_KEYS.dailyStats}_${todayKey()}`;
}

function localHistoryKey() {
  return `${STORAGE_KEYS.salesHistory}_${todayKey()}`;
}

export function saveToStorage(salesHistory, dailyStats) {
  try {
    localStorage.setItem(localHistoryKey(), JSON.stringify(salesHistory));
    localStorage.setItem(localStatsKey(), JSON.stringify(dailyStats));
    localStorage.setItem(STORAGE_KEYS.lastResetDate, new Date().toDateString());
  } catch (e) {
    console.error("Local storage save failed:", e);
  }

  // Persist to Firestore so other terminals can read today's stats
  persistStatsToFirestore(salesHistory, dailyStats).catch(() => {});

  return true;
}

async function persistStatsToFirestore(salesHistory, dailyStats) {
  try {
    const statsId = todayKey();
    await setDoc(doc(db, STATS_COLLECTION, statsId), {
      date: statsId,
      salesHistory,
      dailyStats,
      updatedAtMs: Date.now(),
    });
  } catch (error) {
    console.warn("[Storage] Firestore stats write failed.", error);
  }
}

export async function loadFromStorage() {
  // Try Firestore first for cross-terminal consistency
  const firestore = await loadStatsFromFirestore();
  if (firestore) return firestore;

  // Fall back to local cache
  try {
    const history = localStorage.getItem(localHistoryKey());
    const stats   = localStorage.getItem(localStatsKey());

    return {
      salesHistory: history ? JSON.parse(history) : [],
      dailyStats:   stats ? JSON.parse(stats) : { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0 },
    };
  } catch (e) {
    console.error("Storage load failed:", e);
    return { salesHistory: [], dailyStats: { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0 } };
  }
}

export async function loadStatsFromFirestore() {
  try {
    const statsId = todayKey();
    const snap = await getDocs(
      query(collection(db, STATS_COLLECTION), where("date", "==", statsId))
    );
    if (!snap.empty) {
      const data = snap.docs[0].data();
      return {
        salesHistory: Array.isArray(data?.salesHistory) ? data.salesHistory : [],
        dailyStats: data?.dailyStats || { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0 },
      };
    }
  } catch (error) {
    console.warn("[Storage] Firestore stats read failed.", error);
  }
  return null;
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
  try {
    const raw = localStorage.getItem(localHistoryKey());
    return raw ? JSON.parse(raw).length : 0;
  } catch {
    return 0;
  }
}

// ── Order Outbox (offline queue — localStorage only) ──

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

// ── Kitchen Orders (Firestore-first with local fallback) ──

function readLocalKitchenOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.kitchenOrders);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalKitchenOrders(orders) {
  try {
    localStorage.setItem(STORAGE_KEYS.kitchenOrders, JSON.stringify(orders));
  } catch {}
}

export async function getKitchenOrders() {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const snap = await getDocs(
      query(
        collection(db, KITCHEN_COLLECTION),
        where("createdAt", ">=", startOfDay.getTime())
      )
    );
    const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (remote.length > 0) {
      writeLocalKitchenOrders(remote);
      return remote;
    }
  } catch (error) {
    console.warn("[Storage] Firestore kitchen read failed, using local.", error);
  }
  return readLocalKitchenOrders();
}

export async function saveKitchenOrder(orderData) {
  const orderId = String(orderData.orderId || orderData.id || `k_${Date.now()}`);
  const createdAt = orderData.createdAt
    ? (new Date(orderData.createdAt).getTime ? new Date(orderData.createdAt).getTime() : orderData.createdAt)
    : Date.now();

  const kitchenOrder = { id: orderId, createdAt, payload: orderData };

  // Write to Firestore first
  try {
    await setDoc(doc(db, KITCHEN_COLLECTION, orderId), kitchenOrder);
  } catch (error) {
    console.warn("[Storage] Firestore kitchen write failed.", error);
  }

  // Also update local cache
  const orders = readLocalKitchenOrders();
  const filtered = orders.filter((o) => o.id !== kitchenOrder.id);
  filtered.unshift(kitchenOrder);
  writeLocalKitchenOrders(filtered);

  return filtered.length;
}

export async function removeKitchenOrder(orderId) {
  // Remove from Firestore
  try {
    await deleteDoc(doc(db, KITCHEN_COLLECTION, String(orderId)));
  } catch (error) {
    console.warn("[Storage] Firestore kitchen delete failed.", error);
  }

  // Also update local cache
  const orders = readLocalKitchenOrders().filter((o) => String(o.id) !== String(orderId));
  writeLocalKitchenOrders(orders);

  return orders.length;
}

export function getSavedSalesHistory() {
  try {
    const raw = localStorage.getItem(localHistoryKey());
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('[Storage] failed to read saved sales history', err);
    return [];
  }
}
