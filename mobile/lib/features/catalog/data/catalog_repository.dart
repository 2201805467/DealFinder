import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config.dart';
import '../domain/models.dart';

class CatalogException implements Exception {
  const CatalogException(this.message, {this.unavailable = false});
  final String message;
  final bool unavailable;
  @override
  String toString() => message;
}

class CatalogRepository {
  CatalogRepository(this.dio, this.config);
  final Dio dio;
  final AppConfig config;
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
    CancelToken? cancel,
  }) async {
    if (!config.valid) {
      throw const CatalogException(
        'Configure a valid secure Backend URL to continue.',
      );
    }
    try {
      final response = await dio.get<Object?>(
        path,
        queryParameters: query,
        cancelToken: cancel,
      );
      return object(response.data);
    } on DioException catch (e) {
      if (CancelToken.isCancel(e)) rethrow;
      if (e.error is FormatException) {
        throw const CatalogException(
          'The server returned unreadable data. Please retry.',
        );
      }
      if (e.response?.statusCode == 404) {
        throw const CatalogException(
          'This offer is no longer available.',
          unavailable: true,
        );
      }
      if (e.response?.statusCode == 429) {
        throw const CatalogException(
          'Too many requests. Please try again shortly.',
        );
      }
      if ([
        DioExceptionType.connectionTimeout,
        DioExceptionType.receiveTimeout,
        DioExceptionType.sendTimeout,
      ].contains(e.type)) {
        throw const CatalogException(
          'The connection timed out. Please try again.',
        );
      }
      if (e.response != null) {
        throw const CatalogException(
          'Could not load this selection. Please try again.',
        );
      }
      throw const CatalogException(
        'Cannot reach DealFinder. Check your connection and try again.',
      );
    } on FormatException {
      throw const CatalogException(
        'The server returned unreadable data. Please retry.',
      );
    }
  }

  Future<CatalogPage<Offer>> offers(
    CatalogQuery query, {
    int page = 1,
    int pageSize = 20,
    CancelToken? cancel,
  }) async {
    try {
      final j = await get(
        '/deals',
        query: query.parameters(page: page, pageSize: pageSize),
        cancel: cancel,
      );
      final data = (j['data'] as List)
          .map((v) => Offer.fromJson(object(v)))
          .where(visible)
          .toList();
      final p = object(j['pagination']);
      return CatalogPage(
        data,
        p['page'] as int,
        p['totalPages'] as int,
        p['total'] as int,
      );
    } on TypeError {
      throw const CatalogException('The server returned an unexpected format.');
    } on FormatException {
      throw const CatalogException('The server returned an unexpected format.');
    }
  }

  bool visible(Offer offer) =>
      !offer.expired && (config.demo || !offer.synthetic);
  Future<Offer> offer(
    String id, {
    String? productId,
    CancelToken? cancel,
  }) async {
    try {
      Map<String, dynamic> j;
      try {
        j = object(
          (await get(
            '/deals/${Uri.encodeComponent(id)}',
            cancel: cancel,
          ))['data'],
        );
      } on CatalogException catch (e) {
        if (!e.unavailable || productId == null) rethrow;
        final product = object(
          (await get(
            '/products/${Uri.encodeComponent(productId)}',
            cancel: cancel,
          ))['data'],
        );
        final matches = (product['offers'] as List)
            .map(object)
            .where((v) => v['id'] == id);
        if (matches.isEmpty) rethrow;
        j = matches.first;
      }
      final offer = Offer.fromJson(j);
      if (!visible(offer)) {
        throw const CatalogException(
          'This offer has expired or is unavailable.',
          unavailable: true,
        );
      }
      return offer;
    } on TypeError {
      throw const CatalogException('The server returned an unexpected format.');
    } on FormatException {
      throw const CatalogException('The server returned an unexpected format.');
    }
  }

  Future<CatalogPage<CatalogOption>> options(
    String type, {
    int page = 1,
    CancelToken? cancel,
  }) async {
    try {
      final j = await get(
        '/$type',
        query: {'page': page, 'pageSize': 100},
        cancel: cancel,
      );
      final p = object(j['pagination']);
      return CatalogPage(
        (j['data'] as List)
            .map((v) => CatalogOption.fromJson(object(v)))
            .where((v) => config.demo || !v.synthetic)
            .toList(),
        p['page'] as int,
        p['totalPages'] as int,
        p['total'] as int,
      );
    } on TypeError {
      throw const CatalogException('The server returned an unexpected format.');
    } on FormatException {
      throw const CatalogException('The server returned an unexpected format.');
    }
  }
}

final repositoryProvider = Provider<CatalogRepository>((ref) {
  final config = ref.watch(configProvider);
  final dio = Dio(
    BaseOptions(
      baseUrl: config.baseUrl.replaceFirst(RegExp(r'/$'), ''),
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      sendTimeout: const Duration(seconds: 10),
      headers: {'Accept': 'application/json'},
    ),
  );
  ref.onDispose(() => dio.close(force: true));
  return CatalogRepository(dio, config);
});
final offersProvider = FutureProvider.autoDispose
    .family<CatalogPage<Offer>, CatalogQuery>((ref, q) {
      final cancel = CancelToken();
      ref.onDispose(cancel.cancel);
      return ref
          .watch(repositoryProvider)
          .offers(q, pageSize: 6, cancel: cancel);
    }, retry: (retryCount, error) => null);
typedef OfferKey = ({String id, String? productId});
final offerProvider = FutureProvider.autoDispose.family<Offer, OfferKey>((
  ref,
  key,
) {
  final cancel = CancelToken();
  ref.onDispose(cancel.cancel);
  return ref
      .watch(repositoryProvider)
      .offer(key.id, productId: key.productId, cancel: cancel);
}, retry: (retryCount, error) => null);
final optionsProvider = FutureProvider.autoDispose
    .family<List<CatalogOption>, String>((ref, type) async {
      final cancel = CancelToken();
      ref.onDispose(cancel.cancel);
      final repository = ref.watch(repositoryProvider);
      final all = <CatalogOption>[];
      var page = 1;
      while (true) {
        final result = await repository.options(
          type,
          page: page++,
          cancel: cancel,
        );
        all.addAll(result.items);
        if (!result.hasMore) return all;
      }
    }, retry: (retryCount, error) => null);
