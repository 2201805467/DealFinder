import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';
import 'package:dealfinder_mobile/features/catalog/domain/models.dart';
import 'support.dart';

void main() {
  test('Loads paginated DTO using correct API path', () async {
    final r = repository((o) {
      expect(o.uri.path, '/api/v1/deals');
      expect(o.queryParameters['page'], 2);
      return response(envelope([fixture()], page: 2, pages: 3));
    });
    final page = await r.offers(const CatalogQuery(), page: 2);
    expect(page.items.length, 1);
    expect(page.hasMore, isTrue);
  });
  test('Empty API result is valid', () async {
    expect(
      (await repository(
        (_) => response(envelope([])),
      ).offers(const CatalogQuery())).items,
      isEmpty,
    );
  });
  test('Release never exposes synthetic or unknown-provenance data', () async {
    final rows = [
      fixture(),
      fixture(id: 'unknown')..remove('isSynthetic'),
      fixture(id: 'approved', synthetic: false),
    ];
    final result = await repository(
      (_) => response(envelope(rows)),
      release: true,
    ).offers(const CatalogQuery());
    expect(result.items.map((v) => v.id), ['approved']);
  });
  test('Expired data is filtered even if backend sends it', () async {
    final page = await repository(
      (_) => response(
        envelope([fixture()..['expiresAt'] = '2020-01-01T00:00:00Z']),
      ),
    ).offers(const CatalogQuery());
    expect(page.items, isEmpty);
  });
  test('Malformed response becomes safe readable error', () async {
    for (final j in [
      {'data': null},
      envelope([
        {'id': 'broken'},
      ]),
    ]) {
      await expectLater(
        repository((_) => response(j)).offers(const CatalogQuery()),
        throwsA(isA<CatalogException>()),
      );
    }
  });
  for (final status in [400, 404, 429, 500]) {
    test('HTTP $status has a safe message', () async {
      await expectLater(
        repository(
          (_) => response({'secret': 'do not expose'}, status: status),
        ).offers(const CatalogQuery()),
        throwsA(
          isA<CatalogException>().having(
            (e) => e.message,
            'safe',
            isNot(contains('secret')),
          ),
        ),
      );
    });
  }
  test('Timeout and offline are handled', () async {
    for (final type in [
      DioExceptionType.receiveTimeout,
      DioExceptionType.connectionError,
    ]) {
      final r = repository(
        (o) => throw DioException(requestOptions: o, type: type),
      );
      await expectLater(
        r.offers(const CatalogQuery()),
        throwsA(isA<CatalogException>()),
      );
    }
  });
  test('Cancellation is preserved', () async {
    final r = repository(
      (o) =>
          throw DioException(requestOptions: o, type: DioExceptionType.cancel),
    );
    await expectLater(
      r.offers(const CatalogQuery()),
      throwsA(
        isA<DioException>().having(
          (e) => e.type,
          'cancel',
          DioExceptionType.cancel,
        ),
      ),
    );
  });
  test(
    'Low-price detail uses product fallback without backend changes',
    () async {
      final r = repository(
        (o) => o.path.startsWith('/deals/')
            ? response({}, status: 404)
            : response({
                'data': {
                  'offers': [fixture()],
                },
              }),
      );
      expect((await r.offer('offer-1', productId: 'product-1')).id, 'offer-1');
    },
  );
  test('Expired favorite is unavailable', () async {
    final r = repository(
      (_) =>
          response({'data': fixture()..['expiresAt'] = '2020-01-01T00:00:00Z'}),
    );
    await expectLater(
      r.offer('offer-1'),
      throwsA(
        isA<CatalogException>().having(
          (e) => e.unavailable,
          'unavailable',
          true,
        ),
      ),
    );
  });
}
