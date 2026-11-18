import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/explore_controller.dart';
import '../data/catalog_repository.dart';
import '../domain/models.dart';
import '../../preferences/preferences.dart';
import '../../../core/widgets.dart';

class FiltersSheet extends ConsumerStatefulWidget {
  const FiltersSheet({super.key});
  @override
  ConsumerState<FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends ConsumerState<FiltersSheet> {
  final form = GlobalKey<FormState>();
  late CatalogQuery query;
  late TextEditingController min, max, currency, market;
  @override
  void initState() {
    super.initState();
    query = ref.read(exploreProvider).query;
    min = TextEditingController(text: query.minPrice);
    max = TextEditingController(text: query.maxPrice);
    currency = TextEditingController(text: query.currency);
    market = TextEditingController(text: query.market);
  }

  @override
  void dispose() {
    min.dispose();
    max.dispose();
    currency.dispose();
    market.dispose();
    super.dispose();
  }

  String? price(String? value) =>
      value == null ||
          value.isEmpty ||
          RegExp(r'^\d{1,18}(\.\d{1,6})?$').hasMatch(value)
      ? null
      : 'Enter a positive decimal';
  Widget option(
    String type,
    String label,
    String value,
    ValueChanged<String> onChange,
  ) => ref
      .watch(optionsProvider(type))
      .when(
        data: (rows) => DropdownButtonFormField<String>(
          initialValue: rows.any((v) => v.id == value) ? value : '',
          isExpanded: true,
          decoration: InputDecoration(labelText: label),
          items: [
            const DropdownMenuItem(value: '', child: Text('All')),
            ...rows.map(
              (v) => DropdownMenuItem(
                value: v.id,
                child: Text(
                  v.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
          onChanged: (v) => onChange(v ?? ''),
        ),
        loading: () => const LinearProgressIndicator(),
        error: (e, s) => TextButton(
          onPressed: () => ref.invalidate(optionsProvider(type)),
          child: Text('Retry $label'),
        ),
      );
  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      24,
      20,
      24,
      24 + MediaQuery.viewInsetsOf(context).bottom,
    ),
    child: SingleChildScrollView(
      child: Form(
        key: form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Make it your find',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'Close filters',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 16),
            option(
              'categories',
              'Category',
              query.category,
              (v) => query = query.copyWith(category: v),
            ),
            const SizedBox(height: 12),
            option(
              'merchants',
              'Store',
              query.merchant,
              (v) => query = query.copyWith(merchant: v),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: market,
                    maxLength: 2,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Market (ISO country)',
                      hintText: 'US or leave blank',
                    ),
                    validator: (v) =>
                        v!.isEmpty ||
                            RegExp(r'^[A-Z]{2}$').hasMatch(v.toUpperCase())
                        ? null
                        : 'Use two letters',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: currency,
                    maxLength: 3,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Currency',
                      hintText: 'USD',
                    ),
                    validator: (v) =>
                        RegExp(r'^[A-Z]{3}$').hasMatch(v!.toUpperCase())
                        ? null
                        : 'Use three letters',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: min,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Minimum price',
                    ),
                    validator: price,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: max,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Maximum price',
                    ),
                    validator: (v) {
                      final error = price(v);
                      if (error != null) return error;
                      final lo = DecimalValue.parse(min.text),
                          hi = DecimalValue.parse(v);
                      return lo != null && hi != null && hi.compareTo(lo) < 0
                          ? 'Must be at least minimum'
                          : null;
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'Prices are compared within one currency. Changing currency clears the price range.',
              style: TextStyle(fontSize: 12),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                TextButton(
                  onPressed: () {
                    final s = ref.read(settingsProvider);
                    ref
                        .read(exploreProvider.notifier)
                        .select(
                          CatalogQuery(currency: s.currency, market: s.market),
                        );
                    Navigator.pop(context);
                  },
                  child: const Text('Reset all'),
                ),
                const Spacer(),
                FilledButton(
                  onPressed: () {
                    if (!form.currentState!.validate()) return;
                    final code = currency.text.toUpperCase();
                    final changed = code != query.currency;
                    saveFeedback(
                      context,
                      ref
                          .read(settingsProvider.notifier)
                          .update(
                            ref
                                .read(settingsProvider)
                                .copyWith(
                                  currency: code,
                                  market: market.text.toUpperCase(),
                                ),
                          ),
                    );
                    ref
                        .read(exploreProvider.notifier)
                        .select(
                          query.copyWith(
                            currency: code,
                            market: market.text.toUpperCase(),
                            minPrice: changed ? '' : min.text,
                            maxPrice: changed ? '' : max.text,
                            view: changed ? 'discounted' : query.view,
                          ),
                        );
                    Navigator.pop(context);
                  },
                  child: const Text('Show results'),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}
