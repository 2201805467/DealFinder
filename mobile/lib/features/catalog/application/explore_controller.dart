import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../preferences/preferences.dart';
import '../data/catalog_repository.dart';
import '../domain/models.dart';

class ExploreState {
  const ExploreState({
    this.query = const CatalogQuery(),
    this.items = const [],
    this.page = 0,
    this.hasMore = true,
    this.loading = false,
    this.error,
    this.limited = false,
  });
  final CatalogQuery query;
  final List<Offer> items;
  final int page;
  final bool hasMore, loading;
  final Object? error;
  final bool limited;
}

final exploreProvider = NotifierProvider<ExploreController, ExploreState>(
  ExploreController.new,
);

class ExploreController extends Notifier<ExploreState> {
  static const maxResidentOffers = 1000;
  Timer? _debounce;
  CancelToken? _cancel;
  int _generation = 0;
  @override
  ExploreState build() {
    final settings = ref.read(settingsProvider);
    ref.listen(settingsProvider, (previous, next) {
      if (previous?.currency != next.currency ||
          previous?.market != next.market) {
        select(
          state.query.copyWith(
            currency: next.currency,
            market: next.market,
            minPrice: '',
            maxPrice: '',
            view: 'all',
          ),
        );
      }
    });
    ref.onDispose(() {
      _debounce?.cancel();
      _cancel?.cancel();
      _generation++;
    });
    Future.microtask(() {
      if (ref.mounted) load();
    });
    return ExploreState(
      query: CatalogQuery(currency: settings.currency, market: settings.market),
    );
  }

  void search(String text) {
    if (text.length > 200) text = text.substring(0, 200);
    _debounce?.cancel();
    _cancel?.cancel();
    _generation++;
    state = ExploreState(
      query: state.query.copyWith(search: text),
      loading: true,
    );
    _debounce = Timer(const Duration(milliseconds: 350), () => load());
  }

  Future<void> select(CatalogQuery query) async {
    _debounce?.cancel();
    _cancel?.cancel();
    _generation++;
    state = ExploreState(query: query);
    await load();
  }

  Future<void> refresh() => select(state.query);
  Future<void> load() async {
    if (!ref.mounted) return;
    if (state.loading && _cancel != null && !_cancel!.isCancelled) return;
    if (!state.hasMore) return;
    final generation = _generation;
    final token = CancelToken();
    _cancel = token;
    final before = state;
    state = ExploreState(
      query: before.query,
      items: before.items,
      page: before.page,
      hasMore: before.hasMore,
      loading: true,
    );
    try {
      final result = await ref
          .read(repositoryProvider)
          .offers(before.query, page: before.page + 1, cancel: token);
      if (generation != _generation || !ref.mounted) return;
      final unique = {
        for (final v in before.items) v.id: v,
        for (final v in result.items) v.id: v,
      };
      state = ExploreState(
        query: before.query,
        items: unique.values.take(maxResidentOffers).toList(),
        page: result.page,
        hasMore: result.hasMore && unique.length < maxResidentOffers,
        limited: result.hasMore && unique.length >= maxResidentOffers,
      );
    } catch (e) {
      if (generation != _generation || !ref.mounted || token.isCancelled) {
        return;
      }
      state = ExploreState(
        query: before.query,
        items: before.items,
        page: before.page,
        hasMore: before.hasMore,
        error: e,
      );
    } finally {
      if (identical(_cancel, token)) _cancel = null;
    }
  }
}
