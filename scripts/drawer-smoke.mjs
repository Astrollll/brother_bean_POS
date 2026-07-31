import { readFile } from "node:fs/promises";

const MODEL_PATH = "controllers/posController.js";
const BLOCK_START_MARKER = "// ── DRAWER MATH ──";
const BLOCK_END_MARKER = "// ── END DRAWER MATH ──";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const assert = {
  equal(actual, expected, label) {
    if (actual !== expected) {
      fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(condition, label) {
    if (!condition) fail(label);
  },
  approx(actual, expected, label, eps = 0.01) {
    if (Math.abs(Number(actual) - expected) > eps) {
      fail(`${label}: expected ~${expected}, got ${actual}`);
    }
  },
};

async function loadBlock() {
  const source = await readFile(MODEL_PATH, "utf8");
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.startsWith(BLOCK_START_MARKER));
  const endIdx = lines.findIndex((l) => l.startsWith(BLOCK_END_MARKER));
  if (startIdx < 0 || endIdx <= startIdx) {
    throw new Error(`Could not locate block markers (${BLOCK_START_MARKER} / ${BLOCK_END_MARKER})`);
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

function fakeEl() {
  const classes = new Set();
  return {
    textContent: "",
    className: "",
    value: "",
    innerHTML: "",
    setAttribute() {},
    focus() {},
    classList: {
      toggle(cls, force) {
        if (force === undefined) {
          if (classes.has(cls)) classes.delete(cls);
          else classes.add(cls);
        } else if (force) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
      },
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    },
  };
}

function getSaleTimestampMs(sale) {
  if (!sale) return null;
  if (typeof sale.createdAtMs === "number") return sale.createdAtMs;
  if (sale.createdAt?.toDate) {
    const d = sale.createdAt.toDate();
    return Number.isFinite(d?.getTime?.()) ? d.getTime() : null;
  }
  if (typeof sale.createdAt?.seconds === "number") return sale.createdAt.seconds * 1000;
  if (typeof sale.createdAt === "string") {
    const parsed = Date.parse(sale.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof sale.timestamp === "string") {
    const parsed = Date.parse(sale.timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function main() {
  const block = await loadBlock();

  const windowStub = {};
  const elements = {};
  const trackedClasses = new Map();
  const trackClass = () => {
    const classes = new Set();
    trackedClasses.set(classes, true);
    return {
      toggle() {},
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    };
  };
  const inputStub = () => {
    const el = {
      _v: "0",
      classList: trackClass(),
      focused: false,
      focus() { this.focused = true; },
      matches(sel) { return sel === ":focus" ? this.focused : false; },
      set value(v) { this._v = v; },
      get value() { return this._v ?? "0"; },
    };
    return el;
  };
  const textInputStub = () => ({ _v: "", set value(v) { this._v = v; }, get value() { return this._v ?? ""; } });
  const ledgerInput = inputStub();
  const reasonInput = textInputStub();
  const actualInput = inputStub();
  const documentStub = {
    getElementById: (id) => {
      if (id === "drawerLedgerAmount") return ledgerInput;
      if (id === "drawerLedgerReason") return reasonInput;
      if (id === "drawerActualInput") return actualInput;
      elements[id] = elements[id] || fakeEl();
      return elements[id];
    },
    addEventListener() {},
  };

  let persistCalls = 0;
  const toasts = [];
  const factory = new Function(
    "window", "document", "dailyStats", "salesHistory",
    "persistPosState", "showToast", "getSaleTimestampMs", "getQueuedOrders",
    `${block}
    return { computeDrawerMath, computeDrawerTotals, computeDrawerCashReceived, computeDrawerGcashReceived, renderDrawerModal, renderDrawerVariance, renderDrawerHistory };`,
  );

  const freshStats = () => ({
    orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, gcashReceived: 0,
    openingFloat: 0, cashIn: 0, cashOut: 0, actualCash: null, cashOnHandAuto: true, ledgerEntries: [],
  });

  const call = (stats = freshStats(), salesHistory = [], queued = []) => factory(
    windowStub,
    documentStub,
    stats,
    salesHistory,
    () => { persistCalls += 1; },
    (msg) => toasts.push(msg),
    getSaleTimestampMs,
    () => queued,
  );

  const ctx = call();
  const { computeDrawerMath, computeDrawerTotals, computeDrawerCashReceived, computeDrawerGcashReceived, renderDrawerModal } = ctx;

  // ── computeDrawerMath ──
  // Case 1: float + cash sales -> expected
  let m = computeDrawerMath({ openingFloat: 1000, cashReceived: 1500 });
  assert.approx(m.expected, 2500, "drawer: float + cash sales");

  // Case 2: cash in adds, cash out subtracts
  m = computeDrawerMath({ openingFloat: 1000, cashReceived: 1500, cashIn: 500, cashOut: 200 });
  assert.approx(m.expected, 2800, "drawer: cash in/out applied");

  // Case 3: no float and no sales -> expected zero, missing fields default
  m = computeDrawerMath({});
  assert.approx(m.expected, 0, "drawer: empty stats default to zero");

  // Case 4: negative cash out yields a lower (possibly negative) expected
  m = computeDrawerMath({ openingFloat: 1000, cashReceived: 500, cashOut: 2000 });
  assert.approx(m.expected, -500, "drawer: cash out beyond float/sales reflected");

  // Case 5: GCash expectation is sales-derived only
  m = computeDrawerMath({ gcashReceived: 1234.5 });
  assert.approx(m.expectedGcash, 1234.5, "drawer: expected GCash equals GCash received");

  // ── computeDrawerTotals (cash / gcash / split / employee) ──
  const now = Date.now();
  const todayOrder = (overrides) => ({ orderId: `o_${Math.random().toString(36).slice(2, 8)}`, createdAtMs: now, total: 0, ...overrides });

  let t = computeDrawerTotals([
    todayOrder({ paymentMethod: "cash", total: 1000 }),
    todayOrder({ paymentMethod: "gcash", total: 500 }),
    todayOrder({ paymentMethod: "split", total: 800, cashAmount: 300, gcashAmount: 500 }),
    todayOrder({ paymentMethod: "employee", total: 250 }),
    todayOrder({ paymentMethod: "GCASH", total: 75 }),
    todayOrder({ paymentMethod: "Cash", total: 25 }),
  ]);
  assert.approx(t.cash, 1325, "drawer: cash totals cash + split cash, employee excluded");
  assert.approx(t.gcash, 1075, "drawer: gcash totals gcash + split gcash, case-insensitive");
  assert.equal(t.cashTransactions, 3, "drawer: cash transaction count");
  assert.equal(t.gcashTransactions, 3, "drawer: gcash transaction count");
  assert.approx(t.paidSales, 2400, "drawer: paid sales excludes employee orders");

  // ── Queued (offline) orders included, de-duplicated against sales history ──
  const queuedCtx = call(freshStats(), [], [
    { payload: todayOrder({ orderId: "dup1", paymentMethod: "cash", total: 100 }) },
    { payload: todayOrder({ orderId: "q2", paymentMethod: "gcash", total: 200 }) },
  ]);
  t = queuedCtx.computeDrawerTotals([todayOrder({ orderId: "dup1", paymentMethod: "cash", total: 100 })]);
  assert.approx(t.cash, 100, "drawer: queued duplicate not double-counted");
  assert.approx(t.gcash, 200, "drawer: queued gcash order included");

  // ── Yesterday's orders excluded ──
  t = computeDrawerTotals([
    todayOrder({ orderId: "old1", paymentMethod: "cash", total: 9999, createdAtMs: now - 86400000 }),
    todayOrder({ orderId: "tomorrow1", paymentMethod: "cash", total: 8888, createdAtMs: now + 86400000 }),
  ]);
  assert.approx(t.cash, 0, "drawer: out-of-day orders excluded");

  // ── computeDrawerCashReceived / GcashReceived wrappers ──
  assert.approx(computeDrawerCashReceived([todayOrder({ paymentMethod: "cash", total: 42 })]), 42, "drawer: cash wrapper");
  assert.approx(computeDrawerGcashReceived([todayOrder({ paymentMethod: "gcash", total: 77 })]), 77, "drawer: gcash wrapper");

  // ── renderDrawerModal renders sales-derived totals into the DOM ──
  const stats = freshStats();
  stats.openingFloat = 500;
  renderDrawerModal.call(ctx, null);
  renderDrawerModal();
  assert.equal(elements["drawerCashValue"].textContent, "₱0.00", "drawer: cash card renders zero with no orders");

  // ── renderDrawerCashOrders lists today's cash orders, split cash portions ──
  const ordersCtx = call(freshStats(), [
    todayOrder({ paymentMethod: "cash", total: 100 }),
    todayOrder({ paymentMethod: "split", total: 300, cashAmount: 120, gcashAmount: 180 }),
    todayOrder({ paymentMethod: "gcash", total: 50 }),
    todayOrder({ paymentMethod: "employee", total: 200 }),
  ]);
  ordersCtx.renderDrawerModal();
  assert.equal(elements["drawerCashOrdersHead"].textContent, "Today's cash orders · ₱220.00", "drawer: cash orders head total");
  assert.ok(elements["drawerCashOrdersList"].innerHTML.includes("₱100.00"), "drawer: cash order amount listed");
  assert.ok(elements["drawerCashOrdersList"].innerHTML.includes("₱120.00"), "drawer: split cash portion listed");
  assert.ok(!elements["drawerCashOrdersList"].innerHTML.includes("₱50.00"), "drawer: gcash order excluded from cash list");
  assert.ok(!elements["drawerCashOrdersList"].innerHTML.includes("₱200.00"), "drawer: employee order excluded from cash list");

  const emptyCtx = call(freshStats(), []);
  emptyCtx.renderDrawerModal();
  assert.ok(elements["drawerCashOrdersList"].innerHTML.includes("No cash orders yet today."), "drawer: empty cash orders message");

  // ── renderDrawerVariance badges ──
  const varianceStats = freshStats();
  varianceStats.openingFloat = 1000;
  varianceStats.cashReceived = 1500;
  varianceStats.actualCash = 2600;
  varianceStats.cashOnHandAuto = false;
  let varianceCtx = call(varianceStats);
  varianceCtx.renderDrawerVariance(2500);
  assert.equal(elements["drawerVarianceBadge"].textContent, "Overage ₱100.00", "drawer: overage badge computed");
  assert.ok(elements["drawerVarianceBadge"].className.includes("is-over"), "drawer: overage class applied");

  varianceStats.actualCash = 2400;
  varianceCtx = call(varianceStats);
  varianceCtx.renderDrawerVariance(2500);
  assert.equal(elements["drawerVarianceBadge"].textContent, "Shortage ₱100.00", "drawer: shortage badge computed");
  assert.ok(elements["drawerVarianceBadge"].className.includes("is-short"), "drawer: shortage class applied");

  varianceStats.actualCash = 2500;
  varianceCtx = call(varianceStats);
  varianceCtx.renderDrawerVariance(2500);
  assert.equal(elements["drawerVarianceBadge"].textContent, "Balanced", "drawer: balanced badge computed");
  assert.ok(elements["drawerVarianceBadge"].className.includes("is-balanced"), "drawer: balanced class applied");

  // Auto-tracking: cash on hand follows the orders automatically (start cash +
  // cash sales), no manual record needed, and persists the synced value.
  const autoStats = freshStats();
  autoStats.openingFloat = 1000;
  persistCalls = 0;
  let autoCtx = call(autoStats, [todayOrder({ paymentMethod: "cash", total: 1500 })]);
  autoCtx.renderDrawerModal();
  assert.equal(elements["drawerVarianceBadge"].textContent, "Auto-tracked", "drawer: auto-tracked badge state");
  assert.ok(elements["drawerVarianceBadge"].className.includes("is-neutral"), "drawer: auto-tracked badge class");
  assert.equal(actualInput.value, "2500", "drawer: cash on hand auto-tracks start cash + cash orders");
  assert.equal(autoStats.actualCash, 2500, "drawer: auto-tracked value persisted into stats");
  assert.ok(persistCalls > 0, "drawer: auto-track persist called");

  // A new order while auto-tracking updates the cash on hand automatically
  autoCtx = call(autoStats, [
    todayOrder({ paymentMethod: "cash", total: 1500 }),
    todayOrder({ paymentMethod: "cash", total: 300 }),
  ]);
  autoCtx.renderDrawerModal();
  assert.equal(actualInput.value, "2800", "drawer: new cash order auto-added to cash on hand");
  assert.equal(autoStats.actualCash, 2800, "drawer: auto-tracked value grows with orders");

  // Focus guard: while staff is editing the counted amount, an incidental
  // re-render must not silently reset what they typed
  actualInput.focused = true;
  actualInput.value = "9999";
  autoCtx.renderDrawerModal();
  assert.equal(actualInput.value, "9999", "drawer: focused count input not overwritten by re-render");
  actualInput.focused = false;
  actualInput.value = "9999";
  autoCtx.renderDrawerModal();
  assert.equal(actualInput.value, "2800", "drawer: unfocused count input re-synced by re-render");

  // ── Confirmation popup: nothing is recorded until Record is tapped ──
  const ledgerStats = freshStats();
  ledgerInput.value = "100";
  reasonInput.value = "Change top-up";
  persistCalls = 0;
  const ledgerCtx = call(ledgerStats);
  windowStub.askDrawerConfirm("in");
  assert.ok(elements["drawerConfirmModal"].classList.contains("active"), "drawer: popup opens for cash in");
  assert.equal(elements["drawerConfirmMessage"].textContent, "Add ₱100.00 to the cash drawer?", "drawer: popup message for cash in");
  assert.equal(elements["drawerConfirmHint"].textContent, "Reason: Change top-up", "drawer: popup shows the note");
  assert.approx(ledgerStats.cashIn, 0, "drawer: nothing recorded while popup is open");
  assert.equal(ledgerStats.ledgerEntries.length, 0, "drawer: no ledger entry while popup is open");

  // Record applies the entry immediately and closes the popup
  windowStub.confirmDrawerAction();
  assert.approx(ledgerStats.cashIn, 100, "drawer: cash in added to totals");
  assert.equal(ledgerStats.ledgerEntries.length, 1, "drawer: cash in appended to ledger");
  assert.equal(ledgerStats.ledgerEntries[0].kind, "in", "drawer: ledger entry kind");
  assert.approx(ledgerStats.ledgerEntries[0].amount, 100, "drawer: ledger entry amount");
  assert.equal(ledgerStats.ledgerEntries[0].note, "Change top-up", "drawer: ledger entry note captured");
  assert.equal(reasonInput.value, "", "drawer: note input cleared after entry");
  assert.ok(persistCalls > 0, "drawer: ledger persist called");
  assert.ok(!elements["drawerConfirmModal"].classList.contains("active"), "drawer: popup closed after recording");

  // Cash out goes through the popup too and only records on confirm
  ledgerInput.value = "40";
  windowStub.askDrawerConfirm("out");
  assert.ok(elements["drawerConfirmModal"].classList.contains("active"), "drawer: popup opens for cash out");
  assert.equal(elements["drawerConfirmMessage"].textContent, "Remove ₱40.00 from the cash drawer?", "drawer: popup message for cash out");
  assert.ok(elements["drawerConfirmOkBtn"].classList.contains("bb-drawer-btn-out"), "drawer: cash out confirm button styled red");
  assert.approx(ledgerStats.cashOut, 0, "drawer: cash out not applied while popup is open");
  assert.equal(ledgerStats.ledgerEntries.length, 1, "drawer: no cash out entry while popup is open");
  windowStub.confirmDrawerAction();
  assert.approx(ledgerStats.cashOut, 40, "drawer: cash out applied on popup confirm");
  assert.equal(ledgerStats.ledgerEntries.length, 2, "drawer: cash out appended to ledger");
  assert.equal(ledgerStats.ledgerEntries[1].kind, "out", "drawer: confirmed entry kind");

  // Cancel applies nothing and closes the popup
  ledgerInput.value = "10";
  windowStub.askDrawerConfirm("in");
  assert.ok(elements["drawerConfirmModal"].classList.contains("active"), "drawer: popup opens for cancelled flow");
  windowStub.cancelDrawerConfirm();
  assert.ok(!elements["drawerConfirmModal"].classList.contains("active"), "drawer: popup closed by cancel");
  assert.approx(ledgerStats.cashIn, 100, "drawer: cancelled cash in not applied");
  assert.equal(ledgerStats.ledgerEntries.length, 2, "drawer: cancelled flow adds no entry");

  // Invalid amounts rejected without popup, with attention drawn to the input
  ledgerInput.value = "-5";
  windowStub.askDrawerConfirm("in");
  assert.equal(ledgerStats.ledgerEntries.length, 2, "drawer: invalid amount rejected");
  assert.ok(!elements["drawerConfirmModal"].classList.contains("active"), "drawer: no popup for invalid amount");
  assert.ok(ledgerInput.classList.contains("is-attention"), "drawer: invalid amount input flagged");
  assert.ok(ledgerInput.focused, "drawer: invalid amount input focused");

  // Notes are HTML-escaped when rendered into the history list
  ledgerInput.value = "20";
  reasonInput.value = "<script>alert(1)</script>";
  windowStub.askDrawerConfirm("in");
  windowStub.confirmDrawerAction();
  ledgerCtx.renderDrawerHistory();
  assert.ok(elements["drawerHistoryList"].innerHTML.includes("&lt;script&gt;"), "drawer: note HTML-escaped in history");
  assert.ok(!elements["drawerHistoryList"].innerHTML.includes("<script>alert"), "drawer: raw note never injected");

  // ── Record count popup switches to manual mode and sets the counted cash ──
  actualInput.value = "3210.50";
  windowStub.askDrawerConfirm("count");
  assert.ok(elements["drawerConfirmModal"].classList.contains("active"), "drawer: popup opens for record count");
  assert.equal(elements["drawerConfirmMessage"].textContent, "Record counted cash on hand as ₱3210.50?", "drawer: popup message for record count");
  assert.ok(elements["drawerConfirmHint"].textContent.includes("auto-tracked"), "drawer: popup warns about auto-tracking");
  assert.ok(ledgerStats.cashOnHandAuto !== false, "drawer: auto-tracking not disabled while popup is open");
  windowStub.confirmDrawerAction();
  assert.approx(ledgerStats.actualCash, 3210.5, "drawer: actual cash recorded");
  assert.ok(ledgerStats.cashOnHandAuto === false, "drawer: manual record disables auto-tracking");

  // Auto-tracking must not overwrite the manual count afterwards
  call(ledgerStats);
  windowStub.askDrawerConfirm("count");
  assert.equal(elements["drawerConfirmMessage"].textContent, "Record counted cash on hand as ₱3210.50?", "drawer: popup reflects current count");
  windowStub.cancelDrawerConfirm();
  assert.ok(ledgerStats.cashOnHandAuto === false, "drawer: auto-tracking stays disabled after manual record");
  assert.ok(ledgerStats.actualCash === 3210.5, "drawer: count unchanged after cancelled record");

  // ── window handlers are attached ──
  assert.ok(typeof windowStub.openDrawer === "function", "drawer: openDrawer attached");
  assert.ok(typeof windowStub.drawerCashIn === "function", "drawer: drawerCashIn attached");
  assert.ok(typeof windowStub.drawerCashOut === "function", "drawer: drawerCashOut attached");
  assert.ok(typeof windowStub.saveDrawerOpeningFloat === "function", "drawer: saveDrawerOpeningFloat attached");
  assert.ok(typeof windowStub.toggleDrawerFloatEdit === "function", "drawer: toggleDrawerFloatEdit attached");
  assert.ok(typeof windowStub.drawerSwitchTab === "function", "drawer: drawerSwitchTab attached");
  assert.ok(typeof windowStub.recordDrawerActual === "function", "drawer: recordDrawerActual attached");
  assert.ok(typeof windowStub.onDrawerDeclared === "undefined", "drawer: declared handler removed");

  console.log("PASS: Drawer math smoke checks succeeded.");
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
