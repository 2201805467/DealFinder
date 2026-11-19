import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/widgets.dart';
import '../../preferences/preferences.dart';
import '../application/explore_controller.dart';
import '../domain/models.dart';
import 'offer_card.dart';
import 'filters_sheet.dart';

class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key});
  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen> {
  final search = TextEditingController();
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(exploreProvider);
    final control = ref.read(exploreProvider.notifier);
    if (search.text != state.query.search) {
      search.value = TextEditingValue(
        text: state.query.search,
        selection: TextSelection.collapsed(offset: state.query.search.length),
      );
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Explore',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 14),
              Semantics(
                label: 'Search products',
                child: SearchBar(
                  controller: search,
                  hintText: 'Search products',
                  leading: const Icon(Icons.search),
                  onChanged: control.search,
                  elevation: const WidgetStatePropertyAll(0),
                  trailing: [
                    if (search.text.isNotEmpty)
                      IconButton(
                        tooltip: 'Clear search',
                        onPressed: () {
                          search.clear();
                          control.search('');
                        },
                        icon: const Icon(Icons.close),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: DropdownButton<String>(
                      isExpanded: true,
                      value: state.query.sort,
                      underline: const SizedBox(),
                      items:
                          const {
                                'score_desc': 'Best score',
                                'newest': 'Newest',
                                'discount_desc': 'Biggest discount',
                                'price_asc': 'Price: low to high',
                                'price_desc': 'Price: high to low',
                              }.entries
                              .map(
                                (e) => DropdownMenuItem(
                                  value: e.key,
                                  child: Text(e.value),
                                ),
                              )
                              .toList(),
                      onChanged: (v) {
                        if (v != null) {
                          control.select(state.query.copyWith(sort: v));
                        }
                      },
                    ),
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton.icon(
                    onPressed: () => showModalBottomSheet<void>(
                      context: context,
                      isScrollControlled: true,
                      useSafeArea: true,
                      builder: (_) => const FiltersSheet(),
                    ),
                    icon: const Icon(Icons.tune, size: 18),
                    label: const Text('Filters'),
                  ),
                ],
              ),
              Wrap(
                spacing: 6,
                children: [
                  Chip(label: Text(state.query.currency)),
                  if (state.query.market.isNotEmpty)
                    Chip(label: Text(state.query.market)),
                  if (state.query.view == 'low_price')
                    Chip(label: Text('Under ${state.query.maxPrice}')),
                  if (state.query.category.isNotEmpty ||
                      state.query.merchant.isNotEmpty ||
                      state.query.minPrice.isNotEmpty ||
                      state.query.maxPrice.isNotEmpty)
                    ActionChip(
                      label: const Text('Reset filters'),
                      onPressed: () {
                        final s = ref.read(settingsProvider);
                        control.select(
                          CatalogQuery(
                            currency: s.currency,
                            market: s.market,
                            search: state.query.search,
                          ),
                        );
                      },
                    ),
                ],
              ),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: control.refresh,
            child: NotificationListener<ScrollNotification>(
              onNotification: (n) {
                if (n.metrics.extentAfter < 450 &&
                    state.hasMore &&
                    !state.loading &&
                    state.error == null) {
                  control.load();
                }
                return false;
              },
              child: CustomScrollView(
                key: const PageStorageKey('explore'),
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  if (state.items.isEmpty && state.loading)
                    const SliverToBoxAdapter(
                      child: Row(
                        children: [
                          Expanded(child: Skeleton()),
                          Expanded(child: Skeleton()),
                        ],
                      ),
                    ),
                  if (state.items.isEmpty &&
                      !state.loading &&
                      state.error == null)
                    const SliverFillRemaining(
                      hasScrollBody: false,
                      child: MessageState(
                        'Nothing found yet',
                        'Try a different search or reset your filters.',
                      ),
                    ),
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    sliver: SliverLayoutBuilder(
                      builder: (context, constraints) => SliverGrid(
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount:
                              (constraints.crossAxisExtent /
                                      (MediaQuery.textScalerOf(
                                                context,
                                              ).scale(14) >
                                              18
                                          ? 320
                                          : 180))
                                  .floor()
                                  .clamp(1, 4),
                          mainAxisExtent:
                              420 +
                              (MediaQuery.textScalerOf(context).scale(14) / 14 -
                                          1)
                                      .clamp(0, 3) *
                                  220,
                        ),
                        delegate: SliverChildBuilderDelegate(
                          (context, i) => OfferCard(state.items[i]),
                          childCount: state.items.length,
                        ),
                      ),
                    ),
                  ),
                  if (state.error != null)
                    SliverToBoxAdapter(
                      child: MessageState(
                        'Could not load products',
                        state.error.toString(),
                        retry: control.load,
                      ),
                    ),
                  if (state.limited)
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Text(
                          'Showing the first 1,000 results. Refine your search or filters to see more.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                  if (state.items.isNotEmpty && state.loading)
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Center(child: CircularProgressIndicator()),
                      ),
                    ),
                  if (state.hasMore && !state.loading && state.error == null)
                    SliverToBoxAdapter(
                      child: Center(
                        child: TextButton(
                          onPressed: control.load,
                          child: const Text('Load more'),
                        ),
                      ),
                    ),
                  const SliverToBoxAdapter(child: SizedBox(height: 24)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
