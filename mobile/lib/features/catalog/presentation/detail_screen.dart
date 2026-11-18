import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/config.dart';
import '../../../core/retention.dart';
import '../../../core/widgets.dart';
import '../data/catalog_repository.dart';
import '../domain/models.dart';
import 'offer_card.dart';

final openLinkProvider = Provider<Future<bool> Function(Uri)>(
  (ref) =>
      (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
);
Uri? shoppingLink(Offer offer) => offer.synthetic || !offer.valid
    ? null
    : safeExternalUri(offer.affiliateUrl) ?? safeExternalUri(offer.productUrl);
String plainDescription(String value) => value
    .replaceAll(RegExp(r'<[^>]*>'), ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

class DetailScreen extends ConsumerWidget {
  const DetailScreen({super.key, required this.id, this.productId});
  final String id;
  final String? productId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final key = (id: id, productId: productId);
    return Scaffold(
      appBar: AppBar(title: const Text('The good details')),
      body: Column(
        children: [
          const DemoNotice(),
          Expanded(
            child: ref
                .watch(offerProvider(key))
                .when(
                  loading: () => const Skeleton(height: 450),
                  error: (e, s) => MessageState(
                    e is CatalogException && e.unavailable
                        ? 'Offer unavailable'
                        : 'Could not load offer',
                    e.toString(),
                    retry: () => ref.invalidate(offerProvider(key)),
                  ),
                  data: (offer) => ref.watch(expiredProvider(offer.expiresAt))
                      ? const MessageState(
                          'Offer expired',
                          'This offer is no longer valid. Refresh your saved finds for current availability.',
                        )
                      : RefreshIndicator(
                          onRefresh: () async {
                            ref.invalidate(offerProvider(key));
                            try {
                              await ref.read(offerProvider(key).future);
                            } catch (_) {
                              /* Async error state displays the failure. */
                            }
                          },
                          child: ListView(
                            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(24),
                                child: ProductImage(offer, height: 280),
                              ),
                              const SizedBox(height: 20),
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      offer.merchant,
                                      style: TextStyle(
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.primary,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  FavoriteButton(offer),
                                ],
                              ),
                              Text(
                                offer.name,
                                style: Theme.of(context).textTheme.headlineSmall
                                    ?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 16),
                              PriceLabel(offer, large: true),
                              const SizedBox(height: 16),
                              if (!offer.valid)
                                const Card(
                                  child: Padding(
                                    padding: EdgeInsets.all(12),
                                    child: Text(
                                      'This offer needs an update or is no longer available. Shopping is disabled.',
                                    ),
                                  ),
                                ),
                              Wrap(
                                spacing: 8,
                                children: [
                                  Chip(
                                    label: Text(switch (offer.availability) {
                                      'AVAILABLE' => 'Available',
                                      'UNAVAILABLE' => 'Unavailable',
                                      _ => 'Availability unknown',
                                    }),
                                  ),
                                  if (offer.market != null)
                                    Chip(label: Text(offer.market!)),
                                  Chip(label: Text(offer.currency)),
                                  if (offer.synthetic)
                                    const Chip(label: Text('Synthetic demo')),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'Shipping: ${offer.shipping?.format(offer.currency) ?? 'not provided by the store'}',
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Last updated: ${offer.updatedAt?.toLocal().toIso8601String().split('.').first.replaceFirst('T', ' ') ?? 'Unknown'}',
                              ),
                              if (offer.description?.isNotEmpty == true) ...[
                                const SizedBox(height: 24),
                                Text(
                                  'About this find',
                                  style: Theme.of(
                                    context,
                                  ).textTheme.titleMedium,
                                ),
                                const SizedBox(height: 8),
                                SelectableText(
                                  plainDescription(offer.description!),
                                ),
                              ],
                              if (offer.score != null) ...[
                                const SizedBox(height: 24),
                                Card(
                                  child: Padding(
                                    padding: const EdgeInsets.all(18),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'Deal score ${offer.score} / 100',
                                          style: Theme.of(
                                            context,
                                          ).textTheme.titleMedium,
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          offer.classification == 'TOP_DEAL'
                                              ? 'A top deal based on savings, freshness and data quality.'
                                              : 'A score helps you compare quality, beyond the discount.',
                                        ),
                                        ...offer.components.entries.map(
                                          (e) => Padding(
                                            padding: const EdgeInsets.only(
                                              top: 6,
                                            ),
                                            child: Row(
                                              children: [
                                                Expanded(
                                                  child: Text(
                                                    e.key.replaceAll('_', ' '),
                                                  ),
                                                ),
                                                Text(e.value),
                                              ],
                                            ),
                                          ),
                                        ),
                                        if (offer.reasons.contains(
                                          'SHIPPING_UNKNOWN',
                                        ))
                                          const Padding(
                                            padding: EdgeInsets.only(top: 8),
                                            child: Text(
                                              'Shipping costs are unknown and are not treated as free.',
                                            ),
                                          ),
                                        ...offer.reasons
                                            .where(
                                              (r) => r != 'SHIPPING_UNKNOWN',
                                            )
                                            .map(
                                              (r) => Text(
                                                r.toLowerCase().replaceAll(
                                                  '_',
                                                  ' ',
                                                ),
                                              ),
                                            ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                              const SizedBox(height: 24),
                              FilledButton.icon(
                                icon: const Icon(Icons.open_in_new),
                                label: const Text('View Deal'),
                                onPressed: shoppingLink(offer) == null
                                    ? null
                                    : () async {
                                        try {
                                          final success = await ref.read(
                                            openLinkProvider,
                                          )(shoppingLink(offer)!);
                                          if (!success && context.mounted) {
                                            ScaffoldMessenger.of(
                                              context,
                                            ).showSnackBar(
                                              const SnackBar(
                                                content: Text(
                                                  'Could not open this store link.',
                                                ),
                                              ),
                                            );
                                          }
                                        } catch (_) {
                                          if (context.mounted) {
                                            ScaffoldMessenger.of(
                                              context,
                                            ).showSnackBar(
                                              const SnackBar(
                                                content: Text(
                                                  'Could not open this store link.',
                                                ),
                                              ),
                                            );
                                          }
                                        }
                                      },
                              ),
                              const SizedBox(height: 8),
                              Text(
                                offer.synthetic
                                    ? 'Demo product. No purchase is available.'
                                    : 'Purchases happen at the original store. Eligible links may earn us a commission.',
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                ),
          ),
        ],
      ),
    );
  }
}
