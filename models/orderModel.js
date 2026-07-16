import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, getDoc, setDoc, doc, query, where, Timestamp, deleteDoc, writeBatch, updateDoc
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

  try {
    for (const item of orderData.items) {
      if (item.recipe && item.recipe.length > 0) {
        const result = await deductInventoryQuantities(item.recipe, item.quantity);
        if (Array.isArray(result?.alerts) && result.alerts.length > 0) {
          inventoryAlerts.push(...result.alerts);
        }
        if (Array.isArray(result?.audit) && result.audit.length > 0) {
          inventoryDeductions.push(...result.audit);
        }
      }
    }

    if (inventoryAlerts.length || inventoryDeductions.length) {
      await updateDoc(orderRef, {
        inventoryAlerts,
        inventoryDeductions,
      });
    }
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
export async function saveOrder(cart, total, subtotal, paymentMethod, isPwdSenior, amountTendered, cashierUid = null, cashierName = "Staff", cashAmount = null, gcashAmount = null) {
  const change = amountTendered - total;
  const orderId = crypto.randomUUID();

  const orderData = {
    orderId:        orderId,
    timestamp:      new Date().toLocaleString(),
    createdAtMs:    Date.now(),
    createdAt:      new Date(),
    cashierUid,
    cashierName,
    paymentMethod,
    isPwdSenior,
    subtotal,
    discountAmount: isPwdSenior ? subtotal * 0.2 : 0,
    total,
    amountTendered,
    change,
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

  void persistInventoryAfterSale(orderRef, orderData);

  return {
    ...orderData,
    queued: false,
    inventoryAlerts: [],
    inventoryDeductions: [],
    inventoryDeductionError: null,
  };
}

export async function syncQueuedOrders() {
  const outbox = getOrderOutbox();
  if (!outbox.length) return { synced: 0, pending: 0 };

  let synced = 0;
  let syncedAlerts = 0;
  let deductionFailures = 0;
  for (const item of outbox) {
    try {
      const payloadOrderId = String(item.payload?.orderId || item.id || Date.now());
      const orderRef = doc(db, ORDERS_COLLECTION, payloadOrderId);
      await setDoc(orderRef, item.payload);

      try {
        const payloadItems = Array.isArray(item.payload?.items) ? item.payload.items : [];
        const inventoryAlerts = [];
        const inventoryDeductions = [];
        for (const soldItem of payloadItems) {
          if (Array.isArray(soldItem.recipe) && soldItem.recipe.length > 0) {
            const result = await deductInventoryQuantities(soldItem.recipe, soldItem.quantity || 1);
            if (Array.isArray(result?.alerts)) {
              inventoryAlerts.push(...result.alerts);
              syncedAlerts += result.alerts.length;
            }
            if (Array.isArray(result?.audit) && result.audit.length > 0) {
              inventoryDeductions.push(...result.audit);
            }
          }
        }

        if (inventoryAlerts.length || inventoryDeductions.length) {
          await updateDoc(orderRef, {
            inventoryAlerts,
            inventoryDeductions,
          });
        }
      } catch {
        deductionFailures += 1;
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
  const inventoryAlerts = [];
  const inventoryDeductions = [];
  let allSucceeded = true;

  for (const item of items) {
    if (item.recipe && item.recipe.length > 0) {
      try {
        const result = await deductInventoryQuantities(item.recipe, item.quantity);
        if (Array.isArray(result?.alerts) && result.alerts.length > 0) {
          inventoryAlerts.push(...result.alerts);
        }
        if (Array.isArray(result?.audit) && result.audit.length > 0) {
          inventoryDeductions.push(...result.audit);
        }
      } catch {
        allSucceeded = false;
      }
    }
  }

  if (allSucceeded) {
    await updateDoc(orderRef, {
      inventoryDeductionFailed: false,
      inventoryAlerts,
      inventoryDeductions,
    });
    return true;
  }
  return false;
}
