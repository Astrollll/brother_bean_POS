import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defaultMenu, generateDefaultMenuItems } from "./defaultSeedData.js";

const MENU_COLLECTION = "menu";

// Fetch all menu items from Firestore
export async function getMenuItems() {
  const snap = await getDocs(collection(db, MENU_COLLECTION));
  return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
}

// Watch menu items in Firestore and invoke callback on every update
export function watchMenuItems(onChange, onError) {
  const queryRef = collection(db, MENU_COLLECTION);
  return onSnapshot(queryRef, (snap) => {
    const items = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    onChange(items);
  }, onError);
}

// Save a menu item (add or update)
export async function saveMenuItem(item) {
  if (!item.id) {
    item.id = crypto.randomUUID();
  }
  const ref = doc(db, MENU_COLLECTION, String(item.id));
  await setDoc(ref, item);
}

// Delete a menu item
export async function deleteMenuItem(id) {
  await deleteDoc(doc(db, MENU_COLLECTION, String(id)));
}

// Delete all menu items
export async function clearMenuItems() {
  const snap = await getDocs(collection(db, MENU_COLLECTION));
  const deletes = snap.docs.map((d) => deleteDoc(doc(db, MENU_COLLECTION, d.id)));
  await Promise.all(deletes);
}

// Seed menu to Firestore (run once to populate)
export async function seedMenu(menuItems) {
  for (const item of menuItems) {
    await saveMenuItem(item);
  }
}

export { defaultMenu, generateDefaultMenuItems };
