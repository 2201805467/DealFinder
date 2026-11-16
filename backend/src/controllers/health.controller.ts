import type { RequestHandler } from 'express';

// Liveness only; database connectivity is checked separately with db:check.
export const getHealth: RequestHandler = (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'dealfinder-backend' });
};
