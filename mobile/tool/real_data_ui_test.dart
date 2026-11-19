// Explicit local acceptance: real PostgreSQL/REST data; never runs under `flutter test` defaults.
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dealfinder_mobile/app.dart';
import 'package:dealfinder_mobile/core/config.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';
import 'package:dealfinder_mobile/features/catalog/domain/models.dart';
import 'package:dealfinder_mobile/features/catalog/application/explore_controller.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/detail_screen.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/offer_card.dart';
import 'package:dealfinder_mobile/features/preferences/preferences.dart';

void main() {
  testWidgets(
    'REAL sources: HTTP → Home/Explore → Free/attribution → favorite → detail',
    (tester) async {
      await tester.runAsync(() async {
        const base = String.fromEnvironment('API_BASE_URL');
        expect(Uri.parse(base).host, '127.0.0.1');
        HttpOverrides.global = null;
        // ignore: invalid_use_of_visible_for_testing_member
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();
        final container = ProviderContainer(
          overrides: [
            preferencesProvider.overrideWithValue(prefs),
            configProvider.overrideWithValue(
              const AppConfig(baseUrl: base, requestedDemo: false),
            ),
          ],
        );
        try {
          final repo = container.read(repositoryProvider);
          final page = await repo.offers(
            const CatalogQuery(view: 'all', sort: 'newest'),
            pageSize: 100,
          );
          expect(page.items, isNotEmpty);
          expect(page.items.every((o) => !o.synthetic), isTrue);
          expect(page.items.any((o) => o.sourceKey == 'CHEAPSHARK'), isTrue);
          final free = page.items.firstWhere(
            (o) => o.sourceKey == 'GAMERPOWER',
          );
          expect(free.free, isTrue);
          expect(free.hasDiscount, isFalse);
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: const DealFinderApp(),
            ),
          );
          await container.read(
            offersProvider(const CatalogQuery(view: 'top')).future,
          );
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 100));
          expect(find.text('dealfinder'), findsOneWidget);
          expect(find.textContaining('DEMO MODE'), findsNothing);
          await tester.tap(find.text('Explore'));
          await tester.pump();
          await container
              .read(exploreProvider.notifier)
              .select(const CatalogQuery(view: 'all', sort: 'newest'));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 100));
          expect(find.byType(OfferCard), findsWidgets);
          expect(find.text('Free'), findsWidgets);
          expect(find.text('Data: GamerPower'), findsWidgets);
          await container.read(favoritesProvider.notifier).toggle((
            id: free.id,
            productId: free.productId,
          ));
          expect(
            container.read(favoritesProvider).any((o) => o.id == free.id),
            isTrue,
          );
          container
              .read(routerProvider)
              .push('/deals/${free.id}?productId=${free.productId}');
          await tester
              .pump(); // Mount the detail listener before awaiting an auto-dispose provider.
          await container.read(
            offerProvider((id: free.id, productId: free.productId)).future,
          );
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 400));
          expect(find.byType(DetailScreen), findsOneWidget);
          expect(find.text('Data: GamerPower'), findsWidgets);
          expect(find.text('Free'), findsWidgets);
          expect(tester.takeException(), isNull);
          debugPrint(
            'REAL DATA UI PASS: ${page.items.length} visible offers; ${free.name}; headless Flutter, NOT a native visual/screenshot validation.',
          );
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          container.dispose();
          await tester.pump();
          HttpOverrides.global = null;
        }
      });
    },
  );
}
