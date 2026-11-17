/* Back office: overview, orders, cuts CRUD, stock receiving, suppliers, team roles. */
(async function () {
  const P = PrimeCut;
  const me = await P.requireRole(["admin", "staff"]);
  if (!me) return;
  await P.init();

  const $ = (s) => document.querySelector(s);
  const view = $("#view");
  const isAdmin = me.role === "admin";
  let categories = [];
  let products = [];
  let suppliers = [];

  $("#who").textContent = `${me.full_name || me.email} (${me.role})`;
  $("#sign-out").addEventListener("click", P.signOut);
  if (isAdmin) document.querySelector(".admin-only").classList.remove("hidden");

  /* ---------- helpers ---------- */
  const field = (label, name, value = "", attrs = "", cls = "") =>
    `<div class="field ${cls}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" value="${P.esc(value)}" ${attrs}></div>`;
  const select = (label, name, options, selected = "", cls = "", blank = "") =>
    `<div class="field ${cls}"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${blank ? `<option value="">${blank}</option>` : ""}${options
      .map((o) => `<option value="${o.id}" ${o.id === selected ? "selected" : ""}>${P.esc(o.name)}</option>`).join("")}</select></div>`;

  function openForm(title, fieldsHtml, onSubmit, submitLabel = "Save changes") {
    const dlg = $("#modal");
    $("#modal-title").textContent = title;
    $("#modal-fields").innerHTML = fieldsHtml;
    $("#modal-submit").textContent = submitLabel;
    const form = $("#modal-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#modal-submit");
      btn.disabled = true;
      try { await onSubmit(Object.fromEntries(new FormData(form))); dlg.close(); }
      catch (err) { P.toast(err.message, "error"); }
      finally { btn.disabled = false; }
    };
    dlg.showModal();
  }
  $("#modal-cancel").addEventListener("click", () => $("#modal").close());

  const loadRefs = async () => {
    [categories, products, suppliers] = await Promise.all([
      P.api("/api/categories", { auth: false }),
      P.api("/api/products", { auth: false }),
      P.api("/api/admin/suppliers"),
    ]);
  };
  const empty = (text) => `<div class="empty">${text}</div>`;
  const stockTone = (p) => (Number(p.stock_weight_kg) <= 0 ? "bad" : Number(p.stock_weight_kg) <= Number(p.low_stock_threshold_kg) ? "warn" : "ok");

  /* ---------- Overview ---------- */
  async function overview() {
    const s = await P.api("/api/admin/stats");
    const low = s.low_stock.map((p) => {
      const pct = Math.min(100, (Number(p.stock_weight_kg) / Math.max(Number(p.low_stock_threshold_kg), 0.001)) * 100);
      return `<div class="low-item"><div class="row between"><strong>${P.esc(p.name)}</strong><span class="badge ${stockTone(p)}">${Number(p.stock_weight_kg) <= 0 ? "Sold out" : P.kg(p.stock_weight_kg) + " left"}</span></div>
        <div class="meter ${stockTone(p) === "warn" ? "warn" : ""}"><span style="width:${pct}%"></span></div>
        <div class="muted small">Alert level ${P.kg(p.low_stock_threshold_kg)}</div></div>`;
    }).join("");
    const top = s.top_cuts.map((t) => `<div class="row between low-item"><span>${P.esc(t.name)}</span><strong>${P.kg(t.kg)}</strong></div>`).join("");
    view.innerHTML = `
      <div class="stats">
        <div class="card stat"><div class="muted small">To pack now</div><div class="num">${s.open_orders}</div></div>
        <div class="card stat"><div class="muted small">Ready for pickup</div><div class="num">${s.ready_orders}</div></div>
        <div class="card stat"><div class="muted small">Orders today</div><div class="num">${s.orders_today}</div></div>
        <div class="card stat"><div class="muted small">Paid today</div><div class="num">${P.money(s.revenue_today)}</div></div>
        <div class="card stat"><div class="muted small">Waiting for payment</div><div class="num">${P.money(s.unpaid_total)}</div></div>
        <div class="card stat"><div class="muted small">Shelf value (retail)</div><div class="num">${P.money(s.stock_value)}</div></div>
      </div>
      <div class="two-col">
        <section class="card pad"><h3>Low stock</h3>${low || empty("Every cut is above its alert level.")}</section>
        <section class="card pad"><h3>Best sellers by weight</h3>${top || empty("Sales will show up after the first order.")}</section>
      </div>`;
  }

  /* ---------- Orders ---------- */
  const FULFILL = ["pending_packing", "ready_for_pickup", "delivered", "cancelled"];
  async function orders() {
    const status = view.dataset.filter || "";
    const rows = await P.api(`/api/admin/orders${status ? `?status=${status}` : ""}`);
    view.innerHTML = `
      <div class="toolbar"><label for="status-filter" class="sr-only">Filter by status</label>
        <select id="status-filter" style="max-width:240px"><option value="">All orders</option>${FULFILL.map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${P.label(s)}</option>`).join("")}</select>
        <button class="btn" id="refresh">Refresh</button></div>
      <div class="card table-wrap">${rows.length ? `<table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Fulfillment</th><th>Payment</th></tr></thead><tbody>
        ${rows.map((o) => `<tr data-id="${o.id}">
          <td><strong>#${o.id.slice(0, 8)}</strong><div class="muted small">${P.date(o.created_at)}</div></td>
          <td>${P.esc(o.users ? o.users.full_name || o.users.email : "")}<div class="muted small">${P.esc(o.users ? o.users.phone || "" : "")}</div></td>
          <td>${o.order_items.map((i) => `${P.esc(i.products ? i.products.name : "Cut")} ${P.kg(i.weight_kg)}`).join("<br>")}</td>
          <td>${P.money(o.total_amount)}</td>
          <td>${["delivered", "cancelled"].includes(o.fulfillment_status) ? P.statusBadge(o.fulfillment_status) : `<select data-field="fulfillment_status" aria-label="Fulfillment status">${FULFILL.map((s) => `<option value="${s}" ${s === o.fulfillment_status ? "selected" : ""}>${P.label(s)}</option>`).join("")}</select>`}</td>
          <td><select data-field="payment_status" aria-label="Payment status" ${o.fulfillment_status === "cancelled" ? "disabled" : ""}>${["unpaid", "paid"].map((s) => `<option value="${s}" ${s === o.payment_status ? "selected" : ""}>${P.label(s)}</option>`).join("")}</select></td>
        </tr>`).join("")}</tbody></table>` : empty("No orders match this filter.")}</div>`;
    $("#status-filter").onchange = (e) => { view.dataset.filter = e.target.value; orders(); };
    $("#refresh").onclick = orders;
    view.querySelectorAll("select[data-field]").forEach((sel) => {
      sel.onchange = async () => {
        if (sel.value === "cancelled" && !confirm("Cancel this order and return the meat to stock?")) { return orders(); }
        try {
          await P.api(`/api/admin/orders/${sel.closest("tr").dataset.id}`, { method: "PATCH", body: { [sel.dataset.field]: sel.value } });
          P.toast("Order updated.", "success");
          orders();
        } catch (err) { P.toast(err.message, "error"); orders(); }
      };
    });
  }

  /* ---------- Products ---------- */
  function productForm(p = {}) {
    return `<div class="form-grid">
      ${field("Name", "name", p.name || "", "required", "full")}
      ${select("Category", "category_id", categories, p.category_id || "", "", "Choose a category")}
      ${field("Price per kg", "price_per_kg", p.price_per_kg ?? "", 'type="number" min="0" step="0.01" required')}
      ${field("Stock (kg)", "stock_weight_kg", p.stock_weight_kg ?? 0, 'type="number" min="0" step="0.001" required')}
      ${field("Low-stock alert (kg)", "low_stock_threshold_kg", p.low_stock_threshold_kg ?? 5, 'type="number" min="0" step="0.001" required')}
      ${field("Image URL", "image_url", p.image_url || "", 'type="url" placeholder="https://"', "full")}
      <div class="field full"><label for="f-description">Description</label><textarea id="f-description" name="description">${P.esc(p.description || "")}</textarea></div>
    </div>`;
  }

  async function productsView() {
    await loadRefs();
    const catName = (id) => (categories.find((c) => c.id === id) || {}).name || "";
    view.innerHTML = `
      <div class="toolbar between row"><div class="muted">${products.length} cuts on the board</div>
        <div class="row"><button class="btn" id="add-cat">New category</button><button class="btn btn-primary" id="add-product">Add a cut</button></div></div>
      <div class="card table-wrap">${products.length ? `<table><thead><tr><th>Cut</th><th>Category</th><th>Price/kg</th><th>Stock</th><th></th></tr></thead><tbody>
        ${products.map((p) => `<tr data-id="${p.id}"><td><div class="row">${P.img(p.image_url, p.name, "thumb")}<strong>${P.esc(p.name)}</strong></div></td>
          <td>${P.esc(catName(p.category_id))}</td><td>${P.money(p.price_per_kg)}</td>
          <td><span class="badge ${stockTone(p)}">${P.kg(p.stock_weight_kg)}</span></td>
          <td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-edit>Edit</button> ${isAdmin ? '<button class="btn btn-sm btn-danger" data-delete>Delete</button>' : ""}</td></tr>`).join("")}</tbody></table>` : empty("No cuts yet. Add your first one.")}</div>`;

    $("#add-product").onclick = () => openForm("Add a cut", productForm(), async (d) => {
      await P.api("/api/products", { method: "POST", body: d });
      P.toast("Cut added.", "success");
      productsView();
    }, "Add cut");
    $("#add-cat").onclick = () => openForm("New category", `${field("Name", "name", "", "required")}${field("Description", "description")}`, async (d) => {
      await P.api("/api/categories", { method: "POST", body: d });
      P.toast("Category added.", "success");
      productsView();
    }, "Add category");
    view.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => {
      const p = products.find((x) => x.id === b.closest("tr").dataset.id);
      openForm(`Edit ${p.name}`, productForm(p), async (d) => {
        await P.api(`/api/products/${p.id}`, { method: "PUT", body: d });
        P.toast("Changes saved.", "success");
        productsView();
      });
    }));
    view.querySelectorAll("[data-delete]").forEach((b) => (b.onclick = async () => {
      const p = products.find((x) => x.id === b.closest("tr").dataset.id);
      if (!confirm(`Delete ${p.name}? This can't be undone.`)) return;
      try { await P.api(`/api/products/${p.id}`, { method: "DELETE" }); P.toast("Cut deleted.", "success"); productsView(); }
      catch (err) { P.toast(err.message, "error"); }
    }));
  }

  /* ---------- Receive stock ---------- */
  async function stockView() {
    await loadRefs();
    const logs = await P.api("/api/admin/inventory");
    const today = new Date().toISOString().slice(0, 10);
    view.innerHTML = `
      <div class="two-col">
        <form class="card pad" id="stock-form">
          <h3>Record a delivery</h3>
          ${select("Cut", "product_id", products, "", "", "Choose a cut")}
          ${select("Supplier", "supplier_id", suppliers, "", "", "No supplier")}
          <div class="form-grid">
            ${field("Weight received (kg)", "quantity_added_kg", "", 'type="number" min="0.001" step="0.001" required')}
            ${field("Cost per kg", "cost_price", "", 'type="number" min="0" step="0.01" required')}
          </div>
          ${field("Received on", "received_date", today, 'type="date" required')}
          <button class="btn btn-primary" type="submit">Add to stock</button>
        </form>
        <section class="card pad"><h3>Recent deliveries</h3>${logs.length ? logs.slice(0, 12).map((l) => `<div class="low-item"><div class="row between"><strong>${P.esc(l.products ? l.products.name : "")}</strong><span>+${P.kg(l.quantity_added_kg)}</span></div>
          <div class="muted small">${P.esc(l.suppliers ? l.suppliers.name : "No supplier")} &middot; ${P.money(l.cost_price)}/kg &middot; ${l.received_date}</div></div>`).join("") : empty("No deliveries recorded yet.")}</section>
      </div>`;
    $("#stock-form").onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!d.product_id) return P.toast("Choose a cut first.", "error");
      try { await P.api("/api/admin/inventory", { method: "POST", body: d }); P.toast("Stock added.", "success"); stockView(); }
      catch (err) { P.toast(err.message, "error"); }
    };
  }

  /* ---------- Suppliers ---------- */
  const supplierForm = (s = {}) => `<div class="form-grid">${field("Supplier name", "name", s.name || "", "required", "full")}${field("Contact person", "contact_person", s.contact_person || "")}${field("Phone", "phone", s.phone || "", 'type="tel"')}${field("Email", "email", s.email || "", 'type="email"', "full")}${field("Address", "address", s.address || "", "", "full")}</div>`;

  async function suppliersView() {
    suppliers = await P.api("/api/admin/suppliers");
    view.innerHTML = `
      <div class="toolbar row between"><div class="muted">${suppliers.length} suppliers</div><button class="btn btn-primary" id="add-supplier">Add supplier</button></div>
      <div class="card table-wrap">${suppliers.length ? `<table><thead><tr><th>Supplier</th><th>Contact</th><th>Address</th><th></th></tr></thead><tbody>
        ${suppliers.map((s) => `<tr data-id="${s.id}"><td><strong>${P.esc(s.name)}</strong></td><td>${P.esc(s.contact_person || "")}<div class="muted small">${P.esc(s.phone || "")} ${P.esc(s.email || "")}</div></td><td>${P.esc(s.address || "")}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn btn-sm" data-edit>Edit</button> ${isAdmin ? '<button class="btn btn-sm btn-danger" data-delete>Delete</button>' : ""}</td></tr>`).join("")}</tbody></table>` : empty("No suppliers yet. Add the farms and wholesalers you buy from.")}</div>`;
    $("#add-supplier").onclick = () => openForm("Add supplier", supplierForm(), async (d) => { await P.api("/api/admin/suppliers", { method: "POST", body: d }); P.toast("Supplier added.", "success"); suppliersView(); }, "Add supplier");
    view.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => {
      const s = suppliers.find((x) => x.id === b.closest("tr").dataset.id);
      openForm(`Edit ${s.name}`, supplierForm(s), async (d) => { await P.api(`/api/admin/suppliers/${s.id}`, { method: "PUT", body: d }); P.toast("Changes saved.", "success"); suppliersView(); });
    }));
    view.querySelectorAll("[data-delete]").forEach((b) => (b.onclick = async () => {
      const s = suppliers.find((x) => x.id === b.closest("tr").dataset.id);
      if (!confirm(`Delete ${s.name}? Past deliveries keep their records.`)) return;
      try { await P.api(`/api/admin/suppliers/${s.id}`, { method: "DELETE" }); P.toast("Supplier deleted.", "success"); suppliersView(); }
      catch (err) { P.toast(err.message, "error"); }
    }));
  }

  /* ---------- Team (admin only) ---------- */
  async function usersView() {
    const users = await P.api("/api/admin/users");
    view.innerHTML = `<div class="card table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Role</th></tr></thead><tbody>
      ${users.map((u) => `<tr data-id="${u.id}"><td><strong>${P.esc(u.full_name || "No name")}</strong></td><td>${P.esc(u.email)}</td><td>${P.date(u.created_at)}</td>
      <td><select aria-label="Role for ${P.esc(u.email)}" ${u.id === me.id ? "disabled" : ""}>${["customer", "staff", "admin"].map((r) => `<option ${r === u.role ? "selected" : ""} value="${r}">${P.label(r)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`;
    view.querySelectorAll("select").forEach((sel) => (sel.onchange = async () => {
      try { await P.api(`/api/admin/users/${sel.closest("tr").dataset.id}`, { method: "PATCH", body: { role: sel.value } }); P.toast("Role updated.", "success"); }
      catch (err) { P.toast(err.message, "error"); usersView(); }
    }));
  }

  /* ---------- Tabs ---------- */
  const views = { overview, orders, products: productsView, stock: stockView, suppliers: suppliersView, users: usersView };
  async function show(name) {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === name)));
    view.innerHTML = '<div class="empty">Loading...</div>';
    try { await views[name](); } catch (err) { view.innerHTML = `<div class="alert">${P.esc(err.message)}</div>`; }
  }
  $("#tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) { location.hash = t.dataset.view; } });
  const route = () => { const n = location.hash.slice(1); show(views[n] && (n !== "users" || isAdmin) ? n : "overview"); };
  window.addEventListener("hashchange", route);
  route();
})();
