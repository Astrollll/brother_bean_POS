import { readFile } from "node:fs/promises";

const MODEL_PATH = "models/orderModel.js";

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

async function extractBlocks(source) {
  const lines = source.split(/\r?\n/);

  function sliceBetween(startMarker, endMarker) {
    const startIdx = lines.findIndex((l) => l.startsWith(startMarker));
    const endIdx = lines.findIndex((l) => l.startsWith(endMarker));
    if (startIdx < 0 || endIdx <= startIdx) {
      throw new Error(`Could not locate markers ${startMarker} / ${endMarker}`);
    }
    return lines.slice(startIdx, endIdx).join("\n").replace(/^export\s+/gm, "");
  }

  return {
    syncBlock: sliceBetween("function normalizePayloadDates(", "export function getQueuedOrders"),
    repairBlock: sliceBetween("export async function repairOrderTimestamps(", "export async function deleteOrder"),
  };
}

async function main() {
  const source = await readFile(MODEL_PATH, "utf8");
  const { syncBlock, repairBlock } = await extractBlocks(source);

  const timestampMocks = [];
  const Timestamp = {
    fromDate(date) {
      const t = { __ts: "date", value: date };
      timestampMocks.push(t);
      return t;
    },
    fromMillis(ms) {
      const t = { __ts: "millis", value: ms };
      timestampMocks.push(t);
      return t;
    },
  };

  // ── syncQueuedOrders normalization ──
  const writtenPayloads = [];
  const removedQueueIds = [];
  let outbox = [];
  const syncFactory = new Function(
    "db", "Timestamp", "ORDERS_COLLECTION", "getOrderOutbox", "removeQueuedOrder",
    "deductInventoryQuantities", "doc", "setDoc", "updateDoc",
    `${syncBlock}
    return { syncQueuedOrders };`,
  );
  const { syncQueuedOrders } = syncFactory(
    {}, Timestamp, "orders",
    () => outbox,
    (id) => { removedQueueIds.push(id); },
    () => ({ alerts: [], audit: [] }),
    () => ({ __ref: true }),
    (ref, payload) => { writtenPayloads.push(payload); },
    () => {},
  );

  // Case 1: ISO-string createdAt/paidAt (JSON round-trip through the outbox) -> Timestamps
  outbox = [{
    id: "q1",
    payload: {
      orderId: "o1",
      createdAt: "2026-07-31T09:12:33.000Z",
      createdAtMs: 1785498753000,
      paidAt: "2026-07-31T09:12:34.000Z",
      total: 120,
      items: [],
    },
  }];
  await syncQueuedOrders();
  assert.equal(writtenPayloads.length, 1, "sync: setDoc called once");
  assert.ok(writtenPayloads[0].createdAt && writtenPayloads[0].createdAt.__ts === "date", "sync: string createdAt converted to Timestamp");
  assert.ok(writtenPayloads[0].paidAt && writtenPayloads[0].paidAt.__ts === "date", "sync: string paidAt converted to Timestamp");
  assert.equal(writtenPayloads[0].createdAt.value.toISOString(), "2026-07-31T09:12:33.000Z", "sync: createdAt value preserved");
  assert.equal(removedQueueIds.length, 1, "sync: queued item removed after sync");
  console.log("OK sync: string createdAt/paidAt -> Timestamp");

  // Case 2: missing createdAt, createdAtMs present -> backfilled
  writtenPayloads.length = 0;
  removedQueueIds.length = 0;
  timestampMocks.length = 0;
  outbox = [{
    id: "q2",
    payload: { orderId: "o2", createdAtMs: 1785490000000, total: 50, items: [] },
  }];
  await syncQueuedOrders();
  assert.ok(writtenPayloads[0].createdAt && writtenPayloads[0].createdAt.__ts === "millis", "sync: createdAt backfilled from createdAtMs");
  assert.equal(writtenPayloads[0].createdAt.value, 1785490000000, "sync: backfilled millis preserved");
  console.log("OK sync: createdAt backfilled from createdAtMs");

  // Case 3: already a Timestamp -> untouched
  writtenPayloads.length = 0;
  timestampMocks.length = 0;
  const existingTs = { toDate: () => new Date(), __already: true };
  outbox = [{
    id: "q3",
    payload: { orderId: "o3", createdAt: existingTs, createdAtMs: 1785490000000, items: [] },
  }];
  await syncQueuedOrders();
  assert.equal(writtenPayloads[0].createdAt, existingTs, "sync: existing Timestamp untouched");
  console.log("OK sync: existing Timestamp untouched");

  // Case 4: empty outbox -> no writes
  writtenPayloads.length = 0;
  outbox = [];
  const result = await syncQueuedOrders();
  assert.equal(result.synced, 0, "sync: empty outbox synced=0");
  assert.equal(writtenPayloads.length, 0, "sync: empty outbox no writes");
  console.log("OK sync: empty outbox handled");

  // ── repairOrderTimestamps ──
  const updatedDocs = [];
  const repairFactory = new Function(
    "db", "Timestamp", "ORDERS_COLLECTION", "doc", "updateDoc",
    `${repairBlock}
    return { repairOrderTimestamps };`,
  );
  const { repairOrderTimestamps } = repairFactory(
    {}, Timestamp, "orders",
    (db, coll, id) => ({ __id: id }),
    (ref, patch) => { updatedDocs.push({ id: ref.__id, patch }); },
  );

  // Case 1: string createdAt + string paidAt -> both patched
  const fixed1 = await repairOrderTimestamps([
    { id: "b1", orderId: "b1", createdAt: "2026-07-31T09:12:33.000Z", paidAt: "2026-07-31T09:12:34.000Z", createdAtMs: 1785498753000 },
  ]);
  assert.equal(fixed1.fixed, 1, "repair: fixed count for string createdAt");
  assert.equal(updatedDocs.length, 1, "repair: updateDoc called once");
  assert.ok(updatedDocs[0].patch.createdAt && updatedDocs[0].patch.createdAt.__ts === "date", "repair: createdAt patched to Timestamp");
  assert.ok(updatedDocs[0].patch.paidAt && updatedDocs[0].patch.paidAt.__ts === "date", "repair: paidAt patched to Timestamp");
  console.log("OK repair: string createdAt/paidAt patched");

  // Case 2: missing createdAt with createdAtMs -> backfilled, archived orders skipped
  updatedDocs.length = 0;
  const fixed2 = await repairOrderTimestamps([
    { id: "b2", orderId: "b2", createdAtMs: 1785490000000 },
    { id: "arch", orderId: "arch", archivedFrom: "2026-07-30", createdAt: "2026-07-30T09:00:00.000Z" },
    { id: "ok", orderId: "ok", createdAt: { toDate: () => new Date() } },
  ]);
  assert.equal(fixed2.fixed, 1, "repair: only missing-createdAt active order fixed");
  assert.equal(updatedDocs.length, 1, "repair: one updateDoc");
  assert.ok(updatedDocs[0].patch.createdAt.__ts === "millis", "repair: backfilled from createdAtMs");
  assert.equal(updatedDocs[0].id, "b2", "repair: correct doc id");
  console.log("OK repair: backfill + archived/healthy skipped");

  // Case 3: no broken orders -> no writes
  updatedDocs.length = 0;
  const fixed3 = await repairOrderTimestamps([
    { id: "ok", orderId: "ok", createdAt: { toDate: () => new Date() } },
    { id: "arch", orderId: "arch", archivedFrom: "x", createdAt: "2026-07-30T09:00:00.000Z" },
  ]);
  assert.equal(fixed3.fixed, 0, "repair: nothing to fix");
  assert.equal(updatedDocs.length, 0, "repair: no writes");
  console.log("OK repair: clean data untouched");

  console.log("PASS: Orders sync/repair smoke checks succeeded.");
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
