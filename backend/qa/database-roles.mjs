// Integration check: temporary LOCAL database and ephemeral credentials only.
// No persistent login, password, Docker config or development role is modified.
import 'dotenv/config';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../dist/database/client.js';
import { OfferIngestionService } from '../dist/services/offer-ingestion.js';
import { CatalogService } from '../dist/services/catalog.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';
const development = new URL(process.env.DATABASE_URL);
const tag = 'qa_' + randomBytes(6).toString('hex');
const names = {
  app: tag + '_app',
  migration: tag + '_migration',
  admin: tag + '_admin',
  appLogin: tag + '_app_login',
  migrationLogin: tag + '_migration_login',
  adminLogin: tag + '_admin_login',
};
const name = 'dealfinder_permissions_' + Date.now() + '_test';
const url = new URL(development);
url.pathname = '/' + name;
assertTestDatabase(url.href, development.href);
const owner = createDatabaseClient(development.href);
const report = {
  checkedAt: new Date().toISOString(),
  database: name,
  temporaryRoles: Object.values(names),
  checks: [],
};
let app,
  created = false,
  rolesOwned = false;
function require(value, message) {
  if (!value) throw Error(message);
}
function psql(file) {
  const args = [
    'exec',
    '-i',
    'dealfinder-postgres-1',
    'psql',
    '-X',
    '-q',
    '--username',
    decodeURIComponent(development.username),
    '--dbname',
    name,
    '--set=ON_ERROR_STOP=1',
    '--set=database_name=' + name,
    '--set=app_role=' + names.app,
    '--set=migration_role=' + names.migration,
    '--set=admin_role=' + names.admin,
  ];
  const result = spawnSync('docker', args, {
    input: fs.readFileSync(file),
    encoding: 'utf8',
    timeout: 15000,
  });
  require(result.status === 0, 'Role SQL failed: ' + file);
  report.checks.push({ check: file, passed: true });
}
function hasPermissionCode(error) {
  if (!error || typeof error !== 'object') return false;
  for (const [key, value] of Object.entries(error)) {
    if (/code/i.test(key) && String(value) === '42501') return true;
    if (value && typeof value === 'object' && hasPermissionCode(value))
      return true;
  }
  return false;
}
try {
  const existing = await owner.$queryRawUnsafe(
    'SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',
    Object.values(names),
  );
  require(existing.length ===
    0, 'Temporary role collision; refusing to reuse roles');
  await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  psql('database/roles.sql');
  rolesOwned = true;
  psql('database/database-privileges.sql');
  const appPassword = randomBytes(24).toString('hex'),
    migrationPassword = randomBytes(24).toString('hex'),
    adminPassword = randomBytes(24).toString('hex');
  for (const [role, password, group] of [
    [names.appLogin, appPassword, names.app],
    [names.migrationLogin, migrationPassword, names.migration],
    [names.adminLogin, adminPassword, names.admin],
  ]) {
    await owner.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${password}'`,
    );
    await owner.$executeRawUnsafe(`GRANT "${group}" TO "${role}"`);
  }
  const migrationUrl = new URL(url);
  migrationUrl.username = names.migrationLogin;
  migrationUrl.password = migrationPassword;
  migrationUrl.searchParams.set('options', '-c role=' + names.migration);
  const migrated = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    {
      env: {
        ...process.env,
        DATABASE_URL: migrationUrl.href,
        MIGRATION_DATABASE_URL: migrationUrl.href,
      },
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  require(migrated.status ===
    0, 'Prisma migrations failed under isolated migration login');
  report.checks.push({
    check: 'Prisma migrate deploy using non-superuser migration login and role',
    passed: true,
  });
  psql('database/application-privileges.sql');
  const appUrl = new URL(url);
  appUrl.username = names.appLogin;
  appUrl.password = appPassword;
  app = createDatabaseClient(appUrl.href);
  const [privileges] =
    await app.$queryRaw`SELECT current_user AS login,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
   has_schema_privilege(current_user,'public','CREATE') AS schema_create,
   has_database_privilege(current_database(),'CREATE') AS database_create,
   has_database_privilege(current_database(),'TEMP') AS temporary_tables,
   pg_has_role(current_user,'pg_read_server_files','MEMBER') AS read_server_files
   FROM pg_roles WHERE rolname=current_user`;
  report.application = privileges;
  for (const [key, value] of Object.entries(privileges))
    if (key !== 'login')
      require(value === false, 'Excess application privilege: ' + key);
  const merchant = await app.merchant.create({
    data: {
      name: 'SYNTHETIC isolated role test',
      sourceType: 'SYNTHETIC',
      websiteUrl: 'https://' + tag + '.example.invalid',
      enabled: true,
      storageAuthorized: true,
      isSynthetic: true,
      retentionSeconds: 3600,
    },
  });
  const ingested = await new OfferIngestionService(app, 'test').ingest(
    merchant.id,
    [
      {
        product: {
          externalId: 'role-fixture',
          store: merchant.name,
          name: 'SYNTHETIC role fixture',
          currentPrice: 10,
          originalPrice: 100,
          currency: 'USD',
          availability: 'available',
          fetchedAt: new Date().toISOString(),
        },
      },
    ],
  );
  require(ingested.offerIds.length === 1, 'Application could not ingest');
  const result = await new CatalogService(app, true).deals({
    page: 1,
    pageSize: 20,
    sort: 'score_desc',
    currency: 'USD',
  });
  require(result.data.length ===
    1, 'Application could not read optimized catalogue');
  await app.offer.update({
    where: { id: ingested.offerIds[0] },
    data: { currentPrice: '9.99' },
  });
  await app.offer.delete({ where: { id: ingested.offerIds[0] } });
  report.checks.push({
    check:
      'Actual app login: ingestion, advisory locks, generated factors, catalogue SELECT, UPDATE, DELETE',
    passed: true,
  });
  const denied = [
    ['CREATE DATABASE', `CREATE DATABASE "${tag}_denied_test"`],
    ['CREATE ROLE', `CREATE ROLE "${tag}_denied_role"`],
    ['CREATE SCHEMA', `CREATE SCHEMA "${tag}_denied_schema"`],
    ['CREATE TABLE', 'CREATE TABLE public.qa_denied_table(id int)'],
    ['ALTER TABLE', 'ALTER TABLE offers ADD COLUMN qa_denied_column int'],
    ['TRUNCATE', 'TRUNCATE offers'],
    ['migration metadata', 'SELECT * FROM _prisma_migrations'],
    ['migration escalation', `SET ROLE "${names.migration}"`],
  ];
  for (const [label, sql] of denied) {
    let failure;
    try {
      await app.$executeRawUnsafe(sql);
    } catch (error) {
      failure = error;
    }
    require(hasPermissionCode(failure), 'Expected SQLSTATE42501 for ' + label);
    report.checks.push({
      check: 'Application denied ' + label,
      passed: true,
      sqlState: '42501',
    });
  }
  const adminUrl = new URL(url);
  adminUrl.username = names.adminLogin;
  adminUrl.password = adminPassword;
  const administrator = createDatabaseClient(adminUrl.href);
  try {
    await administrator.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${names.migration}"`);
      await tx.$executeRawUnsafe(
        'CREATE TABLE public.qa_admin_maintenance(id int)',
      );
      await tx.$executeRawUnsafe('DROP TABLE public.qa_admin_maintenance');
    });
    report.checks.push({
      check:
        'Actual administrative login can explicitly assume migration role for maintenance',
      passed: true,
    });
  } finally {
    await administrator.$disconnect();
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure =
    error?.constructor === Error
      ? error.message
      : 'Database role test failed; raw error withheld';
  process.exitCode = 1;
} finally {
  await app?.$disconnect();
  if (created) {
    await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    report.databaseRemoved = true;
  }
  if (rolesOwned) {
    // Names are generated here and checked absent before creation; never drop a pre-existing role.
    for (const role of [
      names.appLogin,
      names.migrationLogin,
      names.adminLogin,
      names.admin,
      names.app,
      names.migration,
    ])
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
    report.temporaryRolesRemoved = true;
  }
  await owner.$disconnect();
  fs.writeFileSync(
    '../docs/qa-evidence/database-roles.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
