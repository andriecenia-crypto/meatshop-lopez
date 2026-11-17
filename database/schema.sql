-- PrimeCut schema for Supabase (PostgreSQL). Run in the Supabase SQL editor.
create extension if not exists "pgcrypto";

-- ============ TABLES ============
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role text not null default 'customer' check (role in ('admin', 'staff', 'customer')),
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text,
  price_per_kg numeric(10,2) not null check (price_per_kg >= 0),
  stock_weight_kg numeric(10,3) not null default 0 check (stock_weight_kg >= 0),
  low_stock_threshold_kg numeric(10,3) not null default 5 check (low_stock_threshold_kg >= 0),
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  quantity_added_kg numeric(10,3) not null check (quantity_added_kg > 0),
  cost_price numeric(10,2) not null default 0 check (cost_price >= 0), -- cost per kg
  received_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users(id) on delete restrict,
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  fulfillment_status text not null default 'pending_packing'
    check (fulfillment_status in ('pending_packing', 'ready_for_pickup', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  weight_kg numeric(10,3) not null check (weight_kg > 0),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

-- ============ INDEXES ============
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_name on public.products(lower(name));
create index if not exists idx_inventory_product on public.inventory_logs(product_id);
create index if not exists idx_inventory_supplier on public.inventory_logs(supplier_id);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_status on public.orders(fulfillment_status);
create index if not exists idx_orders_created on public.orders(created_at desc);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_items_product on public.order_items(product_id);

-- ============ ROLE HELPERS (security definer avoids RLS recursion) ============
create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('admin', 'staff'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

-- ============ AUTO-CREATE PROFILE ON SIGNUP (role is always 'customer') ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ BUSINESS FUNCTIONS (called by the Flask API with the service role) ============
-- Places an order and deducts stock in one transaction. Row locks stop two buyers taking the same last kilos.
create or replace function public.place_order(p_customer uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order uuid;
  v_item jsonb;
  v_prod public.products%rowtype;
  v_weight numeric;
  v_sub numeric;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one cut to your order.';
  end if;

  insert into public.orders (customer_id, total_amount) values (p_customer, 0) returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_weight := (v_item->>'weight_kg')::numeric;
    if v_weight is null or v_weight <= 0 then
      raise exception 'Weight must be greater than 0.';
    end if;

    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid for update;
    if not found then
      raise exception 'One of the cuts is no longer available.';
    end if;
    if v_prod.stock_weight_kg < v_weight then
      raise exception 'Not enough stock for %: % kg left.', v_prod.name, v_prod.stock_weight_kg;
    end if;

    v_sub := round(v_prod.price_per_kg * v_weight, 2);
    update public.products set stock_weight_kg = stock_weight_kg - v_weight where id = v_prod.id;
    insert into public.order_items (order_id, product_id, weight_kg, subtotal)
      values (v_order, v_prod.id, v_weight, v_sub);
    v_total := v_total + v_sub;
  end loop;

  update public.orders set total_amount = v_total where id = v_order;
  return v_order;
end;
$$;

-- Cancels an order and puts the meat back into stock.
create or replace function public.cancel_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_line record;
begin
  select fulfillment_status into v_status from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_status = 'cancelled' then raise exception 'This order is already cancelled.'; end if;
  if v_status = 'delivered' then raise exception 'A delivered order can''t be cancelled.'; end if;

  for v_line in select product_id, weight_kg from public.order_items where order_id = p_order loop
    update public.products set stock_weight_kg = stock_weight_kg + v_line.weight_kg where id = v_line.product_id;
  end loop;
  update public.orders set fulfillment_status = 'cancelled' where id = p_order;
end;
$$;

-- Records a delivery from a supplier and adds it to stock.
create or replace function public.receive_stock(
  p_product uuid, p_supplier uuid, p_qty numeric, p_cost numeric, p_date date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_log uuid;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be greater than 0.'; end if;
  perform 1 from public.products where id = p_product for update;
  if not found then raise exception 'Cut not found.'; end if;

  insert into public.inventory_logs (product_id, supplier_id, quantity_added_kg, cost_price, received_date)
    values (p_product, p_supplier, p_qty, coalesce(p_cost, 0), coalesce(p_date, current_date))
    returning id into v_log;
  update public.products set stock_weight_kg = stock_weight_kg + p_qty where id = p_product;
  return v_log;
end;
$$;

-- Only the service role (our Flask backend) may run these.
revoke all on function public.place_order(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_order(uuid) from public, anon, authenticated;
revoke all on function public.receive_stock(uuid, uuid, numeric, numeric, date) from public, anon, authenticated;
grant execute on function public.place_order(uuid, jsonb) to service_role;
grant execute on function public.cancel_order(uuid) to service_role;
grant execute on function public.receive_stock(uuid, uuid, numeric, numeric, date) to service_role;

-- ============ ROW LEVEL SECURITY ============
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.inventory_logs enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- users
drop policy if exists users_select on public.users;
drop policy if exists users_update_self on public.users;
drop policy if exists users_admin_all on public.users;
create policy users_select on public.users for select using (id = auth.uid() or public.is_staff());
create policy users_update_self on public.users for update
  using (id = auth.uid()) with check (id = auth.uid() and role = public.current_role_name());
create policy users_admin_all on public.users for all using (public.is_admin()) with check (public.is_admin());

-- categories (public read, staff write, admin delete)
drop policy if exists categories_read on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists categories_update on public.categories;
drop policy if exists categories_delete on public.categories;
create policy categories_read on public.categories for select using (true);
create policy categories_insert on public.categories for insert with check (public.is_staff());
create policy categories_update on public.categories for update using (public.is_staff()) with check (public.is_staff());
create policy categories_delete on public.categories for delete using (public.is_admin());

-- products
drop policy if exists products_read on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;
create policy products_read on public.products for select using (true);
create policy products_insert on public.products for insert with check (public.is_staff());
create policy products_update on public.products for update using (public.is_staff()) with check (public.is_staff());
create policy products_delete on public.products for delete using (public.is_admin());

-- suppliers (staff only)
drop policy if exists suppliers_select on public.suppliers;
drop policy if exists suppliers_insert on public.suppliers;
drop policy if exists suppliers_update on public.suppliers;
drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_select on public.suppliers for select using (public.is_staff());
create policy suppliers_insert on public.suppliers for insert with check (public.is_staff());
create policy suppliers_update on public.suppliers for update using (public.is_staff()) with check (public.is_staff());
create policy suppliers_delete on public.suppliers for delete using (public.is_admin());

-- inventory_logs (staff only, append-only)
drop policy if exists inventory_select on public.inventory_logs;
drop policy if exists inventory_insert on public.inventory_logs;
create policy inventory_select on public.inventory_logs for select using (public.is_staff());
create policy inventory_insert on public.inventory_logs for insert with check (public.is_staff());

-- orders (customers see their own; orders are created by place_order())
drop policy if exists orders_select on public.orders;
drop policy if exists orders_update on public.orders;
create policy orders_select on public.orders for select using (customer_id = auth.uid() or public.is_staff());
create policy orders_update on public.orders for update using (public.is_staff()) with check (public.is_staff());

-- order_items
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select using (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and (o.customer_id = auth.uid() or public.is_staff())
  )
);

-- ============ REALTIME: let storefronts see stock change live ============
do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
