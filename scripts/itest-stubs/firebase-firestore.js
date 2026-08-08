export function getFirestore() { return { type: "itest-db" }; }
export const db = { type: "itest-db" };

export function collection(parent, name) { return { path: `${parent.path ?? ""}/${name}` }; }
export function doc(parent, ...ids) { return { path: `${parent.path ?? ""}/${ids.join("/")}`, id: ids[ids.length - 1] }; }
export function addDoc(ref, data) { return Promise.resolve({ id: "itest-doc", path: `${ref.path}/itest-doc` }); }
export function query(q, ...rest) { return q; }
export function where(field, op, value) { return { field, op, value }; }
export function limit(n) { return { n }; }
export function getDocs(q) {
  const slow = /[?&]slowinit=1/.test(location.search) ? 1500 : 0;
  const failOrders = /[?&]initfail=1/.test(location.search) && /\/orders(\/|$)/.test(q?.path || "");
  const seedMenu = /[?&](placeorder|offlinesave)=1/.test(location.search) && /\/menu(\/|$)/.test(q?.path || "");
  const seededOrders = /^\/orders$/.test(q?.path || "") ? (window.__itestOrdersDocs || null) : null;
  return new Promise((resolve, reject) => setTimeout(() => {
    if (failOrders) return reject(new Error("itest: orders fetch failed (offline)"));
    if (seedMenu) {
      const item = {
        id: "p1",
        name: "Test Americano",
        price: 100,
        category: "coffee",
        hasVariant: false,
        hasTemp: false,
        addons: [],
        recipe: [],
        bestseller: false,
        popular: false,
      };
      return resolve({ empty: false, docs: [{ id: "p1", data: () => JSON.parse(JSON.stringify(item)) }], size: 1 });
    }
    if (seededOrders) {
      const docs = seededOrders.map((d) => ({ id: d.id, data: () => JSON.parse(JSON.stringify(d)) }));
      return resolve({ empty: docs.length === 0, docs, size: docs.length });
    }
    resolve({ empty: true, docs: [], size: 0 });
  }, slow));
}
export function getDoc(ref) {
  const seeded = (window.__itestExistingDocs || {})[ref.path];
  if (seeded) {
    return Promise.resolve({ exists: () => true, id: ref.id, data: () => JSON.parse(JSON.stringify(seeded)) });
  }
  return Promise.resolve({ exists: () => false, id: ref.id, data: () => null });
}
export function setDoc(ref, data) {
  if (/[?&]initfail=1/.test(location.search)) {
    window.__itestSetDocRejects = (window.__itestSetDocRejects || 0) + 1;
    return Promise.reject(new Error("itest: setDoc failed (offline)"));
  }
  if (window.__itestForceSetDocFail === true) {
    return Promise.reject(new Error("itest: forced setDoc failure"));
  }
  if (window.__itestWrites) window.__itestWrites.push({ ref: ref.path, data: JSON.parse(JSON.stringify(data)) });
  // In placeorder mode, writing an order to /orders/{id} immediately delivers
  // the today-orders snapshot (like Firestore's own-write listener): by the
  // time completePayment resumes, the order is already in the local list.
  if (/[?&]placeorder=1/.test(location.search) && /^\/orders\/[^/]+$/.test(ref.path || "")) {
    const dataCopy = JSON.parse(JSON.stringify(data || {}));
    for (const cb of window.__itestSnapshots || []) {
      try { cb({ docs: [{ id: ref.id, data: () => dataCopy }], metadata: { fromCache: false } }); } catch {}
    }
  }
  // In offlinesave mode every write hangs forever — Firestore behaves this way
  // when the connection dies without the browser flipping navigator.onLine.
  // The bounded-write timeouts in the models must queue the order locally.
  if (/[?&]offlinesave=1/.test(location.search)) {
    return new Promise(() => {});
  }
  return Promise.resolve();
}
export function updateDoc(ref, data) {
  if (window.__itestForceUpdateDocFail === true) {
    return Promise.reject(new Error("itest: forced updateDoc failure (permission-denied)"));
  }
  if (window.__itestWrites) window.__itestWrites.push({ ref: ref.path, data: JSON.parse(JSON.stringify(data || {})) });
  return Promise.resolve();
}
export function deleteDoc(ref) {
  if (window.__itestForceDeleteDocFail === true) {
    return Promise.reject(new Error("itest: forced deleteDoc failure"));
  }
  if (window.__itestWrites) window.__itestWrites.push({ ref: ref.path, deleted: true });
  return Promise.resolve();
}
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
