import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AppConfig {
  const AppConfig({
    required this.baseUrl,
    this.release = kReleaseMode,
    this.requestedDemo = const bool.fromEnvironment(
      'DEMO_MODE',
      defaultValue: true,
    ),
  });
  factory AppConfig.environment() => AppConfig(
    baseUrl: const String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: 'http://10.0.2.2:3000/api/v1',
    ),
  );
  final String baseUrl;
  final bool release, requestedDemo;
  bool get demo => !release && requestedDemo;
  bool get valid {
    final uri = Uri.tryParse(baseUrl);
    return uri != null &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty &&
        uri.query.isEmpty &&
        uri.fragment.isEmpty &&
        (release
            ? safeExternalUri(baseUrl) != null
            : ['http', 'https'].contains(uri.scheme));
  }
}

/// Only public HTTPS web links may be handed to the OS.
Uri? safeExternalUri(String? value) {
  if (value == null) return null;
  final uri = Uri.tryParse(value);
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.userInfo.isNotEmpty ||
      !uri.host.contains('.') ||
      uri.host.contains(':') ||
      uri.port != 443) {
    return null;
  }
  final host = uri.host.toLowerCase();
  if (!RegExp(r'^[a-z][a-z0-9-]{1,62}$').hasMatch(host.split('.').last)) {
    return null;
  }
  if (RegExp(r'^\d+(\.\d+){3}$').hasMatch(host) ||
      [
        'localhost',
        'local',
        'invalid',
        'test',
        'example',
        'internal',
        'lan',
        'home',
        'arpa',
      ].any((s) => host == s || host.endsWith('.$s'))) {
    return null;
  }
  return uri;
}

final configProvider = Provider<AppConfig>((ref) => AppConfig.environment());
