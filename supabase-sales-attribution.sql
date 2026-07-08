create extension if not exists pgcrypto;

create table if not exists sales_attribution (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  source_message_id text unique,
  lookup_key text not null,
  telegram_user_id text,
  telegram_username text,
  tariff text,
  amount numeric(10, 2),
  joined_at date,
  days_to_purchase integer,
  raw_text text,
  member_payload jsonb default '{}'::jsonb,
  source text default 'telegram_bot',
  created_at timestamptz default now()
);

create index if not exists sales_attribution_sale_date_idx on sales_attribution (sale_date desc);
create index if not exists sales_attribution_username_idx on sales_attribution (telegram_username);
create index if not exists sales_attribution_user_id_idx on sales_attribution (telegram_user_id);
create index if not exists sales_attribution_days_idx on sales_attribution (days_to_purchase);

create or replace view sales_attribution_summary as
select
  count(*) as sales_count,
  count(days_to_purchase) as matched_sales_count,
  round(avg(days_to_purchase)::numeric, 1) as avg_days_to_purchase,
  percentile_cont(0.5) within group (order by days_to_purchase) as median_days_to_purchase
from sales_attribution;
