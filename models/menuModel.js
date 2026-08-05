import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { defaultMenu, generateDefaultMenuItems } from "./defaultSeedData.js";

const MENU_COLLECTION = "menu";
const LOCAL_CACHE_KEY = "bb_menu_local_cache";
const PENDING_OPS_KEY = "bb_menu_pending_ops_v1";

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

function readPendingOps() {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writePendingOps(ops) {
  try {
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops));
  } catch {}
}

function queuePendingOp(op) {
  const ops = readPendingOps().filter(
    (existing) => !(existing.op === op.op && String(existing.item?.id || existing.id) === String(op.item?.id || op.id))
  );
  ops.push(op);
  writePendingOps(ops);
}

function removePendingOp(match) {
  writePendingOps(readPendingOps().filter((op) => !match(op)));
}

function applyPendingMenuOps(items, ops) {
  let result = Array.isArray(items) ? [...items] : [];
  for (const op of ops) {
    if (!op) continue;
    if (op.op === "delete") {
      result = result.filter((m) => String(m?.id) !== String(op.id));
    } else if (op.op === "save" && op.item?.id) {
      const idx = result.findIndex((m) => String(m?.id) === String(op.item.id));
      if (idx >= 0) result[idx] = op.item;
      else result.push(op.item);
    }
  }
  return result;
}

// Fetch all menu items from Firestore, fallback to local cache
export async function getMenuItems() {
  let items = [];
  try {
    const snap = await getDocs(collection(db, MENU_COLLECTION));
    items = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  } catch (error) {
    console.warn("[Menu] Firestore read failed, using local cache.", error);
    items = readLocalCache();
  }
  items = applyPendingMenuOps(items, readPendingOps());
  writeLocalCache(items);
  return items;
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
    removePendingOp((op) => op.op === "save" && String(op.item?.id) === String(item.id));
  } catch (error) {
    console.warn("[Menu] Firestore write failed; queued for retry.", error);
    queuePendingOp({ op: "save", item });
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
    removePendingOp((op) => op.op === "delete" && String(op.id) === String(id));
  } catch (error) {
    console.warn("[Menu] Firestore delete failed; queued for retry.", error);
    queuePendingOp({ op: "delete", id: String(id) });
  }
  const local = readLocalCache().filter((m) => String(m.id) !== String(id));
  writeLocalCache(local);
}

// Replay queued menu ops to Firestore (called when back online / on admin load).
export async function syncPendingMenuOps() {
  const ops = readPendingOps();
  let synced = 0;
  for (const op of ops) {
    try {
      if (op.op === "delete") {
        await deleteDoc(doc(db, MENU_COLLECTION, String(op.id)));
      } else if (op.op === "save" && op.item?.id) {
        await setDoc(doc(db, MENU_COLLECTION, String(op.item.id)), op.item);
      } else {
        continue;
      }
      removePendingOp((o) => o.op === op.op && String(o.item?.id || o.id) === String(op.item?.id || op.id));
      synced += 1;
    } catch {
      // Keep unsynced ops in the queue and try again next time.
    }
  }
  return { synced, pending: readPendingOps().length };
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
