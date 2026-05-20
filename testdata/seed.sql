-- Demo seed data for local development and tests.
-- Idempotent: safe to re-run; existing rows are preserved via ON CONFLICT.

-- 4 supported currencies (ISO 4217). minor_unit_scale = 2 means
-- amounts are stored in the smallest unit (paise/cents) with 2 decimal places.
INSERT INTO currencies (code, minor_unit_scale) VALUES
    ('INR', 2),
    ('USD', 2),
    ('EUR', 2),
    ('GBP', 2)
ON CONFLICT (code) DO NOTHING;

-- 1 demo org with a fixed sentinel UUID so tests and demos can reference it
-- by a predictable ID instead of looking it up each time.
INSERT INTO orgs (id, name) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Demo Org')
ON CONFLICT (id) DO NOTHING;

-- 5 accounts for the Airbnb-style marketplace scenario described in
-- Rithvik-Ledger-Plain-English.html § 02. All in INR for now.
-- tenant_id is the demo tenant UUID seeded by migration 006.
INSERT INTO accounts (org_id, tenant_id, code, name, type, currency) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'cash',           'Cash on Hand',        'asset',     'INR'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'guest_payments', 'Guest Payments',      'asset',     'INR'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'host_payable',   'Host Payable',        'liability', 'INR'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'commission',     'Commission Revenue',  'revenue',   'INR'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'gst_payable',    'GST Payable',         'liability', 'INR'),
    -- Vendor pool accounts — counterparty for demo spend. One per supported
    -- currency. type=liability because the platform owes vendors the captured
    -- amounts (mirrors how Stripe routes platform → connected accounts).
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'vendor_pool_usd', 'Vendor Pool (USD)',  'liability', 'USD'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'vendor_pool_eur', 'Vendor Pool (EUR)',  'liability', 'EUR'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'vendor_pool_gbp', 'Vendor Pool (GBP)',  'liability', 'GBP'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'vendor_pool_inr', 'Vendor Pool (INR)',  'liability', 'INR'),
    -- Treasury pool — the platform's own wallet. Bootstrap funds each spawned
    -- account from treasury_pool_<ccy>. Starts at 0 and goes negative as we
    -- issue funding (semantically: platform draws on float). type=asset.
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'treasury_pool_usd', 'Treasury Pool (USD)', 'asset', 'USD'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'treasury_pool_eur', 'Treasury Pool (EUR)', 'asset', 'EUR'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'treasury_pool_gbp', 'Treasury Pool (GBP)', 'asset', 'GBP'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'treasury_pool_inr', 'Treasury Pool (INR)', 'asset', 'INR')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Historical FX rates between the four supported currencies. Stored as
-- point-in-time observations: ledger.LookupRate picks the row with the
-- largest as_of <= the requested timestamp. Three observations per pair
-- give the tests something meaningful to discriminate between.
--
-- Rates are illustrative — close to real Apr-2026 levels but not authoritative.
INSERT INTO fx_rates (from_currency, to_currency, rate, as_of) VALUES
    ('USD', 'INR',  82.5000000000, '2026-01-01 00:00:00+00'),
    ('USD', 'INR',  83.2500000000, '2026-03-01 00:00:00+00'),
    ('USD', 'INR',  84.1000000000, '2026-04-15 00:00:00+00'),
    ('INR', 'USD',   0.0121212121, '2026-01-01 00:00:00+00'),
    ('INR', 'USD',   0.0120120120, '2026-03-01 00:00:00+00'),
    ('INR', 'USD',   0.0118906064, '2026-04-15 00:00:00+00'),
    ('EUR', 'INR',  89.5000000000, '2026-01-01 00:00:00+00'),
    ('EUR', 'INR',  90.7500000000, '2026-04-15 00:00:00+00'),
    ('INR', 'EUR',   0.0111731844, '2026-01-01 00:00:00+00'),
    ('INR', 'EUR',   0.0110192837, '2026-04-15 00:00:00+00'),
    ('GBP', 'INR', 105.0000000000, '2026-01-01 00:00:00+00'),
    ('GBP', 'INR', 106.4000000000, '2026-04-15 00:00:00+00'),
    ('INR', 'GBP',   0.0095238095, '2026-01-01 00:00:00+00'),
    ('INR', 'GBP',   0.0093984962, '2026-04-15 00:00:00+00')
ON CONFLICT (from_currency, to_currency, as_of) DO NOTHING;
