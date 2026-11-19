-- Connect ONLY to a new/dedicated target database; do not run against the local
-- development database. Required: database_name, app_role, migration_role, admin_role.
SELECT 1 / CASE WHEN current_database()=:'database_name' THEN 1 ELSE 0 END AS target_database;
ALTER DATABASE :"database_name" OWNER TO :"admin_role";
REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO :"app_role", :"migration_role", :"admin_role";
-- CREATE on THIS database permits trusted pg_trgm installation and schemas,
-- not CREATE DATABASE. The migration role still has NOCREATEDB/NOCREATEROLE.
GRANT CREATE ON DATABASE :"database_name" TO :"migration_role";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO :"migration_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
