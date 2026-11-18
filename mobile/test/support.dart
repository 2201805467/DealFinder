import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:dealfinder_mobile/core/config.dart';
import 'package:dealfinder_mobile/features/catalog/data/catalog_repository.dart';

/// Synthetic fixture shaped exactly like the current Backend DTO. Not store data.
Map<String, dynamic> fixture({
  String id = 'offer-1',
  String price = '19.99',
  bool synthetic = true,
}) => {
  'id': id,
  'product': {
    'id': 'product-$id',
    'name': 'SYNTHETIC Demo headphones $id',
    'description': null,
    'imageUrl': null,
    'isSynthetic': synthetic,
  },
  'merchant': {
    'id': 'merchant-1',
    'name': 'SYNTHETIC Demo store',
    'isSynthetic': synthetic,
  },
  'currentPrice': price,
  'referencePrice': '39.98',
  'discountPercentage': '50',
  'currency': 'USD',
  'market': 'US',
  'productUrl': 'https://shop.example.invalid/$id',
  'affiliateUrl': null,
  'availability': 'AVAILABLE',
  'lastUpdatedAt': DateTime.now().toUtc().toIso8601String(),
  'expiresAt': DateTime.now()
      .add(const Duration(days: 1))
      .toUtc()
      .toIso8601String(),
  'isSynthetic': synthetic,
  'isStale': false,
  'referencePriceTrusted': true,
  'shippingCost': null,
  'dealScore': '80.25',
  'scoreClassification': 'TOP_DEAL',
  'scoreComponents': {
    'discount': '35',
    'freshness': '20.25',
    'availability': '20',
    'quality': '5',
    'shipping': '0',
  },
  'scoreReasons': ['SHIPPING_UNKNOWN'],
};
Map<String, dynamic> envelope(
  List<Map<String, dynamic>> rows, {
  int page = 1,
  int pages = 1,
}) => {
  'data': rows,
  'pagination': {
    'page': page,
    'pageSize': 20,
    'total': rows.length * pages,
    'totalPages': pages,
  },
};
typedef Responder = FutureOr<ResponseBody> Function(RequestOptions);

class StubAdapter implements HttpClientAdapter {
  StubAdapter(this.respond);
  final Responder respond;
  final requests = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return await respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody response(Object? value, {int status = 200}) =>
    ResponseBody.fromString(
      jsonEncode(value),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
CatalogRepository repository(
  Responder responder, {
  bool release = false,
  bool demo = true,
}) {
  final config = AppConfig(
    baseUrl: 'https://api.dealfinder.dev/api/v1',
    release: release,
    requestedDemo: demo,
  );
  final dio = Dio(BaseOptions(baseUrl: config.baseUrl));
  dio.httpClientAdapter = StubAdapter(responder);
  return CatalogRepository(dio, config);
}
