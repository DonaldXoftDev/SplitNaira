import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_NETWORKS,
  resolveNetwork,
  isSupportedNetwork,
  getExplorerBaseUrl,
  getTransactionExplorerUrl,
  getAccountExplorerUrl,
  getExplorerLabel,
  assertSupportedNetwork,
} from './explorer';

const HASH = 'a'.repeat(64);

describe('resolveNetwork', () => {
  it('canonicalises the supported networks', () => {
    expect(resolveNetwork('testnet')).toBe('testnet');
    expect(resolveNetwork('mainnet')).toBe('mainnet');
  });

  it('accepts the aliases wallets and Horizon actually emit', () => {
    expect(resolveNetwork('PUBLIC')).toBe('mainnet');
    expect(resolveNetwork('pubnet')).toBe('mainnet');
    expect(resolveNetwork('TESTNET')).toBe('testnet');
    expect(resolveNetwork('  Testnet  ')).toBe('testnet');
    expect(resolveNetwork('Public Global Stellar Network ; September 2015')).toBe(
      'mainnet',
    );
    expect(resolveNetwork('Test SDF Network ; September 2015')).toBe('testnet');
  });

  it('rejects anything it does not recognise instead of guessing', () => {
    // The previous implementation returned a testnet link for every one of
    // these, which is how a mainnet payment ends up with a dead link.
    expect(resolveNetwork(null)).toBeNull();
    expect(resolveNetwork(undefined)).toBeNull();
    expect(resolveNetwork('')).toBeNull();
    expect(resolveNetwork('   ')).toBeNull();
    expect(resolveNetwork('mainet')).toBeNull();
    expect(resolveNetwork('futurenet')).toBeNull();
    expect(resolveNetwork('localhost')).toBeNull();
  });
});

describe('isSupportedNetwork', () => {
  it('agrees with resolveNetwork', () => {
    for (const network of SUPPORTED_NETWORKS) {
      expect(isSupportedNetwork(network)).toBe(true);
    }
    expect(isSupportedNetwork('futurenet')).toBe(false);
    expect(isSupportedNetwork(null)).toBe(false);
  });
});

describe('getExplorerBaseUrl', () => {
  it('maps each supported network to its own explorer', () => {
    expect(getExplorerBaseUrl('testnet')).toBe(
      'https://stellar.expert/explorer/testnet',
    );
    expect(getExplorerBaseUrl('mainnet')).toBe(
      'https://stellar.expert/explorer/public',
    );
  });

  it('never returns a testnet URL for mainnet, or the reverse', () => {
    expect(getExplorerBaseUrl('mainnet')).not.toContain('testnet');
    expect(getExplorerBaseUrl('testnet')).not.toContain('public');
  });

  it('returns null for an unsupported network', () => {
    expect(getExplorerBaseUrl('futurenet')).toBeNull();
    expect(getExplorerBaseUrl(null)).toBeNull();
  });

  it('covers every network it claims to support', () => {
    for (const network of SUPPORTED_NETWORKS) {
      expect(getExplorerBaseUrl(network)).toBeTruthy();
      expect(getExplorerLabel(network)).toBeTruthy();
    }
  });
});

describe('getTransactionExplorerUrl', () => {
  it('builds a transaction link per network', () => {
    expect(getTransactionExplorerUrl(HASH, 'testnet')).toBe(
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
    expect(getTransactionExplorerUrl(HASH, 'mainnet')).toBe(
      `https://stellar.expert/explorer/public/tx/${HASH}`,
    );
  });

  it('returns null rather than a wrong-environment link', () => {
    expect(getTransactionExplorerUrl(HASH, 'mainet')).toBeNull();
    expect(getTransactionExplorerUrl(HASH, null)).toBeNull();
    expect(getTransactionExplorerUrl(HASH, undefined)).toBeNull();
  });

  it('returns null when there is no hash to link to', () => {
    expect(getTransactionExplorerUrl('', 'mainnet')).toBeNull();
    expect(getTransactionExplorerUrl('   ', 'mainnet')).toBeNull();
    expect(getTransactionExplorerUrl(null, 'mainnet')).toBeNull();
  });

  it('encodes the hash so a malformed value cannot alter the path', () => {
    const url = getTransactionExplorerUrl('../../evil', 'testnet');
    expect(url).toBe(
      'https://stellar.expert/explorer/testnet/tx/..%2F..%2Fevil',
    );
    expect(url).not.toContain('/../');
  });
});

describe('getAccountExplorerUrl', () => {
  it('builds an account link per network', () => {
    const address = 'G' + 'A'.repeat(55);
    expect(getAccountExplorerUrl(address, 'mainnet')).toBe(
      `https://stellar.expert/explorer/public/account/${address}`,
    );
  });

  it('returns null for an unsupported network', () => {
    expect(getAccountExplorerUrl('GABC', 'futurenet')).toBeNull();
  });
});

describe('getExplorerLabel', () => {
  it('names the environment so the UI can show which chain a link points at', () => {
    expect(getExplorerLabel('mainnet')).toContain('Mainnet');
    expect(getExplorerLabel('testnet')).toContain('Testnet');
  });

  it('returns null for an unsupported network', () => {
    expect(getExplorerLabel('futurenet')).toBeNull();
  });
});

describe('assertSupportedNetwork', () => {
  it('returns the canonical network for valid config', () => {
    expect(assertSupportedNetwork('PUBLIC')).toBe('mainnet');
  });

  it('throws with the offending value and the supported set', () => {
    expect(() => assertSupportedNetwork('futurenet')).toThrow(/futurenet/);
    expect(() => assertSupportedNetwork('futurenet')).toThrow(/testnet, mainnet/);
    expect(() => assertSupportedNetwork(null)).toThrow();
  });
});
