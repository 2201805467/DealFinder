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
      if (query.view !== undefined)
        throw new AppError(
          400,
          'INVALID_QUERY',
          'Deal selections are available on /deals.',
        );
      res.json(await service.products(query));
    }) as RequestHandler,
    product: (async (req, res) => {
      res.json(await service.product(parseId(req.params.id)));
    }) as RequestHandler,
    categories: (async (req, res) => {
      res.json(await service.categories(parseCatalogQuery(req.query)));
    }) as RequestHandler,
    merchants: (async (req, res) => {
      res.json(await service.merchants(parseCatalogQuery(req.query)));
    }) as RequestHandler,
  };
}
