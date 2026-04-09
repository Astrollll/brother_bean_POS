import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, addDoc, doc, query, where, Timestamp, deleteDoc, writeBatch, updateDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getOrderOutbox, queueOrder, removeQueuedOrder } from "./storageModel.js";
import { deductInventoryQuantities } from "./inventoryModel.js";

const ORDERS_COLLECTION = "orders";

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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
export async function saveOrder(cart, total, subtotal, paymentMethod, isPwdSenior, amountTendered, cashierUid = null) {
  const change = amountTendered - total;

  const orderData = {
    orderId:        Date.now().toString(),
    timestamp:      new Date().toLocaleString(),
    createdAtMs:    Date.now(),
    createdAt:      new Date(),
    cashierUid,
    paymentMethod,
    isPwdSenior,
    subtotal,
    discountAmount: isPwdSenior ? subtotal * 0.2 : 0,
    total,
    amountTendered,
    change,
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
  };

  let orderRef = null;
  try {
    orderRef = await addDoc(collection(db, ORDERS_COLLECTION), orderData);
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

  const inventoryAlerts = [];
  const inventoryDeductions = [];
  let inventoryDeductionError = null;

  try {
    // Deduct inventory items based on recipe usage.
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
  } catch (deductionError) {
    inventoryDeductionError = deductionError?.message || "inventory_deduction_failed";
  }

  return {
    ...orderData,
    queued: false,
    inventoryAlerts,
    inventoryDeductions,
    inventoryDeductionError,
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
      const orderRef = await addDoc(collection(db, ORDERS_COLLECTION), item.payload);

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

export function getPendingOrderCount() {
  return getOrderOutbox().length;
}
