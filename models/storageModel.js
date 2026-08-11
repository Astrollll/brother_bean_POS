// ── STORAGE MODEL ──
// Firestore-first persistence with localStorage fallback for offline resilience

import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, getDoc, doc, setDoc, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const STORAGE_KEYS = {
  salesHistory:    "brotherBean_salesHistory",
  dailyStats:      "brotherBean_dailyStats",
  lastResetDate:   "brotherBean_lastResetDate",
  orderOutbox:     "brotherBean_orderOutbox",
  kitchenOrders:   "brotherBean_kitchenOrders",
  drawerLogOutbox: "brotherBean_drawerLogOutbox",
  terminalId:      "brotherBean_terminalId"
};

const KITCHEN_COLLECTION = "kitchenOrders";
const STATS_COLLECTION = "dailyStats";
const DRAWER_LOG_COLLECTION = "drawerLogs";

// Cap the kitchen-order write: if connectivity drops suddenly the Firestore
// SDK can hang retrying, which would otherwise block completePayment behind
// the receipt. The local cache fallback below is authoritative enough.
const KITCHEN_WRITE_TIMEOUT_MS = readTimeoutParam("bbKitchenWriteTimeoutMs", 4000);

// Cap the drawer-log write for the same reason — recording a cash in/out must
// never hang the cashier behind the drawer popup.
const DRAWER_WRITE_TIMEOUT_MS = readTimeoutParam("bbDrawerWriteTimeoutMs", 4000);

function readTimeoutParam(name, fallback) {
  try {
    if (typeof location !== "undefined") {
      const value = Number(new URLSearchParams(location.search).get(name));
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch {}
  return fallback;
}

function withWriteTimeout(promise, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// Merge order lists de-duplicated by order id (Firestore doc id is the
// orderId, so queued and synced copies of the same sale collapse to one).
function mergeOrderLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const order of Array.isArray(list) ? list : []) {
      if (!order) continue;
      const key = String(order?.orderId || order?.id || "");
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(order);
    }
  }
  return merged;
}

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
  if (firestore) {
    // The shared mirror only provides sales-derived stats. The drawer state
    // (opening float, cash in/out, manual count) comes from the shared
    // drawerLogs collection — the store runs ONE physical drawer that all
    // terminals read and write. Local storage is only the fallback while
    // offline or before any drawer activity has synced.
    let localDrawer = {};
    let localHistory = [];
    try {
      const raw = localStorage.getItem(localStatsKey());
      if (raw) localDrawer = JSON.parse(raw) || {};
    } catch {}
    try {
      const raw = localStorage.getItem(localHistoryKey());
      if (raw) localHistory = JSON.parse(raw) || [];
    } catch {}
    let shared = null;
    try {
      shared = await getSharedDrawerState(todayKey());
    } catch {}
    const drawer = shared || localDrawer;
    // Merge local history into the mirror's instead of letting the mirror
    // replace it, so orders queued while offline (never mirrored) are not
    // lost from the drawer on the next load.
    return {
      salesHistory: mergeOrderLists(localHistory, firestore.salesHistory),
      dailyStats: {
        ...firestore.dailyStats,
        openingFloat: Number(drawer.openingFloat || 0),
        cashIn: Number(drawer.cashIn || 0),
        cashOut: Number(drawer.cashOut || 0),
        actualCash: drawer.actualCash ?? null,
        cashOnHandAuto: drawer.cashOnHandAuto !== false,
        ledgerEntries: Array.isArray(drawer.ledgerEntries) ? drawer.ledgerEntries : [],
      },
    };
  }

  // Fall back to local cache
  try {
    const history = localStorage.getItem(localHistoryKey());
    const stats   = localStorage.getItem(localStatsKey());

    return {
      salesHistory: history ? JSON.parse(history) : [],
      dailyStats:   stats ? JSON.parse(stats) : { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, gcashReceived: 0, openingFloat: 0, cashIn: 0, cashOut: 0, actualCash: null, cashOnHandAuto: true, ledgerEntries: [] },
    };
  } catch (e) {
    console.error("Storage load failed:", e);
    return { salesHistory: [], dailyStats: { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, gcashReceived: 0, openingFloat: 0, cashIn: 0, cashOut: 0, actualCash: null, cashOnHandAuto: true, ledgerEntries: [] } };
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
        dailyStats: data?.dailyStats || { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, gcashReceived: 0, openingFloat: 0, cashIn: 0, cashOut: 0, actualCash: null, cashOnHandAuto: true, ledgerEntries: [] },
      };
    }
  } catch (error) {
    console.warn("[Storage] Firestore stats read failed.", error);
  }
  return null;
}

// Read a specific day's shared stats doc (id = "YYYY-MM-DD") from Firestore.
// Returns { date, dailyStats, updatedAtMs } or null when the day has no record.
export async function getDailyStatsByDate(dateKey) {
  try {
    const id = dateKey || todayKey();
    const snap = await getDoc(doc(db, STATS_COLLECTION, id));
    if (snap.exists()) {
      return { date: id, ...snap.data() };
    }
  } catch (error) {
    console.warn("[Storage] Firestore daily stats read failed.", error);
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

// Remove a sale from today's local saved history, the offline outbox, and the
// shared Firestore stats mirror, so a transaction deleted on the admin
// Transactions page stops being counted in Sales Analytics. Returns the number
// of local copies removed.
export function purgeSavedSale(orderId) {
  const target = String(orderId || "");
  if (!target) return 0;

  let removed = 0;

  try {
    const key = localHistoryKey();
    const raw = localStorage.getItem(key);
    if (raw) {
      const history = JSON.parse(raw);
      const next = history.filter((s) => {
        const id = String(s?.orderId || s?.id || "");
        const keep = id !== target;
        if (!keep) removed += 1;
        return keep;
      });
      if (next.length !== history.length) localStorage.setItem(key, JSON.stringify(next));
    }
  } catch (e) {
    console.warn("[Storage] failed to purge saved sale history", e);
  }

  try {
    const outbox = getOrderOutbox().filter((o) => {
      const id = String(o?.payload?.orderId || o?.payload?.id || "");
      const keep = id !== target;
      if (!keep) removed += 1;
      return keep;
    });
    localStorage.setItem(STORAGE_KEYS.orderOutbox, JSON.stringify(outbox));
  } catch (e) {
    console.warn("[Storage] failed to purge queued order", e);
  }

  // Refresh the shared Firestore stats mirror so a later loadFromStorage()
  // does not merge the deleted order back into local history.
  if (removed > 0) {
    try {
      const history = JSON.parse(localStorage.getItem(localHistoryKey()) || "[]");
      let dailyStats = {};
      try {
        const statsRaw = localStorage.getItem(localStatsKey());
        dailyStats = statsRaw ? JSON.parse(statsRaw) : {};
      } catch {}
      persistStatsToFirestore(history, dailyStats).catch(() => {});
    } catch (e) {
      console.warn("[Storage] failed to refresh Firestore stats mirror after purge", e);
    }
  }

  return removed;
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

  // Write to Firestore first (bounded so a dropped connection can't hang
  // the caller behind the receipt flow)
  try {
    await withWriteTimeout(setDoc(doc(db, KITCHEN_COLLECTION, orderId), kitchenOrder), "kitchen_write", KITCHEN_WRITE_TIMEOUT_MS);
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

// ── Drawer Log (append-only, per-entry Firestore docs) ──
// Each cash in / cash out / starting-cash event is written as its OWN doc in
// the drawerLogs collection (doc id = the entry id). Two consequences:
//   1. Terminals never overwrite each other — the admin Logs page aggregates
//      every terminal's entries instead of reading a shared last-writer-wins
//      doc.
//   2. Offline entries go to a localStorage outbox and are retried later, so
//      nothing is lost when the POS records a drawer event offline.
// A stable per-device terminal id distinguishes which POS made each entry.

let cachedTerminalId = "";

export function getTerminalId() {
  if (cachedTerminalId) return cachedTerminalId;
  try {
    let id = localStorage.getItem(STORAGE_KEYS.terminalId);
    if (!id) {
      id = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : `term_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE_KEYS.terminalId, id);
    }
    cachedTerminalId = id;
    return id;
  } catch {
    return "terminal";
  }
}

export function getDrawerLogOutbox() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.drawerLogOutbox);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function queueDrawerLogEntry(payload) {
  const outbox = getDrawerLogOutbox();
  const key = String(payload?.id || "");
  if (key && outbox.some((o) => String(o.id) === key)) return outbox.length;
  outbox.push({ id: key || `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), payload });
  try {
    localStorage.setItem(STORAGE_KEYS.drawerLogOutbox, JSON.stringify(outbox));
  } catch {}
  return outbox.length;
}

export function removeDrawerLogEntry(queueId) {
  const outbox = getDrawerLogOutbox().filter((o) => String(o.id) !== String(queueId));
  try {
    localStorage.setItem(STORAGE_KEYS.drawerLogOutbox, JSON.stringify(outbox));
  } catch {}
  return outbox.length;
}

// Write one drawer-log entry to Firestore. On failure it is queued locally
// (idempotent retry — the doc id is the entry id). Returns true when synced.
export async function recordDrawerLogEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const id = String(entry.id || `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const payload = {
    id,
    terminalId: String(entry.terminalId || getTerminalId()),
    date: entry.date || todayKey(),
    kind: entry.kind === "out" ? "out" : entry.kind === "float" ? "float" : "in",
    amount: Math.round((Number(entry.amount) || 0) * 100) / 100,
    note: entry.note ? String(entry.note).slice(0, 80) : "",
    t: Number(entry.t) || Date.now(),
    createdAt: Number(entry.createdAt) || Date.now(),
  };

  try {
    await withWriteTimeout(
      setDoc(doc(db, DRAWER_LOG_COLLECTION, id), payload),
      "drawer_log_write",
      DRAWER_WRITE_TIMEOUT_MS
    );
    return true;
  } catch (error) {
    console.warn("[Storage] Drawer log write failed; queued for retry.", error);
    queueDrawerLogEntry(payload);
    return false;
  }
}

// Flush pending drawer-log entries to Firestore (called on POS load and when
// the terminal comes back online).
export async function syncDrawerLogOutbox() {
  const outbox = getDrawerLogOutbox();
  let synced = 0;
  for (const item of outbox) {
    const payload = item?.payload || {};
    const id = String(payload.id || item.id || "");
    if (!id) continue;
    try {
      await withWriteTimeout(
        setDoc(doc(db, DRAWER_LOG_COLLECTION, id), payload),
        "drawer_log_sync",
        DRAWER_WRITE_TIMEOUT_MS
      );
      removeDrawerLogEntry(item.id);
      synced += 1;
    } catch {
      // Keep unsynced entry in the queue and try again next time.
    }
  }
  return { synced, pending: getDrawerLogOutbox().length };
}

// Read every drawer-log entry for a day. Sorted by time client-side (avoids a
// composite Firestore index). Returns [] on failure so the admin page can fall
// back to the legacy dailyStats doc.
export async function getDrawerLogsByDate(dateKey) {
  try {
    const id = dateKey || todayKey();
    const snap = await getDocs(
      query(collection(db, DRAWER_LOG_COLLECTION), where("date", "==", id))
    );
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
  } catch (error) {
    console.warn("[Storage] Firestore drawer log read failed.", error);
    return [];
  }
}

// Derive the drawer state for a day from the shared drawerLogs collection.
// All terminals contribute to the same (single physical) drawer, so the POS
// drawer is shared across terminals. Returns null when the day has no
// records (or Firestore is unreachable) so callers fall back to local state.
export async function getSharedDrawerState(dateKey) {
  try {
    const entries = await getDrawerLogsByDate(dateKey);
    if (!Array.isArray(entries) || entries.length === 0) return null;
    let openingFloat = 0;
    let cashIn = 0;
    let cashOut = 0;
    let actualCash = null;
    const ledgerEntries = [];
    for (const e of entries) {
      const kind = e?.kind;
      const amount = Math.round((Number(e?.amount) || 0) * 100) / 100;
      if (kind === "float") openingFloat = amount;
      else if (kind === "in") cashIn += amount;
      else if (kind === "out") cashOut += amount;
      else if (kind === "count") actualCash = amount;
      ledgerEntries.push({
        id: String(e?.id || ""),
        t: Number(e?.t) || 0,
        kind: kind || "in",
        amount,
        ...(e?.note ? { note: String(e.note) } : {}),
        ...(e?.terminalId ? { terminalId: String(e.terminalId) } : {}),
      });
    }
    return {
      openingFloat: Math.round(openingFloat * 100) / 100,
      cashIn: Math.round(cashIn * 100) / 100,
      cashOut: Math.round(cashOut * 100) / 100,
      actualCash,
      cashOnHandAuto: actualCash === null,
      ledgerEntries,
    };
  } catch (error) {
    console.warn("[Storage] Shared drawer state read failed.", error);
    return null;
  }
}
