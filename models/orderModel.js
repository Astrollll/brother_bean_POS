import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, addDoc, doc, query, where, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

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

// Save a completed order to Firestore
export async function saveOrder(cart, total, subtotal, paymentMethod, isPwdSenior, amountTendered) {
  const change = amountTendered - total;

  const orderData = {
    orderId:        Date.now().toString(),
    timestamp:      new Date().toLocaleString(),
    createdAt:      new Date(),
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
      addons:     (item.addons || []).map(a => ({ name: a.name, price: a.price })),
    })),
  };

  await addDoc(collection(db, ORDERS_COLLECTION), orderData);
  return orderData;
}
