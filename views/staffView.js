// ── STAFF VIEW ──
// Responsible for rendering staff UI — no data fetching here

import { DAYS } from "../models/staffModel.js";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderStaffList(staff, onRemove) {
  const el = document.getElementById("staffList");
  if (!staff.length) {
    el.innerHTML = `
      <div class="staff-empty">
        <i class="ri-team-line" aria-hidden="true"></i>
        <div class="staff-empty-title">No staff records yet</div>
        <div class="staff-empty-sub">Add team members to start assigning shifts for the week.</div>
      </div>
    `;
    return;
  }

  const uniqueRoles = new Set(
    staff
      .map((entry) => String(entry?.role || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const scheduledMembers = new Set(
    staff
      .filter((entry) => String(entry?.shift || "").trim())
      .map((entry) => entry.id)
  );

  el.innerHTML = `<div class="staff-summary-strip" role="status" aria-label="Staff summary">
    <div class="staff-kpi-card">
      <div class="staff-kpi-label">Total Team Members</div>
      <div class="staff-kpi-value">${staff.length}</div>
    </div>
    <div class="staff-kpi-card">
      <div class="staff-kpi-label">Active Roles</div>
      <div class="staff-kpi-value">${uniqueRoles.size}</div>
    </div>
    <div class="staff-kpi-card">
      <div class="staff-kpi-label">With Shift Notes</div>
      <div class="staff-kpi-value">${scheduledMembers.size}</div>
    </div>
  </div>
  <div class="staff-table-shell">
  <div class="tbl-wrap staff-table-wrap"><table class="staff-table">
    <tr><th>Member</th><th>Role</th><th>Action</th></tr>
    ${staff.map(s => {
      const name = String(s?.name || "").trim() || "Unknown";
      const role = String(s?.role || "").trim() || "Unassigned";
      const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
      return `<tr>
        <td>
          <div class="staff-cell-person">
            <div class="avatar sm">${escapeHtml(initials)}</div>
            <div class="staff-cell-meta">
              <div class="staff-cell-name">${escapeHtml(name)}</div>
              <div class="staff-cell-sub">Assigned to weekly schedule</div>
            </div>
          </div>
        </td>
        <td><span class="badge b-blue">${escapeHtml(role)}</span></td>
        <td class="staff-action-cell">
          <button class="orders-btn ghost inventory-mini-btn danger row-action-btn" type="button"
            onclick="window._onRemoveStaff && window._onRemoveStaff('${s.id}')"
            title="Remove staff" aria-label="Remove staff">
            <i class="ri-user-unfollow-line" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
    }).join("")}
  </table></div></div>`;

  window._onRemoveStaff = onRemove;
}

export function renderScheduleEditor(staff, savedSchedule = {}) {
  const el = document.getElementById("scheduleEditor");

  if (!staff.length) {
    el.innerHTML = '<div class="staff-empty compact"><i class="ri-calendar-line" aria-hidden="true"></i><div class="staff-empty-title">No schedule to show</div><div class="staff-empty-sub">Add at least one staff member to configure weekly assignments.</div></div>';
    return;
  }

  let html = `<div class="staff-schedule-shell">
    <div class="staff-schedule-note">Turn on duty per day and set each shift window.</div>
    <div class="staff-schedule-scroll"><table class="staff-schedule-table">
    <tr>
      <th>Staff</th>
      ${DAYS.map(d => `
        <th class="schedule-day-header">
          ${d.slice(0, 3).toUpperCase()}
        </th>`).join("")}
    </tr>
    ${staff.map(s => {
      const staffSched = savedSchedule[s.id] || {};
      return `<tr>
        <td class="schedule-staff-cell">
          <div class="schedule-staff-name">${escapeHtml(s.name)}</div>
          <div class="schedule-staff-role">${escapeHtml(s.role)}</div>
        </td>
        ${DAYS.map(d => {
          const dayData = staffSched[d] || {};
          const checked = dayData.onDuty ? "checked" : "";
          const shift = dayData.shift || "";
          return `<td class="schedule-day-cell">
            <label class="schedule-duty-label" for="chk_${s.id}_${d}">
              <input class="staff-duty-toggle" type="checkbox" id="chk_${s.id}_${d}" ${checked}>
              <span>On Duty</span>
            </label>
            <input class="staff-shift-input" type="text" id="shift_${s.id}_${d}" value="${escapeHtml(shift)}" placeholder="7AM-3PM" maxlength="20">
          </td>`;
        }).join("")}
      </tr>`;
    }).join("")}
  </table></div></div>`;

  el.innerHTML = html;

  // Store staff and days references for controller to read on save
  window._scheduleStaff = staff;
  window._scheduleDays  = DAYS;
}

// Read current schedule values from the DOM
export function readScheduleFromDOM() {
  const staff = window._scheduleStaff || [];
  const days  = window._scheduleDays  || [];
  const sched = {};

  staff.forEach(s => {
    sched[s.id] = {};
    days.forEach(d => {
      const onDuty = document.getElementById(`chk_${s.id}_${d}`)?.checked || false;
      const shift  = document.getElementById(`shift_${s.id}_${d}`)?.value  || "";
      sched[s.id][d] = { onDuty, shift };
    });
  });

  return sched;
}
