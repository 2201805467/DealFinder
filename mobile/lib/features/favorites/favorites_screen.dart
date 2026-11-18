import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/widgets.dart';
import '../preferences/preferences.dart';
import '../catalog/data/catalog_repository.dart';
import '../catalog/presentation/offer_card.dart';

class FavoritesScreen extends ConsumerWidget {
  const FavoritesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ids = ref.watch(favoritesProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Saved finds',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              const Text('Your shortlist. Prices checked fresh.'),
            ],
          ),
        ),
        Expanded(
          child: ids.isEmpty
              ? const MessageState(
                  'Keep a good find close',
                  'Tap the heart on any product to save it here.',
                  icon: Icons.favorite_border,
                )
              : RefreshIndicator(
                  onRefresh: () async {
                    for (final id in ids) {
                      ref.invalidate(offerProvider(id));
                    }
                    try {
                      await ref.read(offerProvider(ids.first).future);
                    } catch (_) {
                      /* Each row displays its error. */
                    }
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: ids.length,
                    itemBuilder: (context, i) {
                      final id = ids[i];
                      return ref
                          .watch(offerProvider(id))
                          .when(
                            loading: () => const Skeleton(),
                            data: (offer) => Column(
                              children: [
                                if (!offer.valid)
                                  const ListTile(
                                    leading: Icon(Icons.update),
                                    title: Text(
                                      'This saved offer needs an update.',
                                    ),
                                  ),
                                OfferCard(offer),
                              ],
                            ),
                            error: (e, s) => Card(
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      e is CatalogException && e.unavailable
                                          ? 'Saved offer unavailable'
                                          : 'Could not refresh saved offer',
                                      style: Theme.of(
                                        context,
                                      ).textTheme.titleMedium,
                                    ),
                                    const SizedBox(height: 8),
                                    Text(e.toString()),
                                    Row(
                                      children: [
                                        TextButton(
                                          onPressed: () =>
                                              ref.invalidate(offerProvider(id)),
                                          child: const Text('Retry'),
                                        ),
                                        const Spacer(),
                                        TextButton(
                                          onPressed: () => saveFeedback(
                                            context,
                                            ref
                                                .read(
                                                  favoritesProvider.notifier,
                                                )
                                                .toggle(id),
                                          ),
                                          child: const Text('Remove'),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}
