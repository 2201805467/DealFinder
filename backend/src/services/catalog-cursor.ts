import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../utils/app-error.js';
import type { CatalogQuery } from './catalog-query.js';
const payload = z
  .object({
    version: z.literal(1),
    filter: z.string().length(64),
    startedAt: z.iso.datetime(),
    lastUpdatedAt: z.iso.datetime(),
    id: z.uuid(),
  })
  .strict();
type Cursor = z.infer<typeof payload>;
function fingerprint(q: CatalogQuery) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        q.q ?? null,
        q.categoryId ?? null,
        q.merchantId ?? null,
        q.market ?? null,
        q.currency ?? null,
        q.minPrice ?? null,
        q.maxPrice ?? null,
        q.view ?? 'discounted',
        q.sort,
        q.pageSize,
      ]),
    )
    .digest('hex');
}
export function decodeCatalogCursor(
  token: string | undefined,
  q: CatalogQuery,
  now: Date,
): Cursor | undefined {
  if (!token) return undefined;
  try {
    if (token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error();
    const value = payload.parse(
      JSON.parse(Buffer.from(token, 'base64url').toString('utf8')),
    );
    const started = Date.parse(value.startedAt);
    if (
      value.filter !== fingerprint(q) ||
      started > now.getTime() ||
      now.getTime() - started > 15 * 60 * 1000 ||
      Date.parse(value.lastUpdatedAt) > started
    )
      throw Error();
    return value;
  } catch {
    throw new AppError(
      400,
      'INVALID_CURSOR',
      'Cursor is invalid, expired or belongs to different filters.',
    );
  }
}
export function encodeCatalogCursor(
  q: CatalogQuery,
  startedAt: Date,
  last: { id: string; last_updated_at: Date },
) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      filter: fingerprint(q),
      startedAt: startedAt.toISOString(),
      lastUpdatedAt: last.last_updated_at.toISOString(),
      id: last.id,
    }),
  ).toString('base64url');
}
