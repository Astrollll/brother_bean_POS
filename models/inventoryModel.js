import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const INVENTORY_COLLECTION = "inventory";

export async function getInventoryItems() {
  const snap = await getDocs(collection(db, INVENTORY_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export async function saveInventoryItem(item) {
  const itemId = String(item.id || crypto.randomUUID());
  const payload = {
    id: itemId,
    name: String(item.name || "").trim(),
    category: String(item.category || "General").trim(),
    unit: String(item.unit || "pcs").trim(),
    quantity: Number(item.quantity || 0),
    reorderLevel: Number(item.reorderLevel || 0),
    updatedAtMs: Date.now(),
  };

  await setDoc(doc(db, INVENTORY_COLLECTION, itemId), payload);
  return payload;
}

export async function deleteInventoryItem(id) {
  await deleteDoc(doc(db, INVENTORY_COLLECTION, String(id)));
}
