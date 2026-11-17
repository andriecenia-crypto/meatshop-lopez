# PrimeCut: Meatshop Inventory and Ordering

A small-business web app for butcher shops. Customers browse cuts and order by weight. Staff manage stock, suppliers and fulfillment.

**Stack:** HTML/CSS/vanilla JS + Supabase JS SDK (auth), Flask + `supabase-py` (API), Supabase PostgreSQL.

## Features
- Supabase signup/login with role-based redirect (customer dashboard vs back office)
- Cuts CRUD, prices, stock in kilograms, categories
- Customers order any weight in 250 g steps; stock is deducted atomically in Postgres (`place_order`), so two buyers can't take the same last kilos
- Cancelling an order puts the meat back in stock (`cancel_order`)
- Receive deliveries from suppliers (`receive_stock`), with an inventory log
- Low-stock warnings and best sellers on the admin overview; live stock updates on the shop via Supabase Realtime
- Email notifications over SMTP (logged to the console until `SMTP_HOST` is set)

## Setup
1. **Create a Supabase project**, then in the SQL editor run `database/schema.sql` and then `database/seed.sql`.
2. In Supabase **Authentication > Providers > Email**, turn off "Confirm email" while testing (or keep it on and confirm via your inbox).
3. Copy the env file and fill it in from **Project Settings > API**:
   ```bash
   cp .env.example .env
   ```
4. Install and run:
   ```bash
   python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python -m backend.app
   ```
   Open http://localhost:5000.
5. **Make yourself an admin.** Sign up through the app, then run in the SQL editor:
   ```sql
   update public.users set role = 'admin' where email = 'you@example.com';
   ```
   Sign in again and you'll land in the back office. Admins can promote others under **Team**.

## Deploy to Render
1. Push the repo to GitHub.
2. In Render choose **New > Blueprint** and select the repo (it reads `render.yaml`).
3. Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` when prompted.
4. In Supabase **Authentication > URL Configuration**, add your Render URL as the Site URL.

## Security notes
- The service-role key is used only by the Flask server. The browser gets the anon key from `/api/config`.
- New accounts are always `customer`. Role changes happen only through admin endpoints or SQL.
- Row Level Security is on for all seven tables. Stock-changing functions can only be run by the service role.
- Every API route verifies the Supabase JWT and checks the role.

## Project layout
```
backend/   Flask app, blueprints (auth, products, orders, admin), notification service
database/  schema.sql (tables, indexes, RLS, functions) and seed.sql
frontend/  HTML, CSS and JS for landing, auth, customer dashboard and back office
```

## API summary
| Method | Path | Access |
|---|---|---|
| GET | `/api/config`, `/api/categories`, `/api/products` | public |
| POST/PUT | `/api/products`, `/api/categories` | staff, admin |
| DELETE | `/api/products/<id>` | admin |
| POST | `/api/orders` | signed in |
| GET | `/api/orders/mine` | signed in |
| POST | `/api/orders/<id>/cancel` | order owner |
| GET | `/api/admin/stats`, `/orders`, `/inventory`, `/suppliers` | staff, admin |
| PATCH | `/api/admin/orders/<id>` | staff, admin |
| POST | `/api/admin/inventory` | staff, admin |
| CRUD | `/api/admin/suppliers` | staff (delete: admin) |
| GET/PATCH | `/api/admin/users` | admin |
