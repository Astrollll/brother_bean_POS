// ── MODAL HELPER ──
// Centralized popup modal system with animations and styling

export function showModal(options = {}) {
  const {
    title = "Notification",
    message = "",
    type = "info", // "info", "success", "warning", "error"
    confirmText = "OK",
    cancelText = null,
    onConfirm = null,
    onCancel = null,
  } = options;

  return new Promise((resolve) => {
    const modalId = `modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const iconMap = {
      info: '<i class="ri-information-line" aria-hidden="true"></i>',
      success: '<i class="ri-checkbox-circle-line" aria-hidden="true"></i>',
      warning: '<i class="ri-alert-line" aria-hidden="true"></i>',
      error: '<i class="ri-close-circle-line" aria-hidden="true"></i>',
    };

    const badgeColorMap = {
      info: "b-blue",
      success: "b-green",
      warning: "b-orange",
      error: "b-red",
    };

    const icon = iconMap[type] || iconMap.info;
    const badgeColor = badgeColorMap[type] || "b-blue";

    const modalHtml = `
      <div class="modal-overlay-custom" id="${modalId}" style="animation: fadeIn 0.3s ease-out;">
        <div class="modal-custom" style="animation: slideUp 0.3s ease-out;">
          <div class="modal-custom-header">
            <div class="modal-custom-icon ${type}">
              ${icon}
            </div>
            <div class="modal-custom-title-wrap">
              <div class="modal-custom-title">${escapeHtml(title)}</div>
              <span class="badge ${badgeColor}" style="font-size: 10px;">${type.toUpperCase()}</span>
            </div>
          </div>

          <div class="modal-custom-body">
            ${message}
          </div>

          <div class="modal-custom-footer">
            ${
              cancelText
                ? `<button class="modal-custom-btn secondary" id="${modalId}-cancel">${escapeHtml(cancelText)}</button>`
                : ""
            }
            <button class="modal-custom-btn primary ${type}" id="${modalId}-confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHtml);

    const overlay = document.getElementById(modalId);
    const confirmBtn = document.getElementById(`${modalId}-confirm`);
    const cancelBtn = document.getElementById(`${modalId}-cancel`);

    const closeModal = (result) => {
      overlay.style.animation = "fadeOut 0.2s ease-out";
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 200);
    };

    confirmBtn?.addEventListener("click", () => {
      if (typeof onConfirm === "function") onConfirm();
      closeModal(true);
    });

    cancelBtn?.addEventListener("click", () => {
      if (typeof onCancel === "function") onCancel();
      closeModal(false);
    });

    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeModal(false);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal(false);
    });
  });
}

export function showAlert(message, type = "info") {
  return showModal({
    title: type.charAt(0).toUpperCase() + type.slice(1),
    message,
    type,
  });
}

export function showConfirm(message, confirmText = "Confirm", cancelText = "Cancel") {
  return showModal({
    title: "Confirm",
    message,
    type: "warning",
    confirmText,
    cancelText,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
