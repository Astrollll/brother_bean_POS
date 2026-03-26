import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDNKDx5JoKsms5sYlOCS4yu2zAqg9scbEM",
  authDomain: "firstproject-e7734.firebaseapp.com",
  projectId: "firstproject-e7734",
  storageBucket: "firstproject-e7734.firebasestorage.app",
  messagingSenderId: "609430570192",
  appId: "1:609430570192:web:965e622e65961663a10ad5",
  measurementId: "G-MY04WNEW10"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
