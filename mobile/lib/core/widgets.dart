import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'config.dart';

class DemoNotice extends ConsumerWidget {
  const DemoNotice({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      ref.watch(configProvider).demo
      ? Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
          color: Theme.of(context).colorScheme.tertiaryContainer,
          child: Text(
            'DEMO MODE · Synthetic products · Shopping disabled',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onTertiaryContainer,
            ),
          ),
        )
      : const SizedBox.shrink();
}

class MessageState extends StatelessWidget {
  const MessageState(
    this.title,
    this.message, {
    super.key,
    this.retry,
    this.icon = Icons.search_off_rounded,
  });
  final String title, message;
  final VoidCallback? retry;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(24),
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 42, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 14),
          Text(
            title,
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center),
          if (retry != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: OutlinedButton(
                onPressed: retry,
                child: const Text('Try again'),
              ),
            ),
        ],
      ),
    ),
  );
}

class Skeleton extends StatelessWidget {
  const Skeleton({super.key, this.height = 220});
  final double height;
  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Loading products',
    child: Container(
      height: height,
      margin: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Container(
              margin: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          Container(
            height: 12,
            width: 130,
            margin: const EdgeInsets.all(16),
            color: Theme.of(context).colorScheme.surfaceContainerLow,
          ),
        ],
      ),
    ),
  );
}

Future<void> saveFeedback(BuildContext context, Future<void> operation) async {
  try {
    await operation;
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Your change could not be saved on this device. Please try again.',
          ),
        ),
      );
    }
  }
}
