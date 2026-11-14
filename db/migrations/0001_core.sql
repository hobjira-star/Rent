-- Core schema for release 1 (ARCHITECTURE.md sections 5, 6, 7, 11).
-- Business dates are Asia/Bangkok calendar dates (type date); instants are timestamptz.
-- Money is integer satang (bigint).

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create schema if not exists app;
create schema if not exists reporting;

-- Runtime role used by the web app. It does not own tables, cannot bypass RLS,
-- and may only insert/select on the append-only logs.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin noinherit;
  end if;
end $$;

set search_path = app, public;

-- ---------------------------------------------------------------- parties
create table organization (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('PLATFORM', 'SHOP', 'LENDER')),
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz not null default now()
);

create table location (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  kind text not null check (kind in ('SHOP', 'WAREHOUSE', 'RACK', 'LENDER_HOME')),
  label text not null,
  parent_id uuid references location(id)
);

create table party (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text unique check (phone_e164 ~ '^\+66[0-9]{8,9}$'),
  line_user_id text unique,
  birth_date_declared date,
  birth_date_verified date,
  created_at timestamptz not null default now()
);

create table identity_verification (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references party(id),
  method text not null check (method in ('EKYC', 'COUNTER')),
  result text not null check (result in ('PASSED', 'FAILED')),
  -- Encrypted in the application with a key outside the database.
  name_enc bytea not null,
  id_number_enc bytea not null,
  address_on_card_enc bytea,
  current_address_enc bytea,
  id_hmac bytea not null,
  key_version int not null,
  consent_face_match boolean not null default false,
  card_photo_path text,
  handover_photo_path text,
  photos_delete_after date,
  verified_by uuid,
  verified_at timestamptz not null default now()
);
-- One national ID number belongs to exactly one party (PLAN.md 3.3 layer 1).
create unique index identity_one_party_per_id on identity_verification (id_hmac)
  where result = 'PASSED';
create or replace function app.identity_same_party() returns trigger language plpgsql as $$
begin
  if exists (select 1 from app.identity_verification v
             where v.id_hmac = new.id_hmac and v.party_id <> new.party_id and v.result = 'PASSED') then
    raise exception 'ID number already belongs to another account' using errcode = 'unique_violation';
  end if;
  return new;
end $$;
create trigger identity_same_party before insert on identity_verification
  for each row execute function app.identity_same_party();

create table party_bank_account (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references party(id),
  bank_code text not null,
  account_number_enc bytea not null,
  account_hmac bytea not null,
  holder_name text not null,
  check_method text not null check (check_method in ('ONE_BAHT', 'API', 'BANK_APP_NAME')),
  verified_at timestamptz,
  verified_by uuid,
  unique (party_id, account_hmac)
);

-- ---------------------------------------------------------------- catalogue and units
create table policy_version (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  document jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table category (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null
);

create table product (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references category(id),
  title_th text not null,
  brand text,
  size_label text,
  colour text,
  attributes jsonb not null default '{}',
  price_tiers jsonb not null, -- [{ "days": 4, "price": 90000 }]
  created_at timestamptz not null default now()
);

create table unit (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references product(id),
  serial text not null unique,
  qr_token text not null unique,
  owner_org_id uuid not null references organization(id),
  operator_org_id uuid not null references organization(id),
  custody_location_id uuid not null references location(id),
  merchant_of_record_org_id uuid not null references organization(id),
  mode text not null default 'OWN' check (mode in ('OWN', 'LENDER_MANAGED', 'PLATFORM_MANAGED')),
  agreed_value bigint not null check (agreed_value > 0),
  acquisition_cost bigint check (acquisition_cost >= 0),
  grade text not null default 'A' check (grade in ('A', 'B', 'C', 'D', 'X')),
  completed_rentals int not null default 0,
  weight_g int,
  measurements jsonb not null default '{}', -- bust/waist/hip/stretch/shoulder_to_hem in cm
  components text[] not null default '{}',
  status text not null default 'IN_STOCK' check (status in
    ('IN_STOCK', 'OUT', 'RECEIVED', 'INSPECTING', 'CLEANING', 'REPAIR', 'LOST', 'RETIRED', 'RETURNED_TO_OWNER')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- bookings and availability
create table booking (
  id uuid primary key default gen_random_uuid(),
  renter_party_id uuid not null references party(id),
  unit_id uuid not null references unit(id),
  merchant_of_record_org_id uuid not null references organization(id),
  status text not null check (status in
    ('PENDING_PAYMENT', 'EXPIRED', 'CONFIRMED', 'HANDED_OVER', 'RETURNED', 'NON_RETURN', 'CANCELLED', 'CLOSED')),
  rent_start date not null,
  rent_end date not null, -- inclusive last day of use
  due_at timestamptz not null,
  fulfilment text not null check (fulfilment in ('PICKUP', 'SHOP_DELIVERY', 'MESSENGER', 'PARCEL')),
  rent bigint not null check (rent >= 0),
  deposit_required bigint not null check (deposit_required >= 0),
  agreed_value_snapshot bigint not null,
  policy_version int not null references policy_version(version),
  price_snapshot jsonb not null,
  contract_version int,
  contract_accept_method text check (contract_accept_method in ('PAPER', 'OTP_SESSION', 'ONE_TIME_LINK')),
  contract_accepted_at timestamptz,
  proxy_name text,
  guardian_party_id uuid references party(id),
  flags jsonb not null default '[]',
  flags_cleared_by uuid,
  replaces_booking_id uuid references booking(id),
  channel text,
  created_by text not null check (created_by in ('CUSTOMER', 'STAFF')),
  created_at timestamptz not null default now(),
  check (rent_end >= rent_start)
);

create table availability_block (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references unit(id),
  booking_id uuid references booking(id),
  period daterange not null,
  kind text not null check (kind in ('HOLD', 'BOOKING', 'MAINTENANCE')),
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (lower_inc(period) and not upper_inc(period)),
  check ((kind = 'HOLD') = (expires_at is not null))
);
-- The database itself prevents double booking (PLAN.md principle 3).
alter table availability_block add constraint no_double_booking
  exclude using gist (unit_id with =, period with &&) where (status = 'active');

-- Lazy expiry: a booking transaction calls this for the unit before inserting its own block.
create or replace function app.expire_stale_holds(p_unit uuid) returns int language plpgsql as $$
declare n int;
begin
  with expired as (
    update app.availability_block
       set status = 'expired'
     where unit_id = p_unit and status = 'active' and kind = 'HOLD' and expires_at <= now()
     returning booking_id
  )
  update app.booking b set status = 'EXPIRED'
    from expired e where b.id = e.booking_id and b.status = 'PENDING_PAYMENT';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- money
create table payment (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking(id),
  provider text not null check (provider in ('OPN', 'STRIPE', 'EXTERNAL_TRANSFER')),
  provider_ref text,
  method text not null check (method in ('PROMPTPAY', 'CARD', 'BANK_TRANSFER')),
  amount bigint not null check (amount > 0),
  status text not null check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTLY_REFUNDED')),
  payer_name text,
  card_last4 text,
  confirmed_by uuid,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref),
  check (provider <> 'EXTERNAL_TRANSFER' or status <> 'SUCCEEDED' or (payer_name is not null and confirmed_by is not null))
);

create table webhook_event (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table deposit (
  booking_id uuid primary key references booking(id),
  amount bigint not null check (amount >= 0),
  status text not null check (status in
    ('REQUIRED', 'HELD', 'HELD_PENDING_CLEANING', 'RELEASING', 'REFUNDED', 'PARTLY_APPLIED', 'FORFEITED')),
  return_gate_passed_at timestamptz,
  -- Money may leave only after the return gate has passed (ARCHITECTURE.md section 7).
  check (status not in ('RELEASING', 'HELD_PENDING_CLEANING', 'REFUNDED', 'PARTLY_APPLIED') or return_gate_passed_at is not null)
);

create table refund (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking(id),
  payment_id uuid not null references payment(id),
  amount bigint not null check (amount > 0),
  route text not null check (route in ('CARD_ORIGINAL', 'PROVIDER_API', 'BANK_TRANSFER')),
  bank_account_id uuid references party_bank_account(id),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'CONFIRMED', 'FAILED')),
  proof_path text,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (route <> 'BANK_TRANSFER' or bank_account_id is not null)
);
-- Card payments are refunded to the original card only (PLAN.md 3.3 layer 3).
create or replace function app.refund_route_matches_payment() returns trigger language plpgsql as $$
declare m text;
begin
  select method into m from app.payment where id = new.payment_id;
  if m = 'CARD' and new.route <> 'CARD_ORIGINAL' then
    raise exception 'card payments can only be refunded to the original card' using errcode = 'check_violation';
  end if;
  if new.route = 'BANK_TRANSFER' and not exists (
       select 1 from app.party_bank_account a join app.booking b on b.renter_party_id = a.party_id
        where a.id = new.bank_account_id and b.id = new.booking_id and a.verified_at is not null) then
    raise exception 'bank refunds go only to a verified account of the renter' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger refund_route before insert or update on refund
  for each row execute function app.refund_route_matches_payment();

create table journal (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references booking(id),
  memo text not null,
  created_at timestamptz not null default now()
);
create table ledger_entry (
  id bigserial primary key,
  journal_id uuid not null references journal(id),
  account text not null check (account in (
    'BANK', 'GATEWAY_CLEARING', 'DEPOSIT_LIABILITY', 'REFUNDS_PAYABLE', 'RENTER_RECEIVABLE',
    'RENTAL_REVENUE', 'PENALTY_REVENUE', 'GATEWAY_FEES', 'CLEANING', 'REPAIR', 'SHIPPING',
    'PACKAGING', 'DISCOUNTS', 'BAD_DEBT', 'LOST_GARMENTS')),
  amount bigint not null check (amount <> 0) -- positive = debit, negative = credit
);
create or replace function app.journal_balances() returns trigger language plpgsql as $$
begin
  if (select coalesce(sum(amount), 0) from app.ledger_entry where journal_id = new.journal_id) <> 0 then
    raise exception 'journal % does not balance', new.journal_id using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger journal_balances after insert or update on ledger_entry
  deferrable initially deferred for each row execute function app.journal_balances();

-- ---------------------------------------------------------------- append-only logs
create table domain_event (
  id bigserial primary key,
  module text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  type text not null,
  actor text,
  payload jsonb not null default '{}',
  evidence_ids uuid[] not null default '{}',
  occurred_at timestamptz not null default now()
);
create table audit_log (
  id bigserial primary key,
  actor uuid not null,
  action text not null,
  subject_type text not null,
  subject_id uuid,
  detail jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create or replace function app.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;
create trigger domain_event_append_only before update or delete on domain_event
  for each row execute function app.forbid_change();
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function app.forbid_change();
create trigger domain_event_no_truncate before truncate on domain_event
  for each statement execute function app.forbid_change();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function app.forbid_change();

-- ---------------------------------------------------------------- grants
grant usage on schema app, reporting to app_runtime;
grant select, insert, update on all tables in schema app to app_runtime;
revoke update, delete, truncate on app.domain_event, app.audit_log from app_runtime;
grant usage on all sequences in schema app to app_runtime;
grant execute on function app.expire_stale_holds(uuid) to app_runtime;
