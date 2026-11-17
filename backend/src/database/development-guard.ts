import { AppError } from '../utils/app-error.js';

export function assertDevelopmentDatabase(
  environment: string | undefined,
  connectionString: string,
) {
  const url = new URL(connectionString);
  if (
    !['development', 'test'].includes(environment ?? '') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/(dealfinder|dealfinder_dev|[a-z0-9_]+_test)$/.test(url.pathname)
  ) {
    throw new AppError(
      403,
      'DEVELOPMENT_ONLY',
      'Synthetic seed is restricted to a named local development or test database.',
    );
  }
}

export function assertTestDatabase(
  testUrl: string | undefined,
  developmentUrl: string | undefined,
) {
  if (!testUrl || !developmentUrl)
    throw new Error(
      'Set TEST_DATABASE_URL and DATABASE_URL before integration tests.',
    );
  const test = new URL(testUrl);
  const development = new URL(developmentUrl);
  if (
    !/^\/[a-z0-9_]+_test$/.test(test.pathname) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(test.hostname) ||
    (test.pathname === development.pathname && test.port === development.port)
  ) {
    throw new Error(
      'Integration tests require a separate local database ending in _test.',
    );
  }
  return testUrl;
}
