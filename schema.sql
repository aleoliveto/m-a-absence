create extension if not exists pgcrypto;

create table if not exists employee (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  first_name text,
  last_name text,
  base text,
  department text,
  role_code text,
  status text default 'active',
  hire_date date,
  manager_email text
);

create table if not exists absence_reason (
  code text primary key,
  label text not null,
  reportable boolean default true,
  paid boolean default true
);

insert into absence_reason (code,label,reportable,paid) values
  ('SICK','Sickness (short-term)',true,true),
  ('STRESS','Stress-related sickness',true,true),
  ('MED_APPT','Medical appointment',false,true),
  ('FAMILY','Family emergency/dependants',false,true),
  ('BEREAVE','Bereavement',true,true),
  ('UNAUTH','Unauthorised absence',true,false),
  ('OTHER','Other',true,false)
on conflict (code) do nothing;

create table if not exists absence (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employee(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason_code text references absence_reason(code),
  notes text,
  source text,
  created_by text,
  created_at timestamptz default now()
);
