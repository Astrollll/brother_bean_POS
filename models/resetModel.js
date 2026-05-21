import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, query, where, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { todayRange } from "./orderModel.js";

const ORDERS_COLLECTION = "orders";
const RESETS_COLLECTION = "resets";

// Archive today's orders to resets/{date}/orders and delete from orders
export async function resetDay() {
  const todayKey = new Date().toISOString().split("T")[0];
  const { start, end } = todayRange();

  const q = query(
    collection(db, ORDERS_COLLECTION),
    where("createdAt", ">=", start),
    where("createdAt", "<",  end)
  );
  const snap = await getDocs(q);

  if (snap.empty) return { success: false, reason: "No orders today to archive." };

  const batch = writeBatch(db);

  snap.docs.forEach(d => {
    const archiveRef = doc(db, RESETS_COLLECTION, todayKey, ORDERS_COLLECTION, d.id);
    batch.set(archiveRef, d.data());
    batch.delete(doc(db, ORDERS_COLLECTION, d.id));
  });

  batch.set(doc(db, RESETS_COLLECTION, todayKey), {
    resetAt:     new Date(),
    totalOrders: snap.size
  });

  await batch.commit();
  return { success: true, totalArchived: snap.size, date: todayKey };
}
