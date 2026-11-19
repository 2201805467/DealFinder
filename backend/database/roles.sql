-- Run with an administrative connection and psql ON_ERROR_STOP=1.
-- Required variables: app_role, migration_role, admin_role.
-- Group roles only: no passwords or production LOGIN credentials are created.
SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', name)
FROM (VALUES (:'app_role'), (:'migration_role'), (:'admin_role')) AS wanted(name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=wanted.name) \gexec

-- Refuse to silently reuse a role with broader attributes or existing memberships.
SELECT 1 / CASE WHEN count(*)=3 AND bool_and(NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin) THEN 1 ELSE 0 END AS safe_roles
FROM pg_roles WHERE rolname IN (:'app_role',:'migration_role',:'admin_role');
SELECT 1 / CASE WHEN count(*)=0 THEN 1 ELSE 0 END AS isolated_app_role
FROM pg_auth_members JOIN pg_roles ON pg_roles.oid=member WHERE rolname=:'app_role';
GRANT :"migration_role" TO :"admin_role" WITH INHERIT FALSE, SET TRUE;
