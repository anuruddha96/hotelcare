import type { DistributionAdapter } from "./adapter";
import type { ConnectivityProvider } from "./types";

/**
 * Provider-neutral registry used by server-side distribution orchestration.
 * Adapters are registered at runtime so HotelCare can start with an
 * aggregator and progressively replace individual channels with direct
 * certified integrations without changing callers.
 */
export class DistributionAdapterRegistry {
  private readonly adapters = new Map<ConnectivityProvider, DistributionAdapter>();

  register(provider: ConnectivityProvider, adapter: DistributionAdapter): void {
    this.adapters.set(provider, adapter);
  }

  unregister(provider: ConnectivityProvider): void {
    this.adapters.delete(provider);
  }

  has(provider: ConnectivityProvider): boolean {
    return this.adapters.has(provider);
  }

  get(provider: ConnectivityProvider): DistributionAdapter {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`No distribution adapter registered for ${provider}`);
    }

    return adapter;
  }

  list(): Array<{ provider: ConnectivityProvider; adapter: DistributionAdapter }> {
    return Array.from(this.adapters.entries()).map(([provider, adapter]) => ({
      provider,
      adapter,
    }));
  }
}

export const distributionAdapterRegistry = new DistributionAdapterRegistry();
