import express from "express";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";

const ROOT = process.cwd();
const PORT = 8901;

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

async function listJsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listJsFiles(full)));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

async function checkNoDualModuleInstances() {
  const problems = [];
  const controllerFiles = await listJsFiles(join(ROOT, "controllers"));
  const modelFiles = await listJsFiles(join(ROOT, "models"));
  const modelBasenames = new Set(modelFiles.map((f) => f.split(/[\\/]/).pop()));

  for (const file of modelFiles) {
    const src = await readFile(file, "utf8");
    const m = src.match(/from\s+"([^"]*\.js\?v=[^"]*)"/);
    if (m) problems.push(`${file}: versioned import ${m[1]} (models must be unversioned)`);
  }

  for (const file of controllerFiles) {
    const src = await readFile(file, "utf8");
    for (const m of src.matchAll(/from\s+"([^"]*\.js)(\?v=[^"]*)"/g)) {
      const basename = m[1].split("/").pop();
      if (modelBasenames.has(basename)) {
        problems.push(`${file}: versioned import of a model (dual-instance risk) ${m[1]}${m[2]}`);
      } else if (!/views\//.test(m[1])) {
        problems.push(`${file}: versioned non-view import ${m[1]}${m[2]}`);
      }
    }
  }

  const admin = await readFile(join(ROOT, "controllers/admin/adminPortalController.js"), "utf8");
  if (/from\s+"[^"]*orderModel\.js\?v=/.test(admin)) {
    problems.push("adminPortalController.js imports orderModel.js with a ?v= query (dual-instance risk)");
  }

  return { ok: problems.length === 0, problems };
}

app.get("/itest-model.html", async (req, res) => {
  const html = `<!doctype html><html><head><meta charset="utf-8">${IMPORTMAP}${PRE_SCRIPT}</head><body><script type="module" src="/itest-model-run.js"></script></body></html>`;
  res.type("html").send(html);
});

app.get("/itest-model-run.js", async (req, res) => {
  res.type("js").send(await readFile(`${ROOT}/scripts/itest-model-run.js`, "utf8"));
});

app.use("/itest-stubs", express.static(`${ROOT}/scripts/itest-stubs`));
app.use(express.static(ROOT, { index: false }));

const server = app.listen(PORT, async () => {
  const staticResult = await checkNoDualModuleInstances();
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  let failed = false;

  const attach = (page, label) => {
    page.on("pageerror", (err) => console.log(`[${label}] PAGE ERROR:`, err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[${label}][console.error]`, msg.text().slice(0, 200));
    });
  };

  try {
    if (!staticResult.ok) {
      console.log("FAIL: static dual-module-instance check:");
      staticResult.problems.forEach((p) => console.log(`  - ${p}`));
      failed = true;
    } else {
      console.log("PASS: no versioned model imports (single module instance per model).");
    }

    const page = await browser.newPage();
    attach(page, "model");
    await page.goto(`http://localhost:${PORT}/itest-model.html`, { waitUntil: "networkidle0", timeout: 60000 });

    let results = null;
    for (let i = 0; i < 100 && !results; i++) {
      results = await page.evaluate(() => window.__itestResults || null);
      if (!results) await new Promise((r) => setTimeout(r, 100));
    }
    if (!results) {
      console.log("FAIL: model itest produced no results");
      failed = true;
    } else if (results.fatal) {
      console.log(`FAIL: ${results.fatal}`);
      failed = true;
    } else {
      const sstep = (name) => results.steps.find((s) => s[0] === name)?.[1];
      const checks = [];
      const check = (label, cond) => checks.push(cond ? null : label);

      const graph = sstep("graph");
      check("module graph error-free", !graph?.error);
      check("settings model exports", graph?.settings === true);
      check("menu model exports", graph?.menu === true);
      check("category model exports", graph?.category === true);
      check("order model exports", graph?.order === true);
      check("reset model exports", graph?.reset === true);
      check("dashboardView module loads (new storage/staff imports resolve)", graph?.dashboardView === true);

      const settings = sstep("settings");
      check("settings: offline save queued", settings?.queued === true);
      check("settings: pending overrides local/fallback", settings?.pendingWins === true);
      check("settings: failed sync keeps pending", settings?.syncFailedKeepsPending === true);
      check("settings: flush succeeds and clears", settings?.flushSucceeds === true);
      check("settings: mirror write persisted", settings?.mirrorWrite === true);

      const menu = sstep("menu");
      check("menu: offline ops queued", menu?.opsQueued === true);
      check("menu: pending ops applied over server list", menu?.appliedOverServer === true);
      check("menu: failed sync keeps pending", menu?.syncFailedKeepsPending === true);
      check("menu: flush succeeds and clears", menu?.flushSucceeds === true);
      check("menu: mirror setDoc write", menu?.mirrorSetWrite === true);
      check("menu: mirror deleteDoc write", menu?.mirrorDeleteWrite === true);

      const dedupe = sstep("menuDedupe");
      check("menu: repeated offline save de-dupes to one op", dedupe?.singleSaveOp === true);

      const stale = sstep("menuStaleOps");
      check("menu: online re-save clears stale queued delete", stale?.pendingCleared === true && stale?.localCacheKeepsItem === true);

      const category = sstep("category");
      check("category: offline upsert queued", category?.upsertQueued === true);
      check("category: merge shows local upsert", category?.mergeShowsUpsert === true);
      check("category: deleted ids honored in merge", category?.deleteHonored === true);
      check("category: failed sync keeps pending", category?.syncFailedKeepsPending === true);
      check("category: flush succeeds", category?.flushSucceeds === true);
      check("category: cache cleared after flush", category?.cacheClearedAfterFlush === true);
      check("category: mirror upsert write", category?.mirrorUpsertWrite === true);
      check("category: mirror delete write", category?.mirrorDeleteWrite === true);

      const failures = checks.filter(Boolean);
      if (failures.length === 0) {
        console.log("PASS: Model outbox + module-graph checks succeeded.");
      } else {
        console.log(`FAIL: ${failures.length} model check(s):`);
        failures.forEach((f) => console.log(`  - ${f}`));
        console.log(`  steps: ${JSON.stringify(results.steps)}`);
        failed = true;
      }
    }
  } finally {
    await browser.close();
    server.close();
    if (failed) process.exitCode = 1;
  }
});
