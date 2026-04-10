// ── MENU VIEW ──
// Responsible for rendering menu UI — no data fetching here

import { convertQuantityBetweenUnits } from "../models/inventoryModel.js";
import { getCategoryIconForName } from "../models/categoryModel.js";

// Admin menu view — shows name, price, sold today, and base cost
export function renderAdminMenu(menuItems, soldMap = {}, inventoryItems = [], globalCategories = []) {
  const grouped = groupByCategory(menuItems, globalCategories);
  const invMap = {};
  for(let i of inventoryItems) invMap[i.id] = i;

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
    
    html += '<div class="card" style="margin-bottom:14px;">' +
      '<div class="card-head">' +
        '<span class="card-title">' + titleIconHtml + ' ' + catData.name + '</span>' +
      '</div>' +
      '<div class="menu-grid">' +
        items.map(item => {
          const sold = soldMap[item.name] || 0;
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
          const addons = Array.isArray(item.addons)
            ? item.addons
                .map((addon) => ({
                  name: String(addon?.name || "").trim(),
                  price: Number(addon?.price || 0),
                }))
                .filter((addon) => addon.name)
            : [];
          const addonPreview = addons.slice(0, 2).map((addon) => `${addon.name} (+₱${addon.price.toFixed(2)})`).join(', ');
          const addonSummary = addons.length > 2 ? `${addonPreview}, ...` : addonPreview;
          const minAddonPrice = addons.length ? Math.min(...addons.map((addon) => addon.price)) : 0;
          return '<div class="menu-card" style="display:flex;flex-direction:column;">' +
            '<div class="menu-icon">' + cardIconHtml + '</div>' +
            '<div class="menu-name" style="flex:1;">' + (item.name || '') + '</div>' +
            (addons.length
              ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;min-height:30px;">Add-ons: ' + addonSummary + '</div>'
              : '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;min-height:30px;">No add-ons</div>') +
            '<div style="background:rgba(0,0,0,0.02);border-radius:8px;padding:8px;margin-bottom:10px;">' +
              '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px;">' +
                 '<span>Base Price</span>' +
                 '<span>₱' + baseCost.toFixed(2) + '</span>' +
              '</div>' +
              (addons.length
                ? '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px;">' +
                    '<span>Add-ons start at</span>' +
                    '<span>+₱' + minAddonPrice.toFixed(2) + '</span>' +
                  '</div>'
                : '') +
              '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;">' +
                 '<span style="color:var(--text-primary);">Retail Price</span>' +
                 '<span style="color:var(--primary);">₱' + Number(item.price||0).toFixed(2) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="menu-sales" style="margin-bottom:8px;">' + (sold > 0 ? sold + ' sold today' : 'none sold today') + '</div>' +
            '<div style="display:flex;gap:8px;justify-content:center;margin-top:auto;">' +
              '<button onclick="window._adminEditMenuItem && window._adminEditMenuItem(\'' + String(item.id).replace(/'/g, '\\\'') + '\')" ' +
                'style="background:transparent;border:1px solid var(--border-color);padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;flex:1;transition:all 0.2s;">' +
                'Edit' +
              '</button>' +
              '<button onclick="window._adminDeleteMenuItem && window._adminDeleteMenuItem(\'' + String(item.id).replace(/'/g, '\\\'') + '\')" ' +
                'style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#991B1B;padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;transition:all 0.2s;">' +
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
