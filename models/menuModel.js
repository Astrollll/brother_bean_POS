import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const MENU_COLLECTION = "menu";

// Fetch all menu items — auto-seeds Firestore if collection is empty
export async function getMenuItems() {
  const snap = await getDocs(collection(db, MENU_COLLECTION));

  if (snap.empty) {
    console.log("Menu collection empty — auto-seeding...");
    await seedMenu(defaultMenu);
    const seeded = await getDocs(collection(db, MENU_COLLECTION));
    return seeded.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  }

  return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
}

// Save a menu item (add or update)
export async function saveMenuItem(item) {
  const ref = doc(db, MENU_COLLECTION, String(item.id));
  await setDoc(ref, item);
}

// Delete a menu item
export async function deleteMenuItem(id) {
  await deleteDoc(doc(db, MENU_COLLECTION, String(id)));
}

// Seed menu to Firestore
export async function seedMenu(menuItems) {
  for (const item of menuItems) {
    await saveMenuItem(item);
  }
}

// Default menu data
export const defaultMenu = [
  // ── COFFEE ──
  { id:1,  name:"Americano",                  price:90,  category:"coffee",    subcategory:"Coffee",        hasVariant:true,  hasTemp:false, variants:[{name:"Plain",price:90},{name:"Chocolate",price:120},{name:"Caramel",price:120}] },
  { id:2,  name:"Cafe Latte",                 price:120, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true  },
  { id:3,  name:"Brown Sugar Latte",          price:130, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true  },
  { id:4,  name:"Vanilla Latte",              price:140, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true  },
  { id:5,  name:"Spanish Latte",              price:140, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true,  popular:true },
  { id:6,  name:"Caramel Latte",              price:140, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true,  popular:true },
  { id:7,  name:"Cafe Mocha",                 price:150, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true  },
  { id:8,  name:"White Choco Mocha",          price:150, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true  },
  { id:9,  name:"Mocha Caramel",              price:150, category:"coffee",    subcategory:"Coffee",        hasVariant:false, hasTemp:true  },
  // ── SIGNATURE ──
  { id:10, name:"Creamy Coconut Latte",       price:170, category:"signature", subcategory:"Signature",     hasVariant:false, hasTemp:true,  bestseller:true },
  { id:11, name:"Honey Oat Espresso",         price:175, category:"signature", subcategory:"Signature",     hasVariant:false, hasTemp:true,  bestseller:true },
  { id:12, name:"Ube Coconut Brew",           price:180, category:"signature", subcategory:"Signature",     hasVariant:false, hasTemp:true,  bestseller:true },
  // ── MATCHA SERIES ──
  { id:13, name:"Matcha Latte",               price:180, category:"matcha",    subcategory:"Matcha Series", hasVariant:false, hasTemp:true,  popular:true },
  { id:14, name:"Strawberry Matcha",          price:220, category:"matcha",    subcategory:"Matcha Series", hasVariant:false, hasTemp:true  },
  { id:15, name:"Salted Cream Matcha",        price:195, category:"matcha",    subcategory:"Matcha Series", hasVariant:false, hasTemp:true  },
  { id:16, name:"Coconut Matcha",             price:210, category:"matcha",    subcategory:"Matcha Series", hasVariant:false, hasTemp:true  },
  { id:17, name:"Dirty Matcha",               price:220, category:"matcha",    subcategory:"Matcha Series", hasVariant:false, hasTemp:true,  note:"Coffee-based" },
  // ── NON-COFFEE ──
  { id:18, name:"Tsoko Latte",                price:130, category:"noncoffee", subcategory:"Non-Coffee",    hasVariant:false, hasTemp:true  },
  { id:19, name:"Strawberry Milkshake",       price:150, category:"noncoffee", subcategory:"Non-Coffee",    hasVariant:false, hasTemp:false },
  { id:20, name:"Ube Milkshake",              price:140, category:"noncoffee", subcategory:"Non-Coffee",    hasVariant:false, hasTemp:false },
  { id:21, name:"Calamansi Cooler",           price:90,  category:"noncoffee", subcategory:"Non-Coffee",    hasVariant:false, hasTemp:true  },
  // ── STARTERS ──
  { id:22, name:"French Fries",               price:90,  category:"starters",  subcategory:"Starters",      hasVariant:false, hasTemp:false },
  { id:23, name:"Hotdog Sandwich w/ Nachos",  price:110, category:"starters",  subcategory:"Starters",      hasVariant:false, hasTemp:false },
  { id:24, name:"Burger w/ Nachos",           price:140, category:"starters",  subcategory:"Starters",      hasVariant:false, hasTemp:false },
  { id:25, name:"Nachos w/ Dip",              price:130, category:"starters",  subcategory:"Starters",      hasVariant:false, hasTemp:false, note:"Salsa/Cheese" },
  // ── RICE MEALS ──
  { id:26, name:"Fried Chicken - Plain",      price:180, category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:27, name:"Fried Chicken - Salted Egg", price:210, category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, popular:true, note:"Served with Egg & Atchara" },
  { id:28, name:"Fried Chicken - Yangnyeom",  price:220, category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:29, name:"Black Pepper Beef",          price:195, category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:30, name:"Burger Steak",               price:150, category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:31, name:"Corned Beef",                price:115, category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:32, name:"Longganisa (Sweet)",         price:99,  category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:33, name:"Tocino",                     price:99,  category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:34, name:"Lumpiang Shanghai",          price:95,  category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  { id:35, name:"Hotdog",                     price:95,  category:"ricemeals", subcategory:"Rice Meals",    hasVariant:false, hasTemp:false, note:"Served with Egg & Atchara" },
  // ── PASTA ──
  { id:36, name:"Meatball Marinara",          price:195, category:"pasta",     subcategory:"Pasta",         hasVariant:false, hasTemp:false },
  { id:37, name:"Creamy Chicken",             price:220, category:"pasta",     subcategory:"Pasta",         hasVariant:false, hasTemp:false, popular:true },
  // ── PASTRIES ──
  { id:47, name:"Cake Slice",                 price:180, category:"pastries",  subcategory:"Pastries",      hasVariant:false, hasTemp:false, note:"Check display for today's selection" },
  { id:48, name:"Whole Cake",                 price:1500,category:"pastries",  subcategory:"Pastries",      hasVariant:false, hasTemp:false, note:"Check display for today's selection" },
  { id:49, name:"Brownies",                   price:70,  category:"pastries",  subcategory:"Pastries",      hasVariant:false, hasTemp:false },
  // ── ADD-ONS (DRINK) ──
  { id:38, name:"Espresso Shot",              price:40,  category:"addons",    subcategory:"Add-ons Drink", hasVariant:false, hasTemp:false },
  { id:39, name:"Oat Milk",                  price:50,  category:"addons",    subcategory:"Add-ons Drink", hasVariant:false, hasTemp:false },
  { id:40, name:"Coconut Milk",              price:60,  category:"addons",    subcategory:"Add-ons Drink", hasVariant:false, hasTemp:false },
  { id:41, name:"Syrup",                     price:30,  category:"addons",    subcategory:"Add-ons Drink", hasVariant:false, hasTemp:false },
  { id:42, name:"Salted Cream",              price:45,  category:"addons",    subcategory:"Add-ons Drink", hasVariant:false, hasTemp:false },
  // ── ADD-ONS (FOOD) ──
  { id:43, name:"Rice",                      price:20,  category:"addons",    subcategory:"Add-ons Food",  hasVariant:false, hasTemp:false },
  { id:44, name:"Egg",                       price:20,  category:"addons",    subcategory:"Add-ons Food",  hasVariant:false, hasTemp:false },
  { id:45, name:"Nacho Dip - Tomato Salsa",  price:45,  category:"addons",    subcategory:"Add-ons Food",  hasVariant:false, hasTemp:false },
  { id:46, name:"Nacho Dip - Cheesy Jalapeño",price:40, category:"addons",    subcategory:"Add-ons Food",  hasVariant:false, hasTemp:false },
];