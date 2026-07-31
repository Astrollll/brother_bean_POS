const fakeUser = { uid: "itest-user", email: "staff@test.local", displayName: "IT Tester" };
export function getAuth() { return { currentUser: fakeUser, onAuthStateChanged: null }; }
export function onAuthStateChanged(auth, cb) {
  if (typeof cb === "function") cb(fakeUser);
  return () => {};
}
export function signInWithEmailAndPassword() { return Promise.resolve({ user: fakeUser }); }
export function signOut() { return Promise.resolve(); }
export function createUserWithEmailAndPassword() { return Promise.resolve({ user: fakeUser }); }
export function sendPasswordResetEmail() { return Promise.resolve(); }
export function updateProfile() { return Promise.resolve(); }
export function updatePassword() { return Promise.resolve(); }
