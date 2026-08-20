import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, writeBatch, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ORDERS_COLLECTION = "orders";
const RESETS_COLLECTION = "resets";
const KITCHEN_COLLECTION = "kitchenOrders";
const BATCH_OP_LIMIT = 400; // safety margin under Firestore's 500-write batch cap

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function resolveOrderDate(data) {
  if (data?.createdAt?.toDate) return data.createdAt.toDate();
  if (Number(data?.createdAtMs) > 0) return new Date(Number(data.createdAtMs));
  if (data?.timestamp?.toDate) return data.timestamp.toDate();
  return new Date();
}

// Archive orders in the live `orders` collection, each under its own
// date (resets/{yyyy-mm-dd}/orders), and delete them from `orders`.
//
// Pass `{ onlyBeforeMs }` to limit the archive to orders created strictly
// before that timestamp (e.g. the start of today). This lets the app roll
// over previous days automatically without ever touching today's live orders.
//
// Every doc that matches is archived — not just today's range — so an offline
// order that is synced back AFTER its day's reset (syncQueuedOrders preserves
// the original createdAt) still gets archived on the next reset instead of
// being orphaned in `orders` forever.
//
// Pending orders (status "pending") are archived as "done" so they never stack
// up as Pending on the admin transactions page when staff forget to mark them
// prepared. Their kitchen queue entries are removed afterwards (best-effort).
export async function resetDay({ onlyBeforeMs = null } = {}) {
  const now = new Date();
  const todayKey = toDateKey(now);

  const snap = await getDocs(collection(db, ORDERS_COLLECTION));

  let docs = snap.docs;
  if (onlyBeforeMs != null) {
    docs = snap.docs.filter((d) => {
      const data = d.data() || {};
      const dated = data?.createdAt?.toDate || Number(data?.createdAtMs) > 0 || data?.timestamp?.toDate;
      // Undated legacy orders carry no usable timestamp, so they clearly were
      // not created today (today's orders always have one) — archive them.
      if (!dated) return true;
      return resolveOrderDate(data).getTime() < onlyBeforeMs;
    });
  }

  if (!docs.length) return { success: false, reason: "No orders to archive." };

  const perDateCount = new Map();
  const kitchenIds = [];
  let autoCompleted = 0;

  // Firestore caps a single write batch at 500 operations. Each archived order
  // costs 2 ops (set + delete), so large collections must be chunked.
  const batches = [];
  let batch = writeBatch(db);
  let ops = 0;
  const flush = () => {
    batches.push(batch);
    batch = writeBatch(db);
    ops = 0;
  };

  docs.forEach((d) => {
    const data = d.data() || {};
    const dateKey = toDateKey(resolveOrderDate(data));
    perDateCount.set(dateKey, (perDateCount.get(dateKey) || 0) + 1);

    let archivedData = data;
    if (String(data.status || "").toLowerCase() === "pending") {
      archivedData = {
        ...data,
        status: "done",
        preparedAtMs: now.getTime(),
        preparedBy: "Auto (end of day)",
      };
      autoCompleted += 1;
      kitchenIds.push(d.id);
    }

    batch.set(doc(db, RESETS_COLLECTION, dateKey, ORDERS_COLLECTION, d.id), archivedData);
    batch.delete(doc(db, ORDERS_COLLECTION, d.id));
    ops += 2;
    if (ops >= BATCH_OP_LIMIT) flush();
  });

  for (const [dateKey, count] of perDateCount.entries()) {
    batch.set(
      doc(db, RESETS_COLLECTION, dateKey),
      {
        resetAt: now,
        totalOrders: count,
      },
      { merge: true }
    );
    ops += 1;
    if (ops >= BATCH_OP_LIMIT) flush();
  }

  if (ops > 0) batches.push(batch);
  for (const b of batches) await b.commit();

  // Clear the kitchen queue for auto-completed pending orders so the POS
  // pending list empties at the end of the day. Best-effort: a failure here
  // must never abort the archive.
  if (kitchenIds.length) {
    try {
      const kitchenBatches = [];
      let kb = writeBatch(db);
      let kops = 0;
      for (const id of kitchenIds) {
        kb.delete(doc(db, KITCHEN_COLLECTION, id));
        kops += 1;
        if (kops >= BATCH_OP_LIMIT) {
          kitchenBatches.push(kb);
          kb = writeBatch(db);
          kops = 0;
        }
      }
      if (kops > 0) kitchenBatches.push(kb);
      for (const b of kitchenBatches) await b.commit();
    } catch (error) {
      console.warn("[Reset] Kitchen queue cleanup skipped (best-effort).", error);
    }
  }

  return { success: true, totalArchived: docs.length, date: todayKey, autoCompleted };
}
