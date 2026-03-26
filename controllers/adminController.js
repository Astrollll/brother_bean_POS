// ── ADMIN CONTROLLER ──
// Connects models (data) to views (UI) for the admin page

import { getTodayOrders }                            from "../models/orderModel.js";
import { getMenuItems }                              from "../models/menuModel.js";
import { getAllStaff, addStaff, removeStaff,
         getSchedule, saveSchedule, getTodayOnDuty } from "../models/staffModel.js";
import { resetDay }                                  from "../models/resetModel.js";
import { renderStats, renderRecentOrders,
         renderTopItems, renderStaffOnDuty }         from "../views/dashboardView.js";
import { renderAdminMenu }                           from "../views/menuView.js";
import { renderStaffList, renderScheduleEditor,
         readScheduleFromDOM }                       from "../views/staffView.js";

// ── DASHBOARD ──
export async function loadDashboard() {
  const [orders, { onDuty, total }] = await Promise.all([
    getTodayOrders(),
    getTodayOnDuty()
  ]);

  const totalSales  = orders.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = orders.length;

  // Best seller
  const soldMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      soldMap[item.name] = (soldMap[item.name] || 0) + (item.quantity || 1);
    });
  });
  const [bestSeller, bestSellerCount] = Object.entries(soldMap)
    .sort((a, b) => b[1] - a[1])[0] || ["—", 0];

  renderStats({ totalSales, totalOrders, bestSeller, bestSellerCount, staffOnDuty: onDuty.length, totalStaff: total });
  renderRecentOrders(orders);
  renderTopItems(orders);
  renderStaffOnDuty(onDuty);
}

// ── MENU ──
export async function loadMenu() {
  const [menuItems, orders] = await Promise.all([getMenuItems(), getTodayOrders()]);

  const soldMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      soldMap[item.name] = (soldMap[item.name] || 0) + (item.quantity || 1);
    });
  });

  renderAdminMenu(menuItems, soldMap);
}

// ── STAFF ──
export async function loadStaff() {
  const [staff, schedule] = await Promise.all([getAllStaff(), getSchedule()]);
  renderStaffList(staff, handleRemoveStaff);
  renderScheduleEditor(staff, schedule);
}

async function handleRemoveStaff(id) {
  if (!confirm("Remove this staff member?")) return;
  await removeStaff(id);
  await loadStaff();
}

export function showAddStaffForm() {
  document.getElementById("addStaffForm").style.display = "block";
}

export async function handleAddStaff() {
  const name = document.getElementById("newStaffName").value.trim();
  const role = document.getElementById("newStaffRole").value.trim();
  if (!name || !role) { alert("Please enter name and role."); return; }
  await addStaff(name, role);
  document.getElementById("newStaffName").value = "";
  document.getElementById("newStaffRole").value = "";
  document.getElementById("addStaffForm").style.display = "none";
  await loadStaff();
}

export async function handleSaveSchedule() {
  const scheduleData = readScheduleFromDOM();
  await saveSchedule(scheduleData);
  alert("Schedule saved! ✅");
  await loadDashboard();
}

// ── RESET DAY ──
export async function handleResetDay() {
  if (!confirm("Reset today? All orders will be archived and cleared.")) return;
  const result = await resetDay();
  if (!result.success) {
    alert(result.reason);
    return;
  }
  alert(`Day reset! ${result.totalArchived} orders archived to resets/${result.date} ✅`);
  await loadDashboard();
}

// ── NAV ──
export function showPage(id, el, title) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  if (el) el.classList.add("active");
  document.getElementById("topbar-page").textContent = title;

  if (id === "dashboard") loadDashboard();
  if (id === "menu")      loadMenu();
  if (id === "staff")     loadStaff();
}

// ── AUTH ──
export function login() {
  const u   = document.getElementById("u").value.trim();
  const p   = document.getElementById("p").value;
  const err = document.getElementById("err");

  if (u === "admin" && p === "admin123") {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app").style.display = "flex";
    err.textContent = "";
    loadDashboard();
  } else {
    err.textContent = "Incorrect username or password.";
    document.getElementById("p").value = "";
  }
}

export function logout() {
  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("u").value = "";
  document.getElementById("p").value = "";
  document.getElementById("err").textContent = "";
}

// ── INIT ──
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("p").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });

  // Expose to HTML onclick attributes
  window.login           = login;
  window.logout          = logout;
  window.showPage        = showPage;
  window.showAddStaff    = showAddStaffForm;
  window.addStaff        = handleAddStaff;
  window.saveSchedule    = handleSaveSchedule;
  window.resetDay        = handleResetDay;
});
