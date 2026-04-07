// ── MENU VIEW ──
// Responsible for rendering menu UI — no data fetching here

const ICON_BASE = "https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg";

export const categoryIcons = {
  "Coffee":       `${ICON_BASE}/2615.svg`,
  "Signature":    `${ICON_BASE}/2B50.svg`,
  "Matcha Series":`${ICON_BASE}/1F343.svg`,
  "Non-Coffee":   `${ICON_BASE}/1F9CB.svg`,
  "Starters":     `${ICON_BASE}/1F35F.svg`,
  "Rice Meals":   `${ICON_BASE}/1F35A.svg`,
  "Pasta":        `${ICON_BASE}/1F35D.svg`,
  "Add-ons Drink":`${ICON_BASE}/1F9C3.svg`,
  "Add-ons Food": `${ICON_BASE}/1F371.svg`,
};

// Admin menu view — shows name, price, sold today
export function renderAdminMenu(menuItems, soldMap = {}) {
  const grouped = groupBySubcategory(menuItems.filter(i => i.category !== "addons"));

  let html = "";
  for (const [subcategory, items] of Object.entries(grouped)) {
    const iconSrc = categoryIcons[subcategory] || `${ICON_BASE}/1F37D.svg`;
    const titleIconHtml = `<img class="admin-menu-category-icon" src="${iconSrc}" alt="" aria-hidden="true" loading="lazy" decoding="async">`;
    const cardIconHtml = `<img class="admin-menu-item-icon" src="${iconSrc}" alt="" aria-hidden="true" loading="lazy" decoding="async">`;
    html += `<div class="card" style="margin-bottom:14px;">
      <div class="card-head">
        <span class="card-title">${titleIconHtml} ${subcategory}</span>
      </div>
      <div class="menu-grid">
        ${items.map(item => {
          const sold = soldMap[item.name] || 0;
          return `<div class="menu-card">
            <div class="menu-icon">${cardIconHtml}</div>
            <div class="menu-name">${item.name}</div>
            <div class="menu-price">₱${item.price}</div>
            <div class="menu-sales">${sold > 0 ? `${sold} sold today` : "none sold today"}</div>
            <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;">
              <button onclick="window._adminEditMenuItem && window._adminEditMenuItem(${item.id})"
                style="background:transparent;border:1px solid var(--border-color);padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;">
                Edit
              </button>
              <button onclick="window._adminDeleteMenuItem && window._adminDeleteMenuItem(${item.id})"
                style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#991B1B;padding:6px 10px;border-radius:10px;font-size:12px;cursor:pointer;">
                Delete
              </button>
            </div>
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
