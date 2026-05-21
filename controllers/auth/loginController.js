import { loginWithEmail, watchAuth, logout as authLogout, createAuthUserByAdmin } from "./firebaseAuth.js";
import { auth } from "../firebase.js";
import { getUserProfile, getUserRole, setUserRole, setUserProfile, ensureAdminAccessProfile } from "../../models/userModel.js";
import { navigateTo } from "../utils/routes.js";
import { fetchSignInMethodsForEmail } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const LOGIN_EMAIL_KEY = "bb_admin_remembered_email";
const DEFAULT_ADMIN_BOOTSTRAP_KEY = "bb_admin_bootstrap_attempted";
const DEFAULT_ADMIN_BOOTSTRAP_VERSION = "2";
const DEFAULT_ADMIN_BOOTSTRAP_VERSIONED_KEY = `${DEFAULT_ADMIN_BOOTSTRAP_KEY}_v${DEFAULT_ADMIN_BOOTSTRAP_VERSION}`;
const DEFAULT_ADMIN_EMAIL = "admin@brotherbean.local";
const DEFAULT_ADMIN_PASSWORD = "Admin@12345";
const DEFAULT_ADMIN_NAME = "Default Admin";
const DEFAULT_ADMIN_ACCOUNTS = [
  {
    email: DEFAULT_ADMIN_EMAIL,
    password: DEFAULT_ADMIN_PASSWORD,
    fullName: DEFAULT_ADMIN_NAME,
  },
  {
    email: "owner@brotherbean.local",
    password: "Owner@12345",
    fullName: "Default Owner",
  },
];

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

async function ensureDefaultAdminAccount() {
  try {
    const alreadyAttempted = localStorage.getItem(DEFAULT_ADMIN_BOOTSTRAP_VERSIONED_KEY);
    if (alreadyAttempted) return;

    localStorage.setItem(DEFAULT_ADMIN_BOOTSTRAP_VERSIONED_KEY, "true");
    // Keep legacy key updated for backward compatibility with older builds.
    localStorage.setItem(DEFAULT_ADMIN_BOOTSTRAP_KEY, "true");
    setLoginLoadingState("Preparing admin account...");

    for (const account of DEFAULT_ADMIN_ACCOUNTS) {
      try {
        const methods = await fetchSignInMethodsForEmail(auth, account.email).catch(() => []);
        if (Array.isArray(methods) && methods.length > 0) {
          continue;
        }

        const created = await createAuthUserByAdmin(account.email, account.password);
        await setUserRole(created.uid, "admin", account.email);
        await setUserProfile(created.uid, {
          fullName: account.fullName,
          email: account.email,
          role: "admin",
          status: "active",
          isDefaultAdmin: true,
          updatedAtMs: Date.now(),
        });
        console.log(`[Auth] Default account created: ${account.email}`);
      } catch (e) {
        if (e?.code !== "auth/email-already-in-use") {
          console.warn(`[Auth] Default admin bootstrap failed for ${account.email}`, e);
        }
      }
    }
  } catch (error) {
    console.error("[Auth] ensureDefaultAdminAccount error:", error);
  }
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
    console.warn("[Auth] Unable to read role during routeByRole; defaulting to admin route.", roleError);
  }

  if (!role) {
    const knownDefaultEmail = DEFAULT_ADMIN_ACCOUNTS.some(
      (account) => String(account.email || "").toLowerCase() === String(user.email || "").toLowerCase()
    );
    try {
      await ensureAdminAccessProfile(user.uid, {
        fullName: profile?.fullName || DEFAULT_ADMIN_NAME,
        displayName: profile?.displayName || DEFAULT_ADMIN_NAME,
        email: user.email || profile?.email || DEFAULT_ADMIN_EMAIL,
        status: profile?.status || "active",
        isDefaultAdmin: knownDefaultEmail || profile?.isDefaultAdmin === true,
      });
      role = "admin";
    } catch (seedError) {
      console.warn("[Auth] Unable to backfill admin profile; continuing with admin route fallback.", seedError);
    }
  }

  if (role === "staff") {
    navigateTo("pos", { replace: true });
    return;
  }

  // Default to admin for admin/owner accounts and legacy users without an explicit role.
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

    if (status) status.textContent = "Login successful. Redirecting...";
    const routeResult = await withTimeout(routeByRole(user), AUTH_OPERATION_TIMEOUT_MS, "route");
    if (routeResult?.blocked) {
      if (err) err.textContent = routeResult.reason;
      if (status) status.textContent = "";
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

  // The default admin accounts are provisioned separately; avoid running
  // the bootstrap on every login load so we don't add auth noise or delay.

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
    try {
      await routeByRole(user);
    } catch (error) {
      console.warn("[Auth] Login redirect failed:", error);
      showLoginScreen();
    }
  });

  showLoginScreen();
});
