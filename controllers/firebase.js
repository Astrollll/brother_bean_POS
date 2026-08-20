import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { firebaseConfig } from "../../config/app.config.js";

export { firebaseConfig };

export const app = initializeApp(firebaseConfig);
// Firestore offline persistence (IndexedDB): reads are served straight from the
// local cache on refresh/login instead of waiting on the network every time,
// which is what made the POS menu and stats feel slow to appear. Each terminal
// is a single client, so a single-tab cache manager is the right fit.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});
export const auth = getAuth(app);
