// Smoke test for the Web Bluetooth thermal printer module.
// Real BLE is not available in Node, so the GATT stack is mocked. The test
// proves the connection-drop scenarios that used to leave the printer stuck on
// "Not connected" until the page was reloaded:
//   1. an unexpected link drop is auto-recovered (reconnect + re-discovery),
//   2. idle links receive a non-printing keep-alive instead of drifting into
//      printer sleep / BLE supervision timeout,
//   3. an explicit disconnect stays disconnected (no phantom reconnect).

let failed = false;
function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

const assert = {
  ok(condition, label) {
    if (!condition) fail(label);
  },
  equal(actual, expected, label) {
    if (actual !== expected) {
      fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
};

// ── Fake Bluetooth stack ──

const writeLog = [];
let gattConnected = false;
let connectCalls = 0;
let connectShouldFail = false;
let disconnectHandler = null;

function makeCharacteristic(uuid) {
  return {
    uuid,
    properties: { write: true, writeWithoutResponse: true, writeWithResponse: false },
    async writeValueWithoutResponse(chunk) {
      writeLog.push(Array.from(chunk));
    },
  };
}

const fakeServer = {
  async getPrimaryServices() {
    return [
      {
        uuid: "0000ffe0-0000-1000-8000-00805f9b34fb",
        async getCharacteristics() {
          return [makeCharacteristic("0000ffe1-0000-1000-8000-00805f9b34fb")];
        },
      },
    ];
  },
};

const fakeDevice = {
  id: "test-device-1",
  name: "Test Thermal 58",
  __bbListenerAttached: false,
  gatt: {
    get connected() { return gattConnected; },
    async connect() {
      if (connectShouldFail) throw new Error("adapter busy (other side holds the link)");
      if (!gattConnected) connectCalls++;
      gattConnected = true;
      return fakeServer;
    },
    disconnect() {
      gattConnected = false;
    },
  },
  addEventListener(type, fn) {
    if (type === "gattserverdisconnected") disconnectHandler = fn;
  },
  removeEventListener(type) {
    if (type === "gattserverdisconnected") disconnectHandler = null;
  },
};

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    bluetooth: {
      async requestDevice() { return fakeDevice; },
      async getDevices() { return [fakeDevice]; },
    },
  },
});

// Fake timers: keep the module's setInterval callbacks under our control so the
// keep-alive test does not wait 30+ real seconds.
const capturedIntervals = [];
global.setInterval = (fn) => {
  capturedIntervals.push(fn);
  return { __fake: true };
};
global.clearInterval = () => {};
global.clearTimeout = () => {};

// Fake localStorage so the "printer selected on one side, reused on the other"
// hand-off can be exercised (the module persists the device here).
const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
});

const realNow = Date.now;
let nowMs = realNow();
Date.now = () => nowMs;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Tests ──

const printer = await import("../controllers/printer/thermalPrinter.js");

// 1) Initial connect
const connected = await printer.connectPrinter();
assert.ok(printer.isSupported(), "isSupported() true with mocked bluetooth");
assert.equal(connected.connected, true, "connectPrinter reports connected");
assert.equal(connectCalls, 1, "one GATT connect on initial pairing");
assert.equal(printer.getStatus().reconnecting, false, "not reconnecting after connect");
assert.ok(storage.has("bb-pos-thermal-device"), "paired device persisted to localStorage (shared with other pages)");

// 2) printReceipt works while connected
const sale = {
  orderId: "ORDER-001234",
  items: [{ name: "Spanish Latte", price: 110, quantity: 2, addons: [] }],
  total: 220,
  paymentMethod: "cash",
  cashierName: "Test",
  createdAtMs: Date.now(),
  amountTendered: 500,
  change: 280,
};
const printResult = await printer.printReceipt(sale);
assert.equal(printResult.status, "sent", "receipt prints while connected");
assert.ok(writeLog.length > 1, "receipt bytes were chunked and written");
writeLog.length = 0;

// 2b) Header address must wrap instead of being cut off, on both paper sizes.
const ADDRESS = "N. Guevarra St., Brgy. Zone 1, Poblacion, Dasmarinas City, Cavite";
const decodeReceipt = (body) => {
  let text = "";
  for (const b of Array.from(body)) {
    if (b === 0x0a) text += "\n";
    else if (b >= 32 && b <= 126) text += String.fromCharCode(b);
  }
  return text;
};
for (const [paper, lineWidth] of [[58, 32], [80, 42]]) {
  const text = decodeReceipt(printer.buildEscReceipt(sale, paper));
  const addrLines = text.split("\n").filter((l) => l.includes("Guevarra") || l.includes("Poblacion") || l.includes("Dasmarinas"));
  assert.ok(
    ADDRESS.split(" ").every((word) => text.includes(word)),
    `${paper}mm receipt keeps every address word (no cut off)`,
  );
  assert.ok(addrLines.length >= 2, `${paper}mm address wraps to multiple lines`);
  assert.ok(addrLines.every((l) => l.trim().length <= lineWidth), `${paper}mm each address line fits ${lineWidth} cols`);
}

// 2c) Discounted item lines must never merge the discount label into the total.
const discountedSale = {
  ...sale,
  items: [{ name: "Caramel Macchiato", price: 145, quantity: 1, addons: [{ name: "Extra shot", price: 25 }], discountPercent: 0.1 }],
  total: 153,
};
const narrowText = decodeReceipt(printer.buildEscReceipt(discountedSale, 58));
assert.ok(narrowText.includes("(-10%)"), "58mm keeps the full discount label (-10%)");
assert.ok(narrowText.includes("P153.00"), "58mm keeps the discounted line total");
assert.ok(!narrowText.includes("%)P153") && !narrowText.includes("(-10%P"), "58mm discount label never runs into the total");
const discountedLines = narrowText.split("\n").filter((l) => /^\s+P153\.00\s*$/.test(l));
assert.ok(discountedLines.length === 1, "58mm discounted total sits on its own right-aligned line");
assert.ok(discountedLines.every((l) => l.trim().length <= 32), "58mm total amount lines fit within the paper width");

// 3) Unexpected link drop → auto-reconnect
gattConnected = false;
assert.ok(typeof disconnectHandler === "function", "disconnect handler registered");
disconnectHandler();
await wait(300);
let st = printer.getStatus();
assert.equal(st.connected, false, "after drop, not connected");
assert.equal(st.reconnecting, true, "after drop, reconnecting flag set");

await wait(1600);
st = printer.getStatus();
assert.equal(st.connected, true, "auto-reconnect restored the link");
assert.equal(st.reconnecting, false, "reconnecting cleared after success");
assert.equal(connectCalls, 2, "second GATT connect happened for the drop");
assert.equal(writeLog.length, 0, "no stray writes during reconnect");

// 3b) Print request while the link is down → reconnect-on-demand and print
gattConnected = false;
disconnectHandler();
await wait(100);
st = printer.getStatus();
assert.equal(st.connected, false, "link dropped again for print recovery test");
const recoveryResult = await printer.printReceipt(sale);
assert.equal(recoveryResult.status, "sent", "print request reconnects and prints");
assert.equal(printer.getStatus().connected, true, "print-time recovery left link connected");
assert.ok(writeLog.length > 1, "recovered print wrote receipt bytes");
assert.equal(connectCalls, 3, "print-time recovery triggered a GATT connect");
writeLog.length = 0;
// The backoff timer from the drop is still pending; when it fires it must be a
// harmless no-op (already connected), not a new connect or a UI flip-flop.
await wait(1600);
assert.equal(printer.getStatus().connected, true, "stale backoff tick leaves link connected");
assert.equal(connectCalls, 3, "stale backoff tick does not reconnect again");
assert.equal(writeLog.length, 0, "stale backoff tick writes nothing");

// 3c) Other-side hand-off: reconnectSavedPrinter picks up the device the POS
// side persisted and keeps retrying when the first connect fails (e.g. the
// POS tab still holds the printer's single BLE link).
const connectsBeforeHandoff = connectCalls;
gattConnected = false;
connectShouldFail = true;
await printer.reconnectSavedPrinter();
let handoff = printer.getStatus();
assert.equal(handoff.connected, false, "hand-off first attempt fails while other side holds the link");
assert.equal(handoff.reconnecting, true, "hand-off failure triggers retry backoff, not give-up");
connectShouldFail = false;
await wait(1600);
handoff = printer.getStatus();
assert.equal(handoff.connected, true, "hand-off auto-connects once the link is free");
assert.equal(connectCalls, connectsBeforeHandoff + 1, "hand-off: failed attempt (no GATT) + one successful retry");
assert.ok(storage.has("bb-pos-thermal-device"), "hand-off keeps the saved device reference");

// 4) Keep-alive: after 20s idle the module sends a non-printing status request
nowMs += 25000;
for (const fn of capturedIntervals) await fn();
assert.ok(
  writeLog.some((chunk) => chunk.length === 3 && chunk[0] === 0x10 && chunk[1] === 0x04),
  "idle keep-alive (DLE EOT status request) written"
);
writeLog.length = 0;

// 5) Explicit disconnect stays disconnected
await printer.disconnectPrinter();
st = printer.getStatus();
assert.equal(st.connected, false, "explicit disconnect clears connection");
assert.equal(st.reconnecting, false, "explicit disconnect clears reconnect flag");
await wait(1600);
assert.equal(st.connected, false, "no phantom reconnect after explicit disconnect");
assert.equal(connectCalls, 4, "no further GATT connects after explicit disconnect");

Date.now = realNow;

if (failed) {
  console.error("FAIL: Thermal printer smoke checks failed.");
  process.exit(1);
}
console.log("PASS: Thermal printer smoke checks succeeded.");
