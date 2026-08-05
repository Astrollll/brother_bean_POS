import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ORDERS_COLLECTION = "orders";
const RESETS_COLLECTION = "resets";

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function resolveOrderDate(data) {
  if (data?.createdAt?.toDate) return data.createdAt.toDate();
  if (Number(data?.createdAtMs) > 0) return new Date(Number(data.createdAtMs));
  if (data?.timestamp?.toDate) return data.timestamp.toDate();
  return new Date();
}

// Archive all orders currently in the `orders` collection, each under its own
// date (resets/{yyyy-mm-dd}/orders), and delete them from `orders`.
// Every doc in `orders` is archived — not just today's range — so an offline
// order that is synced back AFTER its day's reset (syncQueuedOrders preserves
// the original createdAt) still gets archived on the next reset instead of
// being orphaned in `orders` forever.
export async function resetDay() {
  const now = new Date();
  const todayKey = toDateKey(now);

  const snap = await getDocs(collection(db, ORDERS_COLLECTION));

  if (snap.empty) return { success: false, reason: "No orders to archive." };

  const batch = writeBatch(db);
  const perDateCount = new Map();

  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const dateKey = toDateKey(resolveOrderDate(data));
    perDateCount.set(dateKey, (perDateCount.get(dateKey) || 0) + 1);
    batch.set(doc(db, RESETS_COLLECTION, dateKey, ORDERS_COLLECTION, d.id), data);
    batch.delete(doc(db, ORDERS_COLLECTION, d.id));
  });

  for (const [dateKey, count] of perDateCount.entries()) {
    batch.set(
      doc(db, RESETS_COLLECTION, dateKey),
      {
        resetAt: new Date(),
        totalOrders: count,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { success: true, totalArchived: snap.size, date: todayKey };
}
