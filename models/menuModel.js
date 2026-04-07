import { db } from "../controllers/firebase.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const MENU_COLLECTION = "menu";

// Fetch all menu items from Firestore
export async function getMenuItems() {
  const snap = await getDocs(collection(db, MENU_COLLECTION));
  return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
}

// Watch menu items in Firestore and invoke callback on every update
export function watchMenuItems(onChange, onError) {
  const queryRef = collection(db, MENU_COLLECTION);
  return onSnapshot(queryRef, (snap) => {
    const items = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    onChange(items);
  }, onError);
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

// Delete all menu items
export async function clearMenuItems() {
  const snap = await getDocs(collection(db, MENU_COLLECTION));
  const deletes = snap.docs.map((d) => deleteDoc(doc(db, MENU_COLLECTION, d.id)));
  await Promise.all(deletes);
}

// Seed menu to Firestore (run once to populate)
export async function seedMenu(menuItems) {
  for (const item of menuItems) {
    await saveMenuItem(item);
  }
}

// Default menu data (used for seeding)
export const defaultMenu = [
  { id:1,  name:"Americano",               price:90,  category:"coffee",    subcategory:"Coffee",       hasVariant:true, hasTemp:false, variants:[{name:"Plain",price:90},{name:"Chocolate",price:120},{name:"Caramel",price:120}] },
  { id:2,  name:"Cafe Latte",              price:130, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true  },
  { id:3,  name:"Brown Sugar Latte",       price:140, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true  },
  { id:4,  name:"Vanilla Latte",           price:140, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true  },
  { id:5,  name:"Spanish Latte",           price:140, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true,  popular:true },
  { id:6,  name:"Caramel Latte",           price:140, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true,  popular:true },
  { id:7,  name:"Cafe Mocha",              price:150, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true  },
  { id:8,  name:"White Choco Mocha",       price:150, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true  },
  { id:9,  name:"Mocha Caramel",           price:150, category:"coffee",    subcategory:"Coffee",       hasVariant:false, hasTemp:true  },
  { id:10, name:"Creamy Coconut Latte",    price:170, category:"coconut series", subcategory:"Coconut Series",    hasVariant:false, hasTemp:true,  bestseller:true },
  { id:11, name:"Honey Oat Espresso",      price:175, category:"oat series",     subcategory:"Oat Series",         hasVariant:false, hasTemp:true,  bestseller:true },
  { id:12, name:"Ube Coconut Brew",        price:180, category:"coconut series", subcategory:"Coconut Series",    hasVariant:false, hasTemp:true,  bestseller:true },
  { id:13, name:"Matcha Latte",            price:180, category:"matcha series", subcategory:"Matcha Series",    hasVariant:false, hasTemp:true,  popular:true },
  { id:14, name:"Strawberry Matcha",       price:220, category:"matcha series", subcategory:"Matcha Series",    hasVariant:false, hasTemp:true  },
  { id:15, name:"Salted Cream Matcha",     price:195, category:"matcha series", subcategory:"Matcha Series",    hasVariant:false, hasTemp:true  },
  { id:16, name:"Coconut Matcha",          price:210, category:"matcha series", subcategory:"Matcha Series",    hasVariant:false, hasTemp:true  },
  { id:17, name:"Dirty Matcha",            price:220, category:"matcha series", subcategory:"Matcha Series",    hasVariant:false, hasTemp:true,  note:"Coffee-based" },
  { id:18, name:"Tsoko Latte",             price:130, category:"non-coffee", subcategory:"Non-Coffee",   hasVariant:false, hasTemp:true  },
  { id:19, name:"Strawberry Milkshake",    price:150, category:"non-coffee", subcategory:"Non-Coffee",   hasVariant:false, hasTemp:false },
  { id:20, name:"Ube Milkshake",           price:140, category:"non-coffee", subcategory:"Non-Coffee",   hasVariant:false, hasTemp:false },
  { id:21, name:"Calamansi Cooler",        price:90,  category:"non-coffee", subcategory:"Non-Coffee",   hasVariant:false, hasTemp:true  },
  { id:22, name:"French Fries",            price:90,  category:"starter",   subcategory:"Starter",      hasVariant:false, hasTemp:false },
  { id:23, name:"Hotdog Sandwich w/ Nachos",price:110, category:"starter",   subcategory:"Starter",      hasVariant:false, hasTemp:false },
  { id:24, name:"Burger w/ Nachos",        price:140, category:"starter",   subcategory:"Starter",      hasVariant:false, hasTemp:false },
  { id:25, name:"Nachos w/ Dip",           price:130, category:"starter",   subcategory:"Starter",      hasVariant:false, hasTemp:false, note:"Salsa/Cheese" },
  { id:26, name:"Fried Chicken - Plain",   price:180, category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:27, name:"Fried Chicken - Salted Egg",price:210,category:"rice meals",subcategory:"Rice Meals",   hasVariant:false, hasTemp:false, popular:true },
  { id:28, name:"Fried Chicken - Yangnyeom",price:220,category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:29, name:"Black Pepper Beef",       price:195, category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:30, name:"Burger Steak",            price:150, category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:31, name:"Corned Beef",             price:115, category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:32, name:"Longganisa (Sweet)",      price:99,  category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:33, name:"Tocino",                  price:99,  category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:34, name:"Lumpiang Shanghai",       price:95,  category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:35, name:"Hotdog",                  price:95,  category:"rice meals", subcategory:"Rice Meals",   hasVariant:false, hasTemp:false },
  { id:36, name:"Meatball Marinara",       price:195, category:"pasta",     subcategory:"Pasta",        hasVariant:false, hasTemp:false },
  { id:37, name:"Creamy Chicken",          price:220, category:"pasta",     subcategory:"Pasta",        hasVariant:false, hasTemp:false, popular:true },
  // Add-ons
  { id:38, name:"Espresso Shot",           price:40,  category:"addons",    subcategory:"Add-ons Drink",hasVariant:false, hasTemp:false },
  { id:39, name:"Oat Milk",               price:50,  category:"addons",    subcategory:"Add-ons Drink",hasVariant:false, hasTemp:false },
  { id:40, name:"Coconut Milk",           price:60,  category:"addons",    subcategory:"Add-ons Drink",hasVariant:false, hasTemp:false },
  { id:41, name:"Syrup",                  price:30,  category:"addons",    subcategory:"Add-ons Drink",hasVariant:false, hasTemp:false },
  { id:42, name:"Salted Cream",           price:45,  category:"addons",    subcategory:"Add-ons Drink",hasVariant:false, hasTemp:false },
  { id:43, name:"Rice",                   price:20,  category:"addons",    subcategory:"Add-ons Food", hasVariant:false, hasTemp:false },
  { id:44, name:"Egg",                    price:20,  category:"addons",    subcategory:"Add-ons Food", hasVariant:false, hasTemp:false },
  { id:45, name:"Nacho Dip - Tomato Salsa",price:45, category:"addons",    subcategory:"Add-ons Food", hasVariant:false, hasTemp:false },
  { id:46, name:"Nacho Dip - Cheesy Jalapeño",price:40,category:"addons",  subcategory:"Add-ons Food", hasVariant:false, hasTemp:false },
];
