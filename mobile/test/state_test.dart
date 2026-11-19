import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dealfinder_mobile/features/preferences/preferences.dart';
import 'package:dealfinder_mobile/features/catalog/application/explore_controller.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';
import 'package:dealfinder_mobile/features/catalog/domain/models.dart';
import 'support.dart';

Future<ProviderContainer> containerFor(CatalogRepository repo) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  return ProviderContainer(
    overrides: [
      preferencesProvider.overrideWithValue(prefs),
      repositoryProvider.overrideWithValue(repo),
    ],
  );
}

Future<void> tick() => Future<void>.delayed(const Duration(milliseconds: 30));
void main() {
  test(
    'QA: a large catalogue cannot grow the resident list without bound',
    () async {
      var calls = 0;
      final c = await containerFor(
        repository((o) {
          calls++;
          final p = o.queryParameters['page'] as int;
          return response(
            envelope(
              List.generate(20, (i) => fixture(id: '${(p - 1) * 20 + i}')),
              page: p,
              pages: 100,
            ),
          );
        }),
      );
      final control = c.read(exploreProvider.notifier);
      for (var i = 0; i < 100 && c.read(exploreProvider).page == 0; i++) {
        await tick();
      }
      expect(c.read(exploreProvider).error, isNull);
      for (var i = 0; i < 60 && c.read(exploreProvider).hasMore; i++) {
        await control.load();
      }
      expect(c.read(exploreProvider).items.length, 1000);
      expect(c.read(exploreProvider).limited, isTrue);
      expect(calls, 50);
      await control.load();
      expect(calls, 50);
      await control.select(const CatalogQuery(search: 'new'));
      expect(c.read(exploreProvider).items.length, 20);
      expect(c.read(exploreProvider).limited, isFalse);
      c.dispose();
    },
  );
  test(
    'QA: corrupt preference types fall back safely without startup exceptions',
    () async {
      SharedPreferences.setMockInitialValues({
        'currency': 42,
        'market': true,
        'theme': 7,
        'favorite_ids': 'not a list',
      });
      final prefs = await SharedPreferences.getInstance();
      final c = ProviderContainer(
        overrides: [preferencesProvider.overrideWithValue(prefs)],
      );
      expect(c.read(settingsProvider).currency, 'USD');
      expect(c.read(settingsProvider).market, '');
      expect(c.read(favoritesProvider), isEmpty);
      c.dispose();
    },
  );
  test(
    'QA: immediate controller disposal leaves no queued request touching a disposed provider',
    () async {
      var calls = 0;
      final c = await containerFor(
        repository((o) {
          calls++;
          return response(envelope([]));
        }),
      );
      c.read(exploreProvider);
      c.dispose();
      await tick();
      expect(calls, 0);
    },
  );
  test(
    'Favorites store only identifiers, deduplicate and survive restart',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final c = ProviderContainer(
        overrides: [preferencesProvider.overrideWithValue(prefs)],
      );
      final f = c.read(favoritesProvider.notifier);
      const id = (id: 'offer-1', productId: 'product-1');
      await f.toggle(id);
      expect(
        prefs.getStringList('favorite_ids')!.first,
        isNot(contains('price')),
      );
      c.dispose();
      final restored = ProviderContainer(
        overrides: [preferencesProvider.overrideWithValue(prefs)],
      );
      expect(restored.read(favoritesProvider), [id]);
      await restored.read(favoritesProvider.notifier).toggle(id);
      expect(restored.read(favoritesProvider), isEmpty);
      restored.dispose();
    },
  );
  test('Settings theme currency and market survive restart', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final c = ProviderContainer(
      overrides: [preferencesProvider.overrideWithValue(prefs)],
    );
    await c
        .read(settingsProvider.notifier)
        .update(
          const UserSettings(
            currency: 'LYD',
            market: 'LY',
            theme: ThemeMode.dark,
          ),
        );
    c.dispose();
    final restored = ProviderContainer(
      overrides: [preferencesProvider.overrideWithValue(prefs)],
    );
    expect(restored.read(settingsProvider).theme, ThemeMode.dark);
    expect(restored.read(settingsProvider).currency, 'LYD');
    expect(restored.read(settingsProvider).market, 'LY');
    restored.dispose();
  });
  test(
    'Pagination deduplicates and guards overlapping load requests',
    () async {
      var calls = 0;
      final r = repository((o) async {
        calls++;
        await tick();
        final p = o.queryParameters['page'] as int;
        return response(
          envelope(
            [fixture(id: 'same'), if (p == 2) fixture(id: 'new')],
            page: p,
            pages: 2,
          ),
        );
      });
      final c = await containerFor(r);
      final controller = c.read(exploreProvider.notifier);
      for (var i = 0; i < 30 && c.read(exploreProvider).page == 0; i++) {
        await tick();
      }
      expect(c.read(exploreProvider).items.length, 1);
      await Future.wait([controller.load(), controller.load()]);
      expect(c.read(exploreProvider).items.length, 2);
      expect(c.read(exploreProvider).hasMore, isFalse);
      expect(calls, 2);
      c.dispose();
    },
  );
  test('Debounce sends latest search and cancels stale results', () async {
    final slow = Completer<ResponseBody>();
    final searches = <String>[];
    final r = repository((o) {
      final q = o.queryParameters['q'] as String? ?? '';
      searches.add(q);
      return q == 'old'
          ? slow.future
          : response(envelope([fixture(id: q.isEmpty ? 'initial' : q)]));
    });
    final c = await containerFor(r);
    final controller = c.read(exploreProvider.notifier);
    await tick();
    final old = controller.select(const CatalogQuery(search: 'old'));
    await tick();
    controller.search('n');
    controller.search('ne');
    controller.search('new');
    await Future<void>.delayed(const Duration(milliseconds: 420));
    slow.complete(response(envelope([fixture(id: 'old')])));
    await old;
    await tick();
    expect(searches, contains('new'));
    expect(searches, isNot(contains('ne')));
    expect(c.read(exploreProvider).items.single.id, 'new');
    c.dispose();
  });
  test(
    'Filters reach API and settings changes clear cross-currency price ranges',
    () async {
      Map<String, dynamic>? params;
      final c = await containerFor(
        repository((o) {
          params = o.queryParameters;
          return response(envelope([]));
        }),
      );
      final controller = c.read(exploreProvider.notifier);
      await tick();
      await controller.select(
        const CatalogQuery(
          category: 'cat',
          merchant: 'merchant',
          minPrice: '10',
          maxPrice: '20',
          market: 'US',
        ),
      );
      expect(params!['categoryId'], 'cat');
      expect(params!['merchantId'], 'merchant');
      expect(params!['maxPrice'], '20');
      await c
          .read(settingsProvider.notifier)
          .update(const UserSettings(currency: 'EUR'));
      await tick();
      expect(c.read(exploreProvider).query.maxPrice, isEmpty);
      expect(params!['currency'], 'EUR');
      c.dispose();
    },
  );
  test('Failure preserves loaded data and can retry next page', () async {
    var fail = true;
    final c = await containerFor(
      repository((o) {
        final p = o.queryParameters['page'] as int;
        if (p == 2 && fail) return response({}, status: 500);
        return response(envelope([fixture(id: '$p')], page: p, pages: 2));
      }),
    );
    final control = c.read(exploreProvider.notifier);
    await tick();
    await control.load();
    expect(c.read(exploreProvider).items.length, 1);
    expect(c.read(exploreProvider).error, isNotNull);
    fail = false;
    await control.load();
    expect(c.read(exploreProvider).items.length, 2);
    c.dispose();
  });
}
