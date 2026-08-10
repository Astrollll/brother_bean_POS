import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, deleteDoc, getDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const INVENTORY_COLLECTION = "inventory";
const ORDERS_COLLECTION = "orders";

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

// Resolve a recipe ingredient to the inventory item it refers to and the exact
// quantity (already in the inventory's unit) that deduct would apply. Returns
// { ok:false, name, reason } for anything deduct would skip (missing inventory,
// unit mismatch, invalid quantity). Shared by deduct AND restore so a cancel
// always returns exactly what a placement deducted.
async function resolveRecipeIngredient(ingredient, multiplier = 1, getLookup) {
  const inventoryId = String(ingredient?.inventoryId || "").trim();
  const ingredientName = String(ingredient?.name || "").trim();
  const rawQty = Number(ingredient?.quantity || 0) * Number(multiplier || 1);
  if ((!inventoryId && !ingredientName) || !Number.isFinite(rawQty) || rawQty <= 0) {
    return { ok: false, name: ingredientName || inventoryId || "unknown", reason: "invalid quantity" };
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
    const lookup = await getLookup();
    const fallback = findInventoryFallbackMatch(lookup, inventoryId, ingredientName);
    if (!fallback) {
      return { ok: false, name: ingredientName || inventoryId || "unknown", reason: "not found in inventory" };
    }
    resolvedInventoryId = fallback.id;
    inv = fallback.data || {};
  }

  const invUnit = String(inv.unit || "").trim();
  const recipeUnit = String(ingredient?.unit || invUnit).trim();
  const converted = convertQuantityBetweenUnits(rawQty, recipeUnit, invUnit);
  if (converted === null || !Number.isFinite(converted)) {
    return { ok: false, name: ingredientName || inventoryId || "unknown", reason: `unit mismatch (${recipeUnit || "?"} -> ${invUnit || "?"})` };
  }

  return {
    ok: true,
    inventoryId: resolvedInventoryId,
    qty: converted,
    name: String(inv.name || ingredientName || resolvedInventoryId),
    unit: String(inv.unit || ""),
  };
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
    const resolved = await resolveRecipeIngredient(ingredient, multiplier, getInventoryLookup);
    if (!resolved.ok) {
      skipped += 1;
      skipDetails.push({ name: resolved.name, reason: resolved.reason });
      continue;
    }
    const prev = aggregate.get(resolved.inventoryId);
    aggregate.set(resolved.inventoryId, {
      qty: (prev?.qty || 0) + resolved.qty,
      name: resolved.name,
      unit: resolved.unit,
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

// Add stock back for a canceled/voided sale. Uses the order's recorded
// inventoryDeductions audit trail (exactly what was deducted, already in the
// inventory unit) and falls back to re-resolving the item recipes with the same
// lookup + unit conversion + skip rules deduct uses when no audit trail exists
// (e.g. offline-queued orders that never deducted).
//
// IMPORTANT: it never restores stock a sale did NOT actually consume. If the
// local copy has no audit trail, the authoritative order doc is read to confirm
// whether a deduction happened (a completed retry/sync writes the audit there
// even when the local copy predates it). Orders whose deduction failed or timed
// out, or offline-queued orders that were never synced, deduct nothing — so a
// cancel must not re-resolve recipes and "restore" phantom stock.
export async function restoreInventoryForOrder(sale) {
  const deductions = Array.isArray(sale?.inventoryDeductions) ? sale.inventoryDeductions : [];
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const restoreEntries = new Map();

  const addEntry = (inventoryId, qty, name, unit) => {
    const id = String(inventoryId || "").trim();
    if (!id || !Number.isFinite(qty) || qty <= 0) return;
    const prev = restoreEntries.get(id);
    restoreEntries.set(id, {
      qty: (prev?.qty || 0) + qty,
      name: String(name || prev?.name || ""),
      unit: String(unit || prev?.unit || ""),
    });
  };

  let hadAudit = deductions.length > 0;
  if (hadAudit) {
    for (const entry of deductions) {
      addEntry(entry?.inventoryId, Number(entry?.deductedQty || 0), entry?.name, entry?.unit);
    }
  } else {
    // No audit on the local copy. Check the authoritative order doc: a deduction
    // that completed after the local copy was made (retry, queued-order sync)
    // appends the audit there. We only fall back to re-resolving recipes for
    // orders that provably deducted stock (legacy pre-audit orders).
    const orderDoc = await readOrderInventoryAudit(sale);
    if (Array.isArray(orderDoc.audit) && orderDoc.audit.length > 0) {
      hadAudit = true;
      for (const entry of orderDoc.audit) {
        addEntry(entry?.inventoryId, Number(entry?.deductedQty || 0), entry?.name, entry?.unit);
      }
    } else {
      const deductionFailed =
        sale?.inventoryDeductionError === true ||
        sale?.inventoryDeductionFailed === true ||
        orderDoc.deductionFailed === true;
      const neverSyncedQueued =
        sale?.queued === true && orderDoc.docExists !== true;
      if (deductionFailed || neverSyncedQueued) {
        // Nothing was deducted, so there is nothing to restore. Re-resolving the
        // recipes here would add stock the sale never consumed.
        return {
          success: true,
          restored: 0,
          skipped: true,
          reason: deductionFailed ? "deduction-failed" : "never-deducted",
        };
      }
      // Legacy order (deducted before the audit trail existed): re-resolve each
      // ingredient exactly like deduct does (inventory lookup + unit conversion
      // + skips) so we restore only what would have been deducted, in the
      // inventory's own unit.
      let lookupPromise = null;
      const getLookup = async () => {
        if (!lookupPromise) lookupPromise = buildInventoryLookupByNormalizedKey();
        return lookupPromise;
      };
      for (const item of items) {
        const multiplier = Number(item?.quantity || 1);
        for (const ingredient of Array.isArray(item?.recipe) ? item.recipe : []) {
          const resolved = await resolveRecipeIngredient(ingredient, multiplier, getLookup);
          if (!resolved.ok) continue;
          addEntry(resolved.inventoryId, resolved.qty, resolved.name, resolved.unit);
        }
      }
    }
  }

  if (!restoreEntries.size) return { success: true, restored: 0, hadAudit };

  const audit = [];
  try {
    await runTransaction(db, async (tx) => {
      // Firestore transactions forbid reads after writes, so all inventory
      // docs are read first, then updated — same pattern as the deduction
      // transaction. Interleaving get/update throws on the second ingredient
      // and aborts the restore, leaving the deducted stock unrecovered.
      const resolved = [];
      for (const [inventoryId, entry] of restoreEntries.entries()) {
        const ref = doc(db, INVENTORY_COLLECTION, inventoryId);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists()) continue;
        resolved.push({ inventoryId, ref, snapshot, entry });
      }

      for (const { inventoryId, ref, snapshot, entry } of resolved) {
        const data = snapshot.data() || {};
        const currentQty = Number(data.quantity || 0);
        const restoredQty = Number(entry.qty) || 0;
        tx.update(ref, { quantity: Math.max(0, currentQty + restoredQty), updatedAtMs: Date.now() });
        audit.push({
          inventoryId,
          name: String(entry.name || data.name || inventoryId),
          previousQty: currentQty,
          restoredQty,
          remainingQty: currentQty + restoredQty,
          unit: String(entry.unit || data.unit || ""),
          atMs: Date.now(),
        });
      }
    });
  } catch (error) {
    console.warn("[Inventory] Restore failed for canceled order.", error);
    return { success: false, restored: 0, error: error?.message || "inventory restore failed" };
  }

  return { success: true, restored: restoreEntries.size, audit };
}

// Read the authoritative deduction audit for an order from Firestore. Returns
// { audit, docExists, deductionFailed }. A completed deduction (including ones
// finished by a later retry or queued-order sync) appends its audit to the
// order doc, so this is the source of truth whenever the local copy has none.
async function readOrderInventoryAudit(sale) {
  const orderId = String(sale?.orderId || sale?.id || "").trim();
  if (!orderId) return { audit: null, docExists: null, deductionFailed: false };
  try {
    const snap = await getDoc(doc(db, ORDERS_COLLECTION, orderId));
    if (!snap.exists()) return { audit: [], docExists: false, deductionFailed: false };
    const data = snap.data() || {};
    return {
      audit: Array.isArray(data.inventoryDeductions) ? data.inventoryDeductions : [],
      docExists: true,
      deductionFailed: data.inventoryDeductionFailed === true,
    };
  } catch (error) {
    console.warn("[Inventory] Restore: could not read order doc to confirm deduction.", error);
    return { audit: null, docExists: null, deductionFailed: false };
  }
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
