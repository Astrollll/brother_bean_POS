import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { auth, firebaseConfig } from "../firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

export function watchAuth(cb) {
    return onAuthStateChanged(auth, cb);
}

export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
}

export function getCurrentUser() {
  return auth.currentUser;
}

export async function createAuthUserByAdmin(email, password) {
  const appName = `admin-create-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth);
    return cred.user;
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
}

