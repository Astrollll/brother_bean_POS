// ── MENU VIEW ──
// Responsible for rendering menu UI — no data fetching here

import { convertQuantityBetweenUnits } from "../models/inventoryModel.js";
import { getCategoryIconForName } from "../models/categoryModel.js";

// Admin menu view — shows name, price, sold today, and base cost
export function renderAdminMenu(menuItems, soldMap = {}, inventoryItems = [], globalCategories = []) {
  const grouped = groupByCategory(menuItems, globalCategories);
  const invMap = {};
  for(let i of inventoryItems) invMap[i.id] = i;

  const normalizeAddons = (addons, idPrefix = "addon") => {
    if (!Array.isArray(addons)) return [];
    return addons
      .map((addon, index) => ({
        id: String(addon?.id || `${idPrefix}-${index + 1}`),
        name: String(addon?.name || "").trim(),
        price: Number(addon?.price || 0),
      }))
      .filter((addon) => addon.name);
  };

  // Build a Category Map for fast lookups
  const catMap = {};
  for (const c of globalCategories) {
    catMap[String(c.id || "")] = c;
    catMap[normalizeCategoryKey(c.name)] = c;
  }

  let html = '';
  const sortedGroupedEntries = Object.entries(grouped).sort(([leftId], [rightId]) => {
    const leftNormalized = normalizeCategoryKey(leftId);
    const rightNormalized = normalizeCategoryKey(rightId);
    const leftData = catMap[leftId] || catMap[leftNormalized] || { name: leftId };
    const rightData = catMap[rightId] || catMap[rightNormalized] || { name: rightId };
    return String(leftData.name || leftId).localeCompare(String(rightData.name || rightId));
  });

  for (const [categoryId, items] of sortedGroupedEntries) {
    const normalizedCategoryId = normalizeCategoryKey(categoryId);
    const catData = catMap[categoryId] || catMap[normalizedCategoryId] || { name: categoryId, icon: getCategoryIconForName(categoryId) };
    const titleIconHtml = '<span style="margin-right: 8px;">' + catData.icon + '</span>';
    const cardIconHtml = '<span style="font-size: 24px; display: block; margin-bottom: 8px;">' + catData.icon + '</span>';
    
    html += '<div class="card admin-menu-category-shell">' +
      '<div class="card-head">' +
        '<span class="card-title">' + titleIconHtml + ' ' + catData.name + '</span>' +
      '</div>' +
      '<div class="menu-grid">' +
        items.map(item => {
          const itemId = String(item?.id || "").trim();
          const soldById = itemId ? Number(soldMap[`id:${itemId}`] || 0) : 0;
          const soldByName = Number(soldMap[`name:${normalizeSoldKey(item?.name)}`] || 0);
          const soldLegacy = Number(soldMap[item.name] || 0);
          const sold = soldById || soldByName || soldLegacy || 0;
          let baseCost = 0;
          if(Array.isArray(item.recipe)){
             item.recipe.forEach(ing => {
               const inv = invMap[ing.inventoryId];
               if (!inv) return;
               const qtyInInvUnit = convertQuantityBetweenUnits(
                Number(ing.quantity || 0),
                ing.unit || inv.unit,
                inv.unit
               );
               if (qtyInInvUnit === null || !Number.isFinite(qtyInInvUnit)) return;
               baseCost += Number(inv.price || 0) * qtyInInvUnit;
             });
          }
          const normalizedItemCategory = normalizeCategoryKey(item?.category || "");
          const matchedCategory = (Array.isArray(globalCategories) ? globalCategories : []).find((category) => {
            const idKey = normalizeCategoryKey(category?.id || "");
            const nameKey = normalizeCategoryKey(category?.name || "");
            return normalizedItemCategory && (normalizedItemCategory === idKey || normalizedItemCategory === nameKey);
          });
          const categoryHasAddonConfig = !!(matchedCategory && Array.isArray(matchedCategory.addons));
          const addons = categoryHasAddonConfig
            ? normalizeAddons(matchedCategory?.addons || [], `addon-cat-${matchedCategory?.id || matchedCategory?.name || "category"}`)
            : normalizeAddons(item.addons || [], `addon-item-${item?.id || "item"}`);
          const addonPreview = addons.slice(0, 2).map((addon) => `${addon.name} (+₱${addon.price.toFixed(2)})`).join(', ');
          const addonSummary = addons.length > 2 ? `${addonPreview}, ...` : addonPreview;
          const minAddonPrice = addons.length ? Math.min(...addons.map((addon) => addon.price)) : 0;
          return '<div class="menu-card menu-card-admin">' +
            '<div class="menu-icon">' + cardIconHtml + '</div>' +
            '<div class="menu-name" style="flex:1;">' + (item.name || '') + '</div>' +
            (addons.length
              ? '<div class="menu-addon-summary">Add-ons: ' + addonSummary + (categoryHasAddonConfig ? ' (category)' : '') + '</div>'
              : '<div class="menu-addon-summary muted">No add-ons</div>') +
            '<div class="menu-pricing-stack">' +
              '<div class="menu-pricing-row">' +
                 '<span>Base Price</span>' +
                 '<span>₱' + baseCost.toFixed(2) + '</span>' +
              '</div>' +
              (addons.length
                ? '<div class="menu-pricing-row">' +
                    '<span>Add-ons start at</span>' +
                    '<span>+₱' + minAddonPrice.toFixed(2) + '</span>' +
                  '</div>'
                : '') +
              '<div class="menu-pricing-row total">' +
                 '<span>Retail Price</span>' +
                 '<span>₱' + Number(item.price||0).toFixed(2) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="menu-sales menu-sales-admin">' + (sold > 0 ? sold + ' sold today' : 'none sold today') + '</div>' +
            '<div class="menu-card-actions">' +
              '<button onclick="window._adminEditMenuItem && window._adminEditMenuItem(\'' + String(item.id).replace(/'/g, '\\\'') + '\')" ' +
                'class="menu-card-action edit">' +
                'Edit' +
              '</button>' +
              '<button onclick="window._adminDeleteMenuItem && window._adminDeleteMenuItem(\'' + String(item.id).replace(/'/g, '\\\'') + '\')" ' +
                'class="menu-card-action delete">' +
                'Delete' +
              '</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  document.getElementById('menuContent').innerHTML = html;
}

// Helper — group items by category
function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/\s+/g, " ");
}

function normalizeSoldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function groupByCategory(items, globalCategories = []) {
  const categoryNameMap = new Map(
    (Array.isArray(globalCategories) ? globalCategories : [])
      .filter((category) => category && (category.name || category.id))
      .map((category) => [normalizeCategoryKey(category.name || category.id), String(category.name || category.id)])
  );

  return items.reduce((acc, item) => {
    const rawCategory = item.category || "Uncategorized";
    const normalized = normalizeCategoryKey(rawCategory);
    const cat = categoryNameMap.get(normalized) || rawCategory;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});
}
