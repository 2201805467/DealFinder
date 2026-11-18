import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/widgets.dart';
import 'preferences.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          'Make yourself at home',
          style: Theme.of(
            context,
          ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        const Text('Your markets, your currency, your look.'),
        const SizedBox(height: 24),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'SHOPPING PREFERENCES',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.5,
                  ),
                ),
                const SizedBox(height: 16),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.public),
                  title: const Text('Country / market'),
                  subtitle: Text(
                    settings.market.isEmpty ? 'All markets' : settings.market,
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _editCode(context, ref, currency: false),
                ),
                const Divider(),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.payments_outlined),
                  title: const Text('Currency'),
                  subtitle: Text(settings.currency),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _editCode(context, ref, currency: true),
                ),
                const Text(
                  'Only matching prices are shown. No currency conversion. Market availability does not guarantee shipping.',
                  style: TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'APPEARANCE',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.5,
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: SegmentedButton<ThemeMode>(
                    segments: const [
                      ButtonSegment(
                        value: ThemeMode.light,
                        label: Text('Light'),
                        icon: Icon(Icons.light_mode_outlined),
                      ),
                      ButtonSegment(
                        value: ThemeMode.dark,
                        label: Text('Dark'),
                        icon: Icon(Icons.dark_mode_outlined),
                      ),
                      ButtonSegment(
                        value: ThemeMode.system,
                        label: Text('Auto'),
                        icon: Icon(Icons.settings_brightness_outlined),
                      ),
                    ],
                    selected: {settings.theme},
                    onSelectionChanged: (v) => saveFeedback(
                      context,
                      ref
                          .read(settingsProvider.notifier)
                          .update(settings.copyWith(theme: v.first)),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'A smarter way to discover',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 10),
        const Text(
          'DealFinder brings offers from independent stores into one place. We do not sell products, take payments, manage shipping or guarantee store prices. Always check the final details at the store.',
        ),
        const SizedBox(height: 20),
        Text(
          'Affiliate disclosure',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        const Text(
          'When an approved affiliate link is used, DealFinder may earn a commission. This does not change the price shown. No commercial source is currently enabled in this demo.',
        ),
        const SizedBox(height: 24),
        const Text(
          'DealFinder · 0.1.0\nMade for curious, thoughtful shoppers.',
          style: TextStyle(fontSize: 12),
        ),
      ],
    );
  }

  Future<void> _editCode(
    BuildContext context,
    WidgetRef ref, {
    required bool currency,
  }) async {
    final s = ref.read(settingsProvider);
    final controller = TextEditingController(
      text: currency ? s.currency : s.market,
    );
    final form = GlobalKey<FormState>();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(currency ? 'Choose currency' : 'Choose country / market'),
        content: Form(
          key: form,
          child: TextFormField(
            autofocus: true,
            controller: controller,
            maxLength: currency ? 3 : 2,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(
              hintText: currency
                  ? 'USD, EUR, LYD'
                  : 'US, GB, LY — blank for all',
            ),
            validator: (v) {
              final text = v!.toUpperCase();
              return (!currency && text.isEmpty) ||
                      RegExp(
                        currency ? r'^[A-Z]{3}$' : r'^[A-Z]{2}$',
                      ).hasMatch(text)
                  ? null
                  : 'Enter a valid ISO code';
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (form.currentState!.validate()) {
                Navigator.pop(context, controller.text.toUpperCase());
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    // Dispose after the dialog's exit transition has released its editable field.
    await Future<void>.delayed(const Duration(milliseconds: 250));
    controller.dispose();
    if (result != null && context.mounted) {
      await saveFeedback(
        context,
        ref
            .read(settingsProvider.notifier)
            .update(
              currency
                  ? s.copyWith(currency: result)
                  : s.copyWith(market: result),
            ),
      );
    }
  }
}
