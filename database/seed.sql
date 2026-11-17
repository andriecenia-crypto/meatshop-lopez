-- PrimeCut sample data. Run after schema.sql. Safe to run once on an empty database.
insert into public.categories (name, description) values
  ('Beef', 'Grass-fed and grain-finished cuts, aged in house'),
  ('Pork', 'Fresh local pork, cut daily'),
  ('Poultry', 'Free-range chicken and duck'),
  ('Exotics', 'Lamb, goat and specialty cuts')
on conflict (name) do nothing;

insert into public.suppliers (name, contact_person, phone, email, address) values
  ('Highland Ranch Co.', 'Marco Villanueva', '+63 917 555 0142', 'orders@highlandranch.example', 'Batangas, Philippines'),
  ('Sunrise Pork Farms', 'Liza Ramos', '+63 918 555 0199', 'liza@sunrisepork.example', 'Bulacan, Philippines'),
  ('Clearwater Poultry', 'Ben Aquino', '+63 920 555 0111', 'ben@clearwaterpoultry.example', 'Laguna, Philippines');

insert into public.products (category_id, name, description, price_per_kg, stock_weight_kg, low_stock_threshold_kg, image_url)
select c.id, v.name, v.description, v.price, v.stock, v.threshold, v.image
from (values
  ('Beef', 'Ribeye', 'Well-marbled, cut 2.5 cm thick. Best on a hot grill.', 1450.00, 18.500, 6.000, 'https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=800&q=80'),
  ('Beef', 'Ground Beef (80/20)', 'Ground fresh every morning from chuck and brisket.', 520.00, 32.000, 10.000, 'https://images.unsplash.com/photo-1603048297172-c92544798d5a?auto=format&fit=crop&w=800&q=80'),
  ('Beef', 'Tenderloin', 'The leanest, softest cut. Trimmed of silverskin.', 1850.00, 7.250, 4.000, 'https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=800&q=80'),
  ('Beef', 'Short Ribs', 'Bone-in, ideal for braising or Korean-style grilling.', 980.00, 14.000, 5.000, 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80'),
  ('Pork', 'Pork Belly', 'Skin-on slab with even fat layers for lechon kawali.', 460.00, 26.500, 8.000, 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?auto=format&fit=crop&w=800&q=80'),
  ('Pork', 'Pork Chops', 'Bone-in loin chops, 2 cm thick.', 420.00, 12.000, 5.000, 'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?auto=format&fit=crop&w=800&q=80'),
  ('Pork', 'Baby Back Ribs', 'Meaty, tender racks trimmed and ready to season.', 590.00, 9.500, 4.000, 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80'),
  ('Poultry', 'Whole Chicken', 'Free-range, about 1.5 kg each, cleaned.', 260.00, 40.000, 12.000, 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?auto=format&fit=crop&w=800&q=80'),
  ('Poultry', 'Chicken Thighs', 'Skin-on, bone-in. Juicy and forgiving.', 240.00, 22.000, 8.000, 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=800&q=80'),
  ('Exotics', 'Lamb Rack', 'Frenched, eight bones. Rosy in the middle.', 2100.00, 5.000, 3.000, 'https://images.unsplash.com/photo-1514516345957-556ca7d90a29?auto=format&fit=crop&w=800&q=80'),
  ('Exotics', 'Goat Shoulder', 'Bone-in, perfect for kaldereta and slow stews.', 780.00, 8.000, 4.000, 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=800&q=80')
) as v(cat, name, description, price, stock, threshold, image)
join public.categories c on c.name = v.cat;

insert into public.inventory_logs (product_id, supplier_id, quantity_added_kg, cost_price, received_date)
select p.id, s.id, v.qty, v.cost, current_date - v.days_ago
from (values
  ('Ribeye', 'Highland Ranch Co.', 20.000, 1050.00, 2),
  ('Ground Beef (80/20)', 'Highland Ranch Co.', 35.000, 380.00, 2),
  ('Pork Belly', 'Sunrise Pork Farms', 30.000, 310.00, 1),
  ('Whole Chicken', 'Clearwater Poultry', 45.000, 175.00, 1)
) as v(product, supplier, qty, cost, days_ago)
join public.products p on p.name = v.product
join public.suppliers s on s.name = v.supplier;

-- To make yourself an admin after signing up, run (replace the email):
-- update public.users set role = 'admin' where email = 'you@example.com';
