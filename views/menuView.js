// ── MENU VIEW ──
// Responsible for rendering menu UI — no data fetching here

export const categoryIcons = {
  "Coffee":       "☕",
  "Signature":    "⭐",
  "Matcha Series":"🍵",
  "Non-Coffee":   "🥤",
  "Starters":     "🍟",
  "Rice Meals":   "🍚",
  "Pasta":        "🍝",
  "Add-ons Drink":"🧃",
  "Add-ons Food": "🍱",
};

// Admin menu view — shows name, price, sold today
export function renderAdminMenu(menuItems, soldMap = {}) {
  const grouped = groupBySubcategory(menuItems.filter(i => i.category !== "addons"));

  let html = "";
  for (const [subcategory, items] of Object.entries(grouped)) {
    const icon = categoryIcons[subcategory] || "🍽️";
    html += `<div class="card" style="margin-bottom:14px;">
      <div class="card-head">
        <span class="card-title">${icon} ${subcategory}</span>
      </div>
      <div class="menu-grid">
        ${items.map(item => {
          const sold = soldMap[item.name] || 0;
          return `<div class="menu-card">
            <div class="menu-icon">${icon}</div>
            <div class="menu-name">${item.name}</div>
            <div class="menu-price">₱${item.price}</div>
            <div class="menu-sales">${sold > 0 ? `${sold} sold today` : "none sold today"}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  }

  document.getElementById("menuContent").innerHTML = html;
}

// Helper — group items by subcategory
function groupBySubcategory(items) {
  return items.reduce((acc, item) => {
    if (!acc[item.subcategory]) acc[item.subcategory] = [];
    acc[item.subcategory].push(item);
    return acc;
  }, {});
}
