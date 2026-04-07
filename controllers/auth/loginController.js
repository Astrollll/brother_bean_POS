import { loginWithEmail, watchAuth, logout as authLogout, createAuthUserByAdmin } from "./firebaseAuth.js";
import { getUserProfile, getUserRole, setUserRole, setUserProfile } from "../../models/userModel.js";
import { navigateTo } from "../utils/routes.js";

const LOGIN_EMAIL_KEY = "bb_admin_remembered_email";
const DEFAULT_ADMIN_BOOTSTRAP_KEY = "bb_admin_bootstrap_attempted";
const DEFAULT_ADMIN_EMAIL = "admin@brotherbean.local";
const DEFAULT_ADMIN_PASSWORD = "Admin@12345";
const DEFAULT_ADMIN_NAME = "Default Admin";

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
    const alreadyAttempted = localStorage.getItem(DEFAULT_ADMIN_BOOTSTRAP_KEY);
    if (alreadyAttempted) return;

    localStorage.setItem(DEFAULT_ADMIN_BOOTSTRAP_KEY, "true");

    try {
      const created = await createAuthUserByAdmin(DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD);
      await setUserRole(created.uid, "admin", DEFAULT_ADMIN_EMAIL);
      await setUserProfile(created.uid, {
        fullName: DEFAULT_ADMIN_NAME,
        email: DEFAULT_ADMIN_EMAIL,
        role: "admin",
        status: "active",
        isDefaultAdmin: true,
        updatedAtMs: Date.now(),
      });
      console.log("[Auth] Default admin account created successfully");
    } catch (e) {
      if (e?.code !== "auth/email-already-in-use") {
        console.warn("[Auth] Default admin bootstrap failed", e);
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
    if (status) status.textContent = "Authenticating account...";
    const user = await loginWithEmail(email, password);

    if (remember) {
      localStorage.setItem(LOGIN_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(LOGIN_EMAIL_KEY);
    }

    if (status) status.textContent = "Login successful. Redirecting...";
    const routeResult = await routeByRole(user);
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

    if (err) err.textContent = messageByCode[e?.code] || "Login failed. Check your credentials.";
    if (status) status.textContent = "";
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

  await ensureDefaultAdminAccount();

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
    // Only redirect if not already on the login page to prevent redirect loops
    if (window.location.pathname.includes("/login")) {
      return;
    }
    await routeByRole(user);
  });
});
