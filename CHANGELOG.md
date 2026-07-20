# Changelog

## 2026-07-20

- Fully remove dark mode feature from Admin and POS
  - Files changed:
    - `controllers/posController.js`: removed `THEME_STORAGE_KEY`, `setThemeButton()`, `applyTheme()`, `applySavedTheme()`, and `window.toggleTheme()`.
    - `views/pages/pos.html`, `views/pages/admin.html`, `views/pages/login.html`: removed `data-theme="light"` attribute from `<body>`.
    - `assets/style.css`: removed all `body[data-theme="dark"]` CSS rules (~258 lines).
    - `assets/adminstyle.css`: removed `.topbar-theme-toggle` styles and all `body[data-theme="dark"]` CSS rules (~177 lines).
  - Reason: completes the dark mode removal started on 2026-05-21.

## 2026-05-21

- Remove POS theme toggle and button (light-only UI)
  - Files changed:
    - `controllers/posController.js`: made theme helpers force light, removed localStorage writes for theme, and made `toggleTheme()` a no-op to keep compatibility with existing calls.
    - `views/pages/pos.html`: removed the theme toggle button from the sidebar UI.
  - Reason: user requested removal of dark mode feature across Admin and POS.

## 2026-05-21 - Sales Analytics Dashboard

- Added a compact admin sales analytics dashboard modeled after the provided reference.
  - Files changed:
    - `views/pages/admin.html`: loaded Chart.js and Tabler Icons, and replaced the old dashboard block with a render target.
    - `views/dashboardView.js`: added the self-contained analytics renderer, hardcoded sample data for Today / Week / Month, top seller animations, category cards, footer note updates, and Chart.js rendering.
    - `controllers/admin/adminPortalController.js`: switched dashboard loading to the analytics renderer.
    - `assets/adminstyle.css`: added compact dashboard styles with CSS-variable-driven light/dark support.
  - Layout: header with cafe logo, cloud sync status, period tabs, left stat rail, top sellers, trend chart, category cards, and footer report button.
