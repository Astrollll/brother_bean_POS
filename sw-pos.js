const CACHE_NAME = "brother-bean-pos-v4";
const APP_SHELL_FILES = [
  "/pos",
  "/views/pages/pos.html",
  "/assets/style.css",
  "/assets/bootstrap-5.3.8-dist/css/bootstrap.min.css",
  "/assets/bootstrap-5.3.8-dist/js/bootstrap.bundle.min.js",
  "/controllers/pos/index.js",
  "/controllers/posController.js",
  "/controllers/firebase.js",
  "/controllers/auth/firebaseAuth.js",
  "/models/menuModel.js",
  "/models/orderModel.js",
  "/models/storageModel.js",
  "/models/userModel.js",
  "/assets/icons/brother-bean-logo.jpg",
  "/pos.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Network-first for Firebase APIs and auth endpoints.
  if (request.url.includes("firestore.googleapis.com") || request.url.includes("identitytoolkit.googleapis.com")) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (request.url.startsWith("http")) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/pos") || caches.match("/views/pages/pos.html")))
  );
});

