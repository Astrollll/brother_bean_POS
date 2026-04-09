# Prototype Features Implementation Plan

## Phase 1: Storage + Init (✅ 5/8)

- [x] Create models/storageModel.js (LocalStorage sync)
- [x] Update posController.js import storageModel
- [x] Update DOMContentLoaded: loadFromStorage(), checkDailyReset()
- [x] Add storage indicator to sidebar
- [x] Add sidebar buttons (Admin, Sales, Transactions, Menu)
- [ ] Enable stats-bar display:none → block
- [ ] Add pending orders panel  
- [ ] Quick payment buttons (+50,100,500,1000)

## Phase 2: Admin Controllers (✅ 5/6)
- [x] controllers/adminController.js
- [ ] controllers/historyController.js  
- [x] Admin dashboard modal
- [ ] Transaction history modal
- [x] Menu manager
- [x] CSV export

## Phase 3: UI Polish (0/5)
- [ ] views/pages/pos.html sidebar/nav
- [ ] assets/style.css (sidebar, admin tables)
- [ ] Pending orders queue
- [ ] Receipt editor
- [ ] Test all flows

**Next:** Continue polishing views/pages/pos.html UI and verify login-first routing.

