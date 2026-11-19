// Explicit local QA integration, outside the default unit suite. No external store data.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dealfinder_mobile/app.dart';
import 'package:dealfinder_mobile/core/config.dart';
import 'package:dealfinder_mobile/features/catalog/application/explore_controller.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';
import 'package:dealfinder_mobile/features/catalog/domain/models.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/offer_card.dart';
import 'package:dealfinder_mobile/features/preferences/preferences.dart';

void main() {
  testWidgets(
    'QA live API: 100k catalogue, paging, scrolling, saved IDs, details and settings',
    (tester) async {
      await tester.runAsync(() async {
        const base = String.fromEnvironment('API_BASE_URL');
        final uri = Uri.parse(base);
        expect(['127.0.0.1', 'localhost'].contains(uri.host), isTrue);
        HttpOverrides.global =
            null; // Explicit loopback integration only; allow real HTTP instead of widget-test 400 stub.
        // Explicit opt-in test outside test/; never called by the shipped application.
        // ignore: invalid_use_of_visible_for_testing_member
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();
        final container = ProviderContainer(
          overrides: [
            preferencesProvider.overrideWithValue(prefs),
            configProvider.overrideWithValue(const AppConfig(baseUrl: base)),
          ],
        );
        final measurements = <String, Object>{
          'platform':
              'Windows headless Flutter debug test, NOT phone/profile FPS',
          'startedAt': DateTime.now().toUtc().toIso8601String(),
        };
        final stopwatch = Stopwatch()..start();
        final initialMemory = ProcessInfo.currentRss;
        try {
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: const DealFinderApp(),
            ),
          );
          await container
              .read(repositoryProvider)
              .offers(const CatalogQuery(view: 'top'));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 100));
          measurements['homeWallMs'] = stopwatch.elapsedMilliseconds;
          await tester.tap(find.text('Explore'));
          await tester.pump();
          for (
            var i = 0;
            i < 200 && container.read(exploreProvider).page == 0;
            i++
          ) {
            await Future<void>.delayed(const Duration(milliseconds: 25));
          }
          expect(container.read(exploreProvider).error, isNull);
          await tester.pump();
          for (var i = 0; i < 9; i++) {
            await container.read(exploreProvider.notifier).load();
            await tester.pump();
          }
          expect(container.read(exploreProvider).items.length, 200);
          expect(
            container
                .read(exploreProvider)
                .items
                .map((v) => v.id)
                .toSet()
                .length,
            200,
          );
          final mountedBefore = find.byType(OfferCard).evaluate().length;
          final scroll = Stopwatch()..start();
          for (var i = 0; i < 10; i++) {
            await tester.drag(
              find.byType(CustomScrollView),
              const Offset(0, -450),
            );
            await tester.pump(const Duration(milliseconds: 32));
          }
          measurements['tenScrollPumpsWallMs'] = scroll.elapsedMilliseconds;
          measurements['mountedCardsBeforeScroll'] = mountedBefore;
          measurements['mountedCardsAfterScroll'] = find
              .byType(OfferCard)
              .evaluate()
              .length;
          final offer = container.read(exploreProvider).items.first;
          await container.read(favoritesProvider.notifier).toggle((
            id: offer.id,
            productId: offer.productId,
          ));
          expect(
            prefs.getStringList('favorite_ids')!.join(),
            isNot(contains('currentPrice')),
          );
          await container
              .read(repositoryProvider)
              .offer(offer.id, productId: offer.productId);
          await container
              .read(settingsProvider.notifier)
              .update(
                const UserSettings(currency: 'USD', theme: ThemeMode.dark),
              );
          await tester.pump();
          expect(container.read(settingsProvider).theme, ThemeMode.dark);
          measurements['loadedOffers'] = container
              .read(exploreProvider)
              .items
              .length;
          measurements['initialRSSBytes'] = initialMemory;
          measurements['finalRSSBytes'] = ProcessInfo.currentRss;
          measurements['elapsedWallMs'] = stopwatch.elapsedMilliseconds;
          await Directory('docs').create(recursive: true);
          await File('docs/qa-live-ui.json').writeAsString(
            const JsonEncoder.withIndent('  ').convert(measurements),
          );
          expect(tester.takeException(), isNull);
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
