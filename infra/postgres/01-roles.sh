#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_pass="$HCC_DB_APP_PASSWORD" -v migrator_pass="$HCC_DB_MIGRATOR_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE hcc_migrator LOGIN PASSWORD %L', :'migrator_pass') \gexec
SELECT format('CREATE ROLE hcc_app LOGIN PASSWORD %L', :'app_pass') \gexec
CREATE SCHEMA IF NOT EXISTS hcc_data AUTHORIZATION hcc_migrator;
GRANT CONNECT ON DATABASE hcc_data TO hcc_migrator, hcc_app;
GRANT USAGE ON SCHEMA hcc_data TO hcc_app;
SQL
