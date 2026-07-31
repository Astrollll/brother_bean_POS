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
  const results = { steps: [], errors: [] };
  const el = (id) => document.getElementById(id);
  const read = (id) => {
    const e = el(id);
    return e ? { text: e.textContent, value: e.value, html: e.innerHTML } : null;
  };

  for (let i = 0; i < 200 && typeof window.askDrawerConfirm !== "function"; i++) await wait(50);
  if (typeof window.askDrawerConfirm !== "function") {
    results.fatal = "handlers never attached";
    window.__itestResults = results;
    return;
  }
  await wait(500);

  window.openDrawer();
  results.steps.push(["initial", read("drawerVarianceBadge")]);

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
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warn") console.log(`[console.${msg.type()}]`, msg.text().slice(0, 300));
    });
    await page.goto(`http://localhost:${PORT}/itest.html`, { waitUntil: "networkidle0", timeout: 60000 });
    for (let i = 0; i < 100 && !await page.evaluate(() => window.__itestResults); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const results = await page.evaluate(() => window.__itestResults || null);
    if (!results) {
      console.log("FAIL: itest produced no results");
      process.exitCode = 1;
    } else if (results.fatal) {
      console.log(`FAIL: ${results.fatal}`);
      process.exitCode = 1;
    } else {
      const step = (name) => results.steps.find((s) => s[0] === name)?.[1];
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);
      const popup = step("popupCount");
      const afterCount = step("afterCount");
      const afterIn = step("afterIn");
      const afterOut = step("afterOut");
      const afterCancel = step("afterCancel");
      const lastWrite = step("mirrorWrites")?.slice(-1)[0]?.dailyStats;
      const local = step("localStorageStats");
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
        process.exitCode = 1;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
});
