import { db } from "../controllers/firebase.js";
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const USERS_COLLECTION = "users";

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, USERS_COLLECTION, uid));
  return snap.exists() ? snap.data() : null;
}

export async function getUserRole(uid) {
  const profile = await getUserProfile(uid);
  return profile?.role || null;
}

export async function setUserProfile(uid, data) {
  await setDoc(
    doc(db, USERS_COLLECTION, uid),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function listUsers() {
  const snap = await getDocs(collection(db, USERS_COLLECTION));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function setUserRole(uid, role, email = "") {
  await setDoc(
    doc(db, USERS_COLLECTION, uid),
    {
      role,
      email: email || undefined,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function ensureAdminAccessProfile(uid, profile = {}) {
  const fullName = String(profile.fullName || profile.displayName || profile.email || "Admin").trim();
  const email = String(profile.email || "").trim();
  const status = String(profile.status || "active").trim() || "active";

  await setUserProfile(uid, {
    fullName,
    email: email || undefined,
    role: "admin",
    status,
    isDefaultAdmin: !!profile.isDefaultAdmin,
  });
}

