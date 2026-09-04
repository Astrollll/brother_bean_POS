# Brother Bean POS — Agent Guide

## Overview

A web-based Point of Sale system for Brother Bean Coffee House. Three pages: **login**, **admin** (management dashboard), and **POS** (cashier interface). Built with vanilla JS, Firebase backend, and PWA offline support.

## Essential Commands

```bash
# Run all smoke tests (Puppeteer-driven browser tests)
npm run smoke

# Run individual smoke tests
npm run smoke:staff
npm run smoke:orders
npm run smoke:orders-sync
npm run smoke:inventory-deduct
npm run smoke:drawer
npm run smoke:printer
npm run smoke:itest       # Integration test server (Express + Puppeteer + Firebase stubs)

# Deploy to Firebase Hosting
firebase deploy
```

## Architecture

```
brother_bean_POS-main/
├── controllers/          # Glue layer — imports models, wires DOM, handles state
│   ├── firebase.js       #   Firebase init (app, db, auth) — single shared instance
│   ├── posController.js  #   POS/cashier page logic (~5000+ lines)
│   ├── auth/             #   Login, auth state, Firebase Auth API calls
│   ├── admin/            #   Admin portal controller (dashboard, orders, menu, inventory, staff, etc.)
│   ├── printer/          #   Web Bluetooth thermal printer (ESC/POS)
│   ├── pos/              #   POS entrypoint (just imports posController)
│   └── utils/            #   Routes, modal utilities
├── models/               # Data layer — Firestore CRUD + localStorage mirrors + offline outbox
│   ├── menuModel.js
│   ├── orderModel.js
│   ├── inventoryModel.js
│   ├── categoryModel.js
│   ├── staffModel.js
│   ├── storageModel.js   #   Daily stats, sales history, drawer logs, kitchen orders
│   ├── settingsModel.js  #   Admin settings with live Firestore onSnapshot mirror
│   ├── expenseModel.js
│   ├── userModel.js
│   ├── resetModel.js     #   Day-end order archival
│   └── defaultSeedData.js
├── views/                # Pure rendering functions (no data fetching, no side effects)
│   ├── dashboardView.js  #   Sales analytics + admin dashboard (Chart.js)
│   ├── menuView.js
│   ├── staffView.js
│   └── pages/            #   HTML shells (login.html, admin.html, pos.html)
├── assets/               # CSS, Bootstrap 5.3.8, icons
├── config/               # Firebase config (app.config.js is tracked, .example is template)
├── scripts/              # Smoke tests (Puppeteer) + Firebase stubs for integration tests
├── sw-pos.js             # Service Worker for offline POS (PWA)
├── pos.webmanifest       # PWA manifest
└── firebase.json         # Firebase Hosting config (rewrites, caching headers)
```

## Data Flow

1. **Firebase Firestore** is the primary database. All models write to Firestore first.
2. **localStorage mirrors** provide instant reads and offline resilience. Every model maintains a local cache that's written on every save and read on every load.
3. **Offline outbox**: when a Firestore write fails (offline), the operation is queued in localStorage and synced next time the model boots.
4. **`watchAdminSettings()`** — an `onSnapshot` listener on `settings/admin` that refreshes the localStorage mirror; all open terminals pick up edits within ~1s without a refresh.
5. **`syncPendingAdminSettings()`** — retries queued settings writes on admin boot.

## Key Patterns

### Import Rules (CRITICAL)

- **Model imports MUST NOT have `?v=` cache busters** — versioned URLs create separate ES module instances, breaking shared state. The `model-itest.mjs` smoke test enforces this.
- **View imports SHOULD have `?v=` cache busters** — e.g., `import { renderAdminDashboard } from "../../views/dashboardView.js?v=20260902E"`.
- Non-view imports (controllers, utils) should also avoid `?v=`.

### Firebase SDK Imports

All Firebase SDK modules are imported from CDN with exact versions:
```js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
```

### localStorage Mirror Pattern

Every model follows this pattern:
```js
const LOCAL_KEY = "bb_xxx_local_cache";
const PENDING_KEY = "bb_xxx_pending_v1";

function readLocalCache() { /* JSON.parse(localStorage.getItem(LOCAL_KEY)) */ }
function writeLocalCache(data) { /* localStorage.setItem(LOCAL_KEY, JSON.stringify(data)) */ }
function readPendingOps() { /* ... */ }
function writePendingOps(ops) { /* ... */ }
```

### Write Timeout Pattern

Firestore writes are wrapped with `withTimeout()` to prevent hanging when connectivity drops silently:
```js
const WRITE_TIMEOUT_MS = 4000;
function withTimeout(promise, label, timeoutMs) { /* returns a promise with a timeout */ }
```

### Signature-Based Render Skipping

Views use `JSON.stringify()` signatures to skip re-renders when data hasn't changed:
```js
let lastSignature = null;
export function render(data) {
  const signature = JSON.stringify(data);
  if (signature === lastSignature && el?.innerHTML) return;
  lastSignature = signature;
  // ... render HTML
}
```

### HTML Escaping

Always use `escapeHtml()` before injecting user data into innerHTML:
```js
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

### Currency Formatting

```js
function formatPeso(value, digits = 0) {
  return `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
```

### Date Keys

Date-based storage keys use `YYYY-MM-DD` format:
```js
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
```

### `normalizeText()` for Case-Insensitive Matching

```js
function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
```

### Global Functions for HTML onclick

Controllers expose functions on `window` object for HTML onclick handlers:
```html
<button onclick="openMenuItemModal('p1')">Add</button>
```
```js
window.openMenuItemModal = function(id) { /* ... */ };
```

## Admin Portal Tab System

The admin page has 10 tabs: Dashboard, Sales Analytics, Transactions, Expenses, Menu, Inventory, Staff, Accounts, Logs, Settings. Tab state is remembered via `sessionStorage` (`bb_admin_active_tab`). The active tab is restored on browser refresh.

Each tab's content is built by `innerHTML` replacement in the `#pageContent` container. Tab-specific event listeners are bound on each page load.

## CSS Versioning

CSS files use `?v=` cache busters (date-based):
```html
<link rel="stylesheet" href="/assets/adminstyle.css?v=20260830B" />
```
Always bump the version when modifying CSS. Use the format `YYYYMMDD` + optional letter suffix.

## Firebase Collections

| Collection | Purpose | Read | Write |
|---|---|---|---|
| `users/{uid}` | User profiles & roles | Owner + admin | Owner + admin |
| `menu/{docId}` | Menu items | Public | Admin only |
| `categories/{docId}` | Menu categories | Public | Admin only |
| `inventory/{docId}` | Inventory items | Authenticated | Admin (staff: quantity-only) |
| `inventoryCategories/{docId}` | Inventory categories | Authenticated | Admin only |
| `orders/{docId}` | Live orders | Authenticated | Staff create, admin manage |
| `resets/{dateId}/orders/` | Archived orders | Authenticated | Admin only |
| `settings/admin` | Admin settings | Authenticated | Admin only |
| `staff/{docId}` | Staff records | Admin + staff | Admin only |
| `schedule/weekly` | Weekly schedule | Admin + staff | Admin only |
| `dailyStats/{docId}` | Daily POS stats | Admin + staff | Admin + staff |
| `kitchenOrders/{docId}` | Kitchen queue | Admin + staff | Admin + staff |
| `drawerLogs/{docId}` | Cash drawer logs | Admin + staff | Admin + staff |
| `expenses/{docId}` | Store expenses | Admin + staff | Staff create, admin manage |
| `unpaidOrders/{docId}` | Unpaid orders | Owner only | Owner only |

## Testing

### Smoke Tests (Puppeteer)
Each `scripts/*-smoke.mjs` is a self-contained Node.js script that launches a headless browser, serves the app via Express, and verifies behavior. They use Firebase stubs from `scripts/itest-stubs/` via importmap overrides.

### Model Validation Test
`scripts/model-itest.mjs` checks:
1. No `?v=` on model imports (dual module instance prevention)
2. All model files are importable
3. All controller files are importable

### Running Tests
- `npm run smoke` — runs all smoke tests sequentially
- Individual tests: `npm run smoke:staff`, `npm run smoke:orders`, etc.
- `npm run smoke:itest` — starts Express server on port 8899, runs Puppeteer tests with stubs

## Important Gotchas

1. **Never add `?v=` to a model import.** It creates two separate module instances, breaking singleton state (e.g., the Firestore `db` instance). The model-itest smoke test catches this.

2. **Bump CACHE_NAME in `sw-pos.js`** when adding new files to the PWA app shell. The current version is `brother-bean-pos-v11`.

3. **Settings propagation**: Admin settings changes propagate to POS terminals via `watchAdminSettings()` which writes to `localStorage` key `bb_admin_settings_v1`. The thermal printer module reads the same key directly (no import dependency).

4. **Firestore `serverTimestamp()`** is used for timestamps — always use `serverTimestamp()` for new writes, not `Date.now()`.

5. **Order deduplication**: `mergeUniqueOrders()` in orderModel.js uses `orderId` to deduplicate. The POS controller's `completePayment` relies on the snapshot listener merging orders before the local push to avoid double-counting.

6. **Day-end reset**: `resetDay()` in resetModel.js archives orders to `resets/{date}/orders/` and deletes them from the live `orders` collection. Pending orders are auto-completed during reset.

7. **Firebase Hosting rewrites**: `/` → `/views/pages/login.html`, `/admin` → `/views/pages/admin.html`, `/pos` → `/views/pages/pos.html`. All HTML, JS, and CSS files have `Cache-Control: no-cache` headers.

8. **The `ModalUtils` fallback**: The admin controller defines a local `ModalUtils` fallback using `window.confirm()`/`window.alert()` in case the `modalUtils.js` module hasn't loaded yet.

9. **Air Datepicker**: The admin page loads Air Datepicker from CDN. It's used for date filters on Orders, Logs, and Expenses pages. The `airDatepickerSmartPosition()` helper in dashboardView.js handles positioning. The `AIR_DATEPICKER_EN_LOCALE` export provides English locale data.

10. **Inventory deduction**: When an order is placed, `deductInventoryQuantities()` runs in a Firestore transaction. If it fails, it's retried later via `retryFailedInventoryDeduction()`.

11. **The `index.html`, `login.html`, `admin.html`, `pos.html`** in the root are compatibility redirects — the actual pages are in `views/pages/`.

12. **Bootstrap 5.3.8** is vendored locally in `assets/bootstrap-5.3.8-dist/` for the POS page (offline support). The admin and login pages use the CDN version.