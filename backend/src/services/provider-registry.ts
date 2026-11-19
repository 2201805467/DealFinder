import type { Merchant, SourceType } from '../generated/prisma/client.js';
import type { StoreProvider } from '../providers/store-provider.js';
import { MockStoreProvider } from '../providers/mock-store-provider.js';
import { CheapSharkProvider } from '../providers/cheapshark/cheapshark-provider.js';
import { GamerPowerProvider } from '../providers/gamerpower/gamerpower-provider.js';

export interface ProviderRegistration {
  sourceType: SourceType;
  synthetic: boolean;
  // Only explicitly reviewed registrations are eligible for synchronization.
  create: (merchant: Merchant) => StoreProvider;
}
export class ProviderRegistry {
  private readonly instances = new Map<
    string,
    { configuration: string; provider: StoreProvider }
  >();
  constructor(private readonly registrations: ProviderRegistration[] = []) {}
  resolve(merchant: Merchant): StoreProvider | undefined {
    const registration = this.registrations.find(
      (entry) =>
        entry.sourceType === merchant.sourceType &&
        entry.synthetic === merchant.isSynthetic,
    );
    if (!registration) return undefined;
    const configuration = JSON.stringify([
      merchant.sourceType,
      merchant.isSynthetic,
      merchant.name,
      merchant.websiteUrl,
    ]);
    let instance = this.instances.get(merchant.id);
    if (instance?.configuration !== configuration) {
      instance = { configuration, provider: registration.create(merchant) };
      this.instances.set(merchant.id, instance);
    }
    return instance.provider;
  }
}
export function realRegistry() {
  return new ProviderRegistry([
    {
      sourceType: 'CHEAPSHARK',
      synthetic: false,
      create: () => new CheapSharkProvider(),
    },
    {
      sourceType: 'GAMERPOWER',
      synthetic: false,
      create: () => new GamerPowerProvider(),
    },
  ]);
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
