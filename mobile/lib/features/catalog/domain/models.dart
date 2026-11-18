/// Exact non-negative decimal. Money never passes through binary floating point.
class DecimalValue implements Comparable<DecimalValue> {
  DecimalValue._(this.value);
  final String value;
  static DecimalValue? parse(Object? raw) {
    if (raw is! String || !RegExp(r'^\d+(\.\d+)?$').hasMatch(raw)) return null;
    return DecimalValue._(raw);
  }

  @override
  int compareTo(DecimalValue other) {
    final a = value.split('.');
    final b = other.value.split('.');
    final aw = a.length > 1 ? a[1].length : 0;
    final bw = b.length > 1 ? b[1].length : 0;
    final width = aw > bw ? aw : bw;
    BigInt units(List<String> p) =>
        BigInt.parse(p[0] + (p.length > 1 ? p[1] : '').padRight(width, '0'));
    return units(a).compareTo(units(b));
  }

  bool get positive => compareTo(DecimalValue._('0')) > 0;
  String format(String currency) {
    final p = value.split('.');
    final whole = p[0].replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+$)'),
      (m) => '${m[1]},',
    );
    return '$currency $whole${p.length > 1 ? '.${p[1]}' : '.00'}';
  }

  @override
  String toString() => value;
}

Map<String, dynamic> object(Object? v) {
  if (v is! Map<String, dynamic>) {
    throw const FormatException('Expected object');
  }
  return v;
}

String requiredText(Map<String, dynamic> j, String key) {
  final v = j[key];
  if (v is! String || v.isEmpty) throw FormatException('Missing $key');
  return v;
}

class Offer {
  Offer.fromJson(Map<String, dynamic> j)
    : id = requiredText(j, 'id'),
      productId = requiredText(object(j['product']), 'id'),
      name = requiredText(object(j['product']), 'name'),
      description = object(j['product'])['description'] as String?,
      imageUrl = object(j['product'])['imageUrl'] as String?,
      merchant = requiredText(object(j['merchant']), 'name'),
      current = DecimalValue.parse(j['currentPrice']),
      reference = DecimalValue.parse(j['referencePrice']),
      discount = DecimalValue.parse(j['discountPercentage']),
      currency = requiredText(j, 'currency'),
      market = j['market'] as String?,
      productUrl = j['productUrl'] as String?,
      affiliateUrl = j['affiliateUrl'] as String?,
      availability = j['availability'] as String? ?? 'UNKNOWN',
      updatedAt = DateTime.tryParse(j['lastUpdatedAt'] as String? ?? ''),
      expiresAt = DateTime.tryParse(j['expiresAt'] as String? ?? ''),
      stale = j['isStale'] == true,
      synthetic =
          j['isSynthetic'] != false ||
          object(j['product'])['isSynthetic'] != false ||
          object(j['merchant'])['isSynthetic'] != false,
      trustedReference = j['referencePriceTrusted'] == true,
      shipping = DecimalValue.parse(j['shippingCost']),
      score = DecimalValue.parse(j['dealScore']),
      classification = j['scoreClassification'] as String?,
      components = (j['scoreComponents'] as Map<String, dynamic>? ?? {}).map(
        (k, v) => MapEntry(k, v.toString()),
      ),
      reasons = (j['scoreReasons'] as List? ?? []).whereType<String>().toList();
  final String id, productId, name, merchant, currency, availability;
  final String? description,
      imageUrl,
      market,
      productUrl,
      affiliateUrl,
      classification;
  final DecimalValue? current, reference, discount, shipping, score;
  final DateTime? updatedAt, expiresAt;
  final bool stale, synthetic, trustedReference;
  final Map<String, String> components;
  final List<String> reasons;
  bool get expired => expiresAt != null && !expiresAt!.isAfter(DateTime.now());
  bool get valid =>
      !expired &&
      !stale &&
      current?.positive == true &&
      availability != 'UNAVAILABLE';
  bool get hasDiscount =>
      trustedReference &&
      current?.positive == true &&
      reference != null &&
      reference!.compareTo(current!) > 0 &&
      discount?.positive == true &&
      discount!.compareTo(DecimalValue.parse('100')!) <= 0;
}

class CatalogOption {
  CatalogOption.fromJson(Map<String, dynamic> j)
    : id = requiredText(j, 'id'),
      name = requiredText(j, 'name'),
      synthetic = j['isSynthetic'] != false;
  final String id, name;
  final bool synthetic;
}

class CatalogPage<T> {
  const CatalogPage(this.items, this.page, this.totalPages, this.total);
  final List<T> items;
  final int page, totalPages, total;
  bool get hasMore => page < totalPages;
}

class CatalogQuery {
  const CatalogQuery({
    this.search = '',
    this.currency = 'USD',
    this.market = '',
    this.category = '',
    this.merchant = '',
    this.minPrice = '',
    this.maxPrice = '',
    this.sort = 'score_desc',
    this.view = 'discounted',
  });
  final String search,
      currency,
      market,
      category,
      merchant,
      minPrice,
      maxPrice,
      sort,
      view;
  Map<String, dynamic> parameters({int page = 1, int pageSize = 20}) => {
    'page': page,
    'pageSize': pageSize,
    'sort': sort,
    'view': view,
    if (search.trim().isNotEmpty) 'q': search.trim(),
    if (currency.isNotEmpty) 'currency': currency,
    if (market.isNotEmpty) 'market': market,
    if (category.isNotEmpty) 'categoryId': category,
    if (merchant.isNotEmpty) 'merchantId': merchant,
    if (minPrice.isNotEmpty) 'minPrice': minPrice,
    if (maxPrice.isNotEmpty) 'maxPrice': maxPrice,
  };
  CatalogQuery copyWith({
    String? search,
    String? currency,
    String? market,
    String? category,
    String? merchant,
    String? minPrice,
    String? maxPrice,
    String? sort,
    String? view,
  }) => CatalogQuery(
    search: search ?? this.search,
    currency: currency ?? this.currency,
    market: market ?? this.market,
    category: category ?? this.category,
    merchant: merchant ?? this.merchant,
    minPrice: minPrice ?? this.minPrice,
    maxPrice: maxPrice ?? this.maxPrice,
    sort: sort ?? this.sort,
    view: view ?? this.view,
  );
  @override
  bool operator ==(Object other) =>
      other is CatalogQuery && toString() == other.toString();
  @override
  int get hashCode => toString().hashCode;
  @override
  String toString() =>
      Uri(queryParameters: parameters().map((k, v) => MapEntry(k, '$v'))).query;
}
