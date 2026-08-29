// ── EXPENSE MODEL ──
// Store expenses with a local-first day mirror + offline outbox (like drawer
// logs/settings), plus a live today listener so every open terminal reflects
// the latest totals without a manual refresh. Expenses reduce gross revenue;
// "Net" = gross sales minus expenses for a period.

import { db } from "../controllers/firebase.js";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const EXPENSES_COLLECTION = "expenses";
const EXPENSE_MIRROR_PREFIX = "bb_pos_expenses_";
const EXPENSE_OUTBOX_KEY = "bb_pos_expense_outbox_v1";
const TERMINAL_ID_KEY = "bb_pos_terminal_id";
const EXPENSE_WRITE_TIMEOUT_MS = 4000;

export const EXPENSE_CATEGORIES = [
  { key: "supplies", label: "Supplies" },
  { key: "utilities", label: "Utilities" },
  { key: "rent", label: "Rent" },
  { key: "wages", label: "Wages" },
  { key: "equipment", label: "Equipment" },
  { key: "misc", label: "Miscellaneous" },
];

export function expenseCategoryLabel(key) {
  const found = EXPENSE_CATEGORIES.find((c) => c.key === key);
  return found ? found.label : String(key || "Miscellaneous");
}

// ── local storage helpers ──

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function mirrorKey(dateKey) {
  return `${EXPENSE_MIRROR_PREFIX}${dateKey || todayKey()}`;
}

function readMirror(dateKey) {
  try {
    const raw = localStorage.getItem(mirrorKey(dateKey));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeMirror(entries, dateKey) {
  try {
    localStorage.setItem(mirrorKey(dateKey), JSON.stringify(Array.isArray(entries) ? entries : []));
  } catch {
    // storage full / disabled — this terminal just loses the mirror
  }
}

function readOutbox() {
  try {
    const raw = localStorage.getItem(EXPENSE_OUTBOX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeOutbox(entries) {
  try {
    localStorage.setItem(EXPENSE_OUTBOX_KEY, JSON.stringify(Array.isArray(entries) ? entries : []));
  } catch {
    // keep going; queued expense will just be lost on this terminal offline
  }
}

function getLocalTerminalId() {
  try {
    let id = localStorage.getItem(TERMINAL_ID_KEY);
    if (!id) {
      id = `t_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(TERMINAL_ID_KEY, id);
    }
    return String(id).slice(0, 40);
  } catch {
    return "t_unknown";
  }
}

function withWriteTimeout(promise, label) {
  const timer = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`[Expense] ${label} timed out`)), EXPENSE_WRITE_TIMEOUT_MS);
  });
  return Promise.race([promise, timer]);
}

// Timestamp that stays within the recorded business day, so analytics "today /
// week / month / custom" ranges and the day mirror attribute backdated expenses
// to the date they are actually for. Same-day entries keep the real clock time.
function timeForDateKey(dateKey) {
  if (dateKey === todayKey()) return Date.now();
  const parsed = new Date(`${String(dateKey).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
}

// ── read helpers (shared by dashboard/POS/admin) ──

// Normalized timestamp for an expense. Prefers `t`/`createdAtMs`, then falls
// back to the date field, so expenses survive both Firestore and the mirror.
export function getExpenseTime(expense) {
  const t = Number(expense?.t);
  if (Number.isFinite(t) && t > 0) return t;
  const createdAt = Number(expense?.createdAtMs);
  if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;
  if (expense?.date) {
    const parsed = new Date(`${String(expense.date).slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return Date.now();
}

export function sumExpenses(expenses) {
  return (Array.isArray(expenses) ? expenses : []).reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
}

// True when the expense's timestamp falls inside [start, end).
export function expenseInRange(timeMs, range) {
  if (!range?.start || !range?.end) return false;
  const t = Number(timeMs) || 0;
  return t >= range.start.getTime() && t < range.end.getTime();
}

// Day mirror (fast, offline-first). Unsynced entries still in the outbox are
// merged in so a just-recorded expense counts towards the totals immediately.
export function getExpensesByDate(dateKey) {
  const date = dateKey || todayKey();
  const merged = [...readMirror(date)];
  const outbox = readOutbox().filter((e) => e?.date === date);
  for (const entry of outbox) {
    if (!merged.some((m) => m.id === entry.id)) merged.push(entry);
  }
  return merged.sort((a, b) => getExpenseTime(a) - getExpenseTime(b));
}

export function getTodayExpenses() {
  return getExpensesByDate(todayKey());
}

// Remove mirrors for past days so a dormant terminal does not accumulate them.
export function pruneExpenseMirrors() {
  try {
    const keep = todayKey();
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(EXPENSE_MIRROR_PREFIX) && !key.endsWith(keep)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

// ── Firestore access ──

export async function getAllExpenses() {
  try {
    const snap = await getDocs(collection(db, EXPENSES_COLLECTION));
    return Array.isArray(snap?.docs) ? snap.docs.map((d) => d.data()) : [];
  } catch (error) {
    console.warn("[Expense] Firestore read failed; falling back to local mirror.", error);
    return getTodayExpenses();
  }
}

// Local-first save: immediately usable on this terminal (mirror/outbox) and
// written to Firestore with offline retry. Returns { ok, id, queued }.
export async function saveExpense({ amount, category, note, date, recordedByUid, recordedByName, source }) {
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(value > 0)) throw new Error("Expense amount must be greater than zero.");

  const categoryKey = EXPENSE_CATEGORIES.some((c) => c.key === category) ? category : "misc";
  const dateKey = String(date || todayKey()).slice(0, 10);
  const id = `e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const t = timeForDateKey(dateKey);

  const payload = {
    id,
    amount: value,
    category: categoryKey,
    note: note ? String(note).slice(0, 120).trim() : "",
    date: dateKey,
    t,
    createdAtMs: now,
    updatedAtMs: now,
    recordedByUid: String(recordedByUid || "").slice(0, 80),
    recordedByName: String(recordedByName || "Staff").slice(0, 80),
    terminalId: getLocalTerminalId(),
    source: source === "admin" ? "admin" : "pos",
  };

  try {
    await withWriteTimeout(setDoc(doc(db, EXPENSES_COLLECTION, id), payload), "write");
    const mirror = readMirror(dateKey);
    mirror.push(payload);
    writeMirror(mirror, dateKey);
    return { ok: true, id, queued: false };
  } catch (error) {
    console.warn("[Expense] Firestore write failed; queued for retry.", error);
    const outbox = readOutbox();
    outbox.push(payload);
    writeOutbox(outbox);
    return { ok: true, id, queued: true };
  }
}

export async function updateExpense(id, patch = {}) {
  if (!id) throw new Error("Missing expense id.");

  const updateData = {};
  if (patch.amount !== undefined) {
    const value = Math.round((Number(patch.amount) || 0) * 100) / 100;
    if (!(value > 0)) throw new Error("Expense amount must be greater than zero.");
    updateData.amount = value;
  }
  if (patch.category !== undefined) {
    updateData.category = EXPENSE_CATEGORIES.some((c) => c.key === patch.category) ? patch.category : "misc";
  }
  if (patch.note !== undefined) updateData.note = String(patch.note ?? "").slice(0, 120).trim();
  if (patch.date !== undefined) {
    updateData.date = String(patch.date || todayKey()).slice(0, 10);
    updateData.t = timeForDateKey(updateData.date);
  }
  updateData.updatedAtMs = Date.now();

  try {
    await withWriteTimeout(setDoc(doc(db, EXPENSES_COLLECTION, id), updateData, { merge: true }), "update");
    const dates = [updateData.date, todayKey()];
    for (const dateKey of new Set(dates)) {
      const mirror = readMirror(dateKey);
      const idx = mirror.findIndex((m) => m.id === id);
      if (idx !== -1) {
        mirror[idx] = { ...mirror[idx], ...updateData };
        writeMirror(mirror, dateKey);
      }
    }
    return true;
  } catch (error) {
    console.warn("[Expense] Firestore update failed.", error);
    throw error;
  }
}

export async function deleteExpense(id, date) {
  if (!id) throw new Error("Missing expense id.");
  try {
    await withWriteTimeout(deleteDoc(doc(db, EXPENSES_COLLECTION, id)), "delete");
    const dateKey = String(date || todayKey()).slice(0, 10);
    const mirror = readMirror(dateKey).filter((m) => m.id !== id);
    writeMirror(mirror, dateKey);
    return true;
  } catch (error) {
    console.warn("[Expense] Firestore delete failed.", error);
    throw error;
  }
}

// Flush queued offline expenses. On success each entry also lands in its day
// mirror and is removed from the outbox.
export async function syncExpenseOutbox() {
  const outbox = readOutbox();
  const pending = [];
  let synced = 0;
  for (const entry of outbox) {
    const id = String(entry?.id || "");
    const dateKey = String(entry?.date || todayKey()).slice(0, 10);
    if (!id) continue;
    try {
      await withWriteTimeout(setDoc(doc(db, EXPENSES_COLLECTION, id), entry), "sync");
      const mirror = readMirror(dateKey);
      if (!mirror.some((m) => m.id === id)) mirror.push(entry);
      writeMirror(mirror, dateKey);
      synced += 1;
    } catch {
      pending.push(entry);
    }
  }
  writeOutbox(pending);
  return { synced, pending: pending.length };
}

// Live listener for today's expenses. Merges each snapshot into the day mirror
// (keeping locally queued entries) and prunes entries deleted in Firestore.
// Safe under the test harness, which broadcasts { docs } snapshots.
export function watchTodayExpenses(callback) {
  try {
    return onSnapshot(
      query(collection(db, EXPENSES_COLLECTION), where("date", "==", todayKey())),
      (snap) => {
        const docs = Array.isArray(snap?.docs) ? snap.docs.map((d) => d.data()) : [];
        const dateKey = todayKey();
        const outboxIds = new Set(readOutbox().map((o) => o?.id));
        const merged = readMirror(dateKey).filter((m) => m?.id && (outboxIds.has(m.id) || docs.some((d) => d.id === m.id)));
        for (const entry of docs) {
          const index = merged.findIndex((m) => m.id === entry.id);
          if (index !== -1) merged[index] = entry;
          else merged.push(entry);
        }
        merged.sort((a, b) => getExpenseTime(a) - getExpenseTime(b));
        writeMirror(merged, dateKey);
        if (typeof callback === "function") callback(merged);
      },
      (error) => {
        console.warn("[Expense] Live expenses listener error:", error);
      }
    );
  } catch (error) {
    console.warn("[Expense] Failed to start live expenses listener:", error);
    return () => {};
  }
}