create unique index if not exists shop_orders_stripe_session_unique
  on shop_orders (stripe_session_id)
  where stripe_session_id is not null;
