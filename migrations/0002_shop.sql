create table if not exists shop_settings (
  key text primary key,
  value text not null
);

create table if not exists shop_orders (
  id text primary key,
  number text not null,
  created_at timestamptz not null default now(),
  status text not null default 'new',
  buyer_name text not null,
  buyer_email text not null,
  note text not null default '',
  items_json text not null,
  subtotal integer not null,
  discount integer not null default 0,
  tax integer not null default 0,
  shipping integer not null default 0,
  total integer not null,
  shipping_json text,
  stripe_session_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz
);
