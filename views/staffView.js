// ── STAFF VIEW ──
// Responsible for rendering staff UI — no data fetching here

import { DAYS } from "../models/staffModel.js";

export function renderStaffList(staff, onRemove) {
  const el = document.getElementById("staffList");
  if (!staff.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;">No staff added yet.</div>';
    return;
  }

  el.innerHTML = `<div class="tbl-wrap"><table>
    <tr><th>Name</th><th>Role</th><th>Action</th></tr>
    ${staff.map(s => {
      const initials = s.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:8px;">
          <div class="avatar sm">${initials}</div>${s.name}
        </div></td>
        <td>${s.role}</td>
        <td><span style="color:var(--red);cursor:pointer;font-size:12px;"
          onclick="window._onRemoveStaff && window._onRemoveStaff('${s.id}')">Remove</span></td>
      </tr>`;
    }).join("")}
  </table></div>`;

  window._onRemoveStaff = onRemove;
}

export function renderScheduleEditor(staff, savedSchedule = {}) {
  const el = document.getElementById("scheduleEditor");

  let html = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
    <tr>
      <th style="text-align:left;font-size:10px;letter-spacing:2px;color:var(--muted);padding:7px 8px;border-bottom:1px solid var(--border);">Staff</th>
      ${DAYS.map(d => `
        <th style="text-align:center;font-size:10px;letter-spacing:1px;color:var(--muted);padding:7px 4px;border-bottom:1px solid var(--border);">
          ${d.slice(0, 3).toUpperCase()}
        </th>`).join("")}
    </tr>
    ${staff.map(s => {
      const staffSched = savedSchedule[s.id] || {};
      return `<tr>
        <td style="padding:8px;font-size:13px;color:var(--brown);font-weight:500;border-bottom:1px solid #faf7f3;">
          ${s.name}<div style="font-size:11px;color:var(--muted);">${s.role}</div>
        </td>
        ${DAYS.map(d => {
          const dayData = staffSched[d] || {};
          const checked = dayData.onDuty ? "checked" : "";
          const shift   = dayData.shift  || "";
          return `<td style="text-align:center;padding:6px 4px;border-bottom:1px solid #faf7f3;vertical-align:top;">
            <input type="checkbox" id="chk_${s.id}_${d}" ${checked} style="margin-bottom:4px;"><br>
            <input type="text" id="shift_${s.id}_${d}" value="${shift}" placeholder="7AM-3PM"
              style="width:80px;font-size:10px;border:1px solid var(--border);border-radius:4px;padding:3px 4px;font-family:'DM Sans',sans-serif;color:var(--brown);">
          </td>`;
        }).join("")}
      </tr>`;
    }).join("")}
  </table></div>`;

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
