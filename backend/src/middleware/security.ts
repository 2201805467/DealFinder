import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';

export function securityHeaders(production = false) {
  return helmet({
    strictTransportSecurity: production ? {} : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}
export function apiRateLimit(max = 300) {
  return rateLimit({
    windowMs: 60_000,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT',
          message: 'Too many requests. Try again later.',
        },
      });
    },
  });
}
export function limitConcurrentRequests(max = 64): RequestHandler {
  let active = 0;
  return (req, res, next) => {
    if (req.path === '/api/v1/health') {
      next();
      return;
    }
    if (active >= max) {
      res.setHeader('Retry-After', '1');
      res.status(503).json({
        error: {
          code: 'SERVER_BUSY',
          message: 'Server is busy. Please retry shortly.',
        },
      });
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        active--;
        released = true;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}
