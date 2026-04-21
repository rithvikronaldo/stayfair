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
INSERT INTO accounts (org_id, code, name, type, currency) VALUES
    ('00000000-0000-0000-0000-000000000001', 'cash',           'Cash on Hand',        'asset',     'INR'),
    ('00000000-0000-0000-0000-000000000001', 'guest_payments', 'Guest Payments',      'asset',     'INR'),
    ('00000000-0000-0000-0000-000000000001', 'host_payable',   'Host Payable',        'liability', 'INR'),
    ('00000000-0000-0000-0000-000000000001', 'commission',     'Commission Revenue',  'revenue',   'INR'),
    ('00000000-0000-0000-0000-000000000001', 'gst_payable',    'GST Payable',         'liability', 'INR')
ON CONFLICT (org_id, code) DO NOTHING;
