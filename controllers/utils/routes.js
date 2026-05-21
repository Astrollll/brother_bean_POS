const ROUTES = Object.freeze({
  login: "/views/pages/login.html",
  admin: "/views/pages/admin.html",
  pos: "/views/pages/pos.html",
});

export function getRoutePath(routeName) {
  return ROUTES[routeName] || String(routeName || "");
}

export function navigateTo(routeName, options = {}) {
  const { replace = false } = options;
  const targetPath = getRoutePath(routeName);
  if (!targetPath) return;

  const targetUrl = new URL(targetPath, window.location.href).toString();
  if (replace) {
    window.location.replace(targetUrl);
    return;
  }
  window.location.href = targetUrl;
}
