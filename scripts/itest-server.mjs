import express from "express";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";

const ROOT = process.cwd();
const PORT = 8899;

const app = express();

const IMPORTMAP = `<script type="importmap">
{"imports": {
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js": "/itest-stubs/firebase-app.js",
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js": "/itest-stubs/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js": "/itest-stubs/firebase-firestore.js"
}}
</script>`;

const PRE_SCRIPT = `<script>
  try { localStorage.clear(); } catch (e) {}
  try { Object.defineProperty(Navigator.prototype, "serviceWorker", { get: () => undefined }); } catch (e) {}
</script>`;

const TEST_SCRIPT = `<script type="module">
window.__itestWrites = [];
window.__itestSnapshots = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  if (/[?&]slowinit=1/.test(location.search)) return runGuardTest();
  if (/[?&]initfail=1/.test(location.search)) return runOfflinePruneTest();
  if (/[?&]placeorder=1/.test(location.search)) return runOrderDedupeTest();
  if (/[?&]offlinesave=1/.test(location.search)) return runOfflineSaveTest();
  if (/[?&]cancelflow=1/.test(location.search)) return runCancelFlowTest();
  const results = { steps: [], errors: [] };
  const el = (id) => document.getElementById(id);
  const read = (id) => {
    const e = el(id);
    return e ? { text: e.textContent, value: e.value, html: e.innerHTML } : null;
  };

  // Seed a "stale deleted" order BEFORE init reads storage: an order that
  // exists only in this terminal's localStorage (deleted on the admin side)
  // must be pruned at init, not counted in the dashboard.
  try {
    const d = new Date();
    const todayKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    localStorage.setItem("brotherBean_lastResetDate", new Date().toDateString());
    localStorage.setItem("brotherBean_salesHistory_" + todayKey, JSON.stringify([
      { orderId: "stale-deleted-order-1", createdAtMs: Date.now(), total: 999, paymentMethod: "cash", status: "paid" },
    ]));
  } catch (e) {}

  for (let i = 0; i < 200 && typeof window.askDrawerConfirm !== "function"; i++) await wait(50);
  if (typeof window.askDrawerConfirm !== "function") {
    results.fatal = "handlers never attached";
    window.__itestResults = results;
    return;
  }
  for (let i = 0; i < 100 && (window.__itestWrites || []).length === 0; i++) await wait(50);

  window.openDrawer();
  results.steps.push(["initial", { badge: read("drawerVarianceBadge"), stats: { orders: read("todayOrders"), total: read("totalSales") } }]);

  // Set starting cash via the real UI
  window.toggleDrawerFloatEdit();
  el("drawerFloatInput").value = "1000";
  window.saveDrawerOpeningFloat();
  results.steps.push(["afterFloat", read("drawerFloatValue")]);

  // Record count 3500 via popup
  const actual = el("drawerActualInput");
  actual.value = "3500";
  window.askDrawerConfirm("count");
  results.steps.push(["popupCount", { open: el("drawerConfirmModal").classList.contains("active"), msg: el("drawerConfirmMessage").textContent, hint: el("drawerConfirmHint").textContent }]);
  window.confirmDrawerAction();
  results.steps.push(["afterCount", { badge: read("drawerVarianceBadge"), note: read("drawerVarianceNote"), actual: read("drawerActualInput"), popupOpen: el("drawerConfirmModal").classList.contains("active") }]);

  // Cash in 500 with note via popup
  el("drawerLedgerAmount").value = "500";
  el("drawerLedgerReason").value = "Change top-up";
  window.askDrawerConfirm("in");
  results.steps.push(["popupIn", { open: el("drawerConfirmModal").classList.contains("active"), msg: el("drawerConfirmMessage").textContent, hint: el("drawerConfirmHint").textContent }]);
  window.confirmDrawerAction();
  results.steps.push(["afterIn", { ledgerNote: read("drawerLedgerNote"), history: read("drawerHistoryList") }]);

  // Cash out 200 via popup
  el("drawerLedgerAmount").value = "200";
  window.askDrawerConfirm("out");
  results.steps.push(["popupOut", { open: el("drawerConfirmModal").classList.contains("active"), msg: el("drawerConfirmMessage").textContent }]);
  window.confirmDrawerAction();
  results.steps.push(["afterOut", { ledgerNote: read("drawerLedgerNote"), history: read("drawerHistoryList"), badge: read("drawerVarianceBadge") }]);

  // Cancel path
  el("drawerLedgerAmount").value = "77";
  window.askDrawerConfirm("in");
  window.cancelDrawerConfirm();
  results.steps.push(["afterCancel", { popupOpen: el("drawerConfirmModal").classList.contains("active"), ledgerNote: read("drawerLedgerNote") }]);

  // What actually got persisted to the Firestore mirror
  const statsWrites = (window.__itestWrites || []).filter((w) => w.ref.includes("/dailyStats/"));
  results.steps.push(["mirrorWrites", statsWrites.map((w) => ({ ref: w.ref, dailyStats: w.data?.dailyStats }))]);
  results.steps.push(["localStorageStats", (() => { try { return JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("brotherBean_dailyStats_")))); } catch { return null; } })()]);

  window.__itestResults = results;
}

// Prune behavior with the orders fetch failing (offline-like init):
// - local stale orders must survive init and CACHED snapshots
// - a server-confirmed snapshot must prune stale copies but keep queued ones
// Prune behavior with the orders fetch failing (offline-like init):
// - local stale orders must survive init and CACHED snapshots
// - a server-confirmed snapshot must prune stale copies but keep queued ones
async function runOfflinePruneTest() {
  const results = { steps: [], mode: "prune", errors: [] };
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = (id) => {
    const e = el(id);
    return e ? { text: e.textContent, value: e.value } : null;
  };
  const stats = () => ({ orders: read("todayOrders")?.text, total: read("totalSales")?.text });
  const step = (name, extra = {}) => results.steps.push([name, { ...stats(), ...extra }]);
  const seedQueued = () => localStorage.setItem("brotherBean_orderOutbox", JSON.stringify([
    { id: "q_1", createdAt: Date.now(), payload: { orderId: "queued-order-1", createdAtMs: Date.now(), total: 150, paymentMethod: "cash", status: "paid" } },
  ]));

  try {
    const d = new Date();
    const todayKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    localStorage.setItem("brotherBean_lastResetDate", new Date().toDateString());
    localStorage.setItem("brotherBean_salesHistory_" + todayKey, JSON.stringify([
      { orderId: "stale-deleted-order-1", createdAtMs: Date.now(), total: 999, paymentMethod: "cash", status: "paid" },
    ]));
    seedQueued();
  } catch (e) {}

  for (let i = 0; i < 200 && typeof window.askDrawerConfirm !== "function"; i++) await wait(50);
  for (let i = 0; i < 100 && (window.__itestWrites || []).length === 0; i++) await wait(50);
  await wait(500);
  step("init", { rejects: window.__itestSetDocRejects || 0 });

  const fire = (fromCache) => {
    for (const cb of window.__itestSnapshots || []) cb({ docs: [], metadata: { fromCache } });
  };

  // Re-seed the queued order (the outbox may have been consumed/mangled by
  // init flows) so the snapshot handler prunes against a known outbox state.
  seedQueued();
  fire(true);
  await wait(300);
  step("cachedSnapshot");

  seedQueued();
  fire(false);
  await wait(300);
  step("serverSnapshot");

  window.__itestResults = results;
}
// Place an order whose own Firestore write immediately triggers the today-orders
// listener (the stub delivers the snapshot during setDoc). completePayment must
// NOT push a second copy of the same sale on top of the snapshot-merged one, so
// the order count stays exactly 1 without needing a page refresh.
async function runOrderDedupeTest() {
  const results = { steps: [], mode: "placedupe", errors: [] };
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = (id) => {
    const e = el(id);
    return e ? { text: e.textContent, value: e.value } : null;
  };
  const step = (name, extra = {}) => results.steps.push([name, extra]);

  for (let i = 0; i < 200 && typeof window.completePayment !== "function"; i++) await wait(50);
  for (let i = 0; i < 200 && !el("productsGrid")?.querySelector(".product-card"); i++) await wait(50);
  step("menu", { cards: el("productsGrid")?.querySelectorAll(".product-card").length || 0 });

  window.openMenuItemModal("p1");
  window.confirmMenuItem();
  window.openPaymentModal();
  step("cart", { subtotal: read("subtotal")?.text, total: read("total")?.text });

  await window.completePayment();
  await wait(500);
  step("placed", { orders: read("todayOrders")?.text, total: read("totalSales")?.text });

  const mirror = (window.__itestWrites || [])
    .filter((w) => w.ref.includes("/dailyStats/"))
    .map((w) => Array.isArray(w.data?.salesHistory) ? w.data.salesHistory : []);
  const lastMirror = mirror[mirror.length - 1] || [];
  const counts = {};
  for (const o of lastMirror) {
    const id = String(o?.orderId || o?.id || "");
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  const maxDupe = Math.max(0, ...Object.values(counts));
  step("mirror", { copies: lastMirror.length, maxPerOrder: maxDupe });

  window.__itestResults = results;
}
// Sudden network drop: navigator.onLine is still true but every Firestore write
// hangs (the stub never settles setDoc). The bounded-write timeouts must queue
// the order locally so the sale is recorded (receipt + stats) instead of
// spinning forever on "Working...".
async function runOfflineSaveTest() {
  const results = { steps: [], mode: "offlinesave", errors: [] };
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = (id) => {
    const e = el(id);
    return e ? { text: e.textContent, value: e.value } : null;
  };
  const step = (name, extra = {}) => results.steps.push([name, extra]);

  for (let i = 0; i < 200 && typeof window.completePayment !== "function"; i++) await wait(50);
  for (let i = 0; i < 200 && !el("productsGrid")?.querySelector(".product-card"); i++) await wait(50);
  step("menu", { cards: el("productsGrid")?.querySelectorAll(".product-card").length || 0 });

  window.openMenuItemModal("p1");
  window.confirmMenuItem();
  window.openPaymentModal();

  const t0 = Date.now();
  await window.completePayment();
  const elapsedMs = Date.now() - t0;
  await wait(300);
  step("placed", { elapsedMs, orders: read("todayOrders")?.text, total: read("totalSales")?.text });

  let outbox = [];
  try { outbox = JSON.parse(localStorage.getItem("brotherBean_orderOutbox") || "[]"); } catch {}
  step("outbox", { count: outbox.length, hasOrderId: !!(outbox[0]?.payload?.orderId), status: outbox[0]?.payload?.status });

  window.__itestResults = results;
}
// Cancel pending order flow: the Firestore soft-void must (a) write the void
// fields to /orders/{orderId}, (b) drop the sale from local history so the POS
// no longer counts it, and (c) FAIL visibly — leaving the order pending — when
// the void write is rejected (e.g. rules not deployed), instead of falsely
// reporting the order cancelled while it stays live in Firestore.
async function runCancelFlowTest() {
  const results = { steps: [], mode: "cancelflow", errors: [] };
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = (id) => {
    const e = el(id);
    return e ? { text: e.textContent, value: e.value } : null;
  };
  const step = (name, extra = {}) => results.steps.push([name, extra]);

  const d = new Date();
  const todayKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const orderId = "test-order-void-1";
  const seedHistory = () => localStorage.setItem("brotherBean_salesHistory_" + todayKey, JSON.stringify([
    { id: orderId, orderId, createdAtMs: Date.now(), total: 250, paymentMethod: "cash", status: "paid" },
  ]));
  const seedKitchen = (id, total) => localStorage.setItem("brotherBean_kitchenOrders", JSON.stringify([
    { id, createdAt: Date.now(), payload: { orderId: id, createdAtMs: Date.now(), total, paymentMethod: "cash", status: "paid", items: [{ name: "Test", price: total, quantity: 1 }] } },
  ]));

  try {
    localStorage.setItem("brotherBean_lastResetDate", new Date().toDateString());
    seedHistory();
    seedKitchen(orderId, 250);
  } catch (e) {}

  for (let i = 0; i < 200 && typeof window.cancelPendingOrder !== "function"; i++) await wait(50);

  window.openPendingOrdersModal();
  await wait(100);
  step("pendingBefore", { listed: String(el("pendingOrdersModalList")?.innerHTML || "").includes(orderId) });
  window.closePendingOrdersModal();

  // Success path: the order doc exists in Firestore, so the void must update it.
  window.__itestExistingDocs = { ["/orders/" + orderId]: { status: "paid", total: 250 } };
  const cancelPromise = window.cancelPendingOrder(orderId);
  await wait(150);
  step("confirmShown", { open: !!document.getElementById("confirmModal")?.classList.contains("active") });
  window.resolveConfirm(true);
  await cancelPromise;
  await wait(300);

  const voidWrites = (window.__itestWrites || []).filter((w) => w.ref === "/orders/" + orderId && w.data && w.data.voided === true);
  step("voidWrite", { count: voidWrites.length, data: voidWrites[0]?.data });
  step("afterCancel", { orders: read("todayOrders")?.text, total: read("totalSales")?.text });

  // Regression: after a soft-void the order doc must STILL be returned by
  // getAllSalesOrders({ includeVoided: true }) so the admin transactions page
  // keeps the cancellation visible. Without includeVoided it must be excluded.
  window.__itestOrdersDocs = [{
    id: orderId,
    orderId,
    status: "cancelled",
    voided: true,
    total: 250,
    paymentMethod: "cash",
    createdAtMs: Date.now(),
    items: [{ name: "Test", price: 250, quantity: 1 }],
  }];
  const salesOrders = await (await import("/models/orderModel.js")).getAllSalesOrders(null, null, { includeVoided: true });
  step("salesOrdersIncludeVoided", { hasOrder: salesOrders.some((o) => String(o.orderId || o.id) === orderId) });
  const salesOrdersDefault = await (await import("/models/orderModel.js")).getAllSalesOrders();
  step("salesOrdersDefault", { hasOrder: salesOrdersDefault.some((o) => String(o.orderId || o.id) === orderId) });
  let history = [];
  try { history = JSON.parse(localStorage.getItem("brotherBean_salesHistory_" + todayKey) || "[]"); } catch {}
  step("historyAfter", { count: history.length, hasOrder: history.some((o) => String(o.orderId || o.id) === orderId) });
  let kitchen = [];
  try { kitchen = JSON.parse(localStorage.getItem("brotherBean_kitchenOrders") || "[]"); } catch {}
  step("kitchenAfter", { hasOrder: kitchen.some((o) => String(o.id) === orderId) });

  // Failure path: rejected void write must NOT cancel — order stays pending and
  // local records are untouched.
  const id2 = "test-order-void-2";
  window.__itestExistingDocs = { ["/orders/" + id2]: { status: "paid", total: 99 } };
  window.__itestForceUpdateDocFail = true;
  seedKitchen(id2, 99);
  localStorage.setItem("brotherBean_salesHistory_" + todayKey, JSON.stringify([
    { id: id2, orderId: id2, createdAtMs: Date.now(), total: 99, paymentMethod: "cash", status: "paid" },
  ]));
  const failPromise = window.cancelPendingOrder(id2);
  await wait(150);
  window.resolveConfirm(true);
  await failPromise;
  await wait(150);
  window.__itestForceUpdateDocFail = false;
  kitchen = [];
  try { kitchen = JSON.parse(localStorage.getItem("brotherBean_kitchenOrders") || "[]"); } catch {}
  history = [];
  try { history = JSON.parse(localStorage.getItem("brotherBean_salesHistory_" + todayKey) || "[]"); } catch {}
  step("failPath", {
    stillPending: kitchen.some((o) => String(o.id) === id2),
    historyUntouched: history.some((o) => String(o.orderId || o.id) === id2),
    toast: el("toastMessage")?.textContent || "",
    toastShown: document.getElementById("toast")?.classList.contains("show") || false,
  });

  // Mark-prepared flow: flipping an order to done updates the order doc with
  // status "done" + preparedAtMs and removes it from the kitchen list.
  const id3 = "test-order-prepared-3";
  window.__itestExistingDocs = { ["/orders/" + id3]: { status: "pending", total: 75 } };
  seedKitchen(id3, 75);
  await window.markPendingOrderPrepared(id3);
  await wait(150);
  const preparedWrites = (window.__itestWrites || []).filter((w) => w.ref === "/orders/" + id3 && w.data && w.data.status === "done");
  kitchen = [];
  try { kitchen = JSON.parse(localStorage.getItem("brotherBean_kitchenOrders") || "[]"); } catch {}
  step("markPrepared", {
    orderStatusWrite: preparedWrites.length,
    preparedAtMsType: typeof preparedWrites[0]?.data?.preparedAtMs,
    removedFromKitchen: !kitchen.some((o) => String(o.id) === id3),
  });

  window.__itestResults = results;
}

// Clicking the drawer button must NOT open the modal or persist anything until
// init has loaded today's stats (the firestore stub is slowed via ?slowinit=1
// so the pre-init window is deterministic).
async function runGuardTest() {
  const results = { steps: [], mode: "guard", errors: [] };
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const openModal = () => {
    const m = el("drawerModal");
    return !!m && m.classList.contains("active");
  };

  for (let i = 0; i < 200 && typeof window.openDrawer !== "function"; i++) await wait(50);
  const drawerBtn = [...document.querySelectorAll("[onclick]")]
    .find((b) => (b.getAttribute("onclick") || "").includes("openDrawer"));

  const tClick = Date.now();
  if (drawerBtn) drawerBtn.click();
  results.steps.push(["preInitClick", { found: !!drawerBtn, modalOpen: openModal(), wroteBefore: (window.__itestWrites || []).length }]);

  let firstWriteMs = null;
  for (let i = 0; i < 200; i++) {
    if ((window.__itestWrites || []).length > 0) { firstWriteMs = Date.now() - tClick; break; }
    await wait(50);
  }
  results.steps.push(["firstWriteDelayMs", firstWriteMs]);

  for (let i = 0; i < 200 && openModal() === false; i++) {
    window.openDrawer();
    await wait(100);
  }
  results.steps.push(["postInitClick", { modalOpen: openModal() }]);

  window.__itestResults = results;
}

run().catch((err) => {
  window.__itestResults = { fatal: String(err && err.stack || err) };
});
</script>`;

app.get("/itest.html", async (req, res) => {
  let html = await readFile(`${ROOT}/views/pages/pos.html`, "utf8");
  html = html.replace("</head>", `${IMPORTMAP}${PRE_SCRIPT}</head>`);
  html = html.replace("</body>", `${TEST_SCRIPT}</body>`);
  res.type("html").send(html);
});

app.use("/itest-stubs", express.static(`${ROOT}/scripts/itest-stubs`));
app.use(express.static(ROOT, { index: false }));

const server = app.listen(PORT, async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  let failed = false;
  const attach = (page, label) => {
    page.on("pageerror", (err) => console.log(`[${label}] PAGE ERROR:`, err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warn") console.log(`[${label}][console.${msg.type()}]`, msg.text().slice(0, 300));
    });
  };
  const waitResults = async (page) => {
    for (let i = 0; i < 100 && !await page.evaluate(() => window.__itestResults); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return page.evaluate(() => window.__itestResults || null);
  };

  try {
    // Main flow page
    const page = await browser.newPage();
    attach(page, "main");
    await page.goto(`http://localhost:${PORT}/itest.html`, { waitUntil: "networkidle0", timeout: 60000 });
    const results = await waitResults(page);
    if (!results) {
      console.log("FAIL: itest produced no results");
      failed = true;
    } else if (results.fatal) {
      console.log(`FAIL: ${results.fatal}`);
      failed = true;
    } else {
      const step = (name) => results.steps.find((s) => s[0] === name)?.[1];
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);
      const initial = step("initial");
      const popup = step("popupCount");
      const afterCount = step("afterCount");
      const afterIn = step("afterIn");
      const afterOut = step("afterOut");
      const afterCancel = step("afterCancel");
      const lastWrite = step("mirrorWrites")?.slice(-1)[0]?.dailyStats;
      const local = step("localStorageStats");
      check("stale deleted order pruned at init", String(initial?.stats?.orders?.text) === "0" && !String(initial?.stats?.total?.text).includes("999"));
      check("popup opened for record count", popup?.open === true);
      check("popup message shows amount", String(popup?.msg || "").includes("₱3500.00"));
      check("badge updated immediately after confirm", String(afterCount?.badge?.text || "").startsWith("Over"));
      check("variance note updated immediately", String(afterCount?.note?.text || "").includes("Counted ₱3500.00"));
      check("popup closed after confirm", afterCount?.popupOpen === false);
      check("ledger note updated immediately after cash in", String(afterIn?.ledgerNote?.text || "").includes("Cash in ₱500.00"));
      check("history shows cash in entry immediately", String(afterIn?.history?.html || "").includes("+₱500.00") && String(afterIn?.history?.html || "").includes("Change top-up"));
      check("ledger note updated immediately after cash out", String(afterOut?.ledgerNote?.text || "").includes("Cash out ₱200.00"));
      check("history shows cash out entry immediately", String(afterOut?.history?.html || "").includes("−₱200.00"));
      check("badge re-rendered after cash out", String(afterOut?.badge?.text || "").startsWith("Over"));
      check("cancel leaves state untouched", afterCancel?.popupOpen === false && String(afterCancel?.ledgerNote?.text || "").includes("Cash out ₱200.00"));
      check("mirror write persisted ledger", Array.isArray(lastWrite?.ledgerEntries) && lastWrite.ledgerEntries.length === 2);
      check("mirror write persisted manual mode", lastWrite?.cashOnHandAuto === false && lastWrite?.actualCash === 3500);
      check("localStorage persisted ledger", Array.isArray(local?.ledgerEntries) && local.ledgerEntries.length === 2 && local.cashIn === 500 && local.cashOut === 200);

      const failures = checks.filter(Boolean);
      if (failures.length === 0) {
        console.log("PASS: Integration (real controller + real models + real DOM) checks succeeded.");
      } else {
        console.log(`FAIL: ${failures.length} integration check(s):`);
        failures.forEach((f) => console.log(`  - ${f}`));
        failed = true;
      }
    }

    // Pre-init guard page (slowed Firestore stub)
    const guardPage = await browser.newPage();
    attach(guardPage, "guard");
    await guardPage.goto(`http://localhost:${PORT}/itest.html?slowinit=1`, { waitUntil: "networkidle0", timeout: 60000 });
    const guardResults = await waitResults(guardPage);
    if (!guardResults) {
      console.log("FAIL: guard test produced no results");
      failed = true;
    } else if (guardResults.fatal) {
      console.log(`FAIL (guard): ${guardResults.fatal}`);
      failed = true;
    } else {
      const gstep = (name) => guardResults.steps.find((s) => s[0] === name)?.[1];
      const pre = gstep("preInitClick");
      const delay = gstep("firstWriteDelayMs");
      const post = gstep("postInitClick");
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);
      check("drawer button exists", pre?.found === true);
      check("pre-init click blocked (modal stays closed)", pre?.modalOpen === false);
      check("no writes before init completed", pre?.wroteBefore === 0);
      check("first persist waited for init", typeof delay === "number" && delay > 1000);
      check("drawer opens once init completed", post?.modalOpen === true);
      const failures = checks.filter(Boolean);
      if (failures.length === 0) {
        console.log("PASS: Pre-init drawer guard checks succeeded.");
      } else {
        console.log(`FAIL: ${failures.length} guard check(s):`);
        failures.forEach((f) => console.log(`  - ${f}`));
        failed = true;
      }
    }

    // Offline-prune page (orders fetch fails, like starting offline)
    const prunePage = await browser.newPage();
    attach(prunePage, "prune");
    await prunePage.goto(`http://localhost:${PORT}/itest.html?initfail=1`, { waitUntil: "networkidle0", timeout: 60000 });
    const pruneResults = await waitResults(prunePage);
    if (!pruneResults) {
      console.log("FAIL: prune test produced no results");
      failed = true;
    } else if (pruneResults.fatal) {
      console.log(`FAIL (prune): ${pruneResults.fatal}`);
      failed = true;
    } else {
      const pstep = (name) => pruneResults.steps.find((s) => s[0] === name)?.[1];
      const init = pstep("init");
      const cached = pstep("cachedSnapshot");
      const server = pstep("serverSnapshot");
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);
      check("offline-like init keeps local stale + queued orders", init?.orders === "2" && String(init?.total || "").includes("1149"));
      check("cached snapshot does NOT prune", cached?.orders === "2" && String(cached?.total || "").includes("1149"));
      check("server snapshot prunes stale but keeps queued", server?.orders === "1" && String(server?.total || "") === "₱150.00" && !String(server?.total || "").includes("999"));
      const failures = checks.filter(Boolean);
      if (failures.length === 0) {
        console.log("PASS: Offline-safe prune checks succeeded.");
      } else {
        console.log(`FAIL: ${failures.length} prune check(s):`);
        failures.forEach((f) => console.log(`  - ${f}`));
        console.log(`  prune steps: ${JSON.stringify(pruneResults.steps)}`);
        failed = true;
      }
    }
    // Order-placement page: the order's own write fires the today-orders
    // listener before completePayment resumes, so the sale must be merged
    // (de-duped) rather than blindly pushed to avoid double-counting.
    const placePage = await browser.newPage();
    attach(placePage, "placeorder");
    await placePage.goto(`http://localhost:${PORT}/itest.html?placeorder=1`, { waitUntil: "networkidle0", timeout: 60000 });
    const placeResults = await waitResults(placePage);
    if (!placeResults) {
      console.log("FAIL: order-dedupe test produced no results");
      failed = true;
    } else if (placeResults.fatal) {
      console.log(`FAIL (placeorder): ${placeResults.fatal}`);
      failed = true;
    } else {
      const pstep = (name) => placeResults.steps.find((s) => s[0] === name)?.[1];
      const menu = pstep("menu");
      const cart = pstep("cart");
      const placed = pstep("placed");
      const mirror = pstep("mirror");
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);
      check("seeded menu item rendered", menu?.cards === 1);
      check("cart total captured before payment", String(cart?.total || "") === "₱100.00" && String(cart?.subtotal || "") === "₱100.00");
      check("order counted exactly once after placement", placed?.orders === "1");
      check("sales total counted exactly once", String(placed?.total || "") === "₱100.00");
      check("mirror holds exactly one copy of the order", mirror?.copies === 1 && mirror?.maxPerOrder === 1);
      const failures = checks.filter(Boolean);
      if (failures.length === 0) {
        console.log("PASS: Order placement de-duplication checks succeeded.");
      } else {
        console.log(`FAIL: ${failures.length} order-dedupe check(s):`);
        failures.forEach((f) => console.log(`  - ${f}`));
        console.log(`  placeorder steps: ${JSON.stringify(placeResults.steps)}`);
        failed = true;
      }
    }
    // Sudden-offline page: Firestore writes hang, so the bounded-write timeouts
    // must queue the order locally and still complete the sale UI.
    const offlinePage = await browser.newPage();
    attach(offlinePage, "offlinesave");
    await offlinePage.goto(`http://localhost:${PORT}/itest.html?offlinesave=1&bbOrderWriteTimeoutMs=300&bbInventoryDeductionTimeoutMs=300&bbKitchenWriteTimeoutMs=300`, { waitUntil: "networkidle0", timeout: 60000 });
    const offlineResults = await waitResults(offlinePage);
    if (!offlineResults) {
      console.log("FAIL: offline-save test produced no results");
      failed = true;
    } else if (offlineResults.fatal) {
      console.log(`FAIL (offlinesave): ${offlineResults.fatal}`);
      failed = true;
    } else {
      const ostep = (name) => offlineResults.steps.find((s) => s[0] === name)?.[1];
      const menu = ostep("menu");
      const placed = ostep("placed");
      const outbox = ostep("outbox");
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);
      check("seeded menu item rendered", menu?.cards === 1);
      check("payment completed without hanging on the drop", typeof placed?.elapsedMs === "number" && placed.elapsedMs < 3000);
      check("order counted exactly once while queued", placed?.orders === "1" && String(placed?.total || "") === "₱100.00");
      check("order queued to the local outbox", outbox?.count === 1 && outbox?.hasOrderId === true && outbox?.status === "pending");
      const failures = checks.filter(Boolean);
      if (failures.length === 0) {
        console.log("PASS: Sudden-offline order queueing checks succeeded.");
      } else {
        console.log(`FAIL: ${failures.length} offline-save check(s):`);
        failures.forEach((f) => console.log(`  - ${f}`));
        console.log(`  offlinesave steps: ${JSON.stringify(offlineResults.steps)}`);
        failed = true;
      }
    }
    // Cancel pending order flow: soft-void success + failure handling.
    const cancelPage = await browser.newPage();
    attach(cancelPage, "cancelflow");
    await cancelPage.goto(`http://localhost:${PORT}/itest.html?cancelflow=1`, { waitUntil: "networkidle0", timeout: 60000 });
    const cancelResults = await waitResults(cancelPage);
    if (!cancelResults) {
      console.log("FAIL: cancel-flow test produced no results");
      failed = true;
    } else if (cancelResults.fatal) {
      console.log(`FAIL (cancelflow): ${cancelResults.fatal}`);
      failed = true;
    } else {
      const cstep = (name) => cancelResults.steps.find((s) => s[0] === name)?.[1];
      const pendingBefore = cstep("pendingBefore");
      const confirmShown = cstep("confirmShown");
      const voidWrite = cstep("voidWrite");
      const afterCancel = cstep("afterCancel");
      const historyAfter = cstep("historyAfter");
      const kitchenAfter = cstep("kitchenAfter");
      const failPath = cstep("failPath");
      const markPrepared = cstep("markPrepared");
      const salesOrdersIncludeVoided = cstep("salesOrdersIncludeVoided");
      const salesOrdersDefault = cstep("salesOrdersDefault");
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);
      check("pending modal lists the order before cancel", pendingBefore?.listed === true);
      check("confirm popup shown before cancel", confirmShown?.open === true);
      check("void write targets /orders/{orderId}", voidWrite?.count === 1);
      check("void write carries the audit fields", !!voidWrite?.data?.voided && typeof voidWrite?.data?.voidedAtMs === "number" && String(voidWrite?.data?.voidedBy || "") === "Staff");
      check("void write flips status to cancelled", voidWrite?.data?.status === "cancelled" && typeof voidWrite?.data?.cancelledAtMs === "number");
      check("POS no longer counts the order", String(afterCancel?.orders || "") === "0" && String(afterCancel?.total || "").includes("₱250.00") === false);
      check("local history purged the order", historyAfter?.count === 0 && historyAfter?.hasOrder === false);
      check("pending/kitchen list purged the order", kitchenAfter?.hasOrder === false);
      check("rejected void write leaves the order pending", failPath?.stillPending === true);
      check("rejected void write leaves local records untouched", failPath?.historyUntouched === true);
      check("rejected void write surfaces a failure toast", failPath?.toastShown === true && String(failPath?.toast || "").includes("Unable to cancel"));
      check("mark prepared updates order to status done", markPrepared?.orderStatusWrite === 1 && markPrepared?.preparedAtMsType === "number");
      check("mark prepared removes order from kitchen list", markPrepared?.removedFromKitchen === true);
      check("admin transactions keeps the cancelled order (includeVoided)", salesOrdersIncludeVoided?.hasOrder === true);
      check("default sales orders exclude the cancelled order", salesOrdersDefault?.hasOrder === false);
      const failures = checks.filter(Boolean);
      if (failures.length === 0) {
        console.log("PASS: Cancel pending order (soft-void) checks succeeded.");
      } else {
        console.log(`FAIL: ${failures.length} cancel-flow check(s):`);
        failures.forEach((f) => console.log(`  - ${f}`));
        console.log(`  cancelflow steps: ${JSON.stringify(cancelResults.steps)}`);
        failed = true;
      }
    }
  } finally {
    await browser.close();
    server.close();
    if (failed) process.exitCode = 1;
  }
});
