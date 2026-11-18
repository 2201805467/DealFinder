import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dealfinder_mobile/core/config.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';
import 'package:dealfinder_mobile/features/catalog/domain/models.dart';

/// Explicit opt-in only: flutter test tool/backend_smoke_test.dart
/// --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
void main() {
  test(
    'Live Backend: home sections, pagination, search, metadata, and details',
    () async {
      const base = String.fromEnvironment('API_BASE_URL');
      expect(base, isNotEmpty, reason: 'Explicit local Backend URL required');
      final dio = Dio(
        BaseOptions(
          baseUrl: base,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
        ),
      );
      final repo = CatalogRepository(dio, const AppConfig(baseUrl: base));
      final health = await repo.get('/health');
      expect(health['status'], 'ok');
      final queries = [
        const CatalogQuery(view: 'top'),
        const CatalogQuery(sort: 'newest'),
        const CatalogQuery(
          view: 'low_price',
          sort: 'price_asc',
          maxPrice: '20',
        ),
        const CatalogQuery(sort: 'discount_desc'),
      ];
      final counts = <String, int>{};
      for (final q in queries) {
        final p = await repo.offers(q, pageSize: 2);
        expect(p.items, isNotEmpty);
        expect(p.items.every((v) => v.synthetic), isTrue);
        counts[q.view == 'discounted' ? q.sort : q.view] = p.total;
      }
      final first = await repo.offers(const CatalogQuery(), pageSize: 2);
      final second = await repo.offers(
        const CatalogQuery(),
        page: 2,
        pageSize: 2,
      );
      expect(second.page, 2);
      expect(
        first.items
            .map((v) => v.id)
            .toSet()
            .intersection(second.items.map((v) => v.id).toSet()),
        isEmpty,
      );
      final offer = await repo.offer(
        first.items.first.id,
        productId: first.items.first.productId,
      );
      expect(offer.current, isNotNull);
      final search = await repo.offers(CatalogQuery(search: offer.name));
      expect(search.items.any((v) => v.id == offer.id), isTrue);
      final categories = await repo.options('categories');
      final merchants = await repo.options('merchants');
      expect(categories.items, isNotEmpty);
      expect(merchants.items, isNotEmpty);
      final report = {
        'checkedAt': DateTime.now().toUtc().toIso8601String(),
        'baseUrl': base,
        'syntheticOnly': true,
        'sectionTotals': counts,
        'page1Ids': first.items.map((v) => v.id).toList(),
        'page2Ids': second.items.map((v) => v.id).toList(),
        'sampleOffer': {
          'id': offer.id,
          'name': offer.name,
          'price': offer.current!.value,
          'currency': offer.currency,
        },
        'categories': categories.total,
        'merchants': merchants.total,
      };
      await Directory('docs').create(recursive: true);
      await File(
        'docs/live-backend-check.json',
      ).writeAsString(const JsonEncoder.withIndent('  ').convert(report));
      dio.close(force: true);
    },
  );
}
