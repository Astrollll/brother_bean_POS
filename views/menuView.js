// ── MENU VIEW ──
// Responsible for rendering menu UI — no data fetching here

import { convertQuantityBetweenUnits } from "../models/inventoryModel.js";
import { getCategoryIconForName } from "../models/categoryModel.js";

// Admin menu view — shows name, price, sold today, and base cost
export function renderAdminMenu(menuItems, soldMap = {}, inventoryItems = [], globalCategories = []) {
  const grouped = groupByCategory(menuItems);
  const invMap = {};
  for(let i of inventoryItems) invMap[i.id] = i;

  // Build a Category Map for fast lookups
  const catMap = {};
  for(const c of globalCategories) catMap[c.id] = c;

  let html = '';
  for (const [categoryId, items] of Object.entries(grouped)) {
    const catData = catMap[categoryId] || { name: categoryId, icon: getCategoryIconForName(categoryId) };
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

export function renderDefaultMenuPreview(menuItems = [], inventoryItems = [], globalCategories = []) {
  const previewItem = Array.isArray(menuItems) && menuItems.length ? menuItems[0] : null;
  if (!previewItem) {
    return `
      <div class="card" style="margin-bottom:14px;border:1px dashed var(--border-color);background:linear-gradient(180deg,#fffaf2 0%,#fff 100%);">
        <div class="card-head" style="align-items:flex-start;gap:10px;">
          <div>
            <span class="card-title"><span style="margin-right:8px;">✨</span>Default Menu Example</span>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Preview only.</div>
          </div>
          <span class="badge" style="background:rgba(148,163,184,0.18);color:#334155;">Example only</span>
        </div>
      </div>
    `;
  }

  const invMap = {};
  for (let i of inventoryItems) invMap[i.id] = i;

  const catMap = {};
  for (const c of globalCategories) catMap[c.id] = c;

  const catData = catMap[previewItem.category] || { name: previewItem.category, icon: getCategoryIconForName(previewItem.category) };
  const titleIconHtml = '<span style="margin-right: 8px;">' + catData.icon + '</span>';
  const cardIconHtml = '<span style="font-size: 24px; display: block; margin-bottom: 8px;">' + catData.icon + '</span>';

  let baseCost = 0;
  if (Array.isArray(previewItem.recipe)) {
    previewItem.recipe.forEach((ing) => {
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

  const ingredientNames = Array.isArray(previewItem.recipe)
    ? previewItem.recipe.map((ing) => {
        const inv = invMap[ing.inventoryId];
        return inv ? `${inv.name}` : (ing.name || ing.inventoryId || "Ingredient");
      }).slice(0, 3)
    : [];

  const previewAddons = Array.isArray(previewItem.addons)
    ? previewItem.addons
        .map((addon) => ({
          name: String(addon?.name || "").trim(),
          price: Number(addon?.price || 0),
        }))
        .filter((addon) => addon.name)
    : [];
  const previewAddonSummary = previewAddons.length
    ? previewAddons.slice(0, 2).map((addon) => `${addon.name} (+₱${addon.price.toFixed(2)})`).join(', ') + (previewAddons.length > 2 ? ', ...' : '')
    : 'No add-ons';

  let html = `
    <div class="card" style="margin-bottom:14px;border:1px dashed var(--border-color);background:linear-gradient(180deg,#fffaf2 0%,#fff 100%);">
      <div class="card-head" style="align-items:flex-start;gap:10px;">
        <div>
          <span class="card-title"><span style="margin-right:8px;">✨</span>Default Menu Example</span>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Example format only. This item is not synced to cashier POS.</div>
        </div>
        <span class="badge" style="background:rgba(148,163,184,0.18);color:#334155;">Example only</span>
      </div>
      <div class="menu-default-note" style="font-size:12px;color:var(--text-muted);margin-top:-4px;margin-bottom:10px;">Use this as a visual guide for formatting live menu cards.</div>
  `;

  html += '<div class="card" style="margin-bottom:14px;box-shadow:none;border:1px solid var(--border-light);">' +
    '<div class="card-head">' +
      '<span class="card-title">' + titleIconHtml + ' ' + catData.name + '</span>' +
    '</div>' +
    '<div class="menu-grid">' +
      '<div class="menu-card" style="display:flex;flex-direction:column;border-style:dashed;">' +
        '<div class="menu-icon">' + cardIconHtml + '</div>' +
        '<div class="menu-name" style="flex:1;">' + (previewItem.name || '') + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;min-height:30px;">' +
          (ingredientNames.length ? ingredientNames.join(', ') : 'No ingredient mapping') +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;min-height:18px;">' +
          ('Add-ons: ' + previewAddonSummary) +
        '</div>' +
        '<div style="background:rgba(0,0,0,0.02);border-radius:8px;padding:8px;margin-bottom:10px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px;">' +
             '<span>Base Price</span>' +
             '<span>₱' + baseCost.toFixed(2) + '</span>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;">' +
             '<span style="color:var(--text-primary);">Retail Price</span>' +
             '<span style="color:var(--primary);">₱' + Number(previewItem.price || 0).toFixed(2) + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:center;margin-top:auto;">' +
          '<span style="display:inline-flex;align-items:center;justify-content:center;background:rgba(148,163,184,0.16);border:1px solid rgba(148,163,184,0.32);color:#475569;padding:6px 10px;border-radius:10px;font-size:12px;font-weight:600;flex:1;">Preview only</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  return html + '</div>';
}

// Helper — group items by category
function groupByCategory(items) {
  return items.reduce((acc, item) => {
    const cat = item.category || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});
}
