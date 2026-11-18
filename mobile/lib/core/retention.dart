import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Rebuild precisely at expiry, including while the user keeps a screen open.
final expiredProvider = Provider.autoDispose.family<bool, DateTime?>((
  ref,
  expiry,
) {
  if (expiry == null) return false;
  final remaining = expiry.difference(DateTime.now());
  if (remaining <= Duration.zero) return true;
  final timer = Timer(remaining, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return false;
});
