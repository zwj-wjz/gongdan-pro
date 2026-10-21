-- ============================================================================
-- 施工单 Pro 附加迁移（在 gongdan-vercel/supabase/migration.sql 之后执行）
--
-- 作用：
--   1. work_orders 增加 车主电话 / 施工日期 / 备注 三列（不建也能用，页面会自动降级）
--   2. 新建 inventory 耗材库存表（不建也能用，库存会存在浏览器本地）
--
-- 用法：Supabase Dashboard → SQL Editor → 整段粘贴执行（可重复执行）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. work_orders 扩展列
-- ---------------------------------------------------------------------------
alter table public.work_orders add column if not exists customer_phone text;
alter table public.work_orders add column if not exists work_date date;
alter table public.work_orders add column if not exists remark text;


-- ---------------------------------------------------------------------------
-- 2. 耗材库存表
-- ---------------------------------------------------------------------------
create table if not exists public.inventory (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    name       text not null,
    unit       text not null default '件',
    qty        numeric(10, 2) not null default 0,
    updated_at timestamptz not null default now(),
    constraint inventory_user_name_key unique (user_id, name)
);

create index if not exists inventory_user_idx on public.inventory (user_id);

alter table public.inventory enable row level security;
alter table public.inventory force row level security;

do $$
declare
    p record;
begin
    for p in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = 'inventory'
    loop
        execute format('drop policy %I on public.inventory', p.policyname);
    end loop;
end $$;

create policy "inventory_select_own"
    on public.inventory for select to authenticated
    using (user_id = auth.uid());

create policy "inventory_insert_own"
    on public.inventory for insert to authenticated
    with check (user_id = auth.uid());

create policy "inventory_update_own"
    on public.inventory for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy "inventory_delete_own"
    on public.inventory for delete to authenticated
    using (user_id = auth.uid());

revoke all on table public.inventory from anon;
grant select, insert, update, delete on table public.inventory to authenticated;


-- ---------------------------------------------------------------------------
-- 3. 自检
-- ---------------------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'work_orders'
order by ordinal_position;

select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'inventory'
order by cmd;
