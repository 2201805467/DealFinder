import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/config.dart';
import 'core/widgets.dart';
import 'features/catalog/presentation/home_screen.dart';
import 'features/catalog/data/catalog_repository.dart';
import 'features/catalog/presentation/explore_screen.dart';
import 'features/catalog/presentation/detail_screen.dart';
import 'features/favorites/favorites_screen.dart';
import 'features/preferences/preferences.dart';
import 'features/preferences/settings_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final router = GoRouter(
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/',
                builder: (context, state) => const HomeScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/explore',
                builder: (context, state) => const ExploreScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/favorites',
                builder: (context, state) => const FavoritesScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/deals/:id',
        builder: (context, state) => DetailScreen(
          id: state.pathParameters['id']!,
          productId: state.uri.queryParameters['productId'],
        ),
      ),
    ],
    errorBuilder: (context, state) => const Scaffold(
      body: MessageState(
        'Page not found',
        'Use the navigation below to keep exploring.',
      ),
    ),
  );
  ref.onDispose(router.dispose);
  return router;
});
ThemeData appTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: const Color(0xff087f6d),
    brightness: brightness,
    primary: dark ? const Color(0xff79ddbc) : const Color(0xff08735f),
    surface: dark ? const Color(0xff111d24) : const Color(0xfff6f8f7),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    cardTheme: CardThemeData(
      elevation: 0,
      color: dark ? const Color(0xff1b2a32) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: .4)),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surface,
      indicatorColor: scheme.primaryContainer,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 16),
      ),
    ),
  );
}

class DealFinderApp extends ConsumerWidget {
  const DealFinderApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
    title: 'DealFinder',
    debugShowCheckedModeBanner: false,
    theme: appTheme(Brightness.light),
    darkTheme: appTheme(Brightness.dark),
    themeMode: ref.watch(settingsProvider.select((s) => s.theme)),
    locale: const Locale('en'),
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    supportedLocales: const [Locale('en')],
    routerConfig: ref.watch(routerProvider),
    builder: (context, child) => ref.watch(configProvider).valid
        ? child!
        : const Scaffold(
            body: SafeArea(
              child: MessageState(
                'Backend configuration required',
                'Set API_BASE_URL to an approved HTTPS Backend for a production build.',
              ),
            ),
          ),
  );
}

class AppShell extends ConsumerWidget {
  const AppShell(this.shell, {super.key});
  final StatefulNavigationShell shell;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    body: SafeArea(
      bottom: false,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1100),
          child: Column(
            children: [
              const DemoNotice(),
              Expanded(child: shell),
            ],
          ),
        ),
      ),
    ),
    bottomNavigationBar: NavigationBar(
      selectedIndex: shell.currentIndex,
      onDestinationSelected: (i) {
        if (i == 2) ref.invalidate(offerProvider);
        shell.goBranch(i, initialLocation: i == shell.currentIndex);
      },
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home_rounded),
          label: 'Home',
        ),
        NavigationDestination(
          icon: Icon(Icons.search_rounded),
          label: 'Explore',
        ),
        NavigationDestination(
          icon: Icon(Icons.favorite_border),
          selectedIcon: Icon(Icons.favorite),
          label: 'Favorites',
        ),
        NavigationDestination(
          icon: Icon(Icons.settings_outlined),
          selectedIcon: Icon(Icons.settings),
          label: 'Settings',
        ),
      ],
    ),
  );
}
