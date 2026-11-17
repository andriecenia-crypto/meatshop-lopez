/* Login and registration with Supabase Auth, then role-based redirect. */
(async function () {
  const sb = await PrimeCut.init();
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const msg = document.getElementById("form-msg");

  function show(text, ok = false) {
    msg.textContent = text;
    msg.className = `alert${ok ? " ok" : ""}`;
    msg.classList.remove("hidden");
  }

  async function redirectByRole() {
    const me = await PrimeCut.api("/api/auth/me");
    location.href = PrimeCut.homeFor(me.role);
  }

  // Already signed in? Skip the form.
  const { data } = await sb.auth.getSession();
  if (data.session) {
    try { await redirectByRole(); return; } catch (e) { await sb.auth.signOut(); }
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = loginForm.querySelector("button[type=submit]");
      btn.disabled = true;
      msg.classList.add("hidden");
      const { error } = await sb.auth.signInWithPassword({
        email: loginForm.email.value.trim(),
        password: loginForm.password.value,
      });
      if (error) {
        btn.disabled = false;
        show(/confirm/i.test(error.message) ? "Confirm your email first. Check your inbox for the link." : "That email and password don't match. Try again.");
        return;
      }
      try { await redirectByRole(); } catch (err) { btn.disabled = false; show(err.message); }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = registerForm.querySelector("button[type=submit]");
      msg.classList.add("hidden");
      if (registerForm.password.value.length < 8) return show("Use a password with at least 8 characters.");
      if (registerForm.password.value !== registerForm.confirm.value) return show("The passwords don't match.");
      btn.disabled = true;
      const { data: res, error } = await sb.auth.signUp({
        email: registerForm.email.value.trim(),
        password: registerForm.password.value,
        options: { data: { full_name: registerForm.full_name.value.trim(), phone: registerForm.phone.value.trim() } },
      });
      if (error) { btn.disabled = false; return show(error.message); }
      if (res.session) {
        try { await redirectByRole(); } catch (err) { btn.disabled = false; show(err.message); }
      } else {
        registerForm.reset();
        btn.disabled = false;
        show("Account created. Check your email to confirm it, then sign in.", true);
      }
    });
  }
})().catch((e) => console.error(e));
