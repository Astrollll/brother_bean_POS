import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getAuth, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { firebaseConfig } from "../../config/app.config.js";

export { firebaseConfig };

export const app = initializeApp(firebaseConfig);
let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  firestoreInstance = getFirestore(app);
}
export const db = firestoreInstance;

let authPromise = (async () => {
  const auth = getAuth(app);
  await setPersistence(auth, browserSessionPersistence);
  return auth;
})();

export const getAuthInstance = () => authPromise;

export const auth = await authPromise;
