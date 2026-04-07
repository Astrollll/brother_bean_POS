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
      const {
        type = 'info',
        title = 'Notice',
        message = '',
        buttons = [{ text: 'OK', type: 'primary' }],
        onClose = null,
      } = options;

      // Close existing modal if any
      if (activeModal) {
        close(true);
      }

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

      buttons.forEach((btn, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `modal-custom-btn ${btn.type || 'secondary'}`;
        button.textContent = btn.text;

        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();

          if (btn.callback) btn.callback();
          resolve(index);

          // Close cancel-style actions immediately to avoid visible flicker.
          const isCancelAction = index === 0 && (buttons.length > 1 || String(btn.type || '').includes('secondary') || String(btn.text || '').toLowerCase() === 'cancel');
          close(isCancelAction);
        });

        footer.appendChild(button);
      });

      // Assemble modal
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      // Add to DOM
      document.body.appendChild(overlay);
      activeModal = { overlay, modal, onClose, isClosing: false };

      // Trigger animation
      setTimeout(() => {
        overlay.style.animation = 'fadeIn 200ms ease-out';
        modal.style.animation = 'slideUp 300ms cubic-bezier(0.16, 1, 0.3, 1)';
      }, 10);

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          resolve(-1);
          close(true);
        }
      });
    });
  };

  /**
   * Close the active modal
   */
  const close = (immediate = false) => {
    if (!activeModal) return;

    const { overlay, modal, onClose, isClosing } = activeModal;
    if (isClosing) return;
    activeModal.isClosing = true;

    const finalizeClose = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof onClose === 'function') onClose();
      activeModal = null;
    };

    if (immediate) {
      finalizeClose();
      return;
    }

    overlay.style.animation = 'fadeOut 150ms ease-out';
    modal.style.animation = 'fadeOut 150ms ease-out';

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
