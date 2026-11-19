import type { RequestHandler } from 'express';
import { CatalogService } from '../services/catalog.js';
import { parseCatalogQuery, parseId } from '../services/catalog-query.js';
import { AppError } from '../utils/app-error.js';

export function catalogControllers(service: CatalogService) {
  return {
    deals: (async (req, res) => {
      res.json(await service.deals(parseCatalogQuery(req.query)));
    }) as RequestHandler,
    deal: (async (req, res) => {
      res.json(await service.deal(parseId(req.params.id)));
    }) as RequestHandler,
    products: (async (req, res) => {
      const query = parseCatalogQuery(req.query);
      if (query.view !== undefined || query.pagination || query.cursor)
        throw new AppError(
          400,
          'INVALID_QUERY',
          'Deal selections and cursor pagination are available on /deals.',
        );
      res.json(await service.products(query));
    }) as RequestHandler,
    product: (async (req, res) => {
      res.json(
        await service.product(
          parseId(req.params.id),
          req.query.offerId === undefined
            ? undefined
            : parseId(req.query.offerId),
        ),
      );
    }) as RequestHandler,
    categories: (async (req, res) => {
      const query = parseCatalogQuery(req.query);
      if (query.pagination || query.cursor)
        throw new AppError(
          400,
          'INVALID_QUERY',
          'Cursor pagination is available on /deals only.',
        );
      res.json(await service.categories(query));
    }) as RequestHandler,
    merchants: (async (req, res) => {
      const query = parseCatalogQuery(req.query);
      if (query.pagination || query.cursor)
        throw new AppError(
          400,
          'INVALID_QUERY',
          'Cursor pagination is available on /deals only.',
        );
      res.json(await service.merchants(query));
    }) as RequestHandler,
  };
}
