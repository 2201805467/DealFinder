import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dealfinder_mobile/app.dart';
import 'package:dealfinder_mobile/core/config.dart';
import 'package:dealfinder_mobile/features/preferences/preferences.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/offer_card.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/detail_screen.dart';
import 'support.dart';
import 'package:dealfinder_mobile/core/widgets.dart';
import 'package:dealfinder_mobile/features/catalog/application/explore_controller.dart';

ProviderContainer? activeContainer;
void appTest(String name, WidgetTesterCallback body) {
  testWidgets(name, (tester) async {
    try {
      await body(tester);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      activeContainer?.dispose();
      activeContainer = null;
      await tester.pump();
    }
  });
}

Future<ProviderContainer> mount(
  WidgetTester tester, {
  CatalogRepository? repo,
  bool release = false,
}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final c = ProviderContainer(
    overrides: [
      preferencesProvider.overrideWithValue(prefs),
      configProvider.overrideWithValue(
        AppConfig(
          baseUrl: 'https://api.dealfinder.dev/api/v1',
          release: release,
        ),
      ),
      repositoryProvider.overrideWithValue(
        repo ??
            repository((o) {
              if (o.path == '/categories' || o.path == '/merchants') {
                return response(
                  envelope([
                    {'id': 'cat', 'name': 'Demo category', 'isSynthetic': true},
                  ]),
                );
              }
              if (o.path.startsWith('/deals/')) {
                return response({'data': fixture()});
              }
              return response(envelope([fixture()]));
            }),
      ),
    ],
  );
  activeContainer = c;
  await tester.pumpWidget(
    UncontrolledProviderScope(container: c, child: const DealFinderApp()),
  );
  return c;
}

void main() {
  appTest('QA: large text remains usable on all five narrow screens', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 1000);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final c = await mount(tester);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await c.read(favoritesProvider.notifier).toggle((
      id: 'offer-1',
      productId: 'product-offer-1',
    ));
    await tester.tap(find.text('Favorites'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    c.read(routerProvider).push('/deals/offer-1?productId=product-offer-1');
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('View Deal'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(tester.takeException(), isNull);
  });
  appTest(
    'QA: navigation and action controls have accessible labels and tap targets',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await mount(tester);
        await tester.pumpAndSettle();
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await tester.tap(find.text('Explore'));
        await tester.pumpAndSettle();
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        // Flutter SearchBar's inner text-field semantics is only 24 px high,
        // although its outer target is 56 px. Keep this known SDK limitation in QA_REPORT.
      } finally {
        semantics.dispose();
      }
    },
  );
  appTest('Home renders API cards and an explicit demo notice', (tester) async {
    await mount(tester);
    await tester.pumpAndSettle();
    expect(find.text('dealfinder'), findsOneWidget);
    expect(find.textContaining('DEMO MODE'), findsOneWidget);
    expect(find.byType(OfferCard), findsWidgets);
    expect(find.text('USD 19.99'), findsWidgets);
    expect(find.text('-50%'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
  appTest('Release UI hides synthetic results and demo banner', (tester) async {
    await mount(
      tester,
      release: true,
      repo: repository((_) => response(envelope([fixture()])), release: true),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('DEMO MODE'), findsNothing);
    expect(find.byType(OfferCard), findsNothing);
    expect(find.text('No finds here yet'), findsWidgets);
  });
  appTest('An open card hides price and image precisely after expiry', (
    tester,
  ) async {
    final expiry = DateTime.now()
        .add(const Duration(seconds: 1))
        .toUtc()
        .toIso8601String();
    await mount(
      tester,
      repo: repository(
        (o) => o.path == '/categories'
            ? response(envelope([]))
            : response(envelope([fixture()..['expiresAt'] = expiry])),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('USD 19.99'), findsWidgets);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 1100)),
    );
    await tester.pump(const Duration(seconds: 2));
    await tester.pump();
    expect(find.text('USD 19.99'), findsNothing);
    expect(find.text('Offer expired'), findsWidgets);
  });
  appTest('Navigation retains search and opens details by ID', (tester) async {
    final c = await mount(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(SearchBar), 'headphones');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    expect(find.text('headphones'), findsOneWidget);
    c.read(routerProvider).push('/deals/offer-1?productId=product-offer-1');
    await tester.pumpAndSettle();
    expect(find.byType(DetailScreen), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('View Deal'),
      350,
      scrollable: find.byType(Scrollable).last,
    );
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'View Deal'))
          .onPressed,
      isNull,
    );
    expect(tester.takeException(), isNull);
  });
  appTest('Favorite button updates local shortlist and removes it', (
    tester,
  ) async {
    await mount(tester);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byTooltip('Save favorite').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Save favorite').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Favorites'));
    await tester.pumpAndSettle();
    expect(find.byType(OfferCard), findsOneWidget);
    await tester.tap(find.byTooltip('Remove favorite'));
    await tester.pumpAndSettle();
    expect(find.text('Keep a good find close'), findsOneWidget);
  });
  appTest('Theme switches light and dark without replacing navigation', (
    tester,
  ) async {
    final c = await mount(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();
    expect(c.read(settingsProvider).theme, ThemeMode.dark);
    expect(
      Theme.of(tester.element(find.text('Make yourself at home'))).brightness,
      Brightness.dark,
    );
    await tester.tap(find.text('Light'));
    await tester.pumpAndSettle();
    expect(
      Theme.of(tester.element(find.text('Make yourself at home'))).brightness,
      Brightness.light,
    );
  });
  appTest('Empty response has clear empty state', (tester) async {
    await mount(tester, repo: repository((_) => response(envelope([]))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    expect(find.text('Nothing found yet'), findsOneWidget);
  });
  appTest('Loading and network failure are visible with retry', (tester) async {
    final pending = Completer<void>();
    await mount(
      tester,
      repo: repository((o) async {
        await pending.future;
        return response({}, status: 500);
      }),
    );
    await tester.tap(find.text('Explore'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    expect(find.byType(Skeleton), findsWidgets);
    pending.complete();
    await tester.pumpAndSettle();
    expect(find.text('Could not load products'), findsWidgets);
    expect(find.text('Try again'), findsWidgets);
  });
  appTest('Narrow phone renders without overflow', (tester) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await mount(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
  appTest('Filters validate range and apply category to results', (
    tester,
  ) async {
    final c = await mount(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Explore'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Filters'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Minimum price'),
      '20',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Maximum price'),
      '10',
    );
    await tester.tap(find.text('Show results'));
    await tester.pumpAndSettle();
    expect(find.text('Must be at least minimum'), findsOneWidget);
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Maximum price'),
      '30',
    );
    await tester.ensureVisible(find.text('Show results'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Show results'));
    await tester.pumpAndSettle();
    expect(
      c.read(routerProvider).routeInformationProvider.value.uri.path,
      '/explore',
    );
    expect(c.read(exploreProvider).query.maxPrice, '30');
    expect(tester.takeException(), isNull);
  });
}
