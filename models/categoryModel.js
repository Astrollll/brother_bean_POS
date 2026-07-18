import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const CATEGORIES_COLLECTION = "categories";
const LOCAL_CACHE_KEY = "bb_categories_local_cache";

const CATEGORY_ICON_MAP = new Map([
  ["coffee", "☕"],
  ["oat series", "☕"],
  ["coconut series", "☕"],
  ["matcha series", "🍵"],
  ["non-dairy specials", "🧊"],
  ["non-coffee", "🥤"],
  ["starter", "🍔"],
  ["rice meals", "🍛"],
  ["toasties", "🥪"],
  ["pasta", "🍝"],
  ["korean street food", "🍱"],
  ["party platters", "🍔"],
  ["mocktails", "🍹"],
  ["sandwiches", "🥪"],
  ["pastries", "🥐"],
  ["add-ons", "➕"],
  ["addons", "➕"],
  ["drinks", "🥤"],
  ["beverages", "🥤"],
  ["desserts", "🍰"],
  ["cakes", "🍰"],
  ["snacks", "🍟"],
  ["breakfast", "🍳"],
  ["lunch", "🍱"],
  ["dinner", "🍽️"],
  ["fruit", "🍓"],
  ["tea", "🍵"],
  ["milk", "🥛"],
  ["syrup", "🧴"],
  ["ingredients", "🧂"],
  ["packaging", "📦"],
  ["inventory", "📦"],
]);

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/\s+/g, " ");
}

function normalizeCategoryAddons(addons) {
  if (!Array.isArray(addons)) return [];

  return addons
    .map((addon, index) => {
      const recipe = Array.isArray(addon?.recipe)
        ? addon.recipe
            .map((ingredient) => ({
              inventoryId: String(ingredient?.inventoryId || "").trim(),
              name: String(ingredient?.name || "").trim(),
              quantity: Number(ingredient?.quantity || 0),
              unit: String(ingredient?.unit || "").trim(),
            }))
            .filter((ingredient) => ingredient.inventoryId && ingredient.quantity > 0)
        : [];

      const rawName = String(addon?.name || "").trim();
      const derivedName = rawName || String(recipe[0]?.name || "").trim();
      if (!derivedName) return null;

      return {
        id: String(addon?.id || `addon-cat-${index + 1}`),
        name: derivedName,
        price: Math.max(0, Number(addon?.price || 0)),
        recipe,
      };
    })
    .filter(Boolean);
}

export function getCategoryIconForName(name) {
  const normalized = normalizeCategoryKey(name);
  if (!normalized) return "📦";

  if (CATEGORY_ICON_MAP.has(normalized)) {
    return CATEGORY_ICON_MAP.get(normalized);
  }

  if (normalized.includes("coffee")) return "☕";
  if (normalized.includes("matcha")) return "🍵";
  if (normalized.includes("tea")) return "🍵";
  if (normalized.includes("coconut")) return "🥥";
  if (normalized.includes("oat")) return "🌾";
  if (normalized.includes("milk")) return "🥛";
  if (normalized.includes("drink") || normalized.includes("beverage")) return "🥤";
  if (normalized.includes("starter") || normalized.includes("burger")) return "🍔";
  if (normalized.includes("rice")) return "🍛";
  if (normalized.includes("toast") || normalized.includes("sandwich")) return "🥪";
  if (normalized.includes("pasta")) return "🍝";
  if (normalized.includes("korean") || normalized.includes("bento")) return "🍱";
  if (normalized.includes("mocktail") || normalized.includes("cocktail")) return "🍹";
  if (normalized.includes("pastry")) return "🥐";
  if (normalized.includes("cake") || normalized.includes("dessert")) return "🍰";
  if (normalized.includes("snack")) return "🍟";
  if (normalized.includes("packaging") || normalized.includes("box")) return "📦";
  if (normalized.includes("ingredient")) return "🧂";

  return "📦";
}

function readLocalCache() {
  if (typeof localStorage === "undefined") {
    return { upserts: [], deletedIds: [] };
  }
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return { upserts: [], deletedIds: [] };
    const parsed = JSON.parse(raw);
    return {
      upserts: Array.isArray(parsed.upserts) ? parsed.upserts : [],
      deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
    };
  } catch {
    return { upserts: [], deletedIds: [] };
  }
}

function writeLocalCache(cache) {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore localStorage failures in private mode / restricted environments.
  }
}

function saveLocalCategory(category) {
  const cache = readLocalCache();
  const nextUpserts = cache.upserts.filter((item) => String(item.id) !== String(category.id));
  nextUpserts.push(category);
  writeLocalCache({
    upserts: nextUpserts,
    deletedIds: cache.deletedIds.filter((id) => String(id) !== String(category.id)),
  });
}

function removeLocalCategory(id) {
  const cache = readLocalCache();
  writeLocalCache({
    upserts: cache.upserts.filter((item) => String(item.id) !== String(id)),
    deletedIds: Array.from(new Set([...cache.deletedIds, String(id)])),
  });
}

function mergeCategories(remoteCategories, localCache) {
  const byId = new Map();
  const byName = new Map();

  for (const category of [...remoteCategories, ...(localCache.upserts || [])]) {
    if (!category?.id) continue;
    const id = String(category.id);
    const nameKey = normalizeCategoryKey(category.name || "");

    // Deduplicate by normalized name — keep the version with more data
    if (byName.has(nameKey)) {
      const existing = byName.get(nameKey);
      const existingAddons = Array.isArray(existing.addons) ? existing.addons.length : 0;
      const incomingAddons = Array.isArray(category.addons) ? category.addons.length : 0;
      if (incomingAddons <= existingAddons) continue;
      byId.delete(String(existing.id));
    }

    byId.set(id, category);
    byName.set(nameKey, category);
  }

  return Array.from(byId.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export async function getCategories() {
  let categories = [];
  const localCache = readLocalCache();
  try {
    const snap = await getDocs(collection(db, CATEGORIES_COLLECTION));
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (localCache.upserts.length > 0) {
      console.warn("Using local category cache because Firebase read failed.", err);
    } else {
      console.error("Failed to load categories from Firebase.", err);
    }
  }

  const merged = mergeCategories(categories, localCache);
  if (merged.length > 0) return merged;

  return [];
}

export async function saveCategory(category) {
  const genId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'cat-' + Date.now();
  const id = String(category.id || genId);
  const resolvedIcon = getCategoryIconForName(category.name);
  const payload = {
    id: id,
    name: String(category.name || "").trim(),
    icon: resolvedIcon,
    color: String(category.color || "#373b40").trim(),
    addons: normalizeCategoryAddons(category?.addons),
  };

  try {
    await setDoc(doc(db, CATEGORIES_COLLECTION, id), payload);
    // Remove from local cache since Firestore is now authoritative
    const cache = readLocalCache();
    writeLocalCache({
      upserts: cache.upserts.filter((item) => String(item.id) !== String(id)),
      deletedIds: cache.deletedIds.filter((dId) => String(dId) !== String(id)),
    });
  } catch (error) {
    console.warn("Falling back to local category cache because Firestore write failed.", error);
    saveLocalCategory(payload);
  }
  return payload;
}

export async function deleteCategory(id) {
  if (!id) throw new Error("Category ID required for deletion.");
  try {
    await deleteDoc(doc(db, CATEGORIES_COLLECTION, id));
  } catch (error) {
    console.warn("Falling back to local category delete because Firestore delete failed.", error);
  }
  // Always update local cache to prevent deleted category from reappearing via merge
  removeLocalCategory(id);
}
