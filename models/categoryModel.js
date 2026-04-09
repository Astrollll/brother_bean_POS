import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const CATEGORIES_COLLECTION = "categories";
const LOCAL_CACHE_KEY = "bb_categories_local_cache";

// Seed data if none exist
const DEFAULT_CATEGORIES = [
  { id: "cat-coffee", name: "Coffee", color: "#373b40", icon: "☕" },
  { id: "cat-oat", name: "Oat Series", color: "#373b40", icon: "☕" },
  { id: "cat-coconut", name: "Coconut Series", color: "#373b40", icon: "☕" },
  { id: "cat-matcha", name: "Matcha Series", color: "#373b40", icon: "🍵" },
  { id: "cat-nondairy", name: "Non-Dairy Specials", color: "#373b40", icon: "🧊" },
  { id: "cat-noncoffee", name: "Non-Coffee", color: "#373b40", icon: "🥤" },
  { id: "cat-starter", name: "Starter", color: "#373b40", icon: "🍔" },
  { id: "cat-ricemeals", name: "Rice Meals", color: "#373b40", icon: "🍛" },
  { id: "cat-toasties", name: "Toasties", color: "#373b40", icon: "🥪" },
  { id: "cat-pasta", name: "Pasta", color: "#373b40", icon: "🍝" },
  { id: "cat-korean", name: "Korean Street Food", color: "#373b40", icon: "🍱" },
  { id: "cat-platters", name: "Party Platters", color: "#373b40", icon: "🍔" },
  { id: "cat-mocktails", name: "Mocktails", color: "#373b40", icon: "🍹" },
  { id: "cat-sandwiches", name: "Sandwiches", color: "#373b40", icon: "🥪" },
  { id: "cat-pastries", name: "Pastries", color: "#373b40", icon: "🥐" },
  { id: "cat-addons", name: "Add-ons", color: "#373b40", icon: "➕" }
];

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
  const merged = new Map();
  const deletedIds = new Set((localCache.deletedIds || []).map((id) => String(id)));

  for (const category of remoteCategories) {
    if (!category?.id || deletedIds.has(String(category.id))) continue;
    merged.set(String(category.id), category);
  }

  for (const category of localCache.upserts || []) {
    if (!category?.id) continue;
    merged.set(String(category.id), category);
  }

  return Array.from(merged.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export async function getCategories() {
  let categories = [];
  const localCache = readLocalCache();
  try {
    const snap = await getDocs(collection(db, CATEGORIES_COLLECTION));
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (categories.length === 0 && localCache.upserts.length === 0) {
      // Seed default categories
      for (const cat of DEFAULT_CATEGORIES) {
        try {
          await setDoc(doc(db, CATEGORIES_COLLECTION, cat.id), cat);
        } catch(seedErr) {
          console.warn("Could not seed category", cat.id, seedErr);
        }
      }
      categories = [...DEFAULT_CATEGORIES];
    }
  } catch (err) {
    if (localCache.upserts.length > 0) {
      console.warn("Using local category cache because Firebase read failed.", err);
    } else {
      console.error("Failed to load categories from Firebase, using defaults.", err);
    }
  }

  const merged = mergeCategories([...DEFAULT_CATEGORIES, ...categories], localCache);
  if (merged.length > 0) return merged;

  // Fallback to defaults if both Firestore and local cache are empty,
  // while still respecting locally deleted default categories.
  return mergeCategories(DEFAULT_CATEGORIES, localCache);
}

export async function saveCategory(category) {
  const genId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'cat-' + Date.now();
  const id = String(category.id || genId);
  const resolvedIcon = getCategoryIconForName(category.name);
  const payload = {
    id: id,
    name: String(category.name || "").trim(),
    icon: resolvedIcon,
    color: String(category.color || "#373b40").trim()
  };

  try {
    await setDoc(doc(db, CATEGORIES_COLLECTION, id), payload);
  } catch (error) {
    console.warn("Falling back to local category cache because Firestore write failed.", error);
    saveLocalCategory(payload);
    return payload;
  }

  saveLocalCategory(payload);
  return payload;
}

export async function deleteCategory(id) {
  if (!id) throw new Error("Category ID required for deletion.");
  try {
    await deleteDoc(doc(db, CATEGORIES_COLLECTION, id));
  } catch (error) {
    console.warn("Falling back to local category delete because Firestore delete failed.", error);
  }
  removeLocalCategory(id);
}
