-- Internal ledger only; creation does not grant a customer download.
-- Paid snapshot/access checks and atomic delivery allowances remain mandatory.
create table commerce_archive_jobs (
  id text primary key,
  order_id text not null references commerce_orders(id),
  customer_id text not null,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest)='array' and jsonb_array_length(manifest) between 1 and 500),
  status text not null default 'queued' check (status in ('queued','processing','retry','completed','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_token text,
  leased_until timestamptz,
  output_key text,
  output_checksum text check (output_checksum ~ '^[a-f0-9]{64}$'),
  output_bytes bigint check (output_bytes between 1 and 2147483648),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, customer_id, manifest_hash),
  check ((status='processing') = (lease_token is not null and leased_until is not null)),
  check (status <> 'completed' or (output_key is not null and output_checksum is not null and output_bytes is not null))
);
create index commerce_archive_jobs_customer on commerce_archive_jobs(customer_id, created_at desc, id);
create index commerce_archive_jobs_pending on commerce_archive_jobs(available_at, id) where status in ('queued','retry');
create index commerce_archive_jobs_stale on commerce_archive_jobs(leased_until, id) where status='processing';
