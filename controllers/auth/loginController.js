import { loginWithEmail, watchAuth, logout as authLogout } from "./firebaseAuth.js";
import { getUserProfile, getUserRole, setUserProfile } from "../../models/userModel.js";
import { navigateTo } from "../utils/routes.js";
import { ADMIN_EMAILS } from "../../config/app.config.js";

const LOGIN_EMAIL_KEY = "bb_admin_remembered_email";
const SESSION_DATE_KEY = "bb_auth_session_date";

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const AUTH_OPERATION_TIMEOUT_MS = 6000;

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function setLoginLoadingState(message = "Checking session...") {
  const overlay = document.getElementById("login-loading");
  const text = document.getElementById("login-loading-text");
  const screen = document.getElementById("login-screen");
  if (text) text.textContent = message;
  if (overlay) overlay.style.display = "flex";
  if (screen) {
    screen.style.visibility = "hidden";
    screen.style.opacity = "0";
  }
}

function showLoginScreen() {
  const overlay = document.getElementById("login-loading");
  const screen = document.getElementById("login-screen");
  if (overlay) overlay.style.display = "none";
  if (screen) {
    screen.style.visibility = "visible";
    screen.style.opacity = "1";
  }
}

function setLoginBusy(isBusy) {
  const btn = document.getElementById("loginBtn");
  const txt = document.getElementById("loginBtnText");
  if (!btn || !txt) return;
  btn.disabled = isBusy;
  btn.classList.toggle("loading", isBusy);
  txt.textContent = isBusy ? "Signing In..." : "Sign In";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function routeByRole(user) {
  let profile = null;
  let role = "";

  try {
    profile = await getUserProfile(user.uid);
  } catch (profileError) {
    console.warn("[Auth] Unable to read profile during routeByRole; continuing with safe defaults.", profileError);
  }

  const status = String(profile?.status || "active").trim().toLowerCase();
  if (status === "suspended") {
    await authLogout();
    return { blocked: true, reason: "Your account is suspended. Contact an administrator." };
  }

  try {
    const rawRole = await getUserRole(user.uid);
    role = String(rawRole || "").trim().toLowerCase();
  } catch (roleError) {
    console.warn("[Auth] Unable to read role during routeByRole.", roleError);
  }

  if (!role) {
    const email = String(user.email || "").toLowerCase();
    const isAdminEmail = ADMIN_EMAILS.some((e) => e.toLowerCase() === email);

    if (isAdminEmail) {
      try {
        await setUserProfile(user.uid, {
          fullName: user.displayName || "Admin",
          email: user.email || "",
          role: "admin",
          status: "active",
        });
        role = "admin";
      } catch (e) {
        console.warn("[Auth] Failed to auto-provision admin profile:", e);
        await authLogout();
        return { blocked: true, reason: "Failed to set up admin account. Contact support." };
      }
    } else {
      await authLogout();
      return { blocked: true, reason: "Your account has not been set up yet. Contact an administrator." };
    }
  }

  if (role === "staff") {
    navigateTo("pos", { replace: true });
    return;
  }

  navigateTo("admin", { replace: true });
}

window.login = async function () {
  const email = document.getElementById("u")?.value?.trim() || "";
  const password = document.getElementById("p")?.value || "";
  const remember = !!document.getElementById("rememberEmail")?.checked;
  const err = document.getElementById("err");
  const status = document.getElementById("loginStatus");

  if (err) err.textContent = "";
  if (status) status.textContent = "";

  if (!email || !password) {
    if (err) err.textContent = "Email and password are required.";
    return;
  }

  if (!isValidEmail(email)) {
    if (err) err.textContent = "Please enter a valid email address.";
    return;
  }

  try {
    setLoginBusy(true);
    setLoginLoadingState("Signing in...");
    if (status) status.textContent = "Authenticating account...";
    const user = await withTimeout(loginWithEmail(email, password), AUTH_OPERATION_TIMEOUT_MS, "login");

    if (remember) {
      localStorage.setItem(LOGIN_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(LOGIN_EMAIL_KEY);
    }

    localStorage.setItem(SESSION_DATE_KEY, todayString());
    if (status) status.textContent = "Login successful. Redirecting...";
    const routeResult = await withTimeout(routeByRole(user), AUTH_OPERATION_TIMEOUT_MS, "route");
    if (routeResult?.blocked) {
      if (err) err.textContent = routeResult.reason;
      if (status) status.textContent = "";
      showLoginScreen();
    }
  } catch (e) {
    const messageByCode = {
      "auth/invalid-email": "Invalid email format.",
      "auth/user-disabled": "This account has been disabled.",
      "auth/user-not-found": "No account found for that email.",
      "auth/wrong-password": "Incorrect password.",
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/too-many-requests": "Too many failed attempts. Please wait and try again.",
    };

    if (err) err.textContent = e?.message === "login_timeout" || e?.message === "route_timeout"
      ? "Login is taking too long. Please try again."
      : messageByCode[e?.code] || "Login failed. Check your credentials.";
    if (status) status.textContent = "";
    showLoginScreen();
  } finally {
    setLoginBusy(false);
  }
};

window.forgotPasswordHelp = function () {
  alert("Please contact your system administrator to reset your account password.");
};

window.toggleLoginPassword = function () {
  const passwordInput = document.getElementById("p");
  const toggleBtn = document.getElementById("togglePwdBtn");
  if (!passwordInput || !toggleBtn) return;

  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  toggleBtn.textContent = showing ? "Show" : "Hide";
  toggleBtn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  toggleBtn.setAttribute("aria-pressed", showing ? "false" : "true");
};

document.addEventListener("DOMContentLoaded", async () => {
  const emailInput = document.getElementById("u");
  const passwordInput = document.getElementById("p");
  const capsWarn = document.getElementById("capsWarn");
  const rememberedEmail = localStorage.getItem(LOGIN_EMAIL_KEY);

  setLoginLoadingState("Checking session...");

  if (emailInput && rememberedEmail) {
    emailInput.value = rememberedEmail;
    const remember = document.getElementById("rememberEmail");
    if (remember) remember.checked = true;
  }

  const maybeLoginOnEnter = (e) => {
    if (e.key === "Enter") window.login();
  };

  emailInput?.addEventListener("keydown", maybeLoginOnEnter);
  passwordInput?.addEventListener("keydown", maybeLoginOnEnter);

  const capsHandler = (e) => {
    if (!capsWarn) return;
    capsWarn.classList.toggle("active", !!e.getModifierState?.("CapsLock"));
  };

  passwordInput?.addEventListener("keydown", capsHandler);
  passwordInput?.addEventListener("keyup", capsHandler);
  passwordInput?.addEventListener("blur", () => capsWarn?.classList.remove("active"));

  watchAuth(async (user) => {
    if (!user) return;

    const storedDate = localStorage.getItem(SESSION_DATE_KEY);
    if (storedDate !== todayString()) {
      localStorage.removeItem(SESSION_DATE_KEY);
      await authLogout();
      showLoginScreen();
      return;
    }

    try {
      await routeByRole(user);
    } catch (error) {
      console.warn("[Auth] Login redirect failed:", error);
      showLoginScreen();
    }
  });

  showLoginScreen();
});
