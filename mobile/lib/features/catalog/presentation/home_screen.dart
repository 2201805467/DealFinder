import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/widgets.dart';
import '../../preferences/preferences.dart';
import '../application/explore_controller.dart';
import '../data/catalog_repository.dart';
import '../domain/models.dart';
import 'offer_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    final base = CatalogQuery(
      currency: settings.currency,
      market: settings.market,
    );
    final sections = [
      (
        'Top Deals',
        'More than a discount',
        base.copyWith(view: 'top', sort: 'score_desc'),
      ),
      (
        'Latest Deals',
        'Fresh finds, just updated',
        base.copyWith(sort: 'newest'),
      ),
      (
        'Low Price Products',
        'Under ${settings.currency} 20 · No currency conversion',
        base.copyWith(view: 'low_price', sort: 'price_asc', maxPrice: '20'),
      ),
      (
        'Biggest Discounts',
        'Savings with a trusted reference',
        base.copyWith(sort: 'discount_desc', view: 'discounted'),
      ),
    ];
    return RefreshIndicator(
      onRefresh: () async {
        for (final section in sections) {
          ref.invalidate(offersProvider(section.$3));
        }
        ref.invalidate(optionsProvider('categories'));
        try {
          await ref.read(offersProvider(sections.first.$3).future);
        } catch (_) {
          /* Rendered by AsyncValue. */
        }
      },
      child: ListView.builder(
        key: const PageStorageKey('home'),
        padding: const EdgeInsets.only(bottom: 24),
        itemCount: sections.length + 1,
        itemBuilder: (context, index) {
          if (index > 0) {
            return HomeSection(
              title: sections[index - 1].$1,
              subtitle: sections[index - 1].$2,
              query: sections[index - 1].$3,
            );
          }
          return Padding(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primary,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        Icons.local_offer_rounded,
                        color: Theme.of(context).colorScheme.onPrimary,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: AlignmentDirectional.centerStart,
                        child: Text(
                          'dealfinder',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -1,
                          ),
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Shopping preferences',
                      onPressed: () => context.go('/settings'),
                      icon: const Icon(Icons.tune_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text(
                  'Good finds.\nBetter prices.',
                  style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1.1,
                    height: 1.12,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'A little discovery. A smarter shopping day.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 20),
                SearchBar(
                  hintText: 'Find your next good deal',
                  leading: const Icon(Icons.search),
                  onTap: () => context.go('/explore'),
                  readOnly: true,
                  elevation: const WidgetStatePropertyAll(0),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    ActionChip(
                      avatar: const Icon(Icons.public, size: 16),
                      label: Text(
                        settings.market.isEmpty
                            ? 'All markets'
                            : settings.market,
                      ),
                      onPressed: () => context.go('/settings'),
                    ),
                    ActionChip(
                      avatar: const Icon(Icons.payments_outlined, size: 16),
                      label: Text(settings.currency),
                      onPressed: () => context.go('/settings'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ref
                    .watch(optionsProvider('categories'))
                    .when(
                      data: (options) => SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: options
                              .map(
                                (c) => Padding(
                                  padding: const EdgeInsetsDirectional.only(
                                    end: 8,
                                  ),
                                  child: ActionChip(
                                    label: Text(c.name),
                                    onPressed: () {
                                      ref
                                          .read(exploreProvider.notifier)
                                          .select(
                                            base.copyWith(category: c.id),
                                          );
                                      context.go('/explore');
                                    },
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      ),
                      loading: () =>
                          const LinearProgressIndicator(minHeight: 2),
                      error: (e, s) => TextButton(
                        onPressed: () =>
                            ref.invalidate(optionsProvider('categories')),
                        child: const Text('Reload categories'),
                      ),
                    ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class HomeSection extends ConsumerWidget {
  const HomeSection({
    super.key,
    required this.title,
    required this.subtitle,
    required this.query,
  });
  final String title, subtitle;
  final CatalogQuery query;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Padding(
    padding: const EdgeInsets.only(top: 22),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: () {
                  ref.read(exploreProvider.notifier).select(query);
                  context.go('/explore');
                },
                child: const Text('See all'),
              ),
            ],
          ),
        ),
        ref
            .watch(offersProvider(query))
            .when(
              data: (page) => page.items.isEmpty
                  ? const MessageState(
                      'No finds here yet',
                      'Try another currency or market.',
                    )
                  : SizedBox(
                      height:
                          420 +
                          (MediaQuery.textScalerOf(context).scale(14) / 14 - 1)
                                  .clamp(0, 3) *
                              220,
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        scrollDirection: Axis.horizontal,
                        itemCount: page.items.length,
                        itemBuilder: (context, i) => SizedBox(
                          width: MediaQuery.textScalerOf(context).scale(14) > 18
                              ? MediaQuery.sizeOf(context).width - 32
                              : 215,
                          child: OfferCard(page.items[i]),
                        ),
                      ),
                    ),
              loading: () => SizedBox(
                height: 300,
                child: Row(
                  children: const [
                    Expanded(child: Skeleton()),
                    Expanded(child: Skeleton()),
                  ],
                ),
              ),
              error: (e, s) => MessageState(
                'Could not load deals',
                e.toString(),
                retry: () => ref.invalidate(offersProvider(query)),
              ),
            ),
      ],
    ),
  );
}
