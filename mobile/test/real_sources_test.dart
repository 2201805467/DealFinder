import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dealfinder_mobile/app.dart';
import 'package:dealfinder_mobile/core/config.dart';
import 'package:dealfinder_mobile/features/preferences/preferences.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';
import 'package:dealfinder_mobile/features/catalog/domain/models.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/detail_screen.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/offer_card.dart';
import 'support.dart';

// Mock responses only. These are NOT products fetched from an external API.
Map<String, dynamic> giveawayFixture() => fixture(price: '0', synthetic: false)
  ..['product'] = {
    'id': 'product-offer-1',
    'name': 'TEST ONLY digital loot',
    'description': 'Mock API response',
    'imageUrl': null,
    'isSynthetic': false,
  }
  ..['merchant'] = {
    'id': 'merchant-1',
    'name': 'Giveaway publisher not specified',
    'isSynthetic': false,
  }
  ..['source'] = {
    'name': 'GamerPower',
    'key': 'GAMERPOWER',
    'platforms': ['PC', 'Steam'],
    'kind': 'loot',
    'attributionUrl': 'https://www.gamerpower.com/',
    'endText': '2099-12-31 23:59:00',
  }
  ..['market'] = null
  ..['referencePrice'] = null
  ..['discountPercentage'] = null
  ..['referencePriceTrusted'] = false
  ..['scoreClassification'] = 'PRODUCT'
  ..['productUrl'] = 'https://www.gamerpower.com/open/test-only';

void main() {
  test(
    'default application selects real data; giveaway has Free, source/platforms and no invented discount',
    () {
      expect(
        const AppConfig(baseUrl: 'http://localhost:3000/api/v1').demo,
        isFalse,
      );
      final offer = Offer.fromJson(giveawayFixture());
      expect(offer.free, isTrue);
      expect(offer.hasDiscount, isFalse);
      expect(offer.market, isNull);
      expect(offer.platforms, ['PC', 'Steam']);
      expect(offer.sourceName, 'GamerPower');
      expect(shoppingLink(offer)?.host, 'www.gamerpower.com');
      expect(const CatalogQuery().view, 'all');
    },
  );
  test(
    'CheapShark official link takes precedence over unrelated affiliate link',
    () {
      final data = giveawayFixture()
        ..['productUrl'] =
            'https://www.cheapshark.com/redirect?dealID=test%2Fonly'
        ..['affiliateUrl'] = 'https://unrelated.example.com/';
      (data['source'] as Map<String, dynamic>)['key'] = 'CHEAPSHARK';
      expect(shoppingLink(Offer.fromJson(data))?.host, 'www.cheapshark.com');
    },
  );
  testWidgets(
    'real-source shaped DTO renders Home, Explore and detail with active attribution, Free and eligibility warning',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(
        overrides: [
          preferencesProvider.overrideWithValue(prefs),
          configProvider.overrideWithValue(
            const AppConfig(
              baseUrl: 'https://api.example.com/api/v1',
              release: true,
            ),
          ),
          repositoryProvider.overrideWithValue(
            repository((o) {
              if (o.path == '/categories' || o.path == '/merchants') {
                return response(envelope([]));
              }
              if (o.path.startsWith('/deals/')) {
                return response({'data': giveawayFixture()});
              }
              if (o.queryParameters['view'] == 'top' ||
                  o.queryParameters['view'] == 'discounted') {
                return response(envelope([]));
              }
              return response(
                envelope([giveawayFixture(), fixture(id: 'blocked-synthetic')]),
              );
            }, release: true),
          ),
        ],
      );
      try {
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const DealFinderApp(),
          ),
        );
        await tester.pumpAndSettle();
        // Latest section is lower on the existing home page.
        for (var i = 0; i < 10 && find.text('Free').evaluate().isEmpty; i++) {
          await tester.drag(find.byType(ListView).first, const Offset(0, -200));
          await tester.pumpAndSettle();
        }
        expect(find.text('Free'), findsWidgets);
        expect(find.text('Data: GamerPower'), findsWidgets);
        expect(find.textContaining('DEMO MODE'), findsNothing);
        await tester.tap(find.text('Explore'));
        await tester.pumpAndSettle();
        expect(find.byType(OfferCard), findsOneWidget);
        expect(find.text('Free'), findsOneWidget);
        expect(
          tester
              .widget<TextButton>(
                find.widgetWithText(TextButton, 'Data: GamerPower'),
              )
              .onPressed,
          isNotNull,
        );
        await tester.tap(find.text('TEST ONLY digital loot'));
        await tester.pumpAndSettle();
        expect(find.byType(DetailScreen), findsOneWidget);
        await tester.scrollUntilVisible(
          find.textContaining('Country availability is unknown'),
          200,
          scrollable: find.byType(Scrollable).last,
        );
        expect(
          find.textContaining('not necessarily a full game'),
          findsOneWidget,
        );
        expect(
          find.textContaining('source timezone not supplied'),
          findsOneWidget,
        );
        expect(find.text('-100%'), findsNothing);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        container.dispose();
        await tester.pump();
      }
    },
  );
}
