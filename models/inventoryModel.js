import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc, getDoc, updateDoc
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

export async function saveInventoryItem(item) {
  const itemId = String(item.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `inv-${Date.now()}-${Math.floor(Math.random()*1000)}`));
  const normalizedUnit = normalizeUnit(item.unit || "pcs") || "pcs";
  const payload = {
    id: itemId,
    name: String(item.name || "").trim(),
    category: String(item.category || "General").trim(),
    unit: String(normalizedUnit).trim(),
    quantity: Number(item.quantity || 0),
    reorderLevel: Number(item.reorderLevel || 0),
    price: Number(item.price || 0),
    updatedAtMs: Date.now(),
  };

  await setDoc(doc(db, INVENTORY_COLLECTION, itemId), payload);
  return payload;
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

export async function deductInventoryQuantities(recipeItems, multiplier = 1) {
  if (!recipeItems || !recipeItems.length) return { success: true, deducted: 0, skipped: 0 };

  const aggregate = new Map();
  let skipped = 0;
  const alerts = [];
  const audit = [];
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
      continue;
    }

    const prev = aggregate.get(resolvedInventoryId) || 0;
    aggregate.set(resolvedInventoryId, prev + converted);
  }

  let deducted = 0;
  for (const [inventoryId, qtyToDeduct] of aggregate.entries()) {
    const ref = doc(db, INVENTORY_COLLECTION, inventoryId);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) {
      skipped += 1;
      continue;
    }
    const data = snapshot.data() || {};
    const currentQty = Number(data.quantity || 0);
    const newQty = Math.max(0, currentQty - qtyToDeduct);
    await updateDoc(ref, { quantity: newQty, updatedAtMs: Date.now() });

    if (currentQty > 0 && newQty <= 0) {
      alerts.push({
        inventoryId,
        name: String(data.name || inventoryId),
        previousQty: currentQty,
        deductedQty: qtyToDeduct,
        remainingQty: newQty,
        unit: String(data.unit || ""),
      });
    }

    audit.push({
      inventoryId,
      name: String(data.name || inventoryId),
      previousQty: currentQty,
      deductedQty: qtyToDeduct,
      remainingQty: newQty,
      unit: String(data.unit || ""),
      atMs: Date.now(),
    });
    deducted += 1;
  }

  if (alerts.length > 0) {
    console.warn("[Inventory] Stock reached zero for:", alerts.map((item) => `${item.name} (${item.unit})`).join(", "));
  }

  return { success: true, deducted, skipped, alerts, audit };
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
