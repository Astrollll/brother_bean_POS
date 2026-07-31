import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, getDoc, setDoc, doc, query, where, Timestamp, deleteDoc, writeBatch, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getOrderOutbox, queueOrder, removeQueuedOrder } from "./storageModel.js";
import { deductInventoryQuantities } from "./inventoryModel.js";

const ORDERS_COLLECTION = "orders";
const RESETS_COLLECTION = "resets";

// Cache for resolved user profiles (uid -> fullName)
const _profileCache = new Map();

async function resolveCashierName(uid) {
  if (!uid) return null;
  if (_profileCache.has(uid)) return _profileCache.get(uid);
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const name = snap.data()?.fullName || snap.data()?.displayName || null;
      _profileCache.set(uid, name);
      return name;
    }
  } catch {}
  _profileCache.set(uid, null);
  return null;
}

async function applyCashierNames(orders) {
  const uids = [...new Set(orders.map(o => o.cashierUid).filter(Boolean))];
  await Promise.all(uids.map(resolveCashierName));
  return orders.map(order => {
    if (order.cashierUid && _profileCache.has(order.cashierUid)) {
      const currentName = _profileCache.get(order.cashierUid);
      if (currentName) return { ...order, cashierName: currentName };
    }
    return order;
  });
}
function isOnlineNow() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function orderSortKey(order) {
  const created = order?.createdAt?.toDate
    ? order.createdAt.toDate()
    : (order?.createdAtMs ? new Date(order.createdAtMs) : (order?.timestamp ? new Date(order.timestamp) : null));
  return created instanceof Date && !Number.isNaN(created.getTime()) ? created.getTime() : 0;
}

function mergeUniqueOrders(...groups) {
  const merged = [];
  const seen = new Set();

  for (const group of groups) {
    for (const order of Array.isArray(group) ? group : []) {
      const key = String(order?.orderId || order?.id || order?.queueId || "").trim() || `${String(order?.createdAtMs || order?.timestamp || order?.createdAt || Date.now())}:${String(order?.total || 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(order);
    }
  }

  return merged;
}

async function persistInventoryAfterSale(orderRef, orderData) {
  const inventoryAlerts = [];
  const inventoryDeductions = [];
  const inventorySkips = [];

  try {
    for (let i = 0; i < orderData.items.length; i++) {
      const item = orderData.items[i];
      if (item.recipe && item.recipe.length > 0) {
        const result = await deductInventoryQuantities(item.recipe, item.quantity, orderRef, i);
        if (result) {
          if (Array.isArray(result.alerts)) inventoryAlerts.push(...result.alerts);
          if (Array.isArray(result.audit)) inventoryDeductions.push(...result.audit);
          if (Array.isArray(result.skipDetails)) inventorySkips.push(...result.skipDetails);
        }
      }
    }
    return { alerts: inventoryAlerts, audit: inventoryDeductions, skipDetails: inventorySkips, failed: false };
  } catch (error) {
    console.warn("[Orders] Inventory deduction failed after sale.", error);
    try {
      await updateDoc(orderRef, { inventoryDeductionFailed: true });
    } catch {
      // best-effort
    }
    if (typeof window !== "undefined" && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent("bb:inventory:deduction-failed", {
        detail: { orderId: orderData.orderId },
      }));
    }
    return { alerts: inventoryAlerts, audit: inventoryDeductions, skipDetails: inventorySkips, failed: true };
  }
}

// Get today's date range as Timestamps
export function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    start: Timestamp.fromDate(start),
    end:   Timestamp.fromDate(end)
  };
}

// Fetch all of today's orders
export async function getTodayOrders() {
  const { start, end } = todayRange();
  const q = query(
    collection(db, ORDERS_COLLECTION),
    where("createdAt", ">=", start),
    where("createdAt", "<",  end)
  );
  const snap = await getDocs(q);
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return applyCashierNames(orders);
}

// Real-time listener for today's orders (cross-terminal sync)
export function watchTodayOrders(onChange, onError) {
  const { start, end } = todayRange();
  const q = query(
    collection(db, ORDERS_COLLECTION),
    where("createdAt", ">=", start),
    where("createdAt", "<",  end)
  );
  return onSnapshot(q, async (snap) => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const named = await applyCashierNames(orders);
    onChange(named);
  }, onError);
}

// Fetch all orders with optional date range filter (YYYY-MM-DD)
export async function getAllOrders(fromDate = null, toDate = null) {
  const snap = await getDocs(collection(db, ORDERS_COLLECTION));
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
  const to = toDate ? new Date(`${toDate}T23:59:59`) : null;

  const filtered = orders.filter(order => {
    const created = order.createdAt?.toDate
      ? order.createdAt.toDate()
      : (order.createdAtMs ? new Date(order.createdAtMs) : (order.timestamp ? new Date(order.timestamp) : null));

    if (!created) return true;
    if (from && created < from) return false;
    if (to && created > to) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    const aMs = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAtMs || 0);
    const bMs = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAtMs || 0);
    return bMs - aMs;
  });
}

async function getArchivedOrders() {
  const resetsSnap = await getDocs(collection(db, RESETS_COLLECTION));
  if (resetsSnap.empty) return [];

  const archivedGroups = await Promise.all(
    resetsSnap.docs.map(async (resetDoc) => {
      try {
        const archivedSnap = await getDocs(collection(db, RESETS_COLLECTION, resetDoc.id, ORDERS_COLLECTION));
        return archivedSnap.docs.map((d) => ({ id: d.id, archivedFrom: resetDoc.id, ...d.data() }));
      } catch (error) {
        console.warn(`[Orders] failed to read archived orders for ${resetDoc.id}`, error);
        return [];
      }
    })
  );

  return archivedGroups.flat();
}

// Fetch every sale the system knows about, including archived orders under resets/{date}/orders.
export async function getAllSalesOrders(fromDate = null, toDate = null) {
  try {
    const [activeOrders, archivedOrders] = await Promise.all([
      getAllOrders(),
      getArchivedOrders(),
    ]);
    const orders = mergeUniqueOrders(activeOrders, archivedOrders).sort((a, b) => orderSortKey(b) - orderSortKey(a));

    const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null;

    const filtered = orders.filter((order) => {
      const created = order.createdAt?.toDate
        ? order.createdAt.toDate()
        : (order.createdAtMs ? new Date(order.createdAtMs) : (order.timestamp ? new Date(order.timestamp) : null));

      if (!created) return true;
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });

    await repairOrderTimestamps(filtered);

    return applyCashierNames(filtered.sort((a, b) => {
      const aMs = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAtMs || 0);
      const bMs = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAtMs || 0);
      return bMs - aMs;
    }));
  } catch (error) {
    console.warn("[Orders] collectionGroup sales query failed; falling back to active orders.", error);
    return getAllOrders(fromDate, toDate);
  }
}

// Repair legacy/queued order docs whose createdAt/paidAt were stored as
// ISO strings (or are missing) so Timestamp range queries like
// getTodayOrders() can find them. Active collection orders only.
export async function repairOrderTimestamps(orders) {
  if (!Array.isArray(orders)) return { fixed: 0 };
  const broken = orders.filter((order) => {
    if (!order || order.archivedFrom) return false;
    const id = String(order.orderId || order.id || "");
    if (!id) return false;
    const createdAt = order.createdAt;
    const paidAt = order.paidAt;
    return (
      typeof createdAt === "string" ||
      typeof paidAt === "string" ||
      (!createdAt && Number(order.createdAtMs) > 0)
    );
  });
  if (!broken.length) return { fixed: 0 };

  let fixed = 0;
  await Promise.all(broken.map(async (order) => {
    const id = String(order.orderId || order.id || "");
    const patch = {};
    for (const key of ["createdAt", "paidAt"]) {
      const value = order[key];
      if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) patch[key] = Timestamp.fromDate(parsed);
      }
    }
    if (!patch.createdAt && Number(order.createdAtMs) > 0) {
      patch.createdAt = Timestamp.fromMillis(Number(order.createdAtMs));
    }
    if (!Object.keys(patch).length) return;
    try {
      await updateDoc(doc(db, ORDERS_COLLECTION, id), patch);
      fixed += 1;
    } catch (error) {
      console.warn(`[Orders] failed to repair createdAt for ${id}:`, error);
    }
  }));
  return { fixed };
}

export async function deleteOrder(orderId) {
  if (!orderId) return;
  await deleteDoc(doc(db, ORDERS_COLLECTION, String(orderId)));
}

export async function clearAllOrders() {
  const snap = await getDocs(collection(db, ORDERS_COLLECTION));
  if (!snap.size) return { deleted: 0 };

  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = writeBatch(db);
    const chunk = snap.docs.slice(i, i + 450);
    chunk.forEach((orderDoc) => {
      batch.delete(orderDoc.ref);
    });
    await batch.commit();
    deleted += chunk.length;
  }

  return { deleted };
}

// Save a completed order to Firestore
export async function saveOrder(cart, total, subtotal, paymentMethod, isPwdSenior, amountTendered, cashierUid = null, cashierName = "Staff", cashAmount = null, gcashAmount = null, options = {}) {
  const change = amountTendered - total;
  const orderId = crypto.randomUUID();
  const orderType = options.orderType || "regular";
  const note = options.note || "";

  const orderData = {
    orderId:        orderId,
    timestamp:      new Date().toLocaleString(),
    createdAtMs:    Date.now(),
    createdAt:      new Date(),
    cashierUid,
    cashierName,
    paymentMethod,
    orderType,
    isPwdSenior,
    subtotal,
    discountAmount: isPwdSenior ? subtotal * 0.2 : 0,
    total,
    amountTendered,
    change,
    ...(note ? { note } : {}),
    ...(paymentMethod === "split" ? { cashAmount: cashAmount || 0, gcashAmount: gcashAmount || 0 } : {}),
    items: cart.map(item => ({
      menuItemId:  item.id,
      name:        item.name,
      price:       item.price,
      quantity:    item.quantity,
      variant:     item.variant  || null,
      temperature: item.temperature || null,
      discountPercent: item.discountPercent || 0,
      addons:     (item.addons || []).map(a => ({ name: a.name, price: a.price })),
      recipe:     item.recipe || [],
    })),
    status: "paid",
    paidAt: new Date(),
  };

  const orderRef = doc(db, ORDERS_COLLECTION, orderId);

  if (!isOnlineNow()) {
    queueOrder(orderData);
    return {
      ...orderData,
      queued: true,
      queueError: "offline",
      inventoryAlerts: [],
      inventoryDeductions: [],
    };
  }

  try {
    await setDoc(orderRef, orderData);
  } catch (e) {
    queueOrder(orderData);
    return {
      ...orderData,
      queued: true,
      queueError: e?.message || "queued_offline",
      inventoryAlerts: [],
      inventoryDeductions: [],
    };
  }

  const inventoryResult = await persistInventoryAfterSale(orderRef, orderData);

  return {
    ...orderData,
    queued: false,
    inventoryAlerts: Array.isArray(inventoryResult?.alerts) ? inventoryResult.alerts : [],
    inventoryDeductions: Array.isArray(inventoryResult?.audit) ? inventoryResult.audit : [],
    inventorySkips: Array.isArray(inventoryResult?.skipDetails) ? inventoryResult.skipDetails : [],
    inventoryDeductionError: inventoryResult?.failed ? true : null,
  };
}

function normalizePayloadDates(payload) {
  const copy = { ...(payload || {}) };
  for (const key of ["createdAt", "paidAt"]) {
    const value = copy[key];
    if (!value) continue;
    if (typeof value.toDate === "function") continue; // already a Timestamp
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) copy[key] = Timestamp.fromDate(parsed);
    } else if (value instanceof Date) {
      copy[key] = Timestamp.fromDate(value);
    }
  }
  if (!copy.createdAt && Number(copy.createdAtMs) > 0) {
    copy.createdAt = Timestamp.fromMillis(Number(copy.createdAtMs));
  }
  return copy;
}

export async function syncQueuedOrders() {
  const outbox = getOrderOutbox();
  if (!outbox.length) return { synced: 0, pending: 0 };

  let synced = 0;
  let syncedAlerts = 0;
  let deductionFailures = 0;
  for (const item of outbox) {
    try {
      const payload = normalizePayloadDates(item.payload);
      const payloadOrderId = String(payload.orderId || item.id || Date.now());
      const orderRef = doc(db, ORDERS_COLLECTION, payloadOrderId);
      const payloadItems = Array.isArray(payload.items) ? payload.items : [];
      const hasRecipeItems = payloadItems.some((soldItem) => Array.isArray(soldItem?.recipe) && soldItem.recipe.length > 0);

      // Idempotency guard: if a previous sync already recorded deductions on
      // this order (or partially progressed), resume from where it stopped
      // instead of re-deducting. setDoc below would overwrite the audit trail,
      // so the existing doc must be inspected BEFORE it.
      let existing = {};
      try {
        const existingSnap = await getDoc(orderRef);
        if (existingSnap.exists()) existing = existingSnap.data() || {};
      } catch {
        // Treat as fresh; a later retry will re-check once reads succeed.
      }

      const existingAudit = Array.isArray(existing.inventoryDeductions) ? existing.inventoryDeductions : [];
      const progress = Number(existing.inventoryDeductionProgress || 0);
      // progress === 0 with an audit trail means the order was deducted under
      // the pre-progress code (audit was only written after every item), so
      // treat it as fully done. Otherwise require progress to cover all lines.
      const alreadyDone = existingAudit.length > 0 && (progress === 0 || progress >= payloadItems.length);

      if (hasRecipeItems && !alreadyDone && existingAudit.length === 0) {
        await setDoc(orderRef, payload);
      } else if (!hasRecipeItems) {
        await setDoc(orderRef, payload);
      }
      // If existingAudit is non-empty but progress is partial, the doc already
      // holds the audit for earlier lines — do NOT overwrite it; resume below.

      if (hasRecipeItems && !alreadyDone) {
        let itemFailed = false;
        for (let i = progress; i < payloadItems.length; i++) {
          const soldItem = payloadItems[i];
          if (!Array.isArray(soldItem?.recipe) || soldItem.recipe.length === 0) continue;
          try {
            const result = await deductInventoryQuantities(soldItem.recipe, soldItem.quantity || 1, orderRef, i);
            if (Array.isArray(result?.alerts)) syncedAlerts += result.alerts.length;
          } catch {
            itemFailed = true;
            break;
          }
        }

        if (itemFailed) {
          deductionFailures += 1;
          try {
            await updateDoc(orderRef, { inventoryDeductionFailed: true });
          } catch {
            // best-effort; the item stays queued for the next sync attempt
          }
          continue; // keep this item in the outbox for retry
        }
      }

      removeQueuedOrder(item.id);
      synced += 1;
    } catch {
      // Keep unsynced item in queue and continue.
    }
  }

  return { synced, pending: getOrderOutbox().length, syncedAlerts, deductionFailures };
}

// Return queued orders from local outbox as order-like objects
export function getQueuedOrders() {
  try {
    const outbox = getOrderOutbox();
    return (Array.isArray(outbox) ? outbox : []).map((entry) => {
      const payload = entry.payload || {};
      return {
        ...payload,
        queued: true,
        queueId: entry.id,
      };
    });
  } catch (e) {
    return [];
  }
}

export function getPendingOrderCount() {
  return getOrderOutbox().length;
}

export async function retryFailedInventoryDeduction(orderId) {
  if (!orderId) return false;
  const orderRef = doc(db, ORDERS_COLLECTION, String(orderId));
  const snap = await getDoc(orderRef);
  if (!snap.exists()) return false;
  const data = snap.data() || {};
  if (!data.inventoryDeductionFailed) return false;

  const items = Array.isArray(data.items) ? data.items : [];
  const progress = Number(data.inventoryDeductionProgress || 0);
  let allSucceeded = true;

  for (let i = progress; i < items.length; i++) {
    const item = items[i];
    if (item.recipe && item.recipe.length > 0) {
      try {
        await deductInventoryQuantities(item.recipe, item.quantity, orderRef, i);
      } catch {
        allSucceeded = false;
        break;
      }
    }
  }

  if (allSucceeded) {
    // Each line's transaction already appended its alerts/audit/skips to the
    // order doc atomically, so only the failure flag needs clearing here.
    await updateDoc(orderRef, {
      inventoryDeductionFailed: false,
    });
    return true;
  }
  return false;
}
