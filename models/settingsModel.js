import { db } from "../controllers/firebase.js";
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const SETTINGS_DOC_PATH = "settings/admin";

const DEFAULT_SETTINGS = {
  shop: {
    name: "Brother Bean Coffee House",
    openingHours: "7:00 AM - 9:00 PM",
    location: "Imus, Cavite",
    currency: "Philippine Peso (PHP)",
    phone: "+63 (0)2 1234 5678",
    vatTin: "",
    permitNo: "",
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

// Synchronous read of the BIR/receipt tax fields from the local settings
// mirror. Receipt renderers (POS screen, admin reprint, thermal printer) use
// this so they never block on Firestore — watchAdminSettings() keeps the
// mirror fresh, so values appear without any page refresh after an admin edit.
export function readReceiptTaxDetails() {
  const parsed = loadFromLocalStorage();
  return {
    vatTin: String(parsed?.shop?.vatTin || "").trim(),
    permitNo: String(parsed?.shop?.permitNo || "").trim(),
  };
}

// Live subscription to the settings document. Every snapshot refreshes the
// localStorage mirror, which is what lets other tabs/terminals (e.g. the POS)
// pick up admin edits within about a second — no reload needed. Returns an
// unsubscribe function; errors are swallowed so a logout/denied token can't
// crash a terminal that only wanted receipt footer text.
export function watchAdminSettings() {
  try {
    return onSnapshot(
      doc(db, SETTINGS_DOC_PATH),
      (snap) => {
        // Real Firestore delivers a DocumentSnapshot here (exists()/data());
        // anything else (e.g. test harnesses broadcasting query-shaped
        // snapshots) is ignored rather than crashing the terminal.
        if (!snap || typeof snap.exists !== "function") return;
        if (!snap.exists()) return;
        try {
          saveToLocalStorage(mergeSettings(DEFAULT_SETTINGS, snap.data()));
        } catch (error) {
          console.warn("[Settings] Failed to cache live settings snapshot:", error);
        }
      },
      (error) => {
        console.warn("[Settings] Live settings listener error:", error);
      }
    );
  } catch (error) {
    console.warn("[Settings] Failed to start live settings listener:", error);
    return () => {};
  }
}
