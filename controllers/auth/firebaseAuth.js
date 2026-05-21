import { auth, firebaseConfig } from "../firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
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
  const apiKey = String(firebaseConfig?.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("Firebase API key is missing.");
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload?.error?.message || "auth/admin-create-failed").trim();
    const error = new Error(code);
    error.code = code === "EMAIL_EXISTS" ? "auth/email-already-in-use" : code;
    throw error;
  }

  return {
    uid: payload.localId,
    email: payload.email || email,
  };
}

