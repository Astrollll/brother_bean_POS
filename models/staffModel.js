import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, addDoc, doc, getDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const STAFF_COLLECTION    = "staff";
const SCHEDULE_COLLECTION = "schedule";
const SCHEDULE_DOC        = "weekly";

export const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

// Fetch all staff members
export async function getAllStaff() {
  const snap = await getDocs(collection(db, STAFF_COLLECTION));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Add a new staff member
export async function addStaff(name, role) {
  const ref = await addDoc(collection(db, STAFF_COLLECTION), { name, role });
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
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const [schedule, allStaff] = await Promise.all([getSchedule(), getAllStaff()]);

  const staffMap = {};
  allStaff.forEach(s => { staffMap[s.id] = s; });

  const onDuty = [];
  for (const [staffId, days] of Object.entries(schedule)) {
    if (days[todayName]?.onDuty && staffMap[staffId]) {
      onDuty.push({
        ...staffMap[staffId],
        shift: days[todayName].shift || ""
      });
    }
  }

  return { onDuty, total: allStaff.length };
}
