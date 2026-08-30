# Changelog

## 2026-08-30

- Disable text selection inside the Admin Record Expense modal
  - `assets/adminstyle.css`: added `user-select: none` on `.expense-modal` and all descendants so the modal behaves like a kiosk control (labels, ₱ mark, readonly date value, etc.). Typing and caret placement in the Amount/Note fields still work.
  - `views/pages/admin.html`: stylesheet tag bumped to `?v=20260830A`.
  - Reason: owner wanted the modal text (title, subtitle, field labels, currency mark, date value) to stop being highlightable.

## 2026-08-29

- Polish the Expenses feature UI/UX (Admin + POS)
  - Files changed:
    - `assets/adminstyle.css`: `?v=20260829M` on the admin page — new Expenses UI block: icon-accented KPI cards, custom category dropdown (trigger + menu + hidden select), improved records table (category chips with icons, user avatars for recorder, icon Edit/Delete buttons, `−₱` amounts, richer empty state), and modal refinements (₱ currency mark on amount, calendar-icon date field). Follow-up: KPI cards flattened to minimalist flat-white (no gradient/shadow/lift), `.expense-filter-card` stacking-context fix so the toolbar dropdown overlays the records card, an expense-modal polish pass (hero full-width amount field, uniform 46px paired fields, note field icon, header/footer refinements, explicit 18px corner radius on the header/body/footer sections since the shell must keep `overflow: visible` for the dropdown), the Date/Note field icons rebuilt as flex-row siblings with fixed-height 42px inputs (root-cause fix: the global `.ls-input` base rule's `margin-bottom: 20px` was displacing the input box up inside the flex row — zeroed it, so the input, icon, and container share the same box center) plus a canvas-measured `translateY(1px)` optical nudge on the icons and `padding-top: 1px` on the inputs so the value/placeholder text sits a touch higher, optically even with the icon glyph ink, `.air-datepicker-global-container` raised to `z-index: 12000 !important` so the modal datepicker no longer opens behind the overlay (`11001`), and quick-range shortcut chips (Today/Yesterday/Last 7 days/Last 30 days/This month) as a full-width row under the filters.
    - `controllers/admin/adminPortalController.js`: `?v=20260829D` on the admin page — Expenses From/To filters now use the same Air Datepicker as the Orders/Logs filters (`expenseDatePickers`, `initExpenseDatePickers()`); Category filter and the Record Expense modal category both use a custom dropdown (`bindExpenseDropdown`, `initExpenseFilterDropdown`, `initExpenseModalDropdown`) with per-category icons and keyboard/outside-click handling; modal date uses the Air Datepicker too (`initExpenseModalDatePicker`); table renders category chips, recorder avatars, `−₱` amounts, icon actions, and a friendlier empty state; `formatMoney` now groups thousands with commas (₱1,234,567.89); the expense modal amount input gained live thousand-separator formatting (`reformatExpenseAmountInput`/`formatExpenseAmountValue`, commas stripped on save) mirroring the POS form; quick-range presets (`expenseRangeForPreset`/`applyExpenseRangePreset`/`syncExpenseRangeChips`) drive the From/To filters and highlight the active chip, syncing with the pickers and the Today reset. Fallbacks keep everything functional when the Air Datepicker CDN is unavailable. `loadExpensesPage` also flushes the offline expense outbox in parallel with the fetch (and reloads once if anything synced), so expenses recorded while offline on the Admin terminal reach Firestore without needing the POS boot flush.
    - `views/pages/admin.html`: `?v=20260829D` (controller) + `?v=20260829M` (stylesheet) — Expenses toolbar (calendar-icon From/To, category dropdown, Today/Record buttons, quick-range chips), KPI row with icons, records card title, and modal form markup updates (Amount full-width on top, Category+Date paired, Note full-width with icon).
    - `controllers/posController.js` + `views/pages/pos.html` (+ `assets/style.css`): Record Expense modal rebuild — self-contained styling (no longer relies on admin-only classes), hero amount input with ₱ mark and live thousand-separator formatting, custom category dropdown with icons and keyboard support, note field, info hint, and Enter-to-save.
  - Reason: owner wanted the Expenses tab and its controls (dropdowns, date pickers) to look and behave more polished and consistent with the rest of the admin app.

## 2026-08-26

- Add store Expenses feature: record expenses from Admin and POS, see them subtracted from revenue as "Net" on the Admin dashboard, Sales Analytics, and the POS sales dashboard
  - Files changed:
    - `models/expenseModel.js` (new): `EXPENSE_CATEGORIES`, `saveExpense` (local-first day mirror `bb_pos_expenses_YYYY-MM-DD` + Firestore write with offline outbox), `updateExpense`/`deleteExpense`, `getTodayExpenses`/`getAllExpenses`, `getExpenseTime`/`sumExpenses`/`expenseInRange`, `syncExpenseOutbox`, and `watchTodayExpenses` (live `onSnapshot` for today's records, merged into the day mirror, stub-safe for the test harness). Data model: `{ id, amount, category, note, date, t, createdAtMs, updatedAtMs, recordedByUid, recordedByName, terminalId, source }`.
    - `firestore.rules`: new `/expenses/{docId}` block — `read`/`create` for admin+staff (with `amount is number && amount >= 0` guard), `update`/`delete` admin-only.
    - `views/dashboardView.js`: Admin dashboard now shows "Expenses Today" (red) and "Net Today" (green) KPI cards; Sales Analytics gains Expenses + Net sidebar stats with deltas, a third "Expenses" chart dataset, legend swatch, and signature coverage for the new chart series.
    - `controllers/admin/adminPortalController.js`: `loadDashboard` fetches expenses for both renders; new Expenses page (`window.showPage('expenses')`) with date-range + category filters, KPI row (Today total, Filtered total, Record count, Net today), and a Record/Edit/Delete modal.
    - `views/pages/admin.html`: Expenses nav item + page container + modal markup (`?v=20260826C`).
    - `assets/adminstyle.css`: `stat-tone-red`, `.trend-down`, `.sales-legend-swatch.expenses`, and expenses page/modal styles.
    - `controllers/posController.js` + `views/pages/pos.html`: sidebar Record Expense button + Expenses/Net sidebar stats, Expenses + Net KPI cards in the Sales dashboard, and today-only expense modal; live `watchTodayExpenses` keeps totals current, offline saves queue and flush via `syncExpenseOutbox`.
    - `sw-pos.js`: added the new expense model to the offline app-shell pre-cache (`CACHE_NAME` bumped to `brother-bean-pos-v11`).
    - Housekeeping: `?v=` cache-busts removed from model/non-view imports in `adminPortalController.js` (settingsModel, expenseModel, thermalPrinter) so each model stays a single module instance — restores `scripts/model-itest.mjs`'s "no versioned model imports" gate to green. Admin expense modal opens/closes via `style.display` (same mechanism as the other quick-add modals) with a matching header close button bound to `expenseModalCloseBtn`.
  - Reason: the owner wants store expenses tracked and reflected as net revenue across Admin and POS.
  - Note: expenses are deliberately separate from drawer "Cash Out" (no payment-method/credit tracking on expenses).

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
