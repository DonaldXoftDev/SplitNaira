/**
 * Single source of truth for Stellar explorer URLs (#1311).
 *
 * Explorer bases previously lived in three places — `lib/stellar.ts`,
 * `config/network.ts`, and a hardcoded default on `TransactionReceipt` — and
 * two of them defaulted to testnet. A mainnet transaction rendered through the
 * wrong one produced a link to an explorer that has never heard of it, which
 * reads to a user as "my payment vanished".
 *
 * The rule here: an unrecognised network yields **no link**, never a guessed
 * one. A missing link is a visible gap; a wrong-environment link is a
 * confident lie.
 */

/** Networks this app can build explorer links for. */
export const SUPPORTED_NETWORKS = ['testnet', 'mainnet'] as const;

export type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number];

/**
 * Aliases accepted from wallets, env vars and contract metadata.
 *
 * Freighter reports `PUBLIC`/`TESTNET`; Horizon passphrases and older config
 * use `public`. They all have to land on the same canonical value.
 */
const NETWORK_ALIASES: Readonly<Record<string, SupportedNetwork>> = {
  testnet: 'testnet',
  test: 'testnet',
  'test sdf network ; september 2015': 'testnet',
  mainnet: 'mainnet',
  public: 'mainnet',
  pubnet: 'mainnet',
  'public global stellar network ; september 2015': 'mainnet',
};

const EXPLORER_BASE: Readonly<Record<SupportedNetwork, string>> = {
  testnet: 'https://stellar.expert/explorer/testnet',
  mainnet: 'https://stellar.expert/explorer/public',
};

const EXPLORER_LABEL: Readonly<Record<SupportedNetwork, string>> = {
  testnet: 'Stellar.expert (Testnet)',
  mainnet: 'Stellar.expert (Mainnet)',
};

/**
 * Canonicalises a network value, returning null when it is not supported.
 *
 * Returning null rather than defaulting is the whole point: the previous
 * implementation treated `null`, `undefined` and a typo like `"mainet"` as
 * testnet.
 */
export function resolveNetwork(
  value: string | null | undefined,
): SupportedNetwork | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return NETWORK_ALIASES[key] ?? null;
}

/** True when a value names a network this app can link to. */
export function isSupportedNetwork(value: string | null | undefined): boolean {
  return resolveNetwork(value) !== null;
}

/** Explorer base URL for a network, or null when unsupported. */
export function getExplorerBaseUrl(
  network: string | null | undefined,
): string | null {
  const resolved = resolveNetwork(network);
  return resolved ? EXPLORER_BASE[resolved] : null;
}

/**
 * Explorer URL for a transaction hash.
 *
 * Null when the network is unsupported *or* the hash is missing — callers
 * should render no link rather than one pointing at the wrong chain.
 */
export function getTransactionExplorerUrl(
  hash: string | null | undefined,
  network: string | null | undefined,
): string | null {
  const base = getExplorerBaseUrl(network);
  if (!base) return null;
  const trimmed = typeof hash === 'string' ? hash.trim() : '';
  if (!trimmed) return null;
  return `${base}/tx/${encodeURIComponent(trimmed)}`;
}

/** Explorer URL for an account address, or null when unsupported. */
export function getAccountExplorerUrl(
  address: string | null | undefined,
  network: string | null | undefined,
): string | null {
  const base = getExplorerBaseUrl(network);
  if (!base) return null;
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (!trimmed) return null;
  return `${base}/account/${encodeURIComponent(trimmed)}`;
}

/** Human-readable explorer name, or null when the network is unsupported. */
export function getExplorerLabel(
  network: string | null | undefined,
): string | null {
  const resolved = resolveNetwork(network);
  return resolved ? EXPLORER_LABEL[resolved] : null;
}

/**
 * Throws when a configured network is unsupported.
 *
 * For startup/config validation, where failing loudly beats silently
 * producing broken links for the lifetime of a deployment.
 */
export function assertSupportedNetwork(
  value: string | null | undefined,
): SupportedNetwork {
  const resolved = resolveNetwork(value);
  if (!resolved) {
    throw new Error(
      `Unsupported Stellar network: ${JSON.stringify(value)}. ` +
        `Supported networks are ${SUPPORTED_NETWORKS.join(', ')}.`,
    );
  }
  return resolved;
}
