import type { Merchant, SourceType } from '../generated/prisma/client.js';
import type { StoreProvider } from '../providers/store-provider.js';
import { MockStoreProvider } from '../providers/mock-store-provider.js';

export interface ProviderRegistration {
  sourceType: SourceType;
  synthetic: boolean;
  // Commercial entries would require a separate reviewed registration; none ship here.
  create: (merchant: Merchant) => StoreProvider;
}
export class ProviderRegistry {
  constructor(private readonly registrations: ProviderRegistration[] = []) {}
  resolve(merchant: Merchant): StoreProvider | undefined {
    const registration = this.registrations.find(
      (entry) =>
        entry.sourceType === merchant.sourceType &&
        entry.synthetic === merchant.isSynthetic,
    );
    return registration?.create(merchant);
  }
}
export function demoRegistry() {
  return new ProviderRegistry([
    {
      sourceType: 'SYNTHETIC',
      synthetic: true,
      create: (merchant) => new MockStoreProvider(merchant.name),
    },
  ]);
}
