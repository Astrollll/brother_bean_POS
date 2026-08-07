// ── THERMAL PRINTER (Web Bluetooth + ESC/POS) ──
// Prints receipts to a Bluetooth LE thermal printer straight from the browser.
//
// How it works:
//   * Uses the Web Bluetooth API (Chrome/Edge on Windows/Android).
//   * Most BLE 58mm/80mm thermal receipt printers expose a "transparent serial"
//     GATT service (0xFFE0 service / 0xFFE1 write characteristic). If the
//     printer uses a different service, connect once — the module auto-detects
//     the first writable characteristic after pairing.
//   * ESC/POS bytes are generated here (58mm/32-char or 80mm/42-char layouts),
//     written to the printer, fed, and cut.
//   * The selected printer + settings are remembered across reloads.

const STORAGE_KEYS = {
  device: "bb-pos-thermal-device",
  settings: "bb-pos-thermal-settings",
};

const DEFAULT_SETTINGS = {
  paperWidth: 58, // mm — 58 or 80
  autoPrint: true, // print the receipt automatically right after payment
  serviceUuid: "0000ffe0-0000-1000-8000-00805f9b34fb",
  charUuid: "0000ffe1-0000-1000-8000-00805f9b34fb",
};

// Transparent-serial service/characteristic pairs commonly found on BLE thermal
// printers. When the saved UUIDs don't match, we scan the device's services for
// the first writable characteristic.
const KNOWN_PAIRS = [
  { service: "0000ffe0-0000-1000-8000-00805f9b34fb", characteristic: "0000ffe1-0000-1000-8000-00805f9b34fb" },
  { service: "0000ff00-0000-1000-8000-00805f9b34fb", characteristic: "0000ff01-0000-1000-8000-00805f9b34fb" },
  { service: "0000ae30-0000-1000-8000-00805f9b34fb", characteristic: "0000ae01-0000-1000-8000-00805f9b34fb" },
  { service: "000018f0-0000-1000-8000-00805f9b34fb", characteristic: "000018f1-0000-1000-8000-00805f9b34fb" },
];

// Max bytes per BLE write (MTU floor). Chunking is required because most
// printers negotiate the default 23-byte MTU (20 payload bytes).
const BLE_WRITE_CHUNK = 20;
const FEED_AND_CUT_BYTES = new Uint8Array([0x1B, 0x64, 0x05, 0x1D, 0x56, 0x42]);

// ── STATE ──
let device = null;
let writeCharacteristic = null;
let connectionError = null;

// Status listeners (posController registers one to update the UI).
const _listeners = new Set();

function notifyStatus() {
  const status = getStatus();
  for (const fn of _listeners) fn(status);
}

export function onPrinterStatus(fn) {
  if (typeof fn === "function") _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function readSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch {}
}

function readSavedDevice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.device);
    return raw ? JSON.parse(raw) : null;
  } catch {}
  return null;
}

function saveSavedDevice(deviceInfo) {
  try {
    if (!deviceInfo) localStorage.removeItem(STORAGE_KEYS.device);
    else localStorage.setItem(STORAGE_KEYS.device, JSON.stringify(deviceInfo));
  } catch {}
}

// ── PUBLIC API ──

export function isSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

export function isConnected() {
  return !!(device && writeCharacteristic && device.gatt.connected);
}

export function getStatus() {
  return {
    supported: isSupported(),
    connected: isConnected(),
    deviceName: device ? device.name : null,
    deviceId: device ? device.id : null,
    error: connectionError,
  };
}

export function getSettings() {
  return readSettings();
}

export function updateSettings(patch) {
  const next = { ...readSettings(), ...patch };
  saveSettings(next);
  return next;
}

export async function connectPrinter() {
  if (!isSupported()) {
    connectionError = "Web Bluetooth is not supported by this browser. Use Chrome or Edge.";
    notifyStatus();
    throw new Error(connectionError);
  }

  const settings = readSettings();

  let selected;
  try {
    selected = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [settings.serviceUuid] },
        ...KNOWN_PAIRS.filter((p) => p.service !== settings.serviceUuid).map((p) => ({ services: [p.service] })),
      ],
      optionalServices: [...new Set(KNOWN_PAIRS.map((p) => p.service))],
      acceptAllDevices: false,
    });
  } catch (error) {
    // Filtered request can miss printers that don't advertise a service; retry
    // with acceptAllDevices so every nearby BLE device can be picked.
    if (!/cancelled|cancel/i.test(String(error?.message || ""))) {
      selected = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [...new Set(KNOWN_PAIRS.map((p) => p.service))],
      });
    } else {
      throw error;
    }
  }

  await attachDevice(selected, settings);
  return getStatus();
}

export async function disconnectPrinter() {
  try {
    if (device?.gatt?.connected) device.gatt.disconnect();
  } catch {}
  device = null;
  writeCharacteristic = null;
  connectionError = null;
  saveSavedDevice(null);
  notifyStatus();
}

// Re-connect to a printer selected in a previous session (Chrome grants
// re-access to already-paired devices via getDevices()).
export async function reconnectSavedPrinter() {
  const saved = readSavedDevice();
  if (!saved || !isSupported()) return getStatus();

  try {
    const devices = await navigator.bluetooth.getDevices();
    const match = devices.find(
      (d) => d.id === saved.id || (saved.name && d.name === saved.name)
    );
    if (!match) {
      // Device no longer paired; forget the reference silently.
      saveSavedDevice(null);
      return getStatus();
    }
    await attachDevice(match, readSettings());
  } catch (error) {
    connectionError = `Reconnect failed: ${error?.message || "unknown error"}`;
    console.warn("[Printer] Reconnect failed.", error);
  }
  notifyStatus();
  return getStatus();
}

// Print a sale receipt. Returns { status, message } — never throws.
export async function printReceipt(sale) {
  const status = getStatus();
  if (!isSupported()) {
    return { status: "unsupported", message: "Bluetooth not supported by this browser." };
  }
  if (!status.connected) {
    return { status: "not-connected", message: "No printer connected." };
  }

  try {
    const bytes = buildEscReceipt(sale, readSettings().paperWidth || 58);
    await writeBytes(bytes);
    return { status: "sent", message: "Receipt sent to printer." };
  } catch (error) {
    connectionError = error?.message || "Print failed.";
    console.warn("[Printer] Print failed.", error);
    notifyStatus();
    return { status: "error", message: connectionError };
  }
}

// Auto-print after payment. Only prints when a printer is connected and the
// auto-print setting is on; otherwise it's a silent no-op (the cashier can
// still tap "Print receipt").
export async function autoPrintReceipt(sale) {
  if (!readSettings().autoPrint) return { status: "disabled", message: "" };
  const result = await printReceipt(sale);
  return result;
}

// ── INTERNAL: connection + writing ──

async function attachDevice(selected, settings) {
  connectionError = null;
  device = selected;

  try {
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();

    // 1) Prefer the saved/known transparent-serial pair.
    let characteristic = await findCharacteristic(services, settings.serviceUuid, settings.charUuid);

    // 2) Otherwise scan every service for the first writable characteristic
    //    that looks like a data pipe.
    if (!characteristic) {
      for (const service of services) {
        characteristic = await findWritableCharacteristic(service);
        if (characteristic) break;
      }
    }

    if (!characteristic) {
      throw new Error("No writable data characteristic found on this printer. Some printers only support classic Bluetooth (SPP), which the browser cannot access.");
    }

    writeCharacteristic = characteristic;
    saveSavedDevice({ id: device.id, name: device.name });
    device.addEventListener("gattserverdisconnected", () => {
      writeCharacteristic = null;
      notifyStatus();
    });
    notifyStatus();
    return;
  } catch (error) {
    const failed = device;
    device = null;
    writeCharacteristic = null;
    connectionError = error?.message || "Unable to connect to the printer.";
    try { if (failed?.gatt) await failed.gatt.disconnect(); } catch {}
    notifyStatus();
    throw new Error(connectionError);
  }
}

async function findCharacteristic(services, serviceUuid, charUuid) {
  const normalize = (uuid) => String(uuid || "").toLowerCase().replace(/^0{8}-0{4}-0{4}-0{4}-/, "");
  const wantService = normalize(serviceUuid);
  const wantChar = normalize(charUuid);

  for (const service of services) {
    if (normalize(service.uuid) !== wantService) continue;
    try {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (normalize(ch.uuid) === wantChar && ch.properties.write) return ch;
      }
    } catch {}
  }
  return null;
}

async function findWritableCharacteristic(service) {
  try {
    const chars = await service.getCharacteristics();
    for (const ch of chars) {
      if (ch.properties.write) return ch;
    }
  } catch {}
  return null;
}

async function writeBytes(bytes) {
  if (!writeCharacteristic) throw new Error("Printer is not connected.");

  // Chunk to the BLE MTU floor (20 bytes). Awaiting each write serializes the
  // writes so the printer's buffer is never flooded.
  for (let i = 0; i < bytes.length; i += BLE_WRITE_CHUNK) {
    const chunk = bytes.subarray(i, i + BLE_WRITE_CHUNK);
    if (writeCharacteristic.properties.writeWithoutResponse) {
      await writeCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await writeCharacteristic.writeValueWithResponse(chunk);
    }
  }
}

// ── ESC/POS receipt builder ──
// paperWidth is in mm (58 → 32 chars, 80 → 42 chars).

const CMD = {
  init: new Uint8Array([0x1B, 0x40]),
  // Select Font A (12-dot) so the 32-char (58mm) / 42-char (80mm) column math
  // holds even on printers whose default font is wider (16- or 24-dot).
  fontA: new Uint8Array([0x1B, 0x4D, 0x00]),
  alignCenter: new Uint8Array([0x1B, 0x61, 0x01]),
  boldOn: new Uint8Array([0x1B, 0x45, 0x01]),
  boldOff: new Uint8Array([0x1B, 0x45, 0x00]),
};

function textLine(text) {
  const bytes = new TextEncoder().encode(sanitizeText(text));
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes, 0);
  out[bytes.length] = 0x0A;
  return out;
}

function joinChunks(...chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// ESC/POS printers render each ASCII byte as one fixed-width dot column. Any
// multi-byte character (accented letters, ·, …, ₱) would occupy extra columns
// and shift alignment or overflow the line, so sanitize to plain ASCII before
// layout — 1 input char always becomes exactly 1 printed column. Control bytes
// are dropped too, so item names can never forge ESC/POS commands.
const CHAR_MAP = {
  "·": "/", "•": "*", "…": ".", "—": "-", "–": "-", "−": "-",
  "×": "x", "÷": "/", "₱": "P", "“": "\"", "”": "\"", "‘": "'", "’": "'",
  "°": "*", "±": "+", "¢": "c", "€": "E", "£": "L", "¥": "Y",
};

function sanitizeText(input) {
  const normalized = String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const ch of normalized) {
    const mapped = CHAR_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) {
      out += ch;
    } else if (code === 9 || code === 10 || code === 13) {
      // tabs/newlines are dropped (a single printer line only)
    } else {
      out += "?";
    }
  }
  return out;
}

function pad(text, width) {
  return sanitizeText(text).slice(0, width).padEnd(width, " ");
}

function center(text, width) {
  const t = sanitizeText(text).slice(0, width);
  const padTotal = Math.max(0, width - t.length);
  const left = Math.floor(padTotal / 2);
  return " ".repeat(left) + t + " ".repeat(padTotal - left);
}

function alignRow(left, right, width) {
  const l = sanitizeText(left);
  const r = sanitizeText(right);
  const avail = Math.max(1, width - r.length);
  const clipped = l.slice(0, avail);
  return pad(clipped, avail) + r;
}

function dashedLine(width, char = "-") {
  return char.repeat(width);
}

function formatMoney(n) {
  const value = (Number(n) || 0).toFixed(2);
  return `P${value}`;
}

function truncate(text, maxLen) {
  const t = sanitizeText(text);
  return t.length > maxLen ? t.slice(0, Math.max(1, maxLen - 1)) + "." : t;
}

// Fixed "YYYY-MM-DD HH:MM" date so the line is stable regardless of browser
// locale (toLocaleString output can be very long and shift the column math).
function formatDate(sale) {
  let d = null;
  const ms = Number(sale?.createdAtMs) || 0;
  if (ms > 0) {
    d = new Date(ms);
  } else if (sale?.createdAt) {
    d = typeof sale.createdAt.toDate === "function" ? sale.createdAt.toDate() : new Date(sale.createdAt);
  } else if (sale?.timestamp) {
    const parsed = Date.parse(sale.timestamp);
    if (!Number.isNaN(parsed)) d = new Date(parsed);
  }
  if (!d || Number.isNaN(d.getTime())) return sanitizeText(String(sale?.timestamp || "-"));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildEscReceipt(sale, paperWidth = 58) {
  const width = paperWidth >= 80 ? 42 : 32;
  const lines = [];

  // Header
  lines.push([CMD.boldOn, textLine(center("BROTHER BEAN COFFEE HOUSE", width)), CMD.boldOff]);
  lines.push([textLine(center("anytime is coffee time.", width))]);
  lines.push([textLine(center(truncate("N. Guevarra St. Brgy. Zone 1 Poblacion Dasmarinas City Cavite", width), width))]);
  lines.push([textLine("")]);
  lines.push([textLine(dashedLine(width, "="))]);

  // Metadata
  lines.push([textLine(alignRow("Date", formatDate(sale), width))]);
  lines.push([textLine(alignRow("Order #", String(sale.orderId || "").slice(-6) || "-", width))]);
  lines.push([textLine(alignRow("Payment", String(sale.paymentMethod || "-").toUpperCase(), width))]);
  if (String(sale.paymentMethod || "").toLowerCase() === "split") {
    lines.push([textLine(alignRow("Cash", formatMoney(sale.cashAmount || 0), width))]);
    lines.push([textLine(alignRow("GCash", formatMoney(sale.gcashAmount || 0), width))]);
  }
  lines.push([textLine(alignRow("Cashier", truncate(String(sale.cashierName || "Staff"), width - 8), width))]);
  lines.push([textLine(dashedLine(width, "="))]);

  // Items
  for (const item of Array.isArray(sale.items) ? sale.items : []) {
    const qty = Number(item.quantity) || 1;
    const base = Number(item.price) || 0;
    const addonsTotal = (Array.isArray(item.addons) ? item.addons : []).reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = base + addonsTotal;
    const unitPrice = originalUnit * (1 - discountPct);
    const lineTotal = unitPrice * qty;

    const namePrice = alignRow(truncate(`${qty} x ${item.name}`, width - 9), formatMoney(lineTotal), width);
    const nameIsBold = discountPct > 0;
    lines.push([
      nameIsBold ? CMD.boldOn : new Uint8Array([]),
      textLine(namePrice),
      nameIsBold ? CMD.boldOff : new Uint8Array([]),
    ]);

    const variant = [item.variant, item.temperature && item.temperature !== "N/A" ? item.temperature : null].filter(Boolean).join(" · ");
    if (variant) lines.push([textLine("  " + truncate(variant, width - 2))]);

    if (discountPct > 0) {
      lines.push([textLine("  " + truncate(`-${Math.round(discountPct * 100)}% off`, width - 2))]);
    }

    for (const addon of Array.isArray(item.addons) ? item.addons : []) {
      lines.push([textLine(alignRow("  + " + truncate(String(addon.name || ""), width - 12), formatMoney(addon?.price || 0), width))]);
    }
  }
  lines.push([textLine(dashedLine(width, "="))]);

  // Totals
  const subtotal = (Array.isArray(sale.items) ? sale.items : []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 1;
    const addonsTotal = (Array.isArray(item.addons) ? item.addons : []).reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const originalUnit = (Number(item.price) || 0) + addonsTotal;
    return sum + originalUnit * qty;
  }, 0);

  lines.push([textLine(alignRow("Subtotal", formatMoney(subtotal), width))]);
  const total = Number(sale.total) || 0;
  lines.push([
    CMD.boldOn,
    textLine(alignRow("TOTAL", formatMoney(total), width)),
    CMD.boldOff,
  ]);
  lines.push([textLine("")]);

  const method = String(sale.paymentMethod || "cash").toLowerCase();
  if (method === "split") {
    lines.push([textLine(alignRow("Paid", `${formatMoney(sale.cashAmount || 0)} + ${formatMoney(sale.gcashAmount || 0)}`, width))]);
  } else {
    lines.push([textLine(alignRow("Tendered", formatMoney(sale.amountTendered ?? total), width))]);
    lines.push([textLine(alignRow("Change", formatMoney(sale.change ?? 0), width))]);
  }
  lines.push([textLine("")]);

  // Stamp
  const stamp = sale.unpaid ? "UNPAID" : sale.queued ? "PENDING" : "PAID";
  lines.push([textLine(center(`<< ${stamp} >>`, width))]);
  lines.push([textLine("")]);

  // Footer
  lines.push([CMD.alignCenter, textLine(center("Thank you for visiting!", width))]);
  lines.push([textLine(center("Please come again", width))]);
  lines.push([textLine(center("VAT Reg TIN: 000-000-000-000", width))]);

  // Barcode (Code128) from the order number, when present.
  const barcodeBytes = buildCode128(orderNumber(sale));
  const afterItems = barcodeBytes
    ? joinChunks(CMD.alignCenter, barcodeBytes, textLine(""))
    : new Uint8Array([]);

  const body = joinChunks(
    CMD.init,
    CMD.fontA,
    ...lines.flat(),
    afterItems,
    FEED_AND_CUT_BYTES
  );
  return body;
}

function orderNumber(sale) {
  const short = String(sale?.orderId || "").slice(-6);
  if (short && /^[0-9A-Za-z]{4,6}$/.test(short)) return short;
  return null;
}

// Build a Code128 barcode block. Returns null when the value is invalid.
function buildCode128(value) {
  if (!value) return null;
  const data = String(value);
  const codeSetB = Array.from(new TextEncoder().encode(data));

  // GS k 73 (Code128) — pL/pH little-endian length prefix, then raw data. The
  // printer computes the barcode checksum itself.
  const pL = data.length & 0xff;
  const pH = (data.length >> 8) & 0xff;
  return joinChunks(
    textLine(""),
    new Uint8Array([0x1D, 0x6B, 0x49, pL, pH, ...codeSetB]),
    textLine("")
  );
}
