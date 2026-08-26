# Changelog

## 2026-08-26

- Make receipt BIR/VAT footer lines settings-driven with live sync (POS + Admin)
  - Files changed:
    - `models/settingsModel.js`: added optional `shop.vatTin` and `shop.permitNo` to defaults, a synchronous `readReceiptTaxDetails()` helper (reads the local settings mirror), and `watchAdminSettings()` — a Firestore `onSnapshot` listener on `settings/admin` that refreshes the local mirror on every change.
    - `controllers/admin/adminPortalController.js`: Settings → Shop Information now shows "VAT Registered TIN" and "Receipt Permit No" display rows plus two optional edit inputs; saving persists them; the admin order-receipt reprint renders the BIR lines only when set. A one-time live settings listener is attached after login.
    - `controllers/posController.js`: POS receipts render the BIR lines only when set, reading the same live-synced mirror; one-time listener attached after login. No page refresh is needed anywhere — edits propagate to all open terminals within about a second (and to offline terminals once they reconnect, via Firestore offline persistence).
    - `controllers/printer/thermalPrinter.js`: thermal printouts mirror the on-screen behavior — BIR lines only print when filled in. The printer module reads the settings mirror directly (kept dependency-free).
  - Reason: the shop is not BIR-registered yet, so the previously hardcoded placeholder "VAT Registered TIN: 000-000-000-000 / Permit No: 0000000" lines should not appear on customer receipts until real values are configured in Admin → Settings.
  - Note: legacy saved settings without these keys are handled safely (`mergeSettings` fills them as empty → lines hidden).

## 2026-08-21

- Fix Sales Analytics flicker and animation resets (admin side)
  - Files changed:
    - `assets/adminstyle.css`: disabled the `pageEnter` entrance animation replay for `#salesAnalytics.page.active` (page no longer fades from transparent when switching tabs back to Analytics).
    - `views/dashboardView.js`: analytics renders are now idempotent — a render signature skips DOM/chart re-renders when nothing visually changed, so auto-sync refreshes (60s) and tab switches no longer replay top-seller bar animations or redraw the chart; Chart.js instance is now reused via in-place data updates instead of destroy/recreate (removes blank-canvas flicker).
    - `views/pages/admin.html`, `controllers/admin/adminPortalController.js`: bumped cache-bust versions for changed assets (`?v=20260821A`).
  - Reason: user reported the Sales Analytics page flickering and its animations resetting on refresh and on tab switches.

- Fix Staff page flicker when switching tabs (admin side)
  - Files changed:
    - `assets/adminstyle.css`: disabled the `pageEnter` entrance animation replay for `#staff.page.active`.
    - `views/staffView.js`: `renderStaffList()` and `renderScheduleEditor()` now skip their innerHTML rebuild when staff/schedule data is unchanged, so the table row slide-in stagger, badge pop, and KPI cards no longer replay their entry animations on every tab revisit. Side benefit: unsaved schedule editor edits now survive tab switches.
    - `controllers/admin/adminPortalController.js`: added cache-bust version to the `staffView.js` import (`?v=20260821A`).
  - Reason: same flicker-on-tab-switch behavior as Sales Analytics; first visit after refresh still animates as before.

- Fix Settings page flicker when switching tabs (admin side)
  - Files changed:
    - `assets/adminstyle.css`: disabled the `pageEnter` entrance animation replay for `#settings.page.active`.
    - `controllers/admin/adminPortalController.js`: `loadSettingsPage()` now skips its full innerHTML rebuild and listener re-binding when settings are unchanged since the last render (signature check), so page fade and capability badge pops no longer replay on every tab revisit. Side benefit: an open shop-info edit form with unsaved input now survives tab switches. Data-changing flows (toggle saves, shop info save, reset to defaults, clear app cache) still re-render correctly on next visit.
  - Reason: same flicker-on-tab-switch behavior as Sales Analytics and Staff pages.

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
