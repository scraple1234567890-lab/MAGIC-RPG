(function () {
  const LOGIN_STATE_KEY = "auth:isLoggedIn";
  const PROFILE_KEY = "auth:localProfile";

  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  function readProfile() {
    try {
      return safeParse(window.localStorage.getItem(PROFILE_KEY) || "null", null);
    } catch {
      return null;
    }
  }

  function writeProfile(profile) {
    try {
      if (!profile) {
        window.localStorage.removeItem(PROFILE_KEY);
        return;
      }
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // ignore (private mode / blocked storage)
    }
  }

  function setLoggedIn(flag) {
    try {
      if (flag) window.localStorage.setItem(LOGIN_STATE_KEY, "true");
      else window.localStorage.removeItem(LOGIN_STATE_KEY);
    } catch {
      // ignore
    }
  }

  function isLoggedIn() {
    try {
      return window.localStorage.getItem(LOGIN_STATE_KEY) === "true";
    } catch {
      return false;
    }
  }

  // Logout button (works on any page that includes it)
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      setLoggedIn(false);
      writeProfile(null);
      // Keep game progress (hero saves) untouched.
      window.location.href = "./index.html";
    });
  }

  // Local login page behavior
  const form = document.getElementById("localLoginForm");
  const nameInput = document.getElementById("localDisplayName");
  const statusEl = document.getElementById("localAuthStatus");
  const continueGuestBtn = document.getElementById("continueGuest");

  function setStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
  }

  if (form) {
    const existing = readProfile();
    if (existing?.displayName && nameInput) {
      nameInput.value = existing.displayName;
    }

    if (isLoggedIn()) {
      setStatus("You already have a local profile saved on this device. You can update it here.");
    } else {
      setStatus("Tip: you can skip this entirely and just play as a guest.");
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const displayName = (nameInput && "value" in nameInput) ? String(nameInput.value || "").trim() : "";
      writeProfile({ displayName });
      setLoggedIn(true);
      window.location.href = "./index.html";
    });

    if (continueGuestBtn) {
      continueGuestBtn.addEventListener("click", () => {
        setLoggedIn(false);
        writeProfile(null);
        window.location.href = "./index.html";
      });
    }
  }
})();
