window.__itestWrites = [];

const results = { steps: [], errors: [] };
const step = (name, data) => results.steps.push([name, data]);

const KEYS = [
  "bb_admin_settings_v1",
  "bb_admin_settings_pending_v1",
  "bb_menu_local_cache",
  "bb_menu_pending_ops_v1",
  "bb_categories_local_cache",
];
const clearKeys = () => KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
const readJSON = (k) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const setFail = (on) => {
  window.__itestForceSetDocFail = on;
  window.__itestForceDeleteDocFail = on;
};

async function run() {
  let settingsModel, menuModel, categoryModel;

  try {
    const [sm, mm, cm, om, rm, dv, em] = await Promise.all([
      import("/models/settingsModel.js"),
      import("/models/menuModel.js"),
      import("/models/categoryModel.js"),
      import("/models/orderModel.js"),
      import("/models/resetModel.js"),
      import("/views/dashboardView.js"),
      import("/models/expenseModel.js"),
    ]);
    settingsModel = sm;
    menuModel = mm;
    categoryModel = cm;
    step("graph", {
      settings: typeof sm.saveAdminSettings === "function",
      menu: typeof mm.syncPendingMenuOps === "function",
      category: typeof cm.syncCategoryLocalChanges === "function",
      order: typeof om.getTodayOrders === "function",
      reset: typeof rm.resetDay === "function",
      dashboardView: typeof dv.renderSalesAnalyticsDashboard === "function",
      expense: typeof em.saveExpense === "function",
      expenseWatch: typeof em.watchTodayExpenses === "function",
    });
  } catch (err) {
    step("graph", { error: String(err && err.message || err) });
  }

  clearKeys();
  try {
    setFail(true);
    await settingsModel.saveAdminSettings({ shop: { name: "Offline Shop" } });
    const afterSave = await settingsModel.getAdminSettings();
    const syncFail = await settingsModel.syncPendingAdminSettings();
    const pendingAfterFail = readJSON("bb_admin_settings_pending_v1");
    setFail(false);
    const syncOk = await settingsModel.syncPendingAdminSettings();
    const pendingAfterFlush = readJSON("bb_admin_settings_pending_v1");
    const mirrorSettings = (window.__itestWrites || []).filter((w) => String(w.ref || "").includes("/settings/admin"));
    step("settings", {
      queued: pendingAfterFail?.shop?.name === "Offline Shop",
      pendingWins: afterSave.shop?.name === "Offline Shop",
      syncFailedKeepsPending: syncFail.synced === 0 && syncFail.pending === 1,
      flushSucceeds: syncOk.synced === 1 && syncOk.pending === 0 && !pendingAfterFlush,
      mirrorWrite: mirrorSettings.length >= 1,
    });
  } catch (err) {
    step("settings", { error: String(err && err.message || err) });
  }

  clearKeys();
  try {
    setFail(true);
    await menuModel.saveMenuItem({ id: "m1", name: "Latte", price: 120 });
    await menuModel.deleteMenuItem("m2");
    const items = await menuModel.getMenuItems();
    const syncFail = await menuModel.syncPendingMenuOps();
    setFail(false);
    const syncOk = await menuModel.syncPendingMenuOps();
    const opsAfter = readJSON("bb_menu_pending_ops_v1");
    const mirrorSet = (window.__itestWrites || []).filter((w) => w.ref === "/menu/m1");
    const mirrorDel = (window.__itestWrites || []).filter((w) => w.ref === "/menu/m2" && w.deleted);
    step("menu", {
      opsQueued: syncFail.pending === 2,
      appliedOverServer: items.length === 1 && String(items[0].id) === "m1",
      syncFailedKeepsPending: syncFail.synced === 0 && syncFail.pending === 2,
      flushSucceeds: syncOk.synced === 2 && syncOk.pending === 0 && Array.isArray(opsAfter) && opsAfter.length === 0,
      mirrorSetWrite: mirrorSet.length >= 1,
      mirrorDeleteWrite: mirrorDel.length >= 1,
    });
  } catch (err) {
    step("menu", { error: String(err && err.message || err) });
  }

  clearKeys();
  try {
    setFail(true);
    await menuModel.saveMenuItem({ id: "m1", name: "Latte", price: 120 });
    await menuModel.saveMenuItem({ id: "m1", name: "Latte", price: 130 });
    const dedupe = readJSON("bb_menu_pending_ops_v1");
    step("menuDedupe", {
      singleSaveOp: Array.isArray(dedupe) && dedupe.length === 1 && dedupe[0].op === "save" && dedupe[0].item.price === 130,
    });
  } catch (err) {
    step("menuDedupe", { error: String(err && err.message || err) });
  }

  clearKeys();
  try {
    setFail(true);
    await menuModel.saveMenuItem({ id: "m1", name: "Latte", price: 120 });
    await menuModel.deleteMenuItem("m1");
    setFail(false);
    await menuModel.saveMenuItem({ id: "m1", name: "Latte", price: 140 });
    const opsAfter = readJSON("bb_menu_pending_ops_v1");
    const localCache = readJSON("bb_menu_local_cache");
    step("menuStaleOps", {
      pendingCleared: Array.isArray(opsAfter) && opsAfter.length === 0,
      localCacheKeepsItem: Array.isArray(localCache) && localCache.length === 1 && String(localCache[0].id) === "m1" && localCache[0].price === 140,
    });
  } catch (err) {
    step("menuStaleOps", { error: String(err && err.message || err) });
  }

  clearKeys();
  try {
    setFail(true);
    const cat = await categoryModel.saveCategory({ name: "Snacks" });
    await categoryModel.deleteCategory("cat-del");
    const cacheQueued = readJSON("bb_categories_local_cache");
    const cats = await categoryModel.getCategories();
    const syncFail = await categoryModel.syncCategoryLocalChanges();
    setFail(false);
    const syncOk = await categoryModel.syncCategoryLocalChanges();
    const cacheAfter = readJSON("bb_categories_local_cache");
    const mirrorCat = (window.__itestWrites || []).filter((w) => String(w.ref || "").includes("/categories/"));
    step("category", {
      upsertQueued: !!cat?.id && !!((cacheQueued?.upserts || []).length),
      mergeShowsUpsert: cats.length === 1 && String(cats[0].name) === "Snacks",
      deleteHonored: !cats.some((c) => String(c.id) === "cat-del"),
      syncFailedKeepsPending: syncFail.synced === 0 && syncFail.pending === 2,
      flushSucceeds: syncOk.synced === 2 && syncOk.pending === 0,
      cacheClearedAfterFlush: !cacheAfter?.upserts?.length && !cacheAfter?.deletedIds?.length,
      mirrorUpsertWrite: mirrorCat.some((w) => w.ref === "/categories/" + cat.id),
      mirrorDeleteWrite: mirrorCat.some((w) => w.ref === "/categories/cat-del" && w.deleted),
    });
  } catch (err) {
    step("category", { error: String(err && err.message || err) });
  }

  clearKeys();
  try {
    const d = new Date();
    const todayKeyStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFail(true);
    const saved = await em.saveExpense({ amount: 150, category: "supplies", note: "Offline beans" });
    const todayList = em.getTodayExpenses();
    const syncFail = await em.syncExpenseOutbox();
    setFail(false);
    const syncOk = await em.syncExpenseOutbox();
    const mirror = readJSON("bb_pos_expenses_" + todayKeyStr);
    const outboxAfter = readJSON("bb_pos_expense_outbox_v1");
    step("expense", {
      savedLocally: !!saved?.id && saved.queued === true,
      todayTotal: em.sumExpenses(todayList) === 150,
      syncFailedKeepsQueued: syncFail.synced === 0 && syncFail.pending === 1,
      flushSucceeds: syncOk.synced === 1 && syncOk.pending === 0 && Array.isArray(outboxAfter) && outboxAfter.length === 0,
      mirrorKeepsEntry: Array.isArray(mirror) && mirror.length === 1 && mirror[0].amount === 150,
      categoryLanded: Array.isArray(mirror) && mirror[0]?.category === "supplies",
    });
  } catch (err) {
    step("expense", { error: String(err && err.message || err) });
  }

  window.__itestResults = results;
}

run().catch((err) => {
  window.__itestResults = { fatal: String(err && err.stack || err) };
});
