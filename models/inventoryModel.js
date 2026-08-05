import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, deleteDoc, getDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const INVENTORY_COLLECTION = "inventory";

const UNIT_ALIASES = {
  pcs: "pcs",
  piece: "pcs",
  pieces: "pcs",
  pc: "pcs",
  pack: "pack",
  packs: "pack",
  box: "box",
  boxes: "box",
  tray: "tray",
  trays: "tray",
  bottle: "bottle",
  bottles: "bottle",
  can: "can",
  cans: "can",
  jar: "jar",
  jars: "jar",
  sachet: "sachet",
  sachets: "sachet",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  l: "L",
  liter: "L",
  liters: "L",
  litre: "L",
  litres: "L",
  "fl oz": "fl oz",
  floz: "fl oz",
  gal: "gal",
  gallon: "gal",
  gallons: "gal",
  shot: "shot",
  shots: "shot",
  cup: "cup",
  cups: "cup",
  serving: "serving",
  servings: "serving",
  portion: "portion",
  portions: "portion",
  slice: "slice",
  slices: "slice",
  set: "set",
  sets: "set",
};

const UNIT_DEFS = {
  // Mass (base = g)
  g: { dimension: "mass", toBase: 1 },
  kg: { dimension: "mass", toBase: 1000 },
  oz: { dimension: "mass", toBase: 28.349523125 },
  lb: { dimension: "mass", toBase: 453.59237 },
  // Volume (base = ml)
  ml: { dimension: "volume", toBase: 1 },
  L: { dimension: "volume", toBase: 1000 },
  "fl oz": { dimension: "volume", toBase: 29.5735295625 },
  gal: { dimension: "volume", toBase: 3785.411784 },
  shot: { dimension: "volume", toBase: 30 },
  cup: { dimension: "volume", toBase: 240 },
  // Count (base = item)
  pcs: { dimension: "count", toBase: 1 },
  pack: { dimension: "count", toBase: 1 },
  box: { dimension: "count", toBase: 1 },
  tray: { dimension: "count", toBase: 1 },
  bottle: { dimension: "count", toBase: 1 },
  can: { dimension: "count", toBase: 1 },
  jar: { dimension: "count", toBase: 1 },
  sachet: { dimension: "count", toBase: 1 },
  serving: { dimension: "count", toBase: 1 },
  portion: { dimension: "count", toBase: 1 },
  slice: { dimension: "count", toBase: 1 },
  set: { dimension: "count", toBase: 1 },
};

export function normalizeUnit(value) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (!cleaned) return "";
  return UNIT_ALIASES[cleaned] || value;
}

export function convertQuantityBetweenUnits(amount, fromUnit, toUnit) {
  const qty = Number(amount);
  if (!Number.isFinite(qty)) return null;

  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return qty;

  const fromDef = UNIT_DEFS[from];
  const toDef = UNIT_DEFS[to];
  if (!fromDef || !toDef) return null;
  if (fromDef.dimension !== toDef.dimension) return null;

  const inBase = qty * fromDef.toBase;
  return inBase / toDef.toBase;
}

export async function getInventoryItems() {
  const snap = await getDocs(collection(db, INVENTORY_COLLECTION));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export async function saveInventoryItem(item, options = {}) {
  const itemId = String(item.id || crypto.randomUUID());
  const normalizedUnit = normalizeUnit(item.unit || "pcs") || "pcs";
  const requestedQty = Number(item.quantity || 0);
  const originalQty = options.originalQuantity === undefined ? null : Number(options.originalQuantity);
  const quantityDelta = options.quantityDelta === undefined ? null : Number(options.quantityDelta);

  // Write inside a transaction so a concurrent POS deduction is never silently
  // clobbered by a stale form copy:
  //  - quantityDelta (quick-add stock): add to the CURRENT server quantity.
  //  - originalQuantity (edit form): if the admin left quantity untouched, the
  //    form value equals the originally-loaded value, so preserve whatever the
  //    server currently holds instead of overwriting a recent deduction.
  const resolved = await runTransaction(db, async (tx) => {
    const ref = doc(db, INVENTORY_COLLECTION, itemId);
    const snap = await tx.get(ref);

    if (!snap.exists()) {
      const payload = {
        id: itemId,
        name: String(item.name || "").trim(),
        category: String(item.category || "General").trim(),
        unit: String(normalizedUnit).trim(),
        quantity: requestedQty,
        reorderLevel: Number(item.reorderLevel || 0),
        price: Number(item.price || 0),
        updatedAtMs: Date.now(),
      };
      tx.set(ref, payload);
      return payload;
    }

    const currentQty = Number(snap.data()?.quantity || 0);
    let nextQty = requestedQty;
    if (quantityDelta !== null) {
      nextQty = Math.max(0, currentQty + quantityDelta);
    } else if (originalQty !== null && requestedQty === originalQty) {
      nextQty = currentQty;
    }

    const payload = {
      id: itemId,
      name: String(item.name || "").trim(),
      category: String(item.category || "General").trim(),
      unit: String(normalizedUnit).trim(),
      quantity: nextQty,
      reorderLevel: Number(item.reorderLevel || 0),
      price: Number(item.price || 0),
      updatedAtMs: Date.now(),
    };
    tx.set(ref, payload, { merge: true });
    return payload;
  });

  return resolved;
}

function normalizeInventoryLookupValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^seed[-_\s]*/i, "")
    .replace(/^default[-_\s]*/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

async function buildInventoryLookupByNormalizedKey() {
  const snap = await getDocs(collection(db, INVENTORY_COLLECTION));
  const lookup = new Map();

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const keys = [
      normalizeInventoryLookupValue(docSnap.id),
      normalizeInventoryLookupValue(data.id),
      normalizeInventoryLookupValue(data.name),
    ].filter(Boolean);

    keys.forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, { id: docSnap.id, data });
      }
    });
  });

  return lookup;
}

function findInventoryFallbackMatch(lookup, inventoryId, ingredientName) {
  const candidates = [
    normalizeInventoryLookupValue(inventoryId),
    normalizeInventoryLookupValue(ingredientName),
    normalizeInventoryLookupValue(String(inventoryId || "").replace(/^seed[-_\s]*/i, "")),
  ].filter(Boolean);

  for (const key of candidates) {
    const match = lookup.get(key);
    if (match) return match;
  }

  return null;
}

// Deduct recipe ingredients from inventory.
// - Uses a Firestore transaction so concurrent terminals cannot lose updates.
// - When orderRef is provided, the audit trail (and the per-line progress
//   marker) is written atomically in the same transaction as the inventory
//   updates, so a crash can never leave stock deducted without a record
//   (which would cause a double deduction on retry).
// - resumeIndex marks which cart line this call belongs to; it lets retry
//   paths continue from the exact line that failed instead of re-deducting
//   earlier lines.
export async function deductInventoryQuantities(recipeItems, multiplier = 1, orderRef = null, resumeIndex = 0) {
  if (!recipeItems || !recipeItems.length) return { success: true, deducted: 0, skipped: 0, skipDetails: [], alerts: [], audit: [] };

  const aggregate = new Map();
  const skipDetails = [];
  let skipped = 0;
  let inventoryLookupPromise = null;

  const getInventoryLookup = async () => {
    if (!inventoryLookupPromise) {
      inventoryLookupPromise = buildInventoryLookupByNormalizedKey();
    }
    return inventoryLookupPromise;
  };

  for (const ingredient of recipeItems) {
    const inventoryId = String(ingredient.inventoryId || "").trim();
    const ingredientName = String(ingredient.name || "").trim();
    const rawQty = Number(ingredient.quantity || 0) * Number(multiplier || 1);
    if ((!inventoryId && !ingredientName) || !Number.isFinite(rawQty) || rawQty <= 0) {
      skipped += 1;
      skipDetails.push({ name: ingredientName || inventoryId || "unknown", reason: "invalid quantity" });
      continue;
    }

    let resolvedInventoryId = inventoryId;
    let inv = null;

    if (inventoryId) {
      try {
        const directSnapshot = await getDoc(doc(db, INVENTORY_COLLECTION, inventoryId));
        if (directSnapshot.exists()) {
          inv = directSnapshot.data() || {};
          resolvedInventoryId = directSnapshot.id;
        }
      } catch {
        // Fall through to normalized fallback lookup.
      }
    }

    if (!inv) {
      const lookup = await getInventoryLookup();
      const fallback = findInventoryFallbackMatch(lookup, inventoryId, ingredientName);
      if (!fallback) {
        skipped += 1;
        skipDetails.push({ name: ingredientName || inventoryId || "unknown", reason: "not found in inventory" });
        continue;
      }
      resolvedInventoryId = fallback.id;
      inv = fallback.data || {};
    }

    const invUnit = String(inv.unit || "").trim();
    const recipeUnit = String(ingredient.unit || invUnit).trim();
    const converted = convertQuantityBetweenUnits(rawQty, recipeUnit, invUnit);
    if (converted === null || !Number.isFinite(converted)) {
      skipped += 1;
      skipDetails.push({ name: ingredientName || inventoryId || "unknown", reason: `unit mismatch (${recipeUnit || "?"} -> ${invUnit || "?"})` });
      continue;
    }

    const prev = aggregate.get(resolvedInventoryId);
    aggregate.set(resolvedInventoryId, {
      qty: (prev?.qty || 0) + converted,
      name: String(inv.name || ingredientName || resolvedInventoryId),
      unit: String(inv.unit || ""),
    });
  }

  const aggregatedSkips = dedupeSkipDetails(skipDetails);

  const txResult = await runTransaction(db, async (tx) => {
    const resolved = new Map();
    let skippedTx = 0;
    const missingTx = [];

    // Firestore transactions require all reads before any writes, so the
    // order doc (audit append) is read first, then inventory docs, and all
    // updates happen after.
    let orderSnapshot = null;
    if (orderRef) {
      orderSnapshot = await tx.get(orderRef);
      if (orderSnapshot.exists()) {
        const orderData = orderSnapshot.data() || {};
        const existingAudit = Array.isArray(orderData.inventoryDeductions) ? orderData.inventoryDeductions : [];
        const existingProgress = Number(orderData.inventoryDeductionProgress || 0);
        // In-transaction idempotency guard: if this line (or the whole order,
        // for legacy pre-progress audits) is already recorded as deducted, a
        // concurrent sync run won the race. Bail without writing anything —
        // Firestore retries this transaction after the winner commits, so the
        // guard is what makes concurrent sync runs deduct exactly once.
        if (existingAudit.length > 0 && (existingProgress === 0 || existingProgress > Number(resumeIndex))) {
          return { deducted: 0, skipped: 0, skipDetails: [], alerts: [], audit: [] };
        }
      }
    }

    for (const [inventoryId, entry] of aggregate.entries()) {
      const ref = doc(db, INVENTORY_COLLECTION, inventoryId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) {
        skippedTx += 1;
        missingTx.push(entry);
        continue;
      }
      resolved.set(inventoryId, { ref, snapshot, qtyToDeduct: entry.qty, name: entry.name, unit: entry.unit });
    }

    const alerts = [];
    const audit = [];
    let deducted = 0;
    for (const [inventoryId, { ref, snapshot, qtyToDeduct, name, unit }] of resolved.entries()) {
      const data = snapshot.data() || {};
      const currentQty = Number(data.quantity || 0);
      const newQty = Math.max(0, currentQty - qtyToDeduct);
      tx.update(ref, { quantity: newQty, updatedAtMs: Date.now() });

      if (currentQty > 0 && newQty <= 0) {
        alerts.push({
          inventoryId,
          name: String(name || data.name || inventoryId),
          previousQty: currentQty,
          deductedQty: qtyToDeduct,
          remainingQty: newQty,
          unit: String(unit || data.unit || ""),
        });
      }

      audit.push({
        inventoryId,
        name: String(name || data.name || inventoryId),
        previousQty: currentQty,
        deductedQty: qtyToDeduct,
        remainingQty: newQty,
        unit: String(unit || data.unit || ""),
        atMs: Date.now(),
      });
      deducted += 1;
    }

    const writeSkips = dedupeSkipDetails([
      ...aggregatedSkips,
      ...missingTx.map((entry) => ({ name: String(entry.name || ""), reason: "not found in inventory" })),
    ]);

    if (orderRef) {
      let existingAudit = [];
      let existingAlerts = [];
      let existingSkips = [];
      if (orderSnapshot && orderSnapshot.exists()) {
        const orderData = orderSnapshot.data() || {};
        existingAudit = Array.isArray(orderData.inventoryDeductions) ? orderData.inventoryDeductions : [];
        existingAlerts = Array.isArray(orderData.inventoryAlerts) ? orderData.inventoryAlerts : [];
        existingSkips = Array.isArray(orderData.inventorySkips) ? orderData.inventorySkips : [];
      }
      tx.update(orderRef, {
        inventoryAlerts: [...existingAlerts, ...alerts],
        inventoryDeductions: [...existingAudit, ...audit],
        inventorySkips: dedupeSkipDetails([...existingSkips, ...writeSkips]),
        inventoryDeductionProgress: Number(resumeIndex) + 1,
        inventoryDeductionFailed: false,
      });
    }

    return { deducted, skipped: skippedTx, skipDetails: writeSkips, alerts, audit };
  });

  if (txResult.skipDetails.length > 0) {
    console.warn("[Inventory] Skipped deductions:", txResult.skipDetails.map((s) => `${s.name} (${s.reason})`).join(", "));
  }
  if (txResult.alerts.length > 0) {
    console.warn("[Inventory] Stock reached zero for:", txResult.alerts.map((item) => `${item.name} (${item.unit})`).join(", "));
  }

  return { success: true, ...txResult, skipped: skipped + txResult.skipped };
}

function dedupeSkipDetails(entries) {
  const seen = new Set();
  const unique = [];
  for (const entry of entries || []) {
    if (!entry || typeof entry !== "object") continue;
    const key = `${String(entry.name || "")}|${String(entry.reason || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name: String(entry.name || ""), reason: String(entry.reason || "") });
  }
  return unique;
}

export async function deleteInventoryItem(id) {
  await deleteDoc(doc(db, INVENTORY_COLLECTION, String(id)));
}

export async function clearInventoryItems() {
  const snap = await getDocs(collection(db, INVENTORY_COLLECTION));
  const deletes = snap.docs.map((d) => deleteDoc(doc(db, INVENTORY_COLLECTION, d.id)));
  await Promise.all(deletes);
  return { success: true, count: deletes.length };
}
