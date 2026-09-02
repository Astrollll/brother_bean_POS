import { loginWithEmail, watchAuth, logout as authLogout } from "./firebaseAuth.js";
import { getUserProfile, getUserRole, setUserProfile } from "../../models/userModel.js";
import { navigateTo } from "../utils/routes.js";
import { DEFAULT_ADMIN_ACCOUNTS, DEFAULT_STAFF_ACCOUNTS } from "../../config/app.config.js";

const LOGIN_EMAIL_KEY = "bb_admin_remembered_email";
const SESSION_DATE_KEY = "bb_auth_session_date";
const ALL_DEFAULT_ACCOUNTS = [...DEFAULT_ADMIN_ACCOUNTS, ...DEFAULT_STAFF_ACCOUNTS];

let routingInProgress = false;

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const AUTH_OPERATION_TIMEOUT_MS = 10000;

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => { clearTimeout(timer); resolve(value); })
      .catch((error) => { clearTimeout(timer); reject(error); });
  });
}

function setLoginLoadingState(message = "Signing in...") {
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
  if (routingInProgress) return null;
  routingInProgress = true;

  try {
    let profile = null;
    let role = "";

    try {
      profile = await getUserProfile(user.uid);
    } catch (profileError) {
      console.warn("[Auth] Unable to read profile:", profileError);
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
      console.warn("[Auth] Unable to read role:", roleError);
    }

    if (!role) {
      const email = String(user.email || "").toLowerCase();
      const matchedAccount = ALL_DEFAULT_ACCOUNTS.find(
        (a) => a.email.toLowerCase() === email
      );

      if (matchedAccount) {
        const isAdmin = DEFAULT_ADMIN_ACCOUNTS.some((a) => a.email === matchedAccount.email);
        const roleToSet = isAdmin ? "admin" : "staff";
        try {
          await setUserProfile(user.uid, {
            fullName: matchedAccount.fullName,
            email: user.email || matchedAccount.email,
            role: roleToSet,
            status: "active",
            isDefaultAdmin: isAdmin,
            updatedAtMs: Date.now(),
          });
          role = roleToSet;
        } catch (e) {
          console.warn("[Auth] Failed to create profile:", e);
        }
      }
    }

    if (!role) {
      await authLogout();
      return { blocked: true, reason: "Your account has not been set up yet. Contact an administrator." };
    }

    if (role === "staff") {
      navigateTo("pos", { replace: true });
    } else {
      navigateTo("admin", { replace: true });
    }
    return null;
  } finally {
    routingInProgress = false;
  }
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

    if (remember) {
      localStorage.setItem(LOGIN_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(LOGIN_EMAIL_KEY);
    }

    localStorage.setItem(SESSION_DATE_KEY, todayString());

    await withTimeout(loginWithEmail(email, password), AUTH_OPERATION_TIMEOUT_MS, "login");

    if (status) status.textContent = "Login successful. Redirecting...";
  } catch (e) {
    localStorage.removeItem(SESSION_DATE_KEY);

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

  const eyeOpen = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeClosed = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  toggleBtn.innerHTML = showing ? eyeClosed : eyeOpen;
  toggleBtn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  toggleBtn.setAttribute("aria-pressed", showing ? "false" : "true");
};

document.addEventListener("DOMContentLoaded", () => {
  const emailInput = document.getElementById("u");
  const passwordInput = document.getElementById("p");
  const capsWarn = document.getElementById("capsWarn");
  const rememberedEmail = localStorage.getItem(LOGIN_EMAIL_KEY);

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
    if (!user) {
      showLoginScreen();
      return;
    }

    const storedDate = localStorage.getItem(SESSION_DATE_KEY);
    if (storedDate !== todayString()) {
      localStorage.removeItem(SESSION_DATE_KEY);
      await authLogout();
      showLoginScreen();
      setLoginBusy(false);
      return;
    }

    try {
      const result = await routeByRole(user);
      if (result?.blocked) {
        const err = document.getElementById("err");
        if (err) err.textContent = result.reason;
        showLoginScreen();
        setLoginBusy(false);
      }
    } catch (error) {
      console.warn("[Auth] Login redirect failed:", error);
      showLoginScreen();
      setLoginBusy(false);
    }
  });
});
