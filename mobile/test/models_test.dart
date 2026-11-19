import 'package:flutter_test/flutter_test.dart';
import 'package:dealfinder_mobile/core/config.dart';
import 'package:dealfinder_mobile/features/catalog/domain/models.dart';
import 'package:dealfinder_mobile/features/catalog/presentation/detail_screen.dart';
import 'support.dart';

void main() {
  test(
    'QA: zero prices remain exact and missing currency never invents a price',
    () {
      final zero = Offer.fromJson({
        ...fixture(price: '0'),
        'referencePrice': '10',
        'discountPercentage': '100',
      });
      expect(zero.valid, isTrue);
      expect(zero.hasDiscount, isTrue);
      expect(zero.current!.format('USD'), 'USD 0.00');
      final missing = Offer.fromJson(fixture()..remove('currency'));
      expect(missing.current, isNull);
      expect(missing.valid, isFalse);
      expect(DecimalValue.parse('1' * 10000), isNull);
    },
  );
  test('Decimal strings retain cents and arbitrarily large integers', () {
    expect(
      DecimalValue.parse('12345678901234567890.001')!.format('LYD'),
      'LYD 12,345,678,901,234,567,890.001',
    );
    expect(
      DecimalValue.parse('0.10')!.compareTo(DecimalValue.parse('0.1')!),
      0,
    );
    expect(
      DecimalValue.parse('0.09')!.compareTo(DecimalValue.parse('0.1')!),
      -1,
    );
  });
  test('Reject invalid and floating point prices', () {
    for (final value in [null, 1.23, '-1', 'NaN', 'Infinity', '1e3', '']) {
      expect(DecimalValue.parse(value), isNull);
    }
  });
  test('Parse actual DTO shape and optional fields', () {
    final offer = Offer.fromJson(fixture());
    expect(offer.current!.value, '19.99');
    expect(offer.hasDiscount, isTrue);
    expect(offer.imageUrl, isNull);
    expect(offer.shipping, isNull);
    expect(offer.valid, isTrue);
  });
  test('Missing optional values do not invent price or discount', () {
    final j = fixture()
      ..remove('referencePrice')
      ..remove('currentPrice')
      ..remove('discountPercentage')
      ..remove('availability')
      ..remove('scoreReasons');
    final offer = Offer.fromJson(j);
    expect(offer.current, isNull);
    expect(offer.hasDiscount, isFalse);
    expect(offer.availability, 'UNKNOWN');
  });
  test('Invalid reference or untrusted discount is hidden', () {
    for (final patch in [
      {'referencePrice': '10'},
      {'referencePriceTrusted': false},
      {'discountPercentage': '101'},
      {'currentPrice': '-9'},
    ]) {
      expect(Offer.fromJson({...fixture(), ...patch}).hasDiscount, isFalse);
    }
  });
  test('Expired and stale offers are invalid', () {
    expect(
      Offer.fromJson({...fixture(), 'expiresAt': '2020-01-01T00:00:00Z'}).valid,
      isFalse,
    );
    expect(Offer.fromJson({...fixture(), 'isStale': true}).valid, isFalse);
  });
  test('Unknown provenance fails closed', () {
    expect(Offer.fromJson(fixture()..remove('isSynthetic')).synthetic, isTrue);
  });
  test('Unsafe links are rejected', () {
    for (final value in [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'http://store.com',
      'https://user:pass@store.com',
      'https://127.0.0.1/a',
      'https://10.0.0.1/a',
      'https://[::1]/a',
      'https://shop.example.invalid',
      'https://store.local',
      'https://store.com:444/a',
      'https://0x7f.0.0.1/a',
      'https://metadata.google.internal/a',
    ]) {
      expect(safeExternalUri(value), isNull, reason: value);
    }
    expect(safeExternalUri('https://store.com/products/1'), isNotNull);
  });
  test(
    'Shopping disabled for synthetic, expired, stale and unavailable data',
    () {
      for (final patch in [
        {},
        {'isStale': true},
        {'availability': 'UNAVAILABLE'},
      ]) {
        expect(
          shoppingLink(
            Offer.fromJson({
              ...fixture(),
              'productUrl': 'https://store.com',
              ...patch,
            }),
          ),
          isNull,
        );
      }
    },
  );
  test('Valid affiliate wins with a safe original fallback', () {
    final j = fixture(synthetic: false)
      ..['productUrl'] = 'https://store.com/product'
      ..['affiliateUrl'] = 'https://partner.com/a';
    expect(shoppingLink(Offer.fromJson(j))!.host, 'partner.com');
    j['affiliateUrl'] = 'javascript:alert(1)';
    expect(shoppingLink(Offer.fromJson(j))!.host, 'store.com');
  });
  test(
    'Release disables demo even if explicitly requested and requires HTTPS',
    () {
      const c = AppConfig(
        baseUrl: 'http://10.0.2.2:3000/api/v1',
        release: true,
        requestedDemo: true,
      );
      expect(c.demo, isFalse);
      expect(c.valid, isFalse);
    },
  );
  test('Query matches strict backend contract', () {
    final q = const CatalogQuery(
      currency: 'LYD',
      market: 'LY',
      minPrice: '0.01',
      search: ' cable ',
      category: 'cat',
      merchant: 'store',
    ).parameters(page: 3);
    expect(q['q'], 'cable');
    expect(q['page'], 3);
    expect(q['minPrice'], '0.01');
    expect(q['currency'], 'LYD');
    expect(q.containsKey('availability'), isFalse);
  });
}
