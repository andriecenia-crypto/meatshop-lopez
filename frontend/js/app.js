/* PrimeCut shared helpers: Supabase init, API client, formatting, toasts, theme, landing page. */
const PrimeCut = (() => {
  let sb = null;
  let cfg = { currency: "PHP", shop_name: "PrimeCut" };
  const PLACEHOLDER =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e9dfe0"/><path d="M110 170c0-40 40-70 95-70s85 30 85 62-35 58-90 58-90-10-90-50z" fill="#b5475b"/><path d="M150 160c20-18 50-22 80-8" stroke="#f6dfe2" stroke-width="10" fill="none" stroke-linecap="round"/></svg>'
    );

  async function init() {
    if (sb) return sb;
    const res = await fetch("/api/config");
    cfg = await res.json();
    if (!cfg.supabase_url || !cfg.supabase_anon_key) {
      toast("The shop isn't connected to Supabase yet. Add your keys to .env.", "error");
      throw new Error("Supabase is not configured");
    }
    sb = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return sb;
  }

  async function token() {
    const { data } = await (await init()).auth.getSession();
    return data.session ? data.session.access_token : null;
  }

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const t = await token();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    let res;
    try {
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && auth) {
        await (await init()).auth.signOut();
        location.href = "login.html";
      }
      throw new Error((data && data.error) || `Request failed (${res.status}).`);
    }
    return data;
  }

  async function requireRole(roles) {
    try {
      const t = await token();
      if (!t) { location.href = "login.html"; return null; }
      const me = await api("/api/auth/me");
      if (roles && !roles.includes(me.role)) { location.href = homeFor(me.role); return null; }
      return me;
    } catch (e) {
      location.href = "login.html";
      return null;
    }
  }

  const homeFor = (role) => (role === "admin" || role === "staff" ? "admin.html" : "dashboard.html");

  async function signOut() {
    await (await init()).auth.signOut();
    location.href = "login.html";
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => new Intl.NumberFormat("en-PH", { style: "currency", currency: cfg.currency || "PHP" }).format(Number(n) || 0);
  const kg = (n) => `${(Number(n) || 0).toLocaleString("en-PH", { maximumFractionDigits: 3 })} kg`;
  const date = (s) => new Date(s).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
  const label = (s) => String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const imgFallback = (el) => { el.onerror = null; el.src = PLACEHOLDER; };
  const img = (url, alt, cls = "") => `<img class="${cls}" src="${esc(url || PLACEHOLDER)}" alt="${esc(alt)}" loading="lazy" onerror="PrimeCut.imgFallback(this)">`;

  function statusBadge(status) {
    const tone = { pending_packing: "warn", ready_for_pickup: "ok", delivered: "", cancelled: "bad", paid: "ok", unpaid: "warn" }[status] || "";
    return `<span class="badge ${tone}">${esc(label(status))}</span>`;
  }

  function toast(message, type = "") {
    let box = document.querySelector(".toasts");
    if (!box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 6000 : 3500);
  }

  function initTheme() {
    const saved = localStorage.getItem("primecut-theme");
    if (saved) document.documentElement.dataset.theme = saved;
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("primecut-theme", next);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", initTheme);
  return { init, token, api, requireRole, homeFor, signOut, esc, money, kg, date, label, img, imgFallback, statusBadge, toast, get config() { return cfg; } };
})();

/* ---------- Landing page ---------- */
(async function landing() {
  if (document.body.dataset.page !== "home") return;
  const boardList = document.getElementById("board-list");
  const gallery = document.getElementById("gallery");
  const ctaArea = document.getElementById("nav-cta");
  try {
    const sb = await PrimeCut.init();
    const { data } = await sb.auth.getSession();
    if (data.session) {
      ctaArea.innerHTML = '<a class="btn btn-primary" href="login.html">Open my dashboard</a>';
    }
  } catch (e) { /* keep default Sign in / Create account links */ }

  try {
    const products = await PrimeCut.api("/api/products?available=1", { auth: false });
    boardList.innerHTML = products.slice(0, 8).map((p) =>
      `<li><span>${PrimeCut.esc(p.name)}</span><span class="dots"></span><span class="price">${PrimeCut.money(p.price_per_kg)}/kg</span></li>`
    ).join("") || '<li class="muted">The board is being updated. Check back soon.</li>';
    const featured = products.filter((p) => p.image_url).slice(0, 4);
    gallery.innerHTML = featured.map((p) =>
      `<a class="tile" href="register.html" aria-label="Order ${PrimeCut.esc(p.name)}">${PrimeCut.img(p.image_url, p.name)}<div class="cap"><h3>${PrimeCut.esc(p.name)}</h3><span>${PrimeCut.kg(p.stock_weight_kg)} fresh today</span></div></a>`
    ).join("");
  } catch (e) {
    boardList.innerHTML = '<li class="muted">Prices are unavailable right now.</li>';
  }
})();
