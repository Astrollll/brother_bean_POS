import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, addDoc, doc, query, where, orderBy, Timestamp
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

// Fetch all orders with optional date range filter
// fromDate and toDate are ISO date strings like "2025-01-15" or null for no limit
export async function getAllOrders(fromDate = null, toDate = null) {
  let q;

  if (fromDate && toDate) {
    const start = Timestamp.fromDate(new Date(fromDate + "T00:00:00"));
    const end   = Timestamp.fromDate(new Date(toDate   + "T23:59:59"));
    q = query(
      collection(db, ORDERS_COLLECTION),
      where("createdAt", ">=", start),
      where("createdAt", "<=", end),
      orderBy("createdAt", "desc")
    );
  } else if (fromDate) {
    const start = Timestamp.fromDate(new Date(fromDate + "T00:00:00"));
    q = query(
      collection(db, ORDERS_COLLECTION),
      where("createdAt", ">=", start),
      orderBy("createdAt", "desc")
    );
  } else if (toDate) {
    const end = Timestamp.fromDate(new Date(toDate + "T23:59:59"));
    q = query(
      collection(db, ORDERS_COLLECTION),
      where("createdAt", "<=", end),
      orderBy("createdAt", "desc")
    );
  } else {
    // No date filter — fetch all orders
    q = query(
      collection(db, ORDERS_COLLECTION),
      orderBy("createdAt", "desc")
    );
  }

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