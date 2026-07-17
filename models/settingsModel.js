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

export async function getAdminSettings() {
  try {
    const snap = await getDoc(doc(db, SETTINGS_DOC_PATH));
    if (snap.exists()) {
      const data = snap.data();
      const merged = mergeSettings(DEFAULT_SETTINGS, data);
      saveToLocalStorage(merged);
      return merged;
    }
  } catch (error) {
    console.warn("[Settings] Firestore read failed, using local fallback:", error);
  }

  const local = loadFromLocalStorage();
  if (local) return mergeSettings(DEFAULT_SETTINGS, local);
  return deepClone(DEFAULT_SETTINGS);
}

export async function saveAdminSettings(settings) {
  saveToLocalStorage(settings);
  try {
    await setDoc(
      doc(db, SETTINGS_DOC_PATH),
      { ...settings, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (error) {
    console.warn("[Settings] Firestore write failed, saved locally only:", error);
  }
}

export function getDefaultSettings() {
  return deepClone(DEFAULT_SETTINGS);
}
