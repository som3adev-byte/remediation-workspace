#!/bin/sh
# Runs once, on the first start of an empty Postgres volume.
# Two roles:
#   app_owner  owns the databases and schema; runs migrations, seed and test resets.
#   app_user   runtime role; owns nothing and has no BYPASSRLS, so row-level security applies.
set -eu

psql -v ON_ERROR_STOP=1 --username postgres \
  -v owner_pw="$APP_OWNER_PASSWORD" -v user_pw="$APP_USER_PASSWORD" <<'SQL'
CREATE ROLE app_owner LOGIN CREATEDB PASSWORD :'owner_pw';
CREATE ROLE app_user  LOGIN PASSWORD :'user_pw';
CREATE DATABASE remediation      OWNER app_owner;
CREATE DATABASE remediation_test OWNER app_owner;
SQL

for db in remediation remediation_test; do
  psql -v ON_ERROR_STOP=1 --username postgres --dbname "$db" <<'SQL'
-- On Postgres 15+ the public schema belongs to the database owner (app_owner).
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user;
-- Tables app_owner creates later are readable and writable by app_user.
-- No DELETE by default: deletion is out of scope. The RLS migration grants DELETE on login_attempts only.
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
SQL
done
