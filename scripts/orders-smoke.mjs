import { readFile } from "node:fs/promises";

const CONTROLLER_PATH = "controllers/admin/adminPortalController.js";
const BLOCK_START_MARKER = "function getOrderDate(";
const BLOCK_END_MARKER = "function bindOrdersControls(";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, label) {
  if (!condition) fail(label);
}

function assertContains(source, needle, label) {
  if (!source.includes(needle)) fail(`${label} — missing: ${needle}`);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeElement(id = "") {
  const el = {
    id,
    value: "",
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    _attrs: {},
    classList: {
      _set: new Set(),
      toggle(cls, force) {
        const has = this._set.has(cls);
        const want = force === undefined ? !has : force;
        if (want) this._set.add(cls);
        else this._set.delete(cls);
        return want;
      },
      add(cls) { this._set.add(cls); },
      remove(cls) { this._set.delete(cls); },
      contains(cls) { return this._set.has(cls); },
    },
    setAttribute(name, value) { this._attrs[name] = String(value); },
    getAttribute(name) { return this._attrs[name] ?? null; },
    removeAttribute(name) { delete this._attrs[name]; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return el;
}

function loadBlock() {
  return readFile(CONTROLLER_PATH, "utf8").then((source) => {
    const lines = source.split(/\r?\n/);
    const startIdx = lines.findIndex((l) => l.startsWith(BLOCK_START_MARKER));
    const endIdx = lines.findIndex((l) => l.startsWith(BLOCK_END_MARKER));
    if (startIdx < 0 || endIdx <= startIdx) {
      throw new Error(`Could not locate block markers (${BLOCK_START_MARKER} / ${BLOCK_END_MARKER})`);
    }
    const block = lines.slice(startIdx, endIdx).join("\n");
    const exports = [
      "toDayKey", "formatDayLabel", "setOrderPreset", "syncOrderPresetChips",
      "buildNoteBlock", "toggleDetailNote", "nextSortValue", "buildSortHeader",
      "buildOrderMainRow", "buildOrderDetailRow", "buildPageButtons",
      "renderOrdersPagination", "renderOrdersTable", "toggleOrderRow",
      "bindOrdersTableEvents", "sortOrders", "applyOrderFilters",
      "renderOrdersKpis",
    ];
    const factory = new Function(
      "document", "window", "state", "orderFilters", "ModalUtils",
      "escapeHtml", "formatMoney", "deleteOrder", "loadOrdersPage", "getAllSalesOrders",
      `${block}\nreturn { ${exports.join(", ")} };`,
    );
    return factory;
  });
}

function buildHarness() {
  const elements = new Map();
  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const state = {
    allOrders: [],
    filteredOrders: [],
    pagedOrders: [],
    orderStockExpanded: {},
  };
  const orderFilters = {
    search: "", payment: "all", sortBy: "latest", pageSize: 10,
    page: 1, fromDate: "", toDate: "", preset: "",
  };
  return {
    documentStub,
    elements,
    state,
    orderFilters,
    windowStub: {},
    ModalUtils: { confirm: async () => 1, success: async () => {}, error: async () => {} },
    formatMoney: (n) => `₱${(Number(n) || 0).toFixed(2)}`,
    deleteOrder: async () => {},
    loadOrdersPage: async () => {},
    getAllSalesOrders: async () => [],
  };
}

async function main() {
  const factory = await loadBlock();
  const harness = buildHarness();
  const api = factory(
    harness.documentStub, harness.windowStub, harness.state, harness.orderFilters,
    harness.ModalUtils, escapeHtml, harness.formatMoney,
    harness.deleteOrder, harness.loadOrdersPage, harness.getAllSalesOrders,
  );

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const oldDate = new Date(2025, 0, 15, 10, 30);

  // 1. Day labels
  assert(api.formatDayLabel(today) === "Today", "formatDayLabel(today)");
  assert(api.formatDayLabel(yesterday) === "Yesterday", "formatDayLabel(yesterday)");
  const oldLabel = api.formatDayLabel(oldDate);
  assertContains(oldLabel, "2025", "formatDayLabel(old) includes year");
  assertContains(oldLabel, "Wed", "formatDayLabel(old) weekday");

  // 2. Sort toggling
  assert(api.nextSortValue("time", "latest") === "oldest", "nextSortValue time desc->asc");
  assert(api.nextSortValue("time", "oldest") === "latest", "nextSortValue time asc->desc");
  assert(api.nextSortValue("amount", "latest") === "amount_desc", "nextSortValue amount default");
  assert(api.nextSortValue("amount", "amount_asc") === "amount_desc", "nextSortValue amount asc->desc");
  assert(api.nextSortValue("items", "items_desc") === "items_asc", "nextSortValue items desc->asc");
  assert(api.nextSortValue("payment", "payment_asc") === "payment_desc", "nextSortValue payment asc->desc");
  assert(api.nextSortValue("ref", "ref_desc") === "ref_asc", "nextSortValue ref desc->asc");

  // 3. Sort header markup
  harness.orderFilters.sortBy = "latest";
  let header = api.buildSortHeader("time", "Time");
  assertContains(header, "↓", "sort header time shows ↓ for latest");
  assertContains(header, "active", "sort header time active");
  assertContains(header, 'data-sort="time"', "sort header data-sort");
  harness.orderFilters.sortBy = "oldest";
  header = api.buildSortHeader("time", "Time");
  assertContains(header, "↑", "sort header time shows ↑ for oldest");
  harness.orderFilters.sortBy = "amount_asc";
  header = api.buildSortHeader("amount", "Amount");
  assertContains(header, "↑", "sort header amount shows ↑");
  harness.orderFilters.sortBy = "latest";

  // 4. Main row rendering
  const longNote = "N".repeat(200);
  const order = {
    id: "orderABC123xyz", orderId: "orderABC123xyz",
    items: [
      { name: "Latte", quantity: 2, price: 120 },
      { name: "Croissant", quantity: 1, price: 90 },
      { name: "Mocha", quantity: 1, price: 130 },
    ],
    paymentMethod: "gcash",
    total: 460,
    orderType: "regular",
    note: longNote,
    createdAt: today,
  };
  let row = api.buildOrderMainRow(order);
  assertContains(row, "123xyz", "main row short id");
  assertContains(row, "4 items", "main row item count");
  assertContains(row, "+1 more", "main row more chip");
  assertContains(row, "Latte", "main row item chip 1");
  assertContains(row, "orders-note-inline", "main row note inline present");
  assertContains(row, "N".repeat(60) + "…", "main row note truncated at 60");
  assertContains(row, "orders-expand-btn", "main row expand button");
  assertContains(row, "aria-expanded=\"false\"", "main row not expanded");
  assertContains(row, "GCASH", "main row payment badge");

  const empOrder = { ...order, orderType: "employee", items: [{ name: "Latte", quantity: 1, price: 120 }] };
  row = api.buildOrderMainRow(empOrder);
  assertContains(row, "Employee", "main row employee badge");

  const noNoteOrder = { ...order, note: "", items: [{ name: "Latte", quantity: 1, price: 120 }] };
  row = api.buildOrderMainRow(noNoteOrder);
  assert(!row.includes("orders-note-inline"), "main row no note indicator when empty");

  // 5. Detail row rendering
  const detailOrder = {
    id: "orderABC123xyz",
    items: [
      { name: "Latte", quantity: 2, price: 120, discountPercent: 0.1, variant: "Hot", temperature: "Hot" },
      { name: "Croissant", quantity: 1, price: 90, addons: [{ name: "Cheese", price: 20 }] },
    ],
    paymentMethod: "split",
    cashAmount: 300,
    gcashAmount: 160,
    total: 460,
    orderType: "regular",
    note: longNote,
    inventoryDeductions: [
      { inventoryId: "i1", name: "Milk", unit: "ml", deductedQty: 100, remainingQty: 900 },
    ],
    createdAt: today,
  };
  let detail = api.buildOrderDetailRow(detailOrder, false);
  assertContains(detail, "orders-detail-hidden", "detail row hidden when collapsed");
  assertContains(detail, "colspan=\"7\"", "detail row colspan 7");
  assertContains(detail, "od-price-original", "detail row discounted price");
  assertContains(detail, "-10%", "detail row discount percent");
  assertContains(detail, "110.00", "detail row addon price folded into unit total (90+20)");
  assertContains(detail, "Cash", "detail row split cash line");
  assertContains(detail, "GCash", "detail row split gcash line");
  assertContains(detail, "Milk", "detail row stock name");
  assertContains(detail, "Remaining: 900 ml", "detail row stock remaining");
  assert(!detail.includes("Estimated"), "recorded stock has no estimated badge");
  assertContains(detail, "See more", "detail row long note see more");
  assertContains(detail, "od-note", "detail row note block");
  detail = api.buildOrderDetailRow(detailOrder, true);
  assert(!detail.includes("orders-detail-hidden"), "detail row visible when expanded");

  const estDetailOrder = { ...detailOrder, inventoryDeductions: [] };
  detail = api.buildOrderDetailRow(estDetailOrder, true);
  assertContains(detail, "Estimated", "detail row estimated badge");
  assertContains(detail, "No stock usage recorded", "detail row empty stock message");

  // 6. Note block quote escaping
  const noteBlock = api.buildNoteBlock("He said \"hi\" <b>bold</b>");
  assertContains(noteBlock, "&quot;hi&quot;", "note block escapes quotes");
  assertContains(noteBlock, "&lt;b&gt;", "note block escapes html");

  // 7. Pagination buttons
  let btns = api.buildPageButtons(1, 5);
  assertContains(btns, 'data-page="1"', "page buttons include 1");
  assertContains(btns, 'data-page="5"', "page buttons include 5");
  assertContains(btns, "aria-current='page'", "current page marked");
  assertContains(btns, "orders-page-ellipsis", "ellipsis hides middle pages when current=1 of 5");
  btns = api.buildPageButtons(3, 5);
  assert(!btns.includes("orders-page-ellipsis"), "no ellipsis for 5 pages when current is central");
  assertContains(btns, 'data-page="4"', "window around current page");
  btns = api.buildPageButtons(5, 10);
  assertContains(btns, "orders-page-ellipsis", "ellipsis for page 5 of 10");
  assertContains(btns, 'data-page="6"', "window around current page");
  btns = api.buildPageButtons(1, 1);
  assertContains(btns, 'data-page="1"', "single page works");

  // 8. Pagination render
  harness.state.filteredOrders = Array.from({ length: 84 }, (_, i) => ({ total: i + 1 }));
  harness.orderFilters.page = 3;
  harness.orderFilters.pageSize = 10;
  api.renderOrdersPagination(9);
  const pager = harness.documentStub.getElementById("ordersPagination");
  assertContains(pager.innerHTML, "21–30", "pagination range start-end");
  assertContains(pager.innerHTML, "of <strong>84</strong>", "pagination total");
  assertContains(pager.innerHTML, "Prev", "pagination prev");
  assertContains(pager.innerHTML, "Next", "pagination next");

  // 9. Full table render with date grouping
  harness.state.orderStockExpanded = {};
  const now = new Date();
  const makeOrder = (id, daysAgo, hour) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return {
      id, orderId: id,
      items: [{ name: `Item-${id}`, quantity: 1, price: 50 }],
      paymentMethod: "cash", total: 50, orderType: "regular",
      note: "", createdAtMs: d.getTime(),
    };
  };
  const threeOrders = [
    makeOrder("o1", 0, 9),
    makeOrder("o2", 1, 10),
    makeOrder("o3", 1, 11),
  ];
  api.renderOrdersTable(threeOrders);
  const wrap = harness.documentStub.getElementById("ordersTableWrap");
  assertContains(wrap.innerHTML, "Today", "table group header today");
  assertContains(wrap.innerHTML, "Yesterday", "table group header yesterday");
  assertContains(wrap.innerHTML, "orders-main-row", "table main row");
  assertContains(wrap.innerHTML, "orders-detail-row", "table detail row");
  assertContains(wrap.innerHTML, "orders-sort-btn", "table sort header");
  assertContains(wrap.innerHTML, "class=\"orders-table\"", "table class");
  const groupCount = (wrap.innerHTML.match(/orders-date-group/g) || []).length;
  assert(groupCount === 2, "two date group rows for 2 days");

  api.renderOrdersTable([]);
  assertContains(wrap.innerHTML, "No transactions found", "empty table state");

  // 10. Sorting
  const sortable = [
    { id: "a", items: [{ quantity: 1 }, { quantity: 1 }], paymentMethod: "cash", total: 10, createdAtMs: 100 },
    { id: "b", items: [{ quantity: 5 }], paymentMethod: "gcash", total: 200, createdAtMs: 300 },
    { id: "c", items: [{ quantity: 3 }], paymentMethod: "card", total: 50, createdAtMs: 200 },
  ];
  let sorted = api.sortOrders(sortable, "items_desc");
  assert(sorted[0].id === "b", "sort by items desc");
  sorted = api.sortOrders(sortable, "items_asc");
  assert(sorted[0].id === "a", "sort by items asc");
  sorted = api.sortOrders(sortable, "payment_asc");
  assert(sorted[0].id === "c", "sort by payment asc (card)");
  sorted = api.sortOrders(sortable, "amount_desc");
  assert(sorted[0].id === "b", "sort by amount desc");
  sorted = api.sortOrders(sortable, "oldest");
  assert(sorted[0].id === "a", "sort by oldest");

  // 11. Filter pipeline end-to-end
  const twentyFive = Array.from({ length: 25 }, (_, i) => makeOrder(`f${i}`, i % 3, 10));
  harness.state.allOrders = twentyFive;
  harness.orderFilters.search = "";
  harness.orderFilters.payment = "all";
  harness.orderFilters.sortBy = "latest";
  harness.orderFilters.pageSize = 10;
  harness.orderFilters.page = 1;
  harness.orderFilters.fromDate = "";
  harness.orderFilters.toDate = "";
  harness.orderFilters.preset = "";
  api.applyOrderFilters();
  assert(harness.state.filteredOrders.length === 25, "filter keeps all orders");
  assert(harness.state.pagedOrders.length === 10, "paged slice is 10");
  assertContains(
    harness.documentStub.getElementById("ordersPagination").innerHTML,
    "of <strong>25</strong>",
    "pagination total 25",
  );
  harness.orderFilters.payment = "cash";
  api.applyOrderFilters();
  assert(harness.state.filteredOrders.length === 25, "cash filter matches all");
  harness.orderFilters.payment = "gcash";
  api.applyOrderFilters();
  assert(harness.state.filteredOrders.length === 0, "gcash filter matches none");

  // 12. Presets
  harness.orderFilters.preset = "";
  api.setOrderPreset("7d");
  const fromEl = harness.documentStub.getElementById("ordersFromDate");
  const toEl = harness.documentStub.getElementById("ordersToDate");
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 6);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert(fromEl.value === fmt(sevenDaysAgo), "preset 7d from date");
  assert(toEl.value === fmt(now), "preset 7d to date");
  assert(harness.orderFilters.preset === "7d", "preset stored");
  api.setOrderPreset("all");
  assert(fromEl.value === "" && toEl.value === "", "preset all clears dates");

  // 13. Expand/collapse toggle
  const btnEl = makeElement();
  btnEl.dataset.orderId = "o1";
  const detailRowEl = makeElement();
  const mainRowEl = { closest: () => null, nextElementSibling: detailRowEl };
  btnEl.closest = () => mainRowEl;
  api.toggleOrderRow(harness.documentStub, btnEl, "o1");
  assert(harness.state.orderStockExpanded.o1 === true, "expand sets state");
  assert(btnEl._attrs["aria-expanded"] === "true", "expand sets aria");
  assertContains(String(btnEl._attrs["aria-label"]), "Collapse", "expand aria label");
  assert(detailRowEl.classList.contains("orders-detail-hidden") === false, "detail row shown");
  api.toggleOrderRow(harness.documentStub, btnEl, "o1");
  assert(harness.state.orderStockExpanded.o1 === false, "collapse flips state");
  assert(detailRowEl.classList.contains("orders-detail-hidden") === true, "detail row hidden");
  assert(btnEl._attrs["aria-expanded"] === "false", "collapse aria");

  // 14. Note see-more toggle
  const noteEl = makeElement();
  noteEl._attrs["data-full"] = "FULL NOTE";
  noteEl._attrs["data-short"] = "SHORT";
  const toggleBtn = makeElement();
  toggleBtn.previousElementSibling = noteEl;
  api.toggleDetailNote(toggleBtn);
  assert(noteEl.textContent === "FULL NOTE", "note expands to full");
  assert(toggleBtn.textContent === "See less", "note button see less");
  assert(toggleBtn.dataset.expanded === "1", "note expanded flag");
  api.toggleDetailNote(toggleBtn);
  assert(noteEl.textContent === "SHORT", "note collapses to short");
  assert(toggleBtn.textContent === "See more", "note button see more");

  // 15. KPI render
  harness.state.filteredOrders = [{ total: 100 }, { total: 200 }];
  api.renderOrdersKpis(harness.state.filteredOrders);
  assert(
    harness.documentStub.getElementById("ordersCountKpi").textContent === "2",
    "kpi count",
  );
  assertContains(
    harness.documentStub.getElementById("ordersTotalKpi").textContent,
    "300.00",
    "kpi total",
  );
  assertContains(
    harness.documentStub.getElementById("ordersPageSub").textContent,
    "2 transaction(s) shown",
    "kpi sub text",
  );

  console.log("PASS: Orders table smoke checks succeeded.");
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
