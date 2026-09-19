-- ============================================================================
-- ADDABAAZ — one-time database bootstrap
--
-- Run once, as a superuser (e.g. the `postgres` role):
--     psql -U postgres -f db/postgresql/00_create_database.sql
--
-- Change the password before using this anywhere real.
-- ============================================================================

create role addabaaz with login password 'addabaaz_dev_password';

create database addabaaz
    owner addabaaz
    encoding 'UTF8'
    lc_collate 'en_US.UTF-8'
    lc_ctype 'en_US.UTF-8'
    template template0;

\connect addabaaz

create schema if not exists public authorization addabaaz;

grant all privileges on database addabaaz to addabaaz;
grant all privileges on schema public to addabaaz;

-- gen_random_uuid() is built in from PostgreSQL 13 onwards; nothing to install.
