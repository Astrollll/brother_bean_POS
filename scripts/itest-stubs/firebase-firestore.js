export function getFirestore() { return { type: "itest-db" }; }
export const db = { type: "itest-db" };

export function collection(parent, name) { return { path: `${parent.path ?? ""}/${name}` }; }
export function doc(parent, ...ids) { return { path: `${parent.path ?? ""}/${ids.join("/")}`, id: ids[ids.length - 1] }; }
export function addDoc(ref, data) { return Promise.resolve({ id: "itest-doc", path: `${ref.path}/itest-doc` }); }
export function query(q, ...rest) { return q; }
export function where(field, op, value) { return { field, op, value }; }
export function limit(n) { return { n }; }
export function getDocs(q) {
  return Promise.resolve({ empty: true, docs: [], size: 0 });
}
export function getDoc(ref) {
  return Promise.resolve({ exists: () => false, id: ref.id, data: () => null });
}
export function setDoc(ref, data) {
  if (window.__itestWrites) window.__itestWrites.push({ ref: ref.path, data: JSON.parse(JSON.stringify(data)) });
  return Promise.resolve();
}
export function updateDoc() { return Promise.resolve(); }
export function deleteDoc() { return Promise.resolve(); }
export function onSnapshot(q, cb, errCb) {
  if (window.__itestSnapshots) window.__itestSnapshots.push(cb);
  return () => {};
}
export function writeBatch() {
  return {
    set() {},
    update() {},
    delete() {},
    commit: () => Promise.resolve(),
  };
}
export function runTransaction() { return Promise.resolve(); }
export function serverTimestamp() { return new Date(); }
export const Timestamp = {
  fromDate: (d) => ({ toDate: () => new Date(d), seconds: Math.floor(new Date(d).getTime() / 1000) }),
  fromMillis: (ms) => ({ toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) }),
  now: () => ({ toDate: () => new Date(), seconds: Math.floor(Date.now() / 1000) }),
};
