export type ProviderErrorCode =
  | 'CONFIGURATION'
  | 'INVALID_SEARCH'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'ACCESS_OR_QUOTA'
  | 'RATE_LIMIT'
  | 'UPSTREAM'
  | 'INVALID_RESPONSE';

// Only fixed messages and safe metadata. Never attach an upstream body, URL or cause.
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
