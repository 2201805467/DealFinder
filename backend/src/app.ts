import cors from 'cors';
import express from 'express';
import type { Environment } from './config/env.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';
import { catalogRouter } from './routes/catalog.js';
import type { CatalogService } from './services/catalog.js';
import {
  apiRateLimit,
  limitConcurrentRequests,
  securityHeaders,
} from './middleware/security.js';

export function createApp(
  config: Pick<Environment, 'CORS_ORIGINS'> &
    Partial<Pick<Environment, 'NODE_ENV' | 'API_RATE_LIMIT_MAX'>>,
  catalog?: CatalogService,
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('trust proxy', false);
  app.use(securityHeaders(config.NODE_ENV === 'production'));
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: false,
      methods: ['GET', 'HEAD', 'OPTIONS'],
    }),
  );
  app.use(apiRateLimit(config.API_RATE_LIMIT_MAX));
  app.use(limitConcurrentRequests());
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1', apiRouter);
  if (catalog) app.use('/api/v1', catalogRouter(catalog));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
