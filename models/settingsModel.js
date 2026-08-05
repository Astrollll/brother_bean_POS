import { db } from "../controllers/firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const SETTINGS_DOC_PATH = "settings/admin";

const DEFAULT_SETTINGS = {
  shop: {
    name: "Brother Bean Coffee House",
    openingHours: "7:00 AM - 9:00 PM",
    location: "Imus, Cavite",
    currency: "Philippine Peso (PHP)",
    phone: "+63 (0)2 1234 5678",
  },
  preferences: {
    lowStockAlerts: true,
    transactionNotifications: true,
    orderSyncToasts: true,
    compactTableRows: false,
  },
  notifications: {
    modalOnSave: true,
    warningOnDestructive: true,
  },
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(base, incoming) {
  const next = deepClone(base);
  if (!incoming || typeof incoming !== "object") return next;
  Object.keys(next).forEach((section) => {
    if (!incoming[section] || typeof incoming[section] !== "object") return;
    Object.keys(next[section]).forEach((key) => {
      if (incoming[section][key] === undefined) return;
      next[section][key] = incoming[section][key];
    });
  });
  return next;
}

const LOCAL_STORAGE_KEY = "bb_admin_settings_v1";
const PENDING_SETTINGS_KEY = "bb_admin_settings_pending_v1";

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToLocalStorage(settings) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

function readPendingSettings() {
  try {
    const raw = localStorage.getItem(PENDING_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePendingSettings(settings) {
  try {
    localStorage.setItem(PENDING_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {}
}

function clearPendingSettings() {
  try {
    localStorage.removeItem(PENDING_SETTINGS_KEY);
  } catch (_) {}
}

export async function getAdminSettings() {
  let firestoreSettings = null;
  try {
    const snap = await getDoc(doc(db, SETTINGS_DOC_PATH));
    if (snap.exists()) {
      firestoreSettings = mergeSettings(DEFAULT_SETTINGS, snap.data());
    }
  } catch (error) {
    console.warn("[Settings] Firestore read failed, using local fallback:", error);
  }

  const pending = readPendingSettings();
  if (pending) {
    const base = firestoreSettings || loadFromLocalStorage() || {};
    const merged = mergeSettings(base, pending);
    saveToLocalStorage(merged);
    return merged;
  }

  if (firestoreSettings) {
    saveToLocalStorage(firestoreSettings);
    return firestoreSettings;
  }

  const local = loadFromLocalStorage();
  if (local) return mergeSettings(DEFAULT_SETTINGS, local);
  return deepClone(DEFAULT_SETTINGS);
}

export async function saveAdminSettings(settings) {
  const merged = mergeSettings(DEFAULT_SETTINGS, settings);
  try {
    await setDoc(
      doc(db, SETTINGS_DOC_PATH),
      { ...merged, updatedAt: serverTimestamp() },
      { merge: true }
    );
    clearPendingSettings();
  } catch (error) {
    console.warn("[Settings] Firestore write failed; queued for retry.", error);
    writePendingSettings(merged);
  }
  saveToLocalStorage(merged);
}

export async function syncPendingAdminSettings() {
  const pending = readPendingSettings();
  if (!pending) return { synced: 0, pending: 0 };
  try {
    await setDoc(
      doc(db, SETTINGS_DOC_PATH),
      { ...pending, updatedAt: serverTimestamp() },
      { merge: true }
    );
    clearPendingSettings();
    return { synced: 1, pending: 0 };
  } catch (error) {
    console.warn("[Settings] Pending settings sync failed; will retry.", error);
    return { synced: 0, pending: 1 };
  }
}

export function getDefaultSettings() {
  return deepClone(DEFAULT_SETTINGS);
}
