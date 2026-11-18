import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/config.dart';
import '../../../core/retention.dart';
import '../../../core/widgets.dart';
import '../../preferences/preferences.dart';
import '../domain/models.dart';
import '../data/catalog_repository.dart';

class ProductImage extends StatelessWidget {
  const ProductImage(this.offer, {super.key, this.height = 140});
  final Offer offer;
  final double height;
  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      height: height,
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Theme.of(context).colorScheme.primaryContainer,
            Theme.of(context).colorScheme.surfaceContainerLow,
          ],
        ),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.inventory_2_outlined,
              size: 48,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: 8),
            Text(
              offer.synthetic ? 'DEMO PRODUCT' : 'No image available',
              style: const TextStyle(fontSize: 10, letterSpacing: 1.5),
            ),
          ],
        ),
      ),
    );
    // Synthetic fixtures do not fetch external images. No disk image cache.
    final uri = offer.synthetic ? null : safeExternalUri(offer.imageUrl);
    if (uri == null) return placeholder;
    return Image.network(
      uri.toString(),
      height: height,
      width: double.infinity,
      fit: BoxFit.contain,
      cacheWidth: 640,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : placeholder,
      errorBuilder: (context, error, stack) => placeholder,
    );
  }
}

class FavoriteButton extends ConsumerWidget {
  const FavoriteButton(this.offer, {super.key});
  final Offer offer;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saved = ref.watch(
      favoritesProvider.select((v) => v.any((e) => e.id == offer.id)),
    );
    return IconButton.filledTonal(
      tooltip: saved ? 'Remove favorite' : 'Save favorite',
      onPressed: () => saveFeedback(
        context,
        ref.read(favoritesProvider.notifier).toggle((
          id: offer.id,
          productId: offer.productId,
        )),
      ),
      icon: Icon(
        saved ? Icons.favorite_rounded : Icons.favorite_border_rounded,
        size: 21,
      ),
    );
  }
}

class PriceLabel extends StatelessWidget {
  const PriceLabel(this.offer, {super.key, this.large = false});
  final Offer offer;
  final bool large;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      FittedBox(
        fit: BoxFit.scaleDown,
        alignment: AlignmentDirectional.centerStart,
        child: Text(
          offer.current?.format(offer.currency) ?? 'Price unavailable',
          style:
              (large
                      ? Theme.of(context).textTheme.headlineMedium
                      : Theme.of(context).textTheme.titleLarge)
                  ?.copyWith(fontWeight: FontWeight.w800),
        ),
      ),
      if (offer.hasDiscount)
        Wrap(
          spacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              offer.reference!.format(offer.currency),
              style: const TextStyle(
                decoration: TextDecoration.lineThrough,
                fontSize: 12,
              ),
            ),
            Text(
              '-${offer.discount}%',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
          ],
        ),
    ],
  );
}

class OfferCard extends ConsumerWidget {
  const OfferCard(this.offer, {super.key});
  final Offer offer;
  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      ref.watch(expiredProvider(offer.expiresAt))
      ? Card(
          child: ListTile(
            leading: const Icon(Icons.timer_off_outlined),
            title: const Text('Offer expired'),
            trailing: FavoriteButton(offer),
          ),
        )
      : Card(
          clipBehavior: Clip.antiAlias,
          margin: const EdgeInsets.all(6),
          child: InkWell(
            onTap: () {
              ref.invalidate(
                offerProvider((id: offer.id, productId: offer.productId)),
              );
              context.push(
                '/deals/${Uri.encodeComponent(offer.id)}?productId=${Uri.encodeComponent(offer.productId)}',
              );
            },
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Stack(
                  children: [
                    ProductImage(offer),
                    Positioned(top: 6, right: 6, child: FavoriteButton(offer)),
                    if (offer.classification == 'TOP_DEAL')
                      Positioned(
                        bottom: 8,
                        left: 10,
                        child: Chip(
                          visualDensity: VisualDensity.compact,
                          avatar: const Icon(Icons.auto_awesome, size: 14),
                          label: const Text(
                            'Top deal',
                            style: TextStyle(fontSize: 10),
                          ),
                        ),
                      ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        offer.merchant,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 10,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        offer.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          height: 1.3,
                        ),
                      ),
                      const SizedBox(height: 10),
                      PriceLabel(offer),
                      const SizedBox(height: 8),
                      Text(
                        offer.stale
                            ? 'Needs an update'
                            : switch (offer.availability) {
                                'AVAILABLE' => 'Available',
                                'UNAVAILABLE' => 'Unavailable',
                                _ => 'Availability unknown',
                              },
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
}
