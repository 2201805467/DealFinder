import { Router } from 'express';
import { catalogControllers } from '../controllers/catalog.controller.js';
import type { CatalogService } from '../services/catalog.js';

export function catalogRouter(service: CatalogService) {
  const router = Router();
  const controllers = catalogControllers(service);
  router.get('/deals', controllers.deals);
  router.get('/deals/:id', controllers.deal);
  router.get('/products', controllers.products);
  router.get('/products/:id', controllers.product);
  router.get('/categories', controllers.categories);
  router.get('/merchants', controllers.merchants);
  return router;
}
