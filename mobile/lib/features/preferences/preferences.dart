import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

final preferencesProvider = Provider<SharedPreferences>(
  (ref) => throw StateError('Preferences not initialized'),
);

class UserSettings {
  const UserSettings({
    this.currency = 'USD',
    this.market = '',
    this.theme = ThemeMode.system,
  });
  final String currency, market;
  final ThemeMode theme;
  UserSettings copyWith({String? currency, String? market, ThemeMode? theme}) =>
      UserSettings(
        currency: currency ?? this.currency,
        market: market ?? this.market,
        theme: theme ?? this.theme,
      );
}

final settingsProvider = NotifierProvider<SettingsController, UserSettings>(
  SettingsController.new,
);

class SettingsController extends Notifier<UserSettings> {
  Future<void> _writes = Future.value();
  @override
  UserSettings build() {
    final prefs = ref.watch(preferencesProvider);
    final currency = prefs.getString('currency') ?? 'USD';
    final market = prefs.getString('market') ?? '';
    return UserSettings(
      currency: RegExp(r'^[A-Z]{3}$').hasMatch(currency) ? currency : 'USD',
      market: RegExp(r'^[A-Z]{2}$').hasMatch(market) ? market : '',
      theme:
          ThemeMode.values
              .where((v) => v.name == prefs.getString('theme'))
              .firstOrNull ??
          ThemeMode.system,
    );
  }

  Future<void> update(UserSettings value) {
    state = value;
    return _writes = _writes.catchError((Object _) {}).then((_) async {
      final prefs = ref.read(preferencesProvider);
      if (!await prefs.setString('currency', value.currency) ||
          !await prefs.setString('market', value.market) ||
          !await prefs.setString('theme', value.theme.name)) {
        throw StateError('Could not save preferences');
      }
    });
  }
}

typedef FavoriteId = ({String id, String? productId});

abstract interface class FavoritesRepository {
  List<FavoriteId> read();
  Future<void> save(List<FavoriteId> ids);
}

class LocalFavoritesRepository implements FavoritesRepository {
  LocalFavoritesRepository(this.prefs);
  final SharedPreferences prefs;
  @override
  List<FavoriteId> read() {
    final rows = prefs.getStringList('favorite_ids') ?? [];
    final result = <FavoriteId>[];
    for (final row in rows) {
      try {
        final j = jsonDecode(row) as Map<String, dynamic>;
        if (j['id'] is String && !result.any((v) => v.id == j['id'])) {
          result.add((
            id: j['id'] as String,
            productId: j['productId'] as String?,
          ));
        }
      } catch (_) {
        /* Corrupt IDs are ignored; no prices are persisted. */
      }
    }
    return result;
  }

  @override
  Future<void> save(List<FavoriteId> ids) async {
    if (!await prefs.setStringList(
      'favorite_ids',
      ids
          .map((v) => jsonEncode({'id': v.id, 'productId': v.productId}))
          .toList(),
    )) {
      throw StateError('Could not save favorites');
    }
  }
}

final favoritesRepositoryProvider = Provider<FavoritesRepository>(
  (ref) => LocalFavoritesRepository(ref.watch(preferencesProvider)),
);
final favoritesProvider =
    NotifierProvider<FavoritesController, List<FavoriteId>>(
      FavoritesController.new,
    );

class FavoritesController extends Notifier<List<FavoriteId>> {
  Future<void> _writes = Future.value();
  @override
  List<FavoriteId> build() => ref.watch(favoritesRepositoryProvider).read();
  Future<void> toggle(FavoriteId id) {
    final next = state.any((v) => v.id == id.id)
        ? state.where((v) => v.id != id.id).toList()
        : [...state, id];
    state = next;
    return _writes = _writes
        .catchError((Object _) {})
        .then((_) => ref.read(favoritesRepositoryProvider).save(next));
  }
}
