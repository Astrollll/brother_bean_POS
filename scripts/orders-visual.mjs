import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";

const CONTROLLER_PATH = "controllers/admin/adminPortalController.js";
const BLOCK_START_MARKER = "function getOrderDate(";
const BLOCK_END_MARKER = "function bindOrdersControls(";
const OUT_DIR = process.env.TEMP || "C:/Users/user/AppData/Local/Temp/opencode";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function build() {
  const [controllerSource, cssSource] = await Promise.all([
    readFile(CONTROLLER_PATH, "utf8"),
    readFile("assets/adminstyle.css", "utf8"),
  ]);
  const lines = controllerSource.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.startsWith(BLOCK_START_MARKER));
  const endIdx = lines.findIndex((l) => l.startsWith(BLOCK_END_MARKER));
  if (startIdx < 0 || endIdx <= startIdx) {
    fail(`Could not locate block markers (${BLOCK_START_MARKER} / ${BLOCK_END_MARKER})`);
  }
  const block = lines.slice(startIdx, endIdx).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${cssSource}</style>
<style>
  body { background: #f7f4f0; padding: 24px; font-family: system-ui, sans-serif; }
  .visual-shell { max-width: 1200px; margin: 0 auto; }
  .visual-kpi { margin-bottom: 12px; }
  #visualError { color: #b91c1c; font-weight: 700; white-space: pre-wrap; }
  .od-note { white-space: pre-wrap; }
</style>
</head>
<body>
<div class="visual-shell">
  <div id="visualError"></div>
  <div class="orders-kpi-row visual-kpi">
    <div class="orders-kpi-card"><div class="orders-kpi-label">Filtered Transactions</div><div class="orders-kpi-value" id="ordersCountKpi">0</div></div>
    <div class="orders-kpi-card"><div class="orders-kpi-label">Filtered Sales</div><div class="orders-kpi-value" id="ordersTotalKpi">P0.00</div></div>
  </div>
  <div class="card compact-card">
    <div id="ordersTableWrap" class="tbl-wrap" style="padding:12px"></div>
    <div id="ordersPagination" class="orders-pagination"></div>
  </div>
</div>
<script>
${block}
const escapeHtml = (value = "") => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const state = { allOrders: [], filteredOrders: [], pagedOrders: [], orderStockExpanded: {} };
const orderFilters = { search: "", payment: "all", sortBy: "latest", pageSize: 10, page: 1, fromDate: "", toDate: "", preset: "" };
const ModalUtils = { confirm: async () => 1, success: async () => {}, error: async () => {}, warning: async () => {} };
const deleteOrder = async () => {};
const loadOrdersPage = async () => {};
const getAllSalesOrders = async () => [];
const formatMoney = (n) => "P" + (Number(n) || 0).toFixed(2);
const ts = (d) => ({ toDate: () => d });
const daysAgo = (n, hour = 10, min = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, min, 0, 0); return d; };

state.allOrders = [
  { id: "v1", orderId: "v1", items: [{ name: "Spanish Latte", quantity: 2, price: 150 }, { name: "Butter Croissant", quantity: 1, price: 95 }, { name: "Iced Mocha", quantity: 1, price: 135 }], paymentMethod: "gcash", total: 530, orderType: "regular", note: "Extra hot, less sweet, in a big cup please", createdAt: ts(daysAgo(0, 9, 5)), inventoryDeductions: [{ inventoryId: "i1", name: "Milk", unit: "ml", deductedQty: 100, remainingQty: 900 }], inventorySkips: [{ name: "Vanilla Syrup", reason: "not found in inventory" }] },
  { id: "v2", orderId: "v2", items: [{ name: "Americano", quantity: 1, price: 110 }], paymentMethod: "cash", total: 110, orderType: "regular", note: "", createdAt: ts(daysAgo(0, 11, 40)) },
  { id: "v3", orderId: "v3", items: [{ name: "Cappuccino", quantity: 1, price: 125, discountPercent: 0.2 }], paymentMethod: "card", total: 100, orderType: "regular", note: "No foam, oat milk", createdAt: ts(daysAgo(1, 8, 15)) },
  { id: "v4", orderId: "v4", items: [{ name: "Espresso", quantity: 2, price: 90 }], paymentMethod: "split", cashAmount: 90, gcashAmount: 90, total: 180, orderType: "regular", note: "".repeat(0), createdAt: ts(daysAgo(1, 14, 20)) },
  { id: "v5", orderId: "v5", items: [{ name: "Matcha Latte", quantity: 1, price: 145 }], paymentMethod: "employee", total: 0, orderType: "employee", note: "Staff break drink", createdAt: ts(daysAgo(2, 16, 45)) },
  { id: "v6", orderId: "v6", items: [{ name: "Caramel Macchiato", quantity: 1, price: 155 }], paymentMethod: "cash", total: 145, orderType: "regular", isPwdSenior: true, note: "PWD 20% off applied", createdAt: ts(daysAgo(2, 10, 10)) },
  { id: "v7", orderId: "v7", items: [{ name: "Iced Tea", quantity: 3, price: 80 }], paymentMethod: "cash", total: 240, orderType: "regular", note: "A".repeat(300), createdAt: ts(daysAgo(3, 12, 0)), inventoryDeductions: [{ inventoryId: "i1", name: "Black Tea", unit: "g", deductedQty: 45, remainingQty: 500 }] },
  { id: "v8", orderId: "v8", items: [{ name: "Hot Choco", quantity: 1, price: 120 }], paymentMethod: "maya", total: 120, orderType: "regular", note: "", createdAt: ts(daysAgo(30, 13, 0)) },
];
window.__applyOrderFilters = applyOrderFilters;
window.__state = state;
window.__orderFilters = orderFilters;
applyOrderFilters();
</script>
</body>
</html>`;

  const outFile = join(OUT_DIR, "orders-visual.html");
  await writeFile(outFile, html, "utf8");
  return outFile;
}

async function run() {
  const url = "file:///" + (await build()).replaceAll("\\", "/");
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

    await page.setViewport({ width: 1440, height: 1400 });
    await page.goto(url, { waitUntil: "networkidle0" });

    // 1. Basic table render assertions
    const summary = await page.evaluate(() => {
      const wrap = document.getElementById("ordersTableWrap");
      const html = wrap.innerHTML;
      return {
        hasTable: html.includes('class="orders-table"'),
        groupCount: (html.match(/orders-date-group/g) || []).length,
        mainRows: (html.match(/orders-main-row/g) || []).length,
        detailRows: (html.match(/orders-detail-row/g) || []).length,
        sortButtons: (html.match(/orders-sort-btn/g) || []).length,
        hasArrow: html.includes("orders-sort-arrow"),
        chips: (html.match(/orders-item-chip/g) || []).length,
        noteInline: (html.match(/orders-note-inline/g) || []).length,
        pagination: document.getElementById("ordersPagination").innerHTML.includes("Showing"),
        kpiCount: document.getElementById("ordersCountKpi").textContent,
      };
    });
    if (!summary.hasTable) fail("visual: table not rendered");
    if (summary.groupCount !== 5) fail(`visual: expected 5 date groups, got ${summary.groupCount}`);
    if (summary.mainRows !== 8) fail(`visual: expected 8 main rows, got ${summary.mainRows}`);
    if (summary.sortButtons !== 5) fail(`visual: expected 5 sort headers, got ${summary.sortButtons}`);
    if (!summary.hasArrow) fail("visual: sort arrow missing");
    if (summary.noteInline !== 5) fail(`visual: expected 5 note previews, got ${summary.noteInline}`);
    if (!summary.pagination) fail("visual: pagination missing");
    console.log(`OK render: groups=${summary.groupCount} rows=${summary.mainRows} sortBtns=${summary.sortButtons} notes=${summary.noteInline} kpi=${summary.kpiCount}`);

    await page.screenshot({ path: join(OUT_DIR, "orders-visual-1440.png"), fullPage: true });

    // 1b. Computed-style layout audit (desktop)
    const layout = await page.evaluate(() => {
      const wrap = document.getElementById("ordersTableWrap");
      const th = document.querySelector("thead th");
      const amountTd = document.querySelector(".orders-amount-cell");
      const amountTh = document.querySelector(".orders-th-amount");
      const actionsTd = document.querySelector(".orders-actions-cell");
      const noteInline = document.querySelector(".orders-note-inline");
      const dateGroup = document.querySelector(".orders-date-group td");
      const expandBtn = document.querySelector(".orders-expand-btn");
      const detailRow = document.querySelector(".orders-detail-row");
      const hiddenDetail = document.querySelector(".orders-detail-row.orders-detail-hidden");
      const mainTd = document.querySelector(".orders-main-row td");
      const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null;
      return {
        wrapScrolls: wrap.scrollWidth > wrap.clientWidth,
        thSticky: cs(th, "position"),
        thBg: cs(th, "backgroundColor"),
        amountRight: cs(amountTd, "textAlign"),
        amountThRight: cs(amountTh, "textAlign"),
        actionsNowrap: cs(actionsTd, "whiteSpace"),
        actionsVerticalAlign: cs(actionsTd, "verticalAlign"),
        noteEllipsis: cs(noteInline, "textOverflow"),
        noteBlockDisplay: cs(noteInline, "display"),
        dateGroupPaddingTop: cs(dateGroup, "paddingTop"),
        dateGroupUppercase: cs(dateGroup, "textTransform"),
        expandSize: expandBtn ? Math.round(expandBtn.getBoundingClientRect().height) : 0,
        mainTdValign: cs(mainTd, "verticalAlign"),
        detailColspan: detailRow.querySelector("td").colSpan,
        hiddenDetailDisplay: cs(hiddenDetail, "display"),
      };
    });
    if (layout.wrapScrolls) fail("visual: unexpected horizontal scroll at 1440px");
    if (layout.thSticky !== "sticky") fail(`visual: thead not sticky (${layout.thSticky})`);
    if (!layout.thBg || layout.thBg === "rgba(0, 0, 0, 0)") fail("visual: sticky th background transparent");
    if (layout.amountRight !== "right") fail(`visual: amount cell not right-aligned (${layout.amountRight})`);
    if (layout.amountThRight !== "right") fail(`visual: amount th not right-aligned (${layout.amountThRight})`);
    if (layout.actionsNowrap !== "nowrap") fail(`visual: actions cell wraps (${layout.actionsNowrap})`);
    if (layout.noteEllipsis !== "ellipsis") fail(`visual: note inline not ellipsized (${layout.noteEllipsis})`);
    if (layout.noteBlockDisplay !== "block") fail(`visual: note inline not block (${layout.noteBlockDisplay})`);
    if (layout.dateGroupPaddingTop !== "18px") fail(`visual: date group padding-top ${layout.dateGroupPaddingTop}`);
    if (layout.dateGroupUppercase !== "uppercase") fail(`visual: date group not uppercase`);
    if (layout.expandSize < 24) fail(`visual: expand button too small (${layout.expandSize}px)`);
    if (layout.mainTdValign !== "middle") fail(`visual: td not middle aligned (${layout.mainTdValign})`);
    if (layout.detailColspan !== 7) fail(`visual: detail colspan ${layout.detailColspan}`);
    if (layout.hiddenDetailDisplay !== "none") fail(`visual: hidden detail row display ${layout.hiddenDetailDisplay}`);
    console.log(`OK layout: sticky=${layout.thSticky} amountRight=${layout.amountRight} expandBtn=${layout.expandSize}px colspan=${layout.detailColspan}`);

    // 2. Expand a row via chevron click
    const expandResult = await page.evaluate(() => {
      const btn = document.querySelector('button[data-order-action="toggle"]');
      const row = btn.closest("tr.orders-main-row");
      const detail = row.nextElementSibling;
      const before = detail.classList.contains("orders-detail-hidden");
      btn.click();
      const after = detail.classList.contains("orders-detail-hidden");
      return { before, after, aria: btn.getAttribute("aria-expanded") };
    });
    if (!expandResult.before || expandResult.after) fail(`visual: expand toggle broken ${JSON.stringify(expandResult)}`);
    if (expandResult.aria !== "true") fail("visual: aria-expanded not set after expand");
    const expandedDisplay = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".orders-detail-row:not(.orders-detail-hidden)")).display
    );
    if (expandedDisplay !== "table-row") fail(`visual: expanded detail display ${expandedDisplay}`);
    const skipNote = await page.evaluate(() => {
      const note = document.querySelector(".orders-skip-note");
      return note ? note.textContent : "";
    });
    if (!skipNote.includes("Vanilla Syrup") || !skipNote.includes("not found in inventory")) {
      fail(`visual: skip note not rendered in expanded row: ${skipNote}`);
    }
    console.log("OK expand: hidden->visible, aria=true, skip note rendered");

    await page.screenshot({ path: join(OUT_DIR, "orders-visual-expanded.png"), fullPage: false });

    // 3. Note see-more toggle inside an expanded detail row
    const noteToggle = await page.evaluate(() => {
      const noteBtn = document.querySelector("button[data-note-toggle]");
      if (!noteBtn) return { missing: true };
      const noteEl = noteBtn.previousElementSibling;
      const shortLen = noteEl.textContent.length;
      noteBtn.click();
      const fullLen = noteEl.textContent.length;
      const label = noteBtn.textContent;
      return { missing: false, shortLen, fullLen, label };
    });
    if (noteToggle.missing) fail("visual: note toggle missing for long note");
    if (noteToggle.fullLen <= noteToggle.shortLen) fail(`visual: note did not expand (${noteToggle.shortLen} -> ${noteToggle.fullLen})`);
    if (noteToggle.label !== "See less") fail("visual: note toggle label not See less");
    console.log(`OK note: ${noteToggle.shortLen} -> ${noteToggle.fullLen} chars`);

    // 4. Sort via header click (re-render with arrow)
    const sortResult = await page.evaluate(() => {
      const amountBtn = document.querySelector('button[data-sort="amount"]');
      const before = amountBtn.textContent;
      amountBtn.click();
      const after = document.querySelector('button[data-sort="amount"]').textContent;
      const topRow = document.querySelector("tr.orders-main-row .orders-ref").textContent;
      return { before, after, topRow };
    });
    if (!sortResult.after.includes("↓")) fail(`visual: amount sort arrow missing after click: ${JSON.stringify(sortResult)}`);
    if (sortResult.topRow !== "#v1") fail(`visual: amount sort top row wrong: ${JSON.stringify(sortResult)}`);
    console.log(`OK sort: ${sortResult.before.trim()} -> ${sortResult.after.trim()}, top=${sortResult.topRow}`);

    // 5. Search filter through the real pipeline
    const searchResult = await page.evaluate(async () => {
      window.__orderFilters.search = "matcha";
      window.__orderFilters.page = 1;
      window.__applyOrderFilters();
      await new Promise((r) => setTimeout(r, 750));
      return {
        rows: (document.getElementById("ordersTableWrap").innerHTML.match(/orders-main-row/g) || []).length,
        kpi: document.getElementById("ordersCountKpi").textContent,
      };
    });
    if (searchResult.rows !== 1 || searchResult.kpi !== "1") fail(`visual: search filter wrong: ${JSON.stringify(searchResult)}`);
    console.log(`OK search: matcha -> ${searchResult.rows} row(s)`);

    // 6. Mobile width check (768px)
    await page.setViewport({ width: 768, height: 1200 });
    await page.evaluate(() => {
      window.__orderFilters.search = "";
      window.__orderFilters.payment = "all";
      window.__orderFilters.sortBy = "latest";
      window.__orderFilters.preset = "all";
      window.__orderFilters.fromDate = "";
      window.__orderFilters.toDate = "";
      window.__orderFilters.page = 1;
      window.__applyOrderFilters();
    });
    await new Promise((r) => setTimeout(r, 300));
    const mobileDetail = await page.evaluate(() => {
      const btn = document.querySelector('button[data-order-action="toggle"]');
      btn.click();
      const detail = btn.closest("tr").nextElementSibling;
      const grid = detail.querySelector(".orders-detail-grid");
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
      return { cols };
    });
    if (mobileDetail.cols !== 1) fail(`visual: mobile detail grid should be 1 column, got ${mobileDetail.cols}`);
    console.log(`OK mobile: detail grid ${mobileDetail.cols} col(s) at 768px`);

    // 6b. Mobile layout audit (wrap scrolls; body itself must not overflow)
    const mobileLayout = await page.evaluate(() => {
      const body = document.body;
      const wrap = document.getElementById("ordersTableWrap");
      const detailGrid = document.querySelector(".orders-detail-grid");
      const detailCols = getComputedStyle(detailGrid).gridTemplateColumns.split(" ").length;
      return {
        bodyScrolls: body.scrollWidth > body.clientWidth,
        wrapScrolls: wrap.scrollWidth > wrap.clientWidth,
        detailCols,
      };
    });
    if (!mobileLayout.wrapScrolls) fail("visual: wrap should scroll horizontally at 768px");
    if (mobileLayout.bodyScrolls) fail("visual: body overflows viewport at 768px (vertical layout broken)");
    if (mobileLayout.detailCols !== 1) fail(`visual: mobile detail grid ${mobileLayout.detailCols} cols`);
    console.log("OK mobile layout: wrap scrolls, body fits, detail grid 1 col");
    await page.screenshot({ path: join(OUT_DIR, "orders-visual-768.png"), fullPage: true });

    if (consoleErrors.length) {
      fail(`visual: console errors detected:\n${consoleErrors.join("\n")}`);
    }
    console.log("PASS: Orders visual checks succeeded (no console errors).");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  fail(error?.stack || String(error));
});
