-- ============================================================================
-- ADDABAAZ — OTT seed data (roles, plans)
--
-- No users are seeded here: passwords are BCrypt hashed, so the first admin is
-- created by the backend on first boot (see addabaaz.bootstrap.admin in
-- application.yml). That keeps hashes out of version control.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
insert into role (code, name) values
    ('ROLE_USER', 'User'),
    ('ROLE_ADMIN', 'Administrator')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Subscription plans
-- ---------------------------------------------------------------------------
insert into plan (code, name, description, price_inr, currency, duration_days,
                  max_screens, quality, active) values
    ('FREE', 'Free', 'Watch promos, reels and behind-the-scenes for free.',
     0, 'INR', 0, 1, 'SD', true),
    ('MONTHLY', 'Monthly', 'Unlimited access to every ADDABAAZ original for a month.',
     199.00, 'INR', 30, 2, 'HD', true),
    ('QUARTERLY', 'Quarterly', 'Three months of unlimited streaming at a discount.',
     499.00, 'INR', 90, 3, 'FULL_HD', true),
    ('ANNUAL', 'Annual', 'A full year of ADDABAAZ originals — best value.',
     1499.00, 'INR', 365, 4, 'UHD', true)
on conflict (code) do update set
    name = excluded.name,
    description = excluded.description,
    price_inr = excluded.price_inr,
    duration_days = excluded.duration_days,
    max_screens = excluded.max_screens,
    quality = excluded.quality,
    active = excluded.active;

commit;
