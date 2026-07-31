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

async function main() {
  const block = await loadBlock();

  const windowStub = {};
  const factory = new Function(
    "window", "document", "dailyStats",
    "persistPosState", "showToast",
    `${block}
    return { computeDrawerMath, renderDrawerModal, applyDrawerLedger };`,
  );
  const { computeDrawerMath } = factory(
    windowStub,
    { getElementById: () => null },
    { orders: 0, totalSales: 0, discountsApplied: 0, cashReceived: 0, openingFloat: 0, cashIn: 0, cashOut: 0 },
    () => {},
    () => {},
  );

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

  // Case 5: window handlers are attached (openDrawer, drawerCashIn, etc.)
  assert.ok(typeof windowStub.openDrawer === "function", "drawer: openDrawer attached");
  assert.ok(typeof windowStub.drawerCashIn === "function", "drawer: drawerCashIn attached");
  assert.ok(typeof windowStub.drawerCashOut === "function", "drawer: drawerCashOut attached");
  assert.ok(typeof windowStub.saveDrawerOpeningFloat === "function", "drawer: saveDrawerOpeningFloat attached");
  assert.ok(typeof windowStub.toggleDrawerFloatEdit === "function", "drawer: toggleDrawerFloatEdit attached");
  assert.ok(typeof windowStub.onDrawerDeclared === "undefined", "drawer: declared handler removed");

  console.log("PASS: Drawer math smoke checks succeeded.");
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
