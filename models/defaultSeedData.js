const COFFEE_BEANS = {
  id: "seed-arabica-beans",
  name: "Arabica Coffee Beans",
  category: "Coffee",
  unit: "kg",
  quantity: 16,
  reorderLevel: 8,
  price: 500,
};

const FRESH_MILK = {
  id: "seed-fresh-milk",
  name: "Fresh Milk",
  category: "Dairy",
  unit: "L",
  quantity: 30,
  reorderLevel: 14,
  price: 90,
};

const OAT_MILK = {
  id: "seed-oat-milk",
  name: "Oat Milk",
  category: "Dairy Alternative",
  unit: "L",
  quantity: 12,
  reorderLevel: 6,
  price: 150,
};

const MATCHA_POWDER = {
  id: "seed-matcha-powder",
  name: "Premium Matcha Powder",
  category: "Ingredients",
  unit: "kg",
  quantity: 3,
  reorderLevel: 1.5,
  price: 800,
};

const CHOCOLATE_SAUCE = {
  id: "seed-chocolate-sauce",
  name: "Chocolate Sauce",
  category: "Syrup",
  unit: "bottles",
  quantity: 10,
  reorderLevel: 4,
  price: 200,
};

const CARAMEL_SYRUP = {
  id: "seed-caramel-syrup",
  name: "Caramel Syrup",
  category: "Syrup",
  unit: "bottles",
  quantity: 10,
  reorderLevel: 4,
  price: 200,
};

const SUGAR_SYRUP = {
  id: "seed-sugar-syrup",
  name: "Sugar Syrup",
  category: "Ingredients",
  unit: "L",
  quantity: 14,
  reorderLevel: 6,
  price: 120,
};

const WHIPPED_CREAM = {
  id: "seed-whipped-cream",
  name: "Whipped Cream",
  category: "Dairy",
  unit: "L",
  quantity: 8,
  reorderLevel: 3,
  price: 180,
};

const CROISSANT = {
  id: "seed-croissant",
  name: "Croissant",
  category: "Pastry",
  unit: "pcs",
  quantity: 28,
  reorderLevel: 12,
  price: 45,
};

const CHEESECAKE_SLICE = {
  id: "seed-cheesecake-slice",
  name: "Cheesecake Slice",
  category: "Pastry",
  unit: "pcs",
  quantity: 16,
  reorderLevel: 8,
  price: 65,
};

export const inventorySeedItems = [
  COFFEE_BEANS,
  FRESH_MILK,
  OAT_MILK,
  MATCHA_POWDER,
  CHOCOLATE_SAUCE,
  CARAMEL_SYRUP,
  SUGAR_SYRUP,
  WHIPPED_CREAM,
  CROISSANT,
  CHEESECAKE_SLICE,
];

const RECIPE_UNITS = {
  beans: "g",
  milk: "ml",
  oatMilk: "ml",
  matcha: "g",
  sauce: "ml",
  syrup: "ml",
  pastry: "pcs",
};

const MENU_TEMPLATES = [
  {
    id: 1,
    name: "Americano",
    price: 90,
    category: "coffee",
    hasVariant: true,
    hasTemp: true,
    variants: [
      { name: "Plain", price: 90 },
      { name: "Chocolate", price: 120 },
      { name: "Caramel", price: 120 },
    ],
    recipe: [
      { inventoryId: COFFEE_BEANS.id, name: COFFEE_BEANS.name, quantity: 18, unit: RECIPE_UNITS.beans },
    ],
    requiredIngredients: [COFFEE_BEANS.id],
  },
  {
    id: 2,
    name: "Cafe Latte",
    price: 130,
    category: "coffee",
    hasVariant: false,
    hasTemp: true,
    recipe: [
      { inventoryId: COFFEE_BEANS.id, name: COFFEE_BEANS.name, quantity: 18, unit: RECIPE_UNITS.beans },
      { inventoryId: FRESH_MILK.id, name: FRESH_MILK.name, quantity: 180, unit: RECIPE_UNITS.milk },
    ],
    requiredIngredients: [COFFEE_BEANS.id, FRESH_MILK.id],
  },
  {
    id: 3,
    name: "Oat Latte",
    price: 150,
    category: "coffee",
    hasVariant: false,
    hasTemp: true,
    popular: true,
    recipe: [
      { inventoryId: COFFEE_BEANS.id, name: COFFEE_BEANS.name, quantity: 18, unit: RECIPE_UNITS.beans },
      { inventoryId: OAT_MILK.id, name: OAT_MILK.name, quantity: 180, unit: RECIPE_UNITS.oatMilk },
    ],
    requiredIngredients: [COFFEE_BEANS.id, OAT_MILK.id],
  },
  {
    id: 4,
    name: "Brown Sugar Latte",
    price: 145,
    category: "coffee",
    hasVariant: false,
    hasTemp: true,
    recipe: [
      { inventoryId: COFFEE_BEANS.id, name: COFFEE_BEANS.name, quantity: 18, unit: RECIPE_UNITS.beans },
      { inventoryId: FRESH_MILK.id, name: FRESH_MILK.name, quantity: 180, unit: RECIPE_UNITS.milk },
      { inventoryId: SUGAR_SYRUP.id, name: SUGAR_SYRUP.name, quantity: 15, unit: RECIPE_UNITS.syrup },
    ],
    requiredIngredients: [COFFEE_BEANS.id, FRESH_MILK.id, SUGAR_SYRUP.id],
  },
  {
    id: 5,
    name: "Caramel Latte",
    price: 145,
    category: "coffee",
    hasVariant: false,
    hasTemp: true,
    popular: true,
    recipe: [
      { inventoryId: COFFEE_BEANS.id, name: COFFEE_BEANS.name, quantity: 18, unit: RECIPE_UNITS.beans },
      { inventoryId: FRESH_MILK.id, name: FRESH_MILK.name, quantity: 180, unit: RECIPE_UNITS.milk },
      { inventoryId: CARAMEL_SYRUP.id, name: CARAMEL_SYRUP.name, quantity: 15, unit: RECIPE_UNITS.syrup },
    ],
    requiredIngredients: [COFFEE_BEANS.id, FRESH_MILK.id, CARAMEL_SYRUP.id],
  },
  {
    id: 6,
    name: "Cafe Mocha",
    price: 150,
    category: "coffee",
    hasVariant: false,
    hasTemp: true,
    recipe: [
      { inventoryId: COFFEE_BEANS.id, name: COFFEE_BEANS.name, quantity: 18, unit: RECIPE_UNITS.beans },
      { inventoryId: FRESH_MILK.id, name: FRESH_MILK.name, quantity: 180, unit: RECIPE_UNITS.milk },
      { inventoryId: CHOCOLATE_SAUCE.id, name: CHOCOLATE_SAUCE.name, quantity: 20, unit: RECIPE_UNITS.sauce },
    ],
    requiredIngredients: [COFFEE_BEANS.id, FRESH_MILK.id, CHOCOLATE_SAUCE.id],
  },
  {
    id: 7,
    name: "Matcha Latte",
    price: 180,
    category: "matcha series",
    hasVariant: false,
    hasTemp: true,
    bestseller: true,
    recipe: [
      { inventoryId: MATCHA_POWDER.id, name: MATCHA_POWDER.name, quantity: 6, unit: RECIPE_UNITS.matcha },
      { inventoryId: FRESH_MILK.id, name: FRESH_MILK.name, quantity: 180, unit: RECIPE_UNITS.milk },
      { inventoryId: SUGAR_SYRUP.id, name: SUGAR_SYRUP.name, quantity: 15, unit: RECIPE_UNITS.syrup },
    ],
    requiredIngredients: [MATCHA_POWDER.id, FRESH_MILK.id, SUGAR_SYRUP.id],
  },
  {
    id: 8,
    name: "Oat Matcha Latte",
    price: 190,
    category: "matcha series",
    hasVariant: false,
    hasTemp: true,
    recipe: [
      { inventoryId: MATCHA_POWDER.id, name: MATCHA_POWDER.name, quantity: 6, unit: RECIPE_UNITS.matcha },
      { inventoryId: OAT_MILK.id, name: OAT_MILK.name, quantity: 180, unit: RECIPE_UNITS.oatMilk },
      { inventoryId: SUGAR_SYRUP.id, name: SUGAR_SYRUP.name, quantity: 15, unit: RECIPE_UNITS.syrup },
    ],
    requiredIngredients: [MATCHA_POWDER.id, OAT_MILK.id, SUGAR_SYRUP.id],
  },
  {
    id: 9,
    name: "Croissant",
    price: 45,
    category: "pastry",
    hasVariant: false,
    hasTemp: false,
    recipe: [
      { inventoryId: CROISSANT.id, name: CROISSANT.name, quantity: 1, unit: RECIPE_UNITS.pastry },
    ],
    requiredIngredients: [CROISSANT.id],
  },
  {
    id: 10,
    name: "Cheesecake Slice",
    price: 65,
    category: "pastry",
    hasVariant: false,
    hasTemp: false,
    recipe: [
      { inventoryId: CHEESECAKE_SLICE.id, name: CHEESECAKE_SLICE.name, quantity: 1, unit: RECIPE_UNITS.pastry },
    ],
    requiredIngredients: [CHEESECAKE_SLICE.id],
  },
];

function normalizeMenuToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/\s+/g, " ");
}

const TEMPLATE_ID_SET = new Set(MENU_TEMPLATES.map((template) => normalizeMenuToken(template.id)));
const TEMPLATE_KEY_SET = new Set(
  MENU_TEMPLATES.map((template) => `${normalizeMenuToken(template.name)}::${normalizeMenuToken(template.category)}`)
);

export function isDefaultTemplateMenuItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.previewOnly === true || item.templateOnly === true) return true;

  const normalizedId = normalizeMenuToken(item.id);
  if (normalizedId && TEMPLATE_ID_SET.has(normalizedId)) return true;

  const key = `${normalizeMenuToken(item.name)}::${normalizeMenuToken(item.category)}`;
  return TEMPLATE_KEY_SET.has(key);
}

export function generateDefaultMenuItems(inventoryItems = inventorySeedItems) {
  const availableIds = new Set(
    Array.isArray(inventoryItems)
      ? inventoryItems.map((item) => String(item?.id || "").trim()).filter(Boolean)
      : []
  );

  return MENU_TEMPLATES
    .filter((template) => template.requiredIngredients.every((ingredientId) => availableIds.has(ingredientId)))
    .map((template) => ({
      ...template,
      variants: Array.isArray(template.variants)
        ? template.variants.map((variant) => ({ ...variant }))
        : undefined,
      addons: Array.isArray(template.addons)
        ? template.addons.map((addon) => ({ ...addon }))
        : [],
      recipe: Array.isArray(template.recipe)
        ? template.recipe.map((ingredient) => ({ ...ingredient }))
        : [],
    }));
}

export const defaultMenu = generateDefaultMenuItems();

export const adminMenuPreviewExample = {
  ...defaultMenu[0],
  id: "admin-default-preview",
  previewOnly: true,
  templateOnly: true,
  note: "Example format only",
  variants: Array.isArray(defaultMenu[0]?.variants)
    ? defaultMenu[0].variants.map((variant) => ({ ...variant }))
    : [],
  addons: Array.isArray(defaultMenu[0]?.addons)
    ? defaultMenu[0].addons.map((addon) => ({ ...addon }))
    : [],
  recipe: Array.isArray(defaultMenu[0]?.recipe)
    ? defaultMenu[0].recipe.map((ingredient) => ({ ...ingredient }))
    : [],
};
