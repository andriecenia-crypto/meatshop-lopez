/* Customer dashboard: browse cuts, build an order by weight, place it, track it. */
(async function () {
  const P = PrimeCut;
  const me = await P.requireRole(["customer", "staff", "admin"]);
  if (!me) return;
  const sb = await P.init();

  const $ = (s) => document.querySelector(s);
  const STEP = 0.25;
  let products = [];
  let categories = [];
  let activeCat = "";
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem("primecut-cart") || "{}"); } catch (e) { cart = {}; }

  $("#greeting").textContent = `Hello, ${(me.full_name || "friend").split(" ")[0]}. What's for dinner?`;
  $("#sign-out").addEventListener("click", P.signOut);
  if (me.role !== "customer") {
    const link = document.createElement("a");
    link.href = "admin.html"; link.textContent = "Back office";
    $(".nav-links").prepend(link);
  }

  const saveCart = () => localStorage.setItem("primecut-cart", JSON.stringify(cart));
  const round = (n) => Math.round(n * 1000) / 1000;
  const find = (id) => products.find((p) => p.id === id);

  /* ---------- Catalog ---------- */
  async function loadCatalog() {
    [categories, products] = await Promise.all([P.api("/api/categories", { auth: false }), P.api("/api/products", { auth: false })]);
    renderChips();
    renderGrid();
    renderCart();
  }

  function renderChips() {
    const all = [{ id: "", name: "All cuts" }, ...categories];
    $("#chips").innerHTML = all.map((c) => `<button class="chip" data-cat="${c.id}" aria-pressed="${c.id === activeCat}">${P.esc(c.name)}</button>`).join("");
  }

  function stockBadge(p) {
    const stock = Number(p.stock_weight_kg);
    if (stock <= 0) return '<span class="badge bad">Sold out</span>';
    if (stock <= Number(p.low_stock_threshold_kg)) return `<span class="badge warn">Only ${P.kg(stock)} left</span>`;
    return `<span class="badge ok">${P.kg(stock)} available</span>`;
  }

  function renderGrid() {
    const q = $("#search").value.trim().toLowerCase();
    const list = products.filter((p) => (!activeCat || p.category_id === activeCat) && (!q || p.name.toLowerCase().includes(q)));
    if (!list.length) {
      $("#grid").innerHTML = '<div class="empty" style="grid-column:1/-1">No cuts match that search. Try another name or category.</div>';
      return;
    }
    $("#grid").innerHTML = list.map((p) => {
      const out = Number(p.stock_weight_kg) <= 0;
      return `<article class="card product${out ? " soldout" : ""}" data-id="${p.id}">
        ${P.img(p.image_url, p.name)}
        <div class="body">
          <span class="muted small">${P.esc(p.categories ? p.categories.name : "")}</span>
          <h3>${P.esc(p.name)}</h3>
          <p class="desc">${P.esc(p.description || "")}</p>
          <div class="row between"><span class="price">${P.money(p.price_per_kg)}<span class="muted small"> /kg</span></span>${stockBadge(p)}</div>
          ${out ? "" : `<div class="weight">
            <button class="btn btn-icon" data-step="-1" aria-label="Less weight">&minus;</button>
            <input type="number" inputmode="decimal" min="${STEP}" max="${p.stock_weight_kg}" step="${STEP}" value="0.5" aria-label="Weight in kilograms for ${P.esc(p.name)}">
            <span class="muted">kg</span>
            <button class="btn btn-icon" data-step="1" aria-label="More weight">+</button>
          </div>
          <button class="btn btn-primary" data-add>Add to order</button>`}
        </div>
      </article>`;
    }).join("");
  }

  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    activeCat = b.dataset.cat;
    renderChips();
    renderGrid();
  });
  $("#search").addEventListener("input", renderGrid);

  $("#grid").addEventListener("click", (e) => {
    const card = e.target.closest(".product");
    if (!card) return;
    const input = card.querySelector("input");
    const p = find(card.dataset.id);
    if (e.target.closest("[data-step]")) {
      const next = Math.max(STEP, round(Number(input.value || 0) + STEP * Number(e.target.closest("[data-step]").dataset.step)));
      input.value = Math.min(next, Number(p.stock_weight_kg));
    }
    if (e.target.closest("[data-add]")) {
      const w = round(Number(input.value));
      if (!(w > 0)) return P.toast("Enter a weight greater than 0.", "error");
      const total = round((cart[p.id] || 0) + w);
      if (total > Number(p.stock_weight_kg)) return P.toast(`Only ${P.kg(p.stock_weight_kg)} of ${p.name} left.`, "error");
      cart[p.id] = total;
      saveCart();
      renderCart();
      P.toast(`${P.kg(w)} of ${p.name} added.`, "success");
    }
  });

  /* ---------- Cart ---------- */
  function cartLines() {
    return Object.entries(cart).map(([id, w]) => ({ p: find(id), w })).filter((l) => l.p);
  }

  function renderCart() {
    // Drop lines for cuts that vanished and clamp weights to current stock.
    Object.keys(cart).forEach((id) => {
      const p = find(id);
      if (!p || Number(p.stock_weight_kg) <= 0) delete cart[id];
      else if (cart[id] > Number(p.stock_weight_kg)) cart[id] = Number(p.stock_weight_kg);
    });
    saveCart();
    const lines = cartLines();
    $("#cart-count").textContent = lines.length;
    $("#cart-items").innerHTML = lines.length
      ? lines.map(({ p, w }) => `<div class="line" data-id="${p.id}">
          ${P.img(p.image_url, p.name)}
          <div><strong>${P.esc(p.name)}</strong><div class="muted small">${P.kg(w)} &times; ${P.money(p.price_per_kg)}</div></div>
          <div style="text-align:right"><strong>${P.money(w * p.price_per_kg)}</strong><br><button class="btn btn-sm" data-remove>Remove</button></div>
        </div>`).join("")
      : '<div class="empty">Your order is empty. Add a cut to get started.</div>';
    $("#cart-total").textContent = P.money(lines.reduce((s, l) => s + l.w * l.p.price_per_kg, 0));
    $("#place-order").disabled = !lines.length;
  }

  const toggleCart = (open) => {
    $("#drawer").classList.toggle("hidden", !open);
    $("#backdrop").classList.toggle("hidden", !open);
  };
  $("#open-cart").addEventListener("click", () => toggleCart(true));
  $("#close-cart").addEventListener("click", () => toggleCart(false));
  $("#backdrop").addEventListener("click", () => toggleCart(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleCart(false); });

  $("#cart-items").addEventListener("click", (e) => {
    if (!e.target.closest("[data-remove]")) return;
    delete cart[e.target.closest(".line").dataset.id];
    renderCart();
  });

  $("#place-order").addEventListener("click", async (e) => {
    const lines = cartLines();
    if (!lines.length) return;
    e.target.disabled = true;
    try {
      const order = await P.api("/api/orders", {
        method: "POST",
        body: { items: lines.map((l) => ({ product_id: l.p.id, weight_kg: l.w })) },
      });
      cart = {};
      saveCart();
      toggleCart(false);
      P.toast(`Order placed: ${P.money(order.total_amount)}. We'll start packing.`, "success");
      await loadCatalog();
      location.hash = "#orders";
    } catch (err) {
      P.toast(err.message, "error");
      await loadCatalog(); // refresh stock so the message and the shelf agree
    } finally {
      e.target.disabled = false;
    }
  });

  /* ---------- Orders ---------- */
  async function loadOrders() {
    const box = $("#orders-list");
    try {
      const orders = await P.api("/api/orders/mine");
      if (!orders.length) {
        box.innerHTML = '<div class="empty card">You haven\'t ordered yet. <a href="#shop">Browse the cuts</a>.</div>';
        return;
      }
      box.innerHTML = orders.map((o) => `<article class="card order-card" data-id="${o.id}">
        <div class="row between">
          <div><strong>Order #${o.id.slice(0, 8)}</strong><div class="muted small">${P.date(o.created_at)}</div></div>
          <div class="row">${P.statusBadge(o.fulfillment_status)}${P.statusBadge(o.payment_status)}</div>
        </div>
        <ul class="order-lines">${o.order_items.map((i) => `<li><span>${P.esc(i.products ? i.products.name : "Cut")} &middot; ${P.kg(i.weight_kg)}</span><span>${P.money(i.subtotal)}</span></li>`).join("")}</ul>
        <div class="row between"><strong>Total ${P.money(o.total_amount)}</strong>
          ${o.fulfillment_status === "pending_packing" ? '<button class="btn btn-sm btn-danger" data-cancel>Cancel order</button>' : ""}
        </div>
      </article>`).join("");
    } catch (err) {
      box.innerHTML = `<div class="alert">${P.esc(err.message)}</div>`;
    }
  }

  $("#orders-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-cancel]");
    if (!btn || !confirm("Cancel this order? The meat goes back on the shelf.")) return;
    btn.disabled = true;
    try {
      await P.api(`/api/orders/${btn.closest(".order-card").dataset.id}/cancel`, { method: "POST" });
      P.toast("Order cancelled.", "success");
      await Promise.all([loadOrders(), loadCatalog()]);
    } catch (err) {
      btn.disabled = false;
      P.toast(err.message, "error");
    }
  });

  /* ---------- Routing between the two views ---------- */
  function route() {
    const orders = location.hash === "#orders";
    $("#view-shop").classList.toggle("hidden", orders);
    $("#view-orders").classList.toggle("hidden", !orders);
    $("#nav-shop").classList.toggle("active", !orders);
    $("#nav-orders").classList.toggle("active", orders);
    if (orders) loadOrders();
  }
  window.addEventListener("hashchange", route);

  /* ---------- Live stock: refresh when anyone's order changes the shelf ---------- */
  try {
    let timer;
    sb.channel("products-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        clearTimeout(timer);
        timer = setTimeout(async () => { products = await P.api("/api/products", { auth: false }); renderGrid(); renderCart(); }, 400);
      })
      .subscribe();
  } catch (e) { /* realtime is a bonus; the page works without it */ }

  try { await loadCatalog(); } catch (err) { $("#grid").innerHTML = `<div class="alert" style="grid-column:1/-1">${P.esc(err.message)}</div>`; }
  route();
})();
