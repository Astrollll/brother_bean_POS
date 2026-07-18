import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defaultMenu, generateDefaultMenuItems } from "./defaultSeedData.js";

const MENU_COLLECTION = "menu";
const LOCAL_CACHE_KEY = "bb_menu_local_cache";

function readLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalCache(items) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(items));
  } catch {}
}

// Fetch all menu items from Firestore, fallback to local cache
export async function getMenuItems() {
  try {
    const snap = await getDocs(collection(db, MENU_COLLECTION));
    const items = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    writeLocalCache(items);
    return items;
  } catch (error) {
    console.warn("[Menu] Firestore read failed, using local cache.", error);
    return readLocalCache();
  }
}

// Watch menu items in Firestore and invoke callback on every update
export function watchMenuItems(onChange, onError) {
  const queryRef = collection(db, MENU_COLLECTION);
  return onSnapshot(queryRef, (snap) => {
    const items = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    writeLocalCache(items);
    onChange(items);
  }, onError);
}

// Save a menu item (add or update) — Firestore first, local cache fallback
export async function saveMenuItem(item) {
  if (!item.id) {
    item.id = crypto.randomUUID();
  }
  const ref = doc(db, MENU_COLLECTION, String(item.id));
  try {
    await setDoc(ref, item);
  } catch (error) {
    console.warn("[Menu] Firestore write failed, saving locally.", error);
  }
  // Always update local cache
  const local = readLocalCache();
  const idx = local.findIndex((m) => String(m.id) === String(item.id));
  if (idx >= 0) local[idx] = item; else local.push(item);
  writeLocalCache(local);
}

// Delete a menu item — Firestore first, local cache fallback
export async function deleteMenuItem(id) {
  try {
    await deleteDoc(doc(db, MENU_COLLECTION, String(id)));
  } catch (error) {
    console.warn("[Menu] Firestore delete failed.", error);
  }
  const local = readLocalCache().filter((m) => String(m.id) !== String(id));
  writeLocalCache(local);
}

// Delete all menu items
export async function clearMenuItems() {
  try {
    const snap = await getDocs(collection(db, MENU_COLLECTION));
    const deletes = snap.docs.map((d) => deleteDoc(doc(db, MENU_COLLECTION, d.id)));
    await Promise.all(deletes);
  } catch (error) {
    console.warn("[Menu] Firestore clear failed.", error);
  }
  writeLocalCache([]);
}

// Seed menu to Firestore (run once to populate)
export async function seedMenu(menuItems) {
  for (const item of menuItems) {
    await saveMenuItem(item);
  }
}

export { defaultMenu, generateDefaultMenuItems };
