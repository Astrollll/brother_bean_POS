// Firebase Configuration
// Get these from: Firebase Console > Project Settings > General > Your apps
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

// Default Admin Accounts (bootstrap credentials)
// These are created automatically on first run
export const DEFAULT_ADMIN_ACCOUNTS = [
  {
    email: "admin@yourdomain.com",
    password: "CHANGE_THIS_PASSWORD",
    fullName: "Default Admin",
  },
];

// Default Staff Accounts (bootstrap credentials)
export const DEFAULT_STAFF_ACCOUNTS = [
  {
    email: "staff@yourdomain.com",
    password: "CHANGE_THIS_PASSWORD",
    fullName: "Staff",
  },
];
