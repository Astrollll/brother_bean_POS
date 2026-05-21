import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, addDoc, doc, getDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const STAFF_COLLECTION    = "staff";
const SCHEDULE_COLLECTION = "schedule";
const SCHEDULE_DOC        = "weekly";

export const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function parseShiftRange(shiftText) {
  const text = String(shiftText || "").trim();
  if (!text) return null;

  const pattern = /^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?\s*-\s*(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?$/i;
  const match = text.match(pattern);
  if (!match) return null;

  const toMinutes = (hourStr, minuteStr, meridiem) => {
    let hour = Number(hourStr || 0);
    const minute = Number(minuteStr || 0);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (minute < 0 || minute > 59) return null;

    const mer = String(meridiem || "").trim().toUpperCase();
    if (mer) {
      if (hour < 1 || hour > 12) return null;
      if (mer === "AM") {
        if (hour === 12) hour = 0;
      } else if (mer === "PM") {
        if (hour !== 12) hour += 12;
      } else {
        return null;
      }
      return hour * 60 + minute;
    }

    if (hour < 0 || hour > 23) return null;
    return hour * 60 + minute;
  };

  const start = toMinutes(match[1], match[2], match[3]);
  const end = toMinutes(match[4], match[5], match[6]);
  if (start === null || end === null) return null;

  return {
    start,
    end,
    crossesMidnight: end <= start,
  };
}

function getMinutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function getDayName(date = new Date()) {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function getPreviousDayName(date = new Date()) {
  const idx = DAYS.indexOf(getDayName(date));
  if (idx <= 0) return DAYS[DAYS.length - 1];
  return DAYS[idx - 1];
}

function isShiftActiveAtMinutes(shiftRange, minutesNow) {
  if (!shiftRange) return false;
  if (shiftRange.crossesMidnight) {
    return minutesNow >= shiftRange.start || minutesNow < shiftRange.end;
  }
  return minutesNow >= shiftRange.start && minutesNow < shiftRange.end;
}

function isEntryActiveNow(entry, minutesNow, allowOvernightCarry = false) {
  if (!entry?.onDuty) return false;
  const shiftRange = parseShiftRange(entry?.shift || "");
  if (!shiftRange) return false;
  if (allowOvernightCarry) {
    return shiftRange.crossesMidnight && minutesNow < shiftRange.end;
  }
  return isShiftActiveAtMinutes(shiftRange, minutesNow);
}

export function getOnDutyNowFromSchedule(staff, schedule, now = new Date()) {
  const allStaff = Array.isArray(staff) ? staff : [];
  const sched = schedule && typeof schedule === "object" ? schedule : {};
  const dayName = getDayName(now);
  const prevDayName = getPreviousDayName(now);
  const minutesNow = getMinutesOfDay(now);

  const onDuty = [];
  for (const member of allStaff) {
    const staffSched = sched[member.id] || {};
    const todayEntry = staffSched[dayName];
    const prevEntry = staffSched[prevDayName];

    if (isEntryActiveNow(todayEntry, minutesNow, false)) {
      onDuty.push({
        ...member,
        shift: String(todayEntry?.shift || ""),
      });
      continue;
    }

    if (isEntryActiveNow(prevEntry, minutesNow, true)) {
      onDuty.push({
        ...member,
        shift: String(prevEntry?.shift || ""),
      });
    }
  }

  return { onDuty, total: allStaff.length };
}

// Fetch all staff members
export async function getAllStaff() {
  const snap = await getDocs(collection(db, STAFF_COLLECTION));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Add a new staff member
export async function addStaff(name, role) {
  const options = arguments[2] && typeof arguments[2] === "object" ? arguments[2] : {};
  const accountUid = String(options.accountUid || "").trim();
  const email = String(options.email || "").trim();
  const ref = await addDoc(collection(db, STAFF_COLLECTION), {
    name,
    role,
    accountUid: accountUid || null,
    email: email || null,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  });
  return ref.id;
}

// Remove a staff member
export async function removeStaff(id) {
  await deleteDoc(doc(db, STAFF_COLLECTION, id));
}

export async function removeStaffByName(name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return 0;

  const allStaff = await getAllStaff();
  const matches = allStaff.filter((member) => String(member.name || "").trim().toLowerCase() === target);
  await Promise.all(matches.map((member) => removeStaff(member.id)));
  return matches.length;
}

export async function removeStaffByAccountUid(accountUid) {
  const target = String(accountUid || "").trim();
  if (!target) return 0;

  const allStaff = await getAllStaff();
  const matches = allStaff.filter((member) => String(member.accountUid || "").trim() === target);
  await Promise.all(matches.map((member) => removeStaff(member.id)));
  return matches.length;
}

export async function updateStaffAccountLink(staffId, options = {}) {
  const targetId = String(staffId || "").trim();
  if (!targetId) return;

  const accountUid = String(options.accountUid || "").trim();
  const email = String(options.email || "").trim();

  await setDoc(
    doc(db, STAFF_COLLECTION, targetId),
    {
      accountUid: accountUid || null,
      email: email || null,
      updatedAtMs: Date.now(),
    },
    { merge: true }
  );
}

// Fetch the weekly schedule
export async function getSchedule() {
  const snap = await getDoc(doc(db, SCHEDULE_COLLECTION, SCHEDULE_DOC));
  return snap.exists() ? snap.data() : {};
}

// Save the weekly schedule
export async function saveSchedule(scheduleData) {
  await setDoc(doc(db, SCHEDULE_COLLECTION, SCHEDULE_DOC), scheduleData);
}

// Get today's on-duty staff based on schedule
export async function getTodayOnDuty() {
  const [schedule, allStaff] = await Promise.all([getSchedule(), getAllStaff()]);
  return getOnDutyNowFromSchedule(allStaff, schedule, new Date());
}
