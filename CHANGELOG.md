# Changelog

## 2026-05-21

- Remove POS theme toggle and button (light-only UI)
  - Files changed:
    - `controllers/posController.js`: made theme helpers force light, removed localStorage writes for theme, and made `toggleTheme()` a no-op to keep compatibility with existing calls.
    - `views/pages/pos.html`: removed the theme toggle button from the sidebar UI.
  - Reason: user requested removal of dark mode feature across Admin and POS.

Notes:

- Dark-mode CSS (`body[data-theme="dark"]`) still exists in `assets/style.css` for now to avoid visual regressions; remove later if desired.
- TODO updated: `Remove dark-mode feature from admin and POS` marked in-progress.
