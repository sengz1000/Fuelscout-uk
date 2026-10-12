-- FuelScout UK: community fuel reports (Supabase SQL editor)
-- Reports are pending moderation by default; never treat them as verified official prices.
create table if not exists public.fuel_reports (
  id uuid primary key default gen_random_uuid(),
  station_name text not null check (char_length(station_name) between 2 and 120),
  postcode text not null check (char_length(postcode) between 5 and 10),
  fuel_type text not null check (fuel_type in ('E10','E5','B7','other')),
  price_ppl numeric(5,1) not null check (price_ppl >= 50 and price_ppl <= 400),
  observed_at timestamptz not null,
  notes text check (notes is null or char_length(notes) <= 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected','stale')),
  created_at timestamptz not null default now()
);
create index if not exists fuel_reports_postcode_created_idx on public.fuel_reports (postcode, created_at desc);
create index if not exists fuel_reports_status_observed_idx on public.fuel_reports (status, observed_at desc);
alter table public.fuel_reports enable row level security;
-- No public table policies: browser clients cannot read/write the table directly.
-- Netlify serverless functions use the service role key stored as a server-side environment variable.
