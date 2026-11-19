-- Run AFTER migrations; review this explicit allow-list when adding tables.
-- Do not grant ALL TABLES/default future-table privileges to the application.
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  merchants, categories, products, offers, sync_runs TO :"app_role";
REVOKE ALL ON TABLE _prisma_migrations FROM :"app_role";
-- UUID identifiers require no sequence grants. No TRUNCATE, REFERENCES, DDL,
-- database/schema CREATE, role management, replication or bypass-RLS is granted.
