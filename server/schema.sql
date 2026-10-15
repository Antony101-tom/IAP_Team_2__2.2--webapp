-- MediTrac database schema for Supabase (PostgreSQL).
--
-- How to run it: in your Supabase project open  SQL Editor > New query, paste this whole file
-- and click Run. It is safe to run more than once (nothing is dropped or overwritten).
-- It also runs on any ordinary PostgreSQL 13+ database.
--
-- Ids are UUID strings (text) so they match the API contract in openapi.yaml.

create table if not exists users (
    id             text primary key default gen_random_uuid()::text,
    name           text not null check (char_length(name) <= 150),
    email          text not null unique,
    password_hash  text not null,                       -- bcrypt hash, never plain text
    created_at     timestamptz not null default now()
);

create table if not exists pharmacies (
    id             text primary key default gen_random_uuid()::text,
    name           text not null check (char_length(name) <= 150),
    email          text not null unique,
    password_hash  text not null,
    phone          text check (char_length(phone) <= 30),          -- optional public contact details
    address        text check (char_length(address) <= 255),
    opening_hours  text check (char_length(opening_hours) <= 100),
    latitude       double precision check (latitude between -90 and 90),     -- set when the pharmacy pins its location
    longitude      double precision check (longitude between -180 and 180),
    created_at     timestamptz not null default now()
);
create index if not exists idx_pharmacies_name on pharmacies (lower(name));

create table if not exists medications (
    id           text primary key default gen_random_uuid()::text,
    name         text not null check (char_length(name) <= 150),
    form         text check (char_length(form) <= 100),
    category     text check (char_length(category) <= 80),
    quantity     integer not null default 0 check (quantity >= 0),
    unit         text check (char_length(unit) <= 30),
    price        numeric(10,2) not null check (price >= 0),
    branch       text check (char_length(branch) <= 150),
    sku          text check (char_length(sku) <= 64),    -- the pharmacy's own product code (lets uploads update instead of duplicate)
    pharmacy_id  text not null references pharmacies (id) on delete cascade,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (pharmacy_id, sku)                            -- several rows may have no sku (NULLs are distinct)
);
create index if not exists idx_medications_pharmacy on medications (pharmacy_id);
create index if not exists idx_medications_name on medications (lower(name));

-- Keep updated_at current whenever a medication changes
create or replace function set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
drop trigger if exists medications_set_updated_at on medications;
create trigger medications_set_updated_at before update on medications
    for each row execute function set_updated_at();

-- A patient "tracking" a specific pharmacy listing
create table if not exists tracked_medications (
    user_id        text not null references users (id) on delete cascade,
    medication_id  text not null references medications (id) on delete cascade,
    created_at     timestamptz not null default now(),
    primary key (user_id, medication_id)
);

-- SECURITY: Supabase automatically publishes every table in the "public" schema through a web
-- API that anyone holding the project's public (anon) key can call. These tables hold
-- password hashes, so switch on Row Level Security with NO policies: that blocks that public API
-- completely. The MediTrac server connects directly to the database as its owner, which is not
-- affected, so everything keeps working through the Express API.
alter table users enable row level security;
alter table pharmacies enable row level security;
alter table medications enable row level security;
alter table tracked_medications enable row level security;
