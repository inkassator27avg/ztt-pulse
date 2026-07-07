alter table daily_entries add column if not exists telegram_joined integer default 0;
alter table daily_entries add column if not exists telegram_left integer default 0;
alter table daily_entries add column if not exists telegram_growth integer default 0;
