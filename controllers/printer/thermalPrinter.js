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
//
// Keeping the link alive (the part that used to "disconnect after a while"):
//   * Web Bluetooth GATT links are not permanent — printers sleep, BLE
//     supervision timers fire, and the laptop suspending/resuming drops the
//     radio link. None of that is fatal if we recover from it.
//   * While connected, a lightweight ESC/POS real-time status request
//     (DLE EOT 1, prints nothing) is sent after every ~20s of inactivity so
//     the printer never drifts into its sleep/auto-power-off state.
//   * If the link still drops (laptop sleep, radio blip, printer reboot), the
//     module reconnects automatically with backoff and keeps trying for about
//     a minute; printing also attempts a reconnect first if a saved device is
//     known but the link is down.

const STORAGE_KEYS = {
  device: "bb-pos-thermal-device",
  settings: "bb-pos-thermal-settings",
};

const DEFAULT_SETTINGS = {
  paperWidth: 58, // mm — 58 or 80
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

// Link keep-alive + auto-reconnect.
const KEEP_ALIVE_IDLE_MS = 20000; // send a keep-alive after 20s with no writes
const KEEP_ALIVE_CHECK_MS = 10000; // check the idle timer every 10s
const DLE_EOT_STATUS = new Uint8Array([0x10, 0x04, 0x01]); // ESC/POS real-time status request (printer status) — prints nothing
const RECONNECT_BASE_DELAY = 1000; // 1s, 2s, 4s, 8s, 16s, 30s
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MAX_ATTEMPTS = 6;

// ── STATE ──
let device = null;
let writeCharacteristic = null;
let connectionError = null;
let manualDisconnect = false;
let reconnecting = false;
let autoReconnectTimer = null;
let reconnectAttempts = 0;
let keepAliveTimer = null;
let printing = false;
let lastActivityAt = 0;

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
    reconnecting,
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
  manualDisconnect = true;
  stopAutoReconnect();
  stopKeepAlive();
  try {
    if (device?.gatt?.connected) device.gatt.disconnect();
  } catch {}
  if (device && device.__bbListenerAttached) {
    try { device.removeEventListener("gattserverdisconnected", handleServerDisconnected); } catch {}
    device.__bbListenerAttached = false;
  }
  device = null;
  writeCharacteristic = null;
  connectionError = null;
  reconnectAttempts = 0;
  saveSavedDevice(null);
  notifyStatus();
}

// Re-connect to a printer selected in a previous session (Chrome grants
// re-access to already-paired devices via getDevices()).
//
// This is how one side of the app "shares" the printer with the other: the
// paired device is persisted in localStorage, and any page that loads
// re-establishes the link automatically. The first attempt can fail because
// the OTHER side still holds the printer's single BLE link; that failure is
// not fatal — the device reference is kept and the module retries with backoff
// until the link is free (or the page is unloaded).
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
    device = match;
    manualDisconnect = false;
    reconnecting = false;
    registerDisconnectHandler(match);
    await reconnectDevice();
  } catch (error) {
    connectionError = `Reconnect failed: ${error?.message || "unknown error"}`;
    console.warn("[Printer] Reconnect failed.", error);
  }
  notifyStatus();
  return getStatus();
}

// Print a sale receipt. Returns { status, message } — never throws.
export async function printReceipt(sale) {
  if (!isSupported()) {
    return { status: "unsupported", message: "Bluetooth not supported by this browser." };
  }
  // Opportunistic reconnect: if we know a printer but the link dropped, bring
  // it back before giving up so an idle-timeout doesn't kill a sale's receipt.
  if (!isConnected() && device && !manualDisconnect) {
    try {
      await reconnectDevice();
    } catch {}
  }
  if (!isConnected()) {
    return { status: "not-connected", message: "No printer connected." };
  }

  try {
    const bytes = buildEscReceipt(sale, readSettings().paperWidth || 58);
    printing = true;
    try {
      await writeBytes(bytes);
    } finally {
      printing = false;
    }
    return { status: "sent", message: "Receipt sent to printer." };
  } catch (error) {
    connectionError = error?.message || "Print failed.";
    console.warn("[Printer] Print failed.", error);
    notifyStatus();
    if (device && !manualDisconnect) scheduleReconnect();
    return { status: "error", message: connectionError };
  }
}

// ── INTERNAL: connection + writing ──

async function attachDevice(selected, settings) {
  connectionError = null;
  device = selected;
  manualDisconnect = false;
  reconnecting = false;
  stopAutoReconnect();
  stopKeepAlive();

  try {
    writeCharacteristic = await establishConnection(selected, settings);
    saveSavedDevice({ id: selected.id, name: selected.name });
    registerDisconnectHandler(selected);
    reconnectAttempts = 0;
    startKeepAlive();
    notifyStatus();
    return;
  } catch (error) {
    const failed = device;
    device = null;
    writeCharacteristic = null;
    stopKeepAlive();
    connectionError = error?.message || "Unable to connect to the printer.";
    try { if (failed?.gatt) await failed.gatt.disconnect(); } catch {}
    notifyStatus();
    throw new Error(connectionError);
  }
}

// Connect to the GATT server and return the writable data characteristic.
// Throws on failure and does NOT touch module state so auto-reconnect retries
// can keep the `device` reference for the next attempt.
async function establishConnection(selected, settings) {
  const server = await selected.gatt.connect();
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

  return characteristic;
}

function registerDisconnectHandler(selected) {
  if (!selected.__bbListenerAttached) {
    selected.addEventListener("gattserverdisconnected", handleServerDisconnected);
    selected.__bbListenerAttached = true;
  }
}

function handleServerDisconnected() {
  writeCharacteristic = null;
  stopKeepAlive();
  notifyStatus();
  if (manualDisconnect || !device) return;
  scheduleReconnect();
}

function stopAutoReconnect() {
  clearTimeout(autoReconnectTimer);
  autoReconnectTimer = null;
  reconnecting = false;
}

function scheduleReconnect() {
  if (manualDisconnect || !device || reconnecting) return;
  if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    connectionError = "Printer connection was lost and automatic reconnection timed out. Tap Connect printer to re-pair.";
    console.warn("[Printer]", connectionError);
    notifyStatus();
    return;
  }
  reconnectAttempts++;
  reconnecting = true;
  notifyStatus();
  const delay = Math.min(RECONNECT_MAX_DELAY, RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1));
  autoReconnectTimer = setTimeout(() => {
    autoReconnectTimer = null;
    reconnectDevice();
  }, delay);
}

// Reconnect to the remembered device. Keeps `device` on failure so later
// attempts (and print-time recovery) can still reuse it.
async function reconnectDevice() {
  if (!device || manualDisconnect) return;
  connectionError = null;
  stopKeepAlive();
  try {
    writeCharacteristic = await establishConnection(device, readSettings());
    saveSavedDevice({ id: device.id, name: device.name });
    registerDisconnectHandler(device);
    reconnectAttempts = 0;
    reconnecting = false;
    startKeepAlive();
    notifyStatus();
  } catch (error) {
    writeCharacteristic = null;
    connectionError = error?.message || "Reconnect failed.";
    console.warn("[Printer] Reconnect failed:", error?.message);
    reconnecting = false;
    notifyStatus();
    scheduleReconnect();
  }
}

// ── Keep-alive ──
// BLE links (and most thermal printers) idle-drop: after enough silent time the
// printer sleeps or the radio supervision timer fires and the connection dies.
// A periodic, non-printing ESC/POS status request keeps the link busy so it
// never drifts into that state, and doubles as a dead-link detector (a failed
// write triggers the auto-reconnect path).
function startKeepAlive() {
  stopKeepAlive();
  lastActivityAt = Date.now();
  keepAliveTimer = setInterval(keepAliveTick, KEEP_ALIVE_CHECK_MS);
}

function stopKeepAlive() {
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

async function keepAliveTick() {
  if (manualDisconnect || printing) return;
  if (!device || !device.gatt?.connected || !writeCharacteristic) return;
  if (Date.now() - lastActivityAt < KEEP_ALIVE_IDLE_MS) return;
  try {
    await writeChunk(DLE_EOT_STATUS);
  } catch (error) {
    handleServerDisconnected();
  }
}

// When the tab becomes visible again (laptop woke up, user switched back),
// the radio may have silently dropped — give the link a fresh reconnect push.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (device && !manualDisconnect && !reconnecting && !device.gatt?.connected) {
      reconnectAttempts = 0;
      scheduleReconnect();
    }
  });
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

async function writeChunk(chunk) {
  if (!writeCharacteristic) throw new Error("Printer is not connected.");
  if (writeCharacteristic.properties.writeWithoutResponse) {
    await writeCharacteristic.writeValueWithoutResponse(chunk);
  } else {
    await writeCharacteristic.writeValueWithResponse(chunk);
  }
  lastActivityAt = Date.now();
}

async function writeBytes(bytes) {
  if (!writeCharacteristic) throw new Error("Printer is not connected.");

  // Chunk to the BLE MTU floor (20 bytes). Awaiting each write serializes the
  // writes so the printer's buffer is never flooded.
  for (let i = 0; i < bytes.length; i += BLE_WRITE_CHUNK) {
    await writeChunk(bytes.subarray(i, i + BLE_WRITE_CHUNK));
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

// Wrap text into lines of at most `width` columns, breaking on word boundaries
// so nothing is cut off mid-word. A single word longer than the paper is
// hard-split across lines to keep every line inside the printable area.
function wrapText(text, width) {
  const words = sanitizeText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (sanitizeText(candidate).length <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      let rest = word;
      while (sanitizeText(rest).length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      current = rest;
    }
  }
  if (current) lines.push(current);
  return lines;
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

// Date printed exactly as shown on the on-screen POS/admin receipts: the stored
// "timestamp" string when present (e.g. "8/9/2026, 2:30:45 PM"), otherwise a
// locale-formatted date from createdAt/createdAtMs.
function formatDate(sale) {
  if (sale?.timestamp) return sanitizeText(String(sale.timestamp));
  const locale = { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
  const ms = Number(sale?.createdAtMs) || 0;
  if (ms > 0) return new Date(ms).toLocaleString("en-PH", locale);
  if (sale?.createdAt) {
    const d = typeof sale.createdAt.toDate === "function" ? sale.createdAt.toDate() : new Date(sale.createdAt);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString("en-PH", locale);
  }
  return "-";
}

export function buildEscReceipt(sale, paperWidth = 58) {
  const width = paperWidth >= 80 ? 42 : 32;
  const lines = [];

  // Header
  lines.push([CMD.boldOn, textLine(center("Brother Bean Coffee House", width)), CMD.boldOff]);
  lines.push([textLine(center("anytime is coffee time.", width))]);
  for (const addrLine of wrapText("N. Guevarra St., Brgy. Zone 1, Poblacion, Dasmarinas City, Cavite", width)) {
    lines.push([textLine(center(addrLine, width))]);
  }
  lines.push([textLine("")]);
  lines.push([textLine(dashedLine(width, "="))]);

  // Metadata
  lines.push([textLine(alignRow("Date", formatDate(sale), width))]);
  lines.push([textLine(alignRow("Order #", String(sale.orderId || "").slice(-6) || "-", width))]);
  if (String(sale.customerName || "").trim()) {
    lines.push([textLine(alignRow("Order for", truncate(String(sale.customerName).trim(), width - 10), width))]);
  }
  lines.push([textLine(alignRow("Payment", String(sale.paymentMethod || "-").toUpperCase(), width))]);
  if (String(sale.paymentMethod || "").toLowerCase() === "split") {
    lines.push([textLine(alignRow("Cash", formatMoney(sale.cashAmount || 0), width))]);
    lines.push([textLine(alignRow("GCash", formatMoney(sale.gcashAmount || 0), width))]);
  }
  lines.push([textLine(alignRow("Cashier", truncate(String(sale.cashierName || "Staff"), width - 8), width))]);
  lines.push([textLine(dashedLine(width, "="))]);

  // Items — mirrors the on-screen POS/admin receipt layout: item name, variant,
  // then "qty x price" with line total (addon prices are folded into the unit
  // price, exactly like the on-screen receipt).
  for (const item of Array.isArray(sale.items) ? sale.items : []) {
    const qty = Number(item.quantity) || 1;
    const base = Number(item.price) || 0;
    const addonsTotal = (Array.isArray(item.addons) ? item.addons : []).reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = base + addonsTotal;
    const unitPrice = originalUnit * (1 - discountPct);
    const lineTotal = unitPrice * qty;

    lines.push([textLine(truncate(String(item.name || "Item"), width))]);

    const variant = [item.variant, item.temperature && item.temperature !== "N/A" ? item.temperature : null].filter(Boolean).join(" · ");
    if (variant) lines.push([textLine("  " + truncate(variant, width - 2))]);

    const pctLabel = `(-${Math.round(discountPct * 100)}%)`;
    const spaced = `${qty} x ${formatMoney(originalUnit)} -> ${formatMoney(unitPrice)} ${pctLabel}`;
    const compact = `${qty} x ${formatMoney(originalUnit)}->${formatMoney(unitPrice)}${pctLabel}`;
    const totalLabel = formatMoney(lineTotal);
    const rightLen = sanitizeText(totalLabel).length;
    const priceLabel = discountPct > 0
      ? (sanitizeText(spaced).length + rightLen <= width ? spaced : compact)
      : `${qty} x ${formatMoney(unitPrice)}`;
    const labelLen = sanitizeText(priceLabel).length;
    if (labelLen + rightLen <= width) {
      lines.push([textLine(alignRow(priceLabel, totalLabel, width))]);
    } else if (labelLen <= width) {
      // Narrow paper: the discount label cannot share a row with the total, so
      // print the label on its own line and right-align the amount below it.
      lines.push([textLine(pad(priceLabel, width))]);
      lines.push([textLine(pad("", Math.max(0, width - rightLen)) + totalLabel)]);
    } else {
      lines.push([textLine(truncate(priceLabel, width))]);
      lines.push([textLine(pad("", Math.max(0, width - rightLen)) + totalLabel)]);
    }
  }
  lines.push([textLine(dashedLine(width, "="))]);

  // Totals — mirrors the on-screen POS/admin receipt discount logic.
  const originalSubtotal = (Array.isArray(sale.items) ? sale.items : []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 1;
    const addonsTotal = (Array.isArray(item.addons) ? item.addons : []).reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const originalUnit = (Number(item.price) || 0) + addonsTotal;
    return sum + originalUnit * qty;
  }, 0);
  const totalItemSavings = (Array.isArray(sale.items) ? sale.items : []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 1;
    const addonsTotal = (Array.isArray(item.addons) ? item.addons : []).reduce((s, a) => s + (Number(a?.price) || 0), 0);
    const discountPct = Number(item.discountPercent) || 0;
    const originalUnit = (Number(item.price) || 0) + addonsTotal;
    return sum + originalUnit * discountPct * qty;
  }, 0);
  const subtotalRounded = Math.round(originalSubtotal * 100) / 100;
  const savingsRounded = Math.round(totalItemSavings * 100) / 100;
  const total = Number(sale.total) || 0;
  const totalRounded = Math.round(total * 100) / 100;

  lines.push([textLine(alignRow("Subtotal", formatMoney(subtotalRounded), width))]);

  const isEmployeeOrder = sale.orderType === "employee" || sale.paymentMethod === "employee" || sale.isEmployeeOrder === true;
  if (isEmployeeOrder) {
    const employeeDiscount = Math.max(0, subtotalRounded - totalRounded);
    if (employeeDiscount > 0) {
      lines.push([textLine(alignRow("Employee discount", "-" + formatMoney(employeeDiscount), width))]);
    }
  } else {
    const hasPwdSenior = Number(sale.discountAmount) > 0 || sale.isPwdSenior === true;
    let displayItemSavings = 0;
    if (totalItemSavings > 0) {
      displayItemSavings = hasPwdSenior ? savingsRounded : (subtotalRounded - totalRounded);
    }
    const displayDiscount = hasPwdSenior
      ? Math.max(0, subtotalRounded - displayItemSavings - totalRounded)
      : 0;
    if (displayItemSavings > 0) {
      lines.push([textLine(alignRow("Item discounts", "-" + formatMoney(displayItemSavings), width))]);
    }
    if (displayDiscount > 0) {
      lines.push([textLine(alignRow("Discount", "-" + formatMoney(displayDiscount), width))]);
    }
  }

  lines.push([
    CMD.boldOn,
    textLine(alignRow("TOTAL", formatMoney(total), width)),
    CMD.boldOff,
  ]);
  lines.push([textLine("")]);

  const method = String(sale.paymentMethod || "cash").toLowerCase();
  if (method === "split") {
    lines.push([textLine(alignRow("Paid", `Cash ${formatMoney(sale.cashAmount || 0)} + GCash ${formatMoney(sale.gcashAmount || 0)}`, width))]);
  } else {
    lines.push([textLine(alignRow("Tendered", formatMoney(sale.amountTendered ?? total), width))]);
    lines.push([textLine(alignRow("Change", formatMoney(sale.change ?? 0), width))]);
  }
  lines.push([textLine("")]);

  // Stamp
  const stamp = sale.unpaid ? "UNPAID" : sale.cancelled ? "CANCELLED" : "PAID";
  lines.push([textLine(center(`<< ${stamp} >>`, width))]);
  lines.push([textLine("")]);

  // Barcode (Code128) from the order number, when present — same spot as the
  // on-screen receipt (between the stamp and the footer).
  const barcodeBytes = buildCode128(orderNumber(sale));
  if (barcodeBytes) {
    lines.push(joinChunks(CMD.alignCenter, barcodeBytes, textLine("")));
  }

  // Footer — mirrors the on-screen POS/admin receipt footer.
  lines.push([textLine(dashedLine(width, "="))]);
  lines.push([CMD.alignCenter, textLine(center("Thank you for visiting!", width))]);
  lines.push([textLine(center("Please come again", width))]);
  const vatLine = "VAT Registered TIN: 000-000-000-000";
  if (sanitizeText(vatLine).length <= width) {
    lines.push([textLine(center(vatLine, width))]);
  } else {
    lines.push([textLine(center("VAT Registered TIN:", width))]);
    lines.push([textLine(center("000-000-000-000", width))]);
  }
  lines.push([textLine(center("Permit No: 0000000", width))]);

  const body = joinChunks(
    CMD.init,
    CMD.fontA,
    ...lines.flat(),
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
