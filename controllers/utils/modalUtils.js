/**
 * Modal Utility Module
 * Provides reusable modal dialog functionality with animations and callbacks
 */

const ModalUtils = (() => {
  let activeModal = null;

  /**
   * Show a modal dialog
   * @param {Object} options - Modal configuration
   * @param {string} options.type - 'info', 'success', 'warning', or 'error'
   * @param {string} options.title - Modal title
   * @param {string} options.message - Modal body message
   * @param {Array} options.buttons - Array of button objects [{text, type, callback}]
   * @param {Function} options.onClose - Callback when modal closes
   * @returns {Promise} - Resolves when modal action is taken
   */
  const show = (options = {}) => {
    return new Promise((resolve) => {
      let myModal = { overlay: null, modal: null, onClose: null, isClosing: false, cleanup: null };
      
      const {
        type = 'info',
        title = 'Notice',
        message = '',
        buttons = [{ text: 'OK', type: 'primary' }],
        onClose = null,
      } = options;

      let hadPreviousModal = false;
      // Close existing modal if any
      if (activeModal) {
        hadPreviousModal = true;
        close(true, activeModal);
      }
      let docCaptureHandler = null;

      // Create overlay
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay-custom';
      overlay.id = 'modal-overlay';

      // Create modal
      const modal = document.createElement('div');
      modal.className = 'modal-custom';
      modal.id = 'modal-custom';

      // Create header
      const header = document.createElement('div');
      header.className = 'modal-custom-header';

      const icon = document.createElement('div');
      icon.className = `modal-custom-icon ${type}`;
      icon.textContent = getIconForType(type);

      const titleWrap = document.createElement('div');
      titleWrap.className = 'modal-custom-title-wrap';

      const titleEl = document.createElement('h3');
      titleEl.className = 'modal-custom-title';
      titleEl.textContent = title;

      titleWrap.appendChild(titleEl);
      header.appendChild(icon);
      header.appendChild(titleWrap);

      // Create body
      const body = document.createElement('div');
      body.className = 'modal-custom-body';
      body.innerHTML = message;

      // Create footer with buttons
      const footer = document.createElement('div');
      footer.className = 'modal-custom-footer';

      let actionHandled = false;

      const handleAction = (btn, index) => {
        if (actionHandled) return;
        actionHandled = true;

        try {
          if (btn.callback) btn.callback();
        } catch (error) {
          console.error("[ModalUtils] Button callback failed:", error);
        }

        resolve(index);

        // Close cancel-style actions immediately to avoid visible flicker.
        const isCancelAction = index === 0 && (buttons.length > 1 || String(btn.type || '').includes('secondary') || String(btn.text || '').toLowerCase() === 'cancel');
        close(isCancelAction, myModal);
      };

      const activateFromTarget = (target) => {
        const actionButton = target?.closest?.("button[data-modal-btn-index]");
        if (!actionButton) return false;
        const index = Number(actionButton.dataset.modalBtnIndex || "-1");
        if (!Number.isInteger(index) || index < 0 || index >= buttons.length) return false;
        handleAction(buttons[index], index);
        return true;
      };

      buttons.forEach((btn, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = false;
        button.dataset.modalBtnIndex = String(index);
        button.className = `modal-custom-btn ${btn.type || 'secondary'}`;
        button.textContent = btn.text;

        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          handleAction(btn, index);
        });

        button.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          handleAction(btn, index);
        });

        footer.appendChild(button);
      });

      if (buttons.length === 1) {
        footer.addEventListener('click', (event) => {
          if (event.target?.closest?.('button[data-modal-btn-index]')) return;
          handleAction(buttons[0], 0);
        });
      }

      // Assemble modal
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      // Add to DOM
      document.body.appendChild(overlay);
      myModal.overlay = overlay;
      myModal.modal = modal;
      myModal.onClose = onClose;
      
      activeModal = myModal;

      // Trigger animation
      setTimeout(() => {
        if (overlay) {
          overlay.style.animation = hadPreviousModal ? 'none' : 'fadeIn 200ms ease-out forwards';
          if (hadPreviousModal) overlay.style.opacity = '1';
        }
        if (modal) {
          modal.style.animation = 'slideUp 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards';
        }
      }, 10);

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (activateFromTarget(e.target)) return;
        if (e.target === overlay) {
          resolve(-1);
          close(true, myModal);
        }
      });

      // Some environments can suppress synthetic click on custom-styled buttons.
      // Capture pointer-up as a fallback to guarantee button activation.
      overlay.addEventListener('pointerup', (e) => {
        activateFromTarget(e.target);
      });
      docCaptureHandler = (event) => {
        // Capture-phase fallback for environments where bubbling click handlers are disrupted.
        if (!myModal || activeModal !== myModal || myModal.overlay !== overlay) return;
        if (!overlay.contains(event.target)) return;
        activateFromTarget(event.target);
      };
      document.addEventListener('click', docCaptureHandler, true);
      myModal.cleanup = () => {
        if (docCaptureHandler) {
          document.removeEventListener('click', docCaptureHandler, true);
          docCaptureHandler = null;
        }
      };
    });
  };

  /**
   * Close the active modal
   */
  const close = (immediate = false, targetModal = activeModal) => {
    if (!targetModal) return;

    const { overlay, modal, onClose, isClosing, cleanup } = targetModal;
    if (isClosing) return;
    targetModal.isClosing = true;

    const finalizeClose = () => {
      if (typeof cleanup === 'function') cleanup();
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof onClose === 'function') onClose();
      if (activeModal === targetModal) {
        activeModal = null;
      }
    };

    if (immediate) {
      finalizeClose();
      return;
    }

    if (overlay) {
      overlay.style.animation = 'fadeOut 150ms ease-out forwards';
      overlay.style.opacity = '0';
    }
    if (modal) {
      modal.style.animation = 'fadeOut 150ms ease-out forwards';
      modal.style.opacity = '0';
    }

    setTimeout(finalizeClose, 150);
  };

  /**
   * Get icon emoji for modal type
   */
  const getIconForType = (type) => {
    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌',
    };
    return icons[type] || icons.info;
  };

  /**
   * Show success modal
   */
  const success = (title, message, buttons = null) => {
    return show({
      type: 'success',
      title,
      message,
      buttons: buttons || [{ text: 'OK', type: 'primary success' }],
    });
  };

  /**
   * Show error modal
   */
  const error = (title, message, buttons = null) => {
    return show({
      type: 'error',
      title,
      message,
      buttons: buttons || [{ text: 'OK', type: 'primary error' }],
    });
  };

  /**
   * Show warning modal
   */
  const warning = (title, message, buttons = null) => {
    return show({
      type: 'warning',
      title,
      message,
      buttons: buttons || [{ text: 'OK', type: 'primary warning' }],
    });
  };

  /**
   * Show info modal
   */
  const info = (title, message, buttons = null) => {
    return show({
      type: 'info',
      title,
      message,
      buttons: buttons || [{ text: 'OK', type: 'primary info' }],
    });
  };

  /**
   * Show confirmation dialog
   */
  const confirm = (title, message) => {
    return show({
      type: 'warning',
      title,
      message,
      buttons: [
        { text: 'Cancel', type: 'secondary' },
        { text: 'Confirm', type: 'primary warning' },
      ],
    });
  };

  return {
    show,
    close,
    success,
    error,
    warning,
    info,
    confirm,
  };
})();

// Make modal helpers available to module scripts and inline handlers.
if (typeof window !== "undefined") {
  window.ModalUtils = ModalUtils;
}
