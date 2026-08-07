import { readFile } from "node:fs/promises";

const MODEL_PATH = "models/inventoryModel.js";
const BLOCK_START_MARKER = "const UNIT_ALIASES = {";
const BLOCK_END_MARKER = "export async function deleteInventoryItem(";

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
};

async function loadBlock() {
  const source = await readFile(MODEL_PATH, "utf8");
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.startsWith(BLOCK_START_MARKER));
  const endIdx = lines.findIndex((l) => l.startsWith(BLOCK_END_MARKER));
  if (startIdx < 0 || endIdx <= startIdx) {
    throw new Error(`Could not locate block markers (${BLOCK_START_MARKER} / ${BLOCK_END_MARKER})`);
  }
  return lines.slice(startIdx, endIdx).join("\n").replace(/^export\s+/gm, "");
}

function makeHarness(store) {
  const INVENTORY_COLLECTION = "inventory";

  function doc(db, coll, id) {
    return { __coll: coll, __id: String(id) };
  }

  function getStore(ref) {
    if (ref?.__coll === INVENTORY_COLLECTION) return store.inventory;
    return store.orders;
  }

  function getDoc(ref) {
    const map = getStore(ref);
    const data = map.get(ref.__id);
    if (!data) return { exists: () => false, data: () => ({}) };
    return { id: ref.__id, exists: () => true, data: () => ({ ...data }) };
  }

  function updateDoc(ref, patch) {
    const map = getStore(ref);
    const data = map.get(ref.__id) || {};
    map.set(ref.__id, { ...data, ...patch });
  }

  // In-memory transaction emulation that mirrors real Firestore semantics:
  // reads must happen before any write within a transaction.
  function runTransaction(db, callback) {
    let wrote = false;
    const tx = {
      async get(ref) {
        if (wrote) throw new Error("Firestore transaction error: reads after writes are not allowed");
        return getDoc(ref);
      },
      update(ref, patch) {
        wrote = true;
        updateDoc(ref, patch);
      },
    };
    return callback(tx);
  }

  function collection(db, coll) {
    return { __coll: coll };
  }

  function getDocs(coll) {
    const map = coll.__coll === INVENTORY_COLLECTION ? store.inventory : store.orders;
    return {
      docs: [...map.entries()].map(([id, data]) => ({
        id,
        data: () => ({ id, ...data }),
      })),
    };
  }

  return { doc, getDoc, updateDoc, runTransaction, collection, getDocs, INVENTORY_COLLECTION };
}

async function main() {
  const block = await loadBlock();
  const store = {
    inventory: new Map(),
    orders: new Map(),
  };
  const { doc, getDoc, updateDoc, runTransaction, collection, getDocs, INVENTORY_COLLECTION } = makeHarness(store);

  const factory = new Function(
    "db", "doc", "getDoc", "updateDoc", "runTransaction", "collection", "getDocs", "INVENTORY_COLLECTION",
    `${block}
    return { deductInventoryQuantities, restoreInventoryForOrder, convertQuantityBetweenUnits, normalizeUnit };`,
  );
  const { deductInventoryQuantities, restoreInventoryForOrder } = factory(
    {}, doc, getDoc, updateDoc, runTransaction, collection, getDocs, INVENTORY_COLLECTION,
  );

  const orderRef = doc({}, "orders", "order-1");
  const milkRef = doc({}, "inventory", "inv-milk");

  // Case 1: unit conversion + multiplier + audit written atomically with progress
  store.inventory.set("inv-milk", { name: "Milk", unit: "ml", quantity: 1000 });
  const r1 = await deductInventoryQuantities(
    [{ inventoryId: "inv-milk", name: "Milk", unit: "ml", quantity: 50 }],
    2,
    orderRef,
    0,
  );
  assert.equal(store.inventory.get("inv-milk").quantity, 900, "deduct: 50ml x2 deducted from 1000ml");
  assert.equal(r1.deducted, 1, "deduct: one inventory doc updated");
  assert.equal(r1.audit.length, 1, "deduct: audit recorded");
  assert.equal(store.orders.get("order-1").inventoryDeductions.length, 1, "deduct: audit persisted on order");
  assert.equal(store.orders.get("order-1").inventoryDeductionProgress, 1, "deduct: progress written");
  assert.equal(store.orders.get("order-1").inventoryDeductionFailed, false, "deduct: failure flag cleared");
  console.log("OK deduct: unit conversion + multiplier + atomic audit");

  // Case 2: aggregation of two ingredients targeting the same inventory doc
  store.inventory.set("inv-sugar", { name: "Sugar", unit: "g", quantity: 500 });
  const r2 = await deductInventoryQuantities(
    [
      { inventoryId: "inv-sugar", name: "Sugar", unit: "g", quantity: 20 },
      { inventoryId: "inv-sugar", name: "Sugar", unit: "g", quantity: 30 },
    ],
    1,
    null,
    0,
  );
  assert.equal(store.inventory.get("inv-sugar").quantity, 450, "deduct: aggregated 50g deducted");
  assert.equal(r2.audit.length, 1, "deduct: single aggregated audit entry");
  console.log("OK deduct: same-ingredient aggregation");

  // Case 3: unit mismatch (recipe g vs inventory pcs) -> skip detail, nothing deducted
  store.inventory.set("inv-straw", { name: "Straw", unit: "pcs", quantity: 10 });
  const r3 = await deductInventoryQuantities(
    [{ inventoryId: "inv-straw", name: "Straw", unit: "g", quantity: 5 }],
    1,
    null,
    0,
  );
  assert.equal(store.inventory.get("inv-straw").quantity, 10, "deduct: unit mismatch does not deduct");
  assert.ok(r3.skipDetails.some((s) => s.reason.startsWith("unit mismatch")), "deduct: unit mismatch skip reason recorded");
  assert.equal(r3.skipped, 1, "deduct: skipped count includes unit mismatch");
  console.log("OK deduct: unit mismatch surfaced as skip detail");

  // Case 4: missing inventory doc -> skip detail, other items still deduct
  store.inventory.set("inv-coffee", { name: "Coffee", unit: "g", quantity: 200 });
  const r4 = await deductInventoryQuantities(
    [
      { inventoryId: "inv-ghost", name: "Ghost Ingredient", unit: "g", quantity: 10 },
      { inventoryId: "inv-coffee", name: "Coffee", unit: "g", quantity: 10 },
    ],
    1,
    null,
    0,
  );
  assert.equal(store.inventory.get("inv-coffee").quantity, 190, "deduct: valid item still deducted");
  assert.ok(r4.skipDetails.some((s) => s.name === "Ghost Ingredient" && s.reason === "not found in inventory"), "deduct: missing doc skip reason");
  assert.equal(r4.skipped, 1, "deduct: missing doc counted as skipped");
  console.log("OK deduct: missing doc skipped, valid items unaffected");

  // Case 5: zero clamp + alert
  store.inventory.set("inv-beans", { name: "Beans", unit: "g", quantity: 10 });
  const r5 = await deductInventoryQuantities(
    [{ inventoryId: "inv-beans", name: "Beans", unit: "g", quantity: 25 }],
    1,
    null,
    0,
  );
  assert.equal(store.inventory.get("inv-beans").quantity, 0, "deduct: clamps at zero");
  assert.equal(r5.alerts.length, 1, "deduct: zero-stock alert raised");
  assert.equal(r5.alerts[0].remainingQty, 0, "deduct: alert remaining 0");
  console.log("OK deduct: zero clamp + alert");

  // Case 6: resumeIndex appends audit instead of overwriting
  const r6a = await deductInventoryQuantities(
    [{ inventoryId: "inv-coffee", name: "Coffee", unit: "g", quantity: 10 }],
    1,
    orderRef,
    1,
  );
  const orderDocAfter = store.orders.get("order-1");
  assert.equal(orderDocAfter.inventoryDeductions.length, 2, "deduct: audit appended across lines");
  assert.equal(orderDocAfter.inventoryDeductionProgress, 2, "deduct: progress advanced to next line");
  assert.equal(r6a.audit.length, 1, "deduct: per-call audit returned");
  console.log("OK deduct: resume append preserves prior audit");

  // Case 7: in-transaction idempotency guard - a concurrent sync already
  // progressed past this line, so the transaction bails without writes
  const coffeeBefore = store.inventory.get("inv-coffee").quantity;
  const r7 = await deductInventoryQuantities(
    [{ inventoryId: "inv-coffee", name: "Coffee", unit: "g", quantity: 10 }],
    1,
    orderRef,
    1,
  );
  const orderDocGuard = store.orders.get("order-1");
  assert.equal(store.inventory.get("inv-coffee").quantity, coffeeBefore, "deduct: already-progressed line does not deduct");
  assert.equal(orderDocGuard.inventoryDeductions.length, 2, "deduct: already-progressed line does not append audit");
  assert.equal(orderDocGuard.inventoryDeductionProgress, 2, "deduct: already-progressed line does not move progress");
  assert.equal(r7.deducted, 0, "deduct: no inventory updated on guard hit");
  console.log("OK deduct: concurrent already-progressed line skipped in-transaction");

  // Case 8: legacy order (audit but no progress field) is treated as fully
  // deducted, so a stray sync cannot double-deduct it
  const legacyRef = doc({}, "orders", "order-legacy");
  store.orders.set("order-legacy", { inventoryDeductions: [{ inventoryId: "inv-coffee", name: "Coffee" }] });
  const legacyBefore = store.inventory.get("inv-coffee").quantity;
  const r8 = await deductInventoryQuantities(
    [{ inventoryId: "inv-coffee", name: "Coffee", unit: "g", quantity: 10 }],
    1,
    legacyRef,
    0,
  );
  assert.equal(store.inventory.get("inv-coffee").quantity, legacyBefore, "deduct: legacy audited order not re-deducted");
  assert.equal(store.orders.get("order-legacy").inventoryDeductions.length, 1, "deduct: legacy audit not appended");
  assert.equal(r8.deducted, 0, "deduct: legacy order deducts nothing");
  console.log("OK deduct: legacy audited order (no progress) skipped in-transaction");

  // Case 9: no orderRef -> no order doc written
  store.orders.delete("order-1");
  store.orders.delete("order-legacy");
  await deductInventoryQuantities(
    [{ inventoryId: "inv-coffee", name: "Coffee", unit: "g", quantity: 5 }],
    1,
    null,
    0,
  );
  assert.equal(store.orders.size, 0, "deduct: no order write without orderRef");
  console.log("OK deduct: orderRef optional");

  // ── restoreInventoryForOrder ──

  // Case R1: audit-trail restore returns exactly the deducted amount
  store.inventory.set("inv-milk", { name: "Milk", unit: "ml", quantity: 900 });
  const s1 = await restoreInventoryForOrder({
    orderId: "order-1",
    items: [{ menuItemId: "m1", name: "Latte", quantity: 1, recipe: [{ inventoryId: "inv-milk", name: "Milk", unit: "ml", quantity: 50 }] }],
    inventoryDeductions: [{ inventoryId: "inv-milk", name: "Milk", unit: "ml", deductedQty: 50 }],
  });
  assert.equal(store.inventory.get("inv-milk").quantity, 950, "restore: audit trail adds back deductedQty");
  assert.equal(s1.success, true, "restore: audit-trail path reports success");
  console.log("OK restore: audit-trail exact restore");

  // Case R2: no audit trail -> recipe fallback converts units to the
  // inventory unit (recipe in ml, inventory in l)
  store.inventory.set("inv-milk", { name: "Milk", unit: "l", quantity: 1 });
  const s2 = await restoreInventoryForOrder({
    orderId: "order-2",
    items: [{ menuItemId: "m2", name: "Latte", quantity: 2, recipe: [{ inventoryId: "inv-milk", name: "Milk", unit: "ml", quantity: 50 }] }],
  });
  assert.equal(store.inventory.get("inv-milk").quantity, 1.1, "restore: fallback converts recipe unit to inventory unit");
  assert.equal(s2.restored, 1, "restore: fallback restored one inventory entry");
  console.log("OK restore: fallback unit conversion (100ml -> 0.1l)");

  // Case R3: fallback skips ingredients that deduct would skip
  // (missing inventory doc + unit mismatch), restoring only the valid one
  store.inventory.set("inv-coffee", { name: "Coffee", unit: "g", quantity: 200 });
  store.inventory.set("inv-straw", { name: "Straw", unit: "pcs", quantity: 10 });
  const s3 = await restoreInventoryForOrder({
    orderId: "order-3",
    items: [{
      menuItemId: "m3",
      name: "Cold Brew",
      quantity: 1,
      recipe: [
        { inventoryId: "inv-ghost", name: "Ghost Ingredient", unit: "g", quantity: 10 },
        { inventoryId: "inv-straw", name: "Straw", unit: "g", quantity: 5 },
        { inventoryId: "inv-coffee", name: "Coffee", unit: "g", quantity: 10 },
      ],
    }],
  });
  assert.equal(store.inventory.get("inv-coffee").quantity, 210, "restore: valid ingredient restored");
  assert.equal(store.inventory.get("inv-ghost"), undefined, "restore: missing doc not restored");
  assert.equal(store.inventory.get("inv-straw").quantity, 10, "restore: unit mismatch not restored");
  assert.equal(s3.restored, 1, "restore: only resolvable entries restored");
  console.log("OK restore: fallback mirrors deduct skips");

  // Case R4: name-only ingredient resolved through the normalized fallback
  // lookup (no inventoryId on the recipe)
  store.inventory.set("inv-sugar", { name: "Sugar", unit: "g", quantity: 400 });
  const s4 = await restoreInventoryForOrder({
    orderId: "order-4",
    items: [{ menuItemId: "m4", name: "Pastry", quantity: 1, recipe: [{ name: "Sugar", unit: "g", quantity: 25 }] }],
  });
  assert.equal(store.inventory.get("inv-sugar").quantity, 425, "restore: name-only ingredient matched by name");
  assert.equal(s4.restored, 1, "restore: name-only resolution restored");
  console.log("OK restore: name-only fallback lookup");

  // Case R5: nothing to restore when the sale has no items/recipe
  const s5 = await restoreInventoryForOrder({ orderId: "order-5", items: [{ menuItemId: "m5", name: "Espresso", quantity: 1 }] });
  assert.equal(s5.success, true, "restore: empty sale is a no-op success");
  assert.equal(s5.restored, 0, "restore: empty sale restores nothing");
  console.log("OK restore: empty sale no-op");

  console.log("PASS: Inventory deduction smoke checks succeeded.");
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
