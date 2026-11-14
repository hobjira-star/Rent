-- Behavioural checks for the core schema. Each block raises if a rule does not hold.
set search_path = app, public;
\set QUIET on
\o /dev/null

create function pg_temp.expect_error(stmt text, want_code text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = want_code then return; end if;
    raise exception 'FAIL %: expected SQLSTATE %, got % (%)', label, want_code, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL %: statement succeeded but should have failed', label;
end $$;

-- fixtures
insert into organization (id, kind, name) values ('00000000-0000-0000-0000-000000000001', 'SHOP', 'Rent');
insert into location (id, organization_id, kind, label) values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'SHOP', 'ร้าน');
insert into category (id, code, name_th) values ('00000000-0000-0000-0000-000000000020', 'evening', 'ชุดราตรี');
insert into product (id, category_id, title_th, price_tiers) values
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'ชุดราตรีซาติน', '[{"days":4,"price":90000}]');
insert into unit (id, product_id, serial, qr_token, owner_org_id, operator_org_id, custody_location_id, merchant_of_record_org_id, agreed_value)
values ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030', 'U-000001', 'qr1',
        '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 600000);
insert into party (id, phone_e164) values
  ('00000000-0000-0000-0000-000000000050', '+66812345678'),
  ('00000000-0000-0000-0000-000000000051', '+66812345679');
insert into policy_version (version, document) values (1, '{}');

create function pg_temp.new_booking(p_id uuid, p_status text) returns void language sql as $$
  insert into app.booking (id, renter_party_id, unit_id, merchant_of_record_org_id, status, rent_start, rent_end, due_at,
                           fulfilment, rent, deposit_required, agreed_value_snapshot, policy_version, price_snapshot, created_by)
  values (p_id, '00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000040',
          '00000000-0000-0000-0000-000000000001', p_status, '2026-12-11', '2026-12-14', '2026-12-14 16:59:59+00',
          'PICKUP', 90000, 180000, 600000, 1, '{}', 'CUSTOMER');
$$;

-- 1. Double booking is impossible for overlapping active blocks; touching ranges are fine.
select pg_temp.new_booking('00000000-0000-0000-0000-0000000000a1', 'CONFIRMED');
insert into availability_block (unit_id, booking_id, period, kind)
  values ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-0000000000a1', '[2026-12-09,2026-12-18)', 'BOOKING');
select pg_temp.expect_error(
  $q$insert into app.availability_block (unit_id, period, kind) values ('00000000-0000-0000-0000-000000000040', '[2026-12-17,2026-12-20)', 'MAINTENANCE')$q$,
  '23P01', 'overlapping block');
insert into availability_block (unit_id, period, kind) values ('00000000-0000-0000-0000-000000000040', '[2026-12-18,2026-12-20)', 'MAINTENANCE');

-- 2. A cancelled block frees the dates.
update availability_block set status = 'cancelled' where period = '[2026-12-18,2026-12-20)';
insert into availability_block (unit_id, period, kind) values ('00000000-0000-0000-0000-000000000040', '[2026-12-19,2026-12-21)', 'MAINTENANCE');

-- 3. Lazy expiry: an expired hold is marked expired (not deleted) and its booking moves to EXPIRED.
select pg_temp.new_booking('00000000-0000-0000-0000-0000000000a2', 'PENDING_PAYMENT');
insert into availability_block (unit_id, booking_id, period, kind, expires_at)
  values ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-0000000000a2', '[2027-01-05,2027-01-12)', 'HOLD', now() - interval '1 minute');
do $$ begin
  if app.expire_stale_holds('00000000-0000-0000-0000-000000000040') <> 1 then raise exception 'FAIL lazy expiry count'; end if;
  if (select status from app.booking where id = '00000000-0000-0000-0000-0000000000a2') <> 'EXPIRED' then raise exception 'FAIL booking not EXPIRED'; end if;
  if not exists (select 1 from app.availability_block where booking_id = '00000000-0000-0000-0000-0000000000a2' and status = 'expired') then
    raise exception 'FAIL block row should be kept with status expired'; end if;
end $$;
insert into availability_block (unit_id, period, kind) values ('00000000-0000-0000-0000-000000000040', '[2027-01-06,2027-01-08)', 'MAINTENANCE');

-- 4. One national ID number cannot sit on two accounts.
insert into identity_verification (party_id, method, result, name_enc, id_number_enc, id_hmac, key_version)
  values ('00000000-0000-0000-0000-000000000050', 'COUNTER', 'PASSED', 'x', 'x', 'hmac-1', 1);
select pg_temp.expect_error(
  $q$insert into app.identity_verification (party_id, method, result, name_enc, id_number_enc, id_hmac, key_version)
     values ('00000000-0000-0000-0000-000000000051', 'EKYC', 'PASSED', 'x', 'x', 'hmac-1', 1)$q$,
  '23505', 'same ID on a second account');

-- 5. Deposit cannot be released before the return gate passes.
insert into deposit (booking_id, amount, status) values ('00000000-0000-0000-0000-0000000000a1', 180000, 'HELD');
select pg_temp.expect_error(
  $q$update app.deposit set status = 'RELEASING' where booking_id = '00000000-0000-0000-0000-0000000000a1'$q$,
  '23514', 'release before return gate');
update deposit set return_gate_passed_at = now(), status = 'RELEASING' where booking_id = '00000000-0000-0000-0000-0000000000a1';

-- 6. Card payments are refunded to the original card only; bank refunds need a verified account of the renter.
insert into payment (id, booking_id, provider, provider_ref, method, amount, status, card_last4)
  values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'OPN', 'chrg_1', 'CARD', 270000, 'SUCCEEDED', '4242');
insert into party_bank_account (id, party_id, bank_code, account_number_enc, account_hmac, holder_name, check_method)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000050', 'KBANK', 'x', 'acct-1', 'ทดสอบ', 'ONE_BAHT');
select pg_temp.expect_error(
  $q$insert into app.refund (booking_id, payment_id, amount, route, bank_account_id, due_at)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 180000, 'BANK_TRANSFER', '00000000-0000-0000-0000-0000000000c1', now())$q$,
  '23514', 'card refunded by bank transfer');
insert into refund (booking_id, payment_id, amount, route, due_at)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 180000, 'CARD_ORIGINAL', now());
insert into payment (id, booking_id, provider, provider_ref, method, amount, status, payer_name)
  values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'OPN', 'chrg_2', 'PROMPTPAY', 270000, 'SUCCEEDED', 'ทดสอบ');
select pg_temp.expect_error(
  $q$insert into app.refund (booking_id, payment_id, amount, route, bank_account_id, due_at)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 180000, 'BANK_TRANSFER', '00000000-0000-0000-0000-0000000000c1', now())$q$,
  '23514', 'refund to an unverified account');
update party_bank_account set verified_at = now() where id = '00000000-0000-0000-0000-0000000000c1';
insert into refund (booking_id, payment_id, amount, route, bank_account_id, due_at)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 180000, 'BANK_TRANSFER', '00000000-0000-0000-0000-0000000000c1', now());

-- 7. A staff-confirmed transfer must record the payer name and who confirmed it.
select pg_temp.expect_error(
  $q$insert into app.payment (booking_id, provider, method, amount, status)
     values ('00000000-0000-0000-0000-0000000000a1', 'EXTERNAL_TRANSFER', 'BANK_TRANSFER', 270000, 'SUCCEEDED')$q$,
  '23514', 'external transfer without payer');

-- 8. Every journal balances at commit.
do $$
declare j uuid;
begin
  begin
    insert into app.journal (memo) values ('unbalanced') returning id into j;
    insert into app.ledger_entry (journal_id, account, amount) values (j, 'BANK', 1000);
    set constraints app.journal_balances immediate;
    raise exception 'FAIL unbalanced journal accepted';
  exception when check_violation then null;
  end;
end $$;
do $$
declare j uuid;
begin
  insert into app.journal (memo) values ('deposit received') returning id into j;
  insert into app.ledger_entry (journal_id, account, amount) values (j, 'GATEWAY_CLEARING', 180000), (j, 'DEPOSIT_LIABILITY', -180000);
  set constraints app.journal_balances immediate;
end $$;

-- 9. The event and audit logs are append-only, even for the table owner.
insert into domain_event (module, aggregate_type, aggregate_id, type) values ('rental', 'booking', '00000000-0000-0000-0000-0000000000a1', 'CONFIRMED');
select pg_temp.expect_error($q$update app.domain_event set type = 'X'$q$, '42501', 'update domain_event');
select pg_temp.expect_error($q$delete from app.domain_event$q$, '42501', 'delete domain_event');
select pg_temp.expect_error($q$truncate app.domain_event$q$, '42501', 'truncate domain_event');

-- 10. The runtime role cannot bypass RLS and has no update/delete on the logs.
do $$ begin
  if (select rolbypassrls or rolsuper from pg_roles where rolname = 'app_runtime') then raise exception 'FAIL app_runtime too privileged'; end if;
  if has_table_privilege('app_runtime', 'app.domain_event', 'UPDATE') or has_table_privilege('app_runtime', 'app.domain_event', 'DELETE')
     or has_table_privilege('app_runtime', 'app.audit_log', 'DELETE') then
    raise exception 'FAIL app_runtime can change the logs'; end if;
  if not has_table_privilege('app_runtime', 'app.domain_event', 'INSERT') then raise exception 'FAIL app_runtime cannot insert events'; end if;
end $$;

\o
\echo all checks ok
