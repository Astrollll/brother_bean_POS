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
// Clicking it must NOT open the modal or persist anything until init has
// loaded today's stats (the firestore stub is slowed via ?slowinit=1 so the
// pre-init window is deterministic).
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
      check("badge updated immediately after confirm", String(afterCount?.badge?.text || "").startsWith("Overage"));
      check("variance note updated immediately", String(afterCount?.note?.text || "").includes("Counted ₱3500.00"));
      check("popup closed after confirm", afterCount?.popupOpen === false);
      check("ledger note updated immediately after cash in", String(afterIn?.ledgerNote?.text || "").includes("Cash in ₱500.00"));
      check("history shows cash in entry immediately", String(afterIn?.history?.html || "").includes("+₱500.00") && String(afterIn?.history?.html || "").includes("Change top-up"));
      check("ledger note updated immediately after cash out", String(afterOut?.ledgerNote?.text || "").includes("Cash out ₱200.00"));
      check("history shows cash out entry immediately", String(afterOut?.history?.html || "").includes("−₱200.00"));
      check("badge re-rendered after cash out", String(afterOut?.badge?.text || "").startsWith("Overage"));
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
  } finally {
    await browser.close();
    server.close();
    if (failed) process.exitCode = 1;
  }
});
