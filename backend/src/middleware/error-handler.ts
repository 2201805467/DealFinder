import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/app-error.js';

export const notFound: RequestHandler = (_request, response) => {
  response
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }

  const type =
    typeof error === 'object' && error !== null && 'type' in error
      ? error.type
      : undefined;
  if (type === 'entity.parse.failed') {
    response
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } });
    return;
  }
  if (type === 'entity.too.large') {
    response.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
    });
    return;
  }

  // Do not log raw errors, bodies, URLs, or query strings which can contain secrets.
  logger.error('Unhandled request error', { method: request.method });
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
};
