// frontend/src/config/network.ts
import { getExplorerBaseUrl } from "@/lib/explorer";

export type Network = "testnet" | "mainnet";

export const NETWORK = (
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? process.env.NEXT_PUBLIC_NETWORK) as Network
) ?? "testnet";

export const NETWORK_CONFIG = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
    // Derived from lib/explorer.ts so there is one definition (#1311).
    explorerUrl: getExplorerBaseUrl("testnet")!,
  },
  mainnet: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-rpc-mainnet.stellar.gateway.fm",
    horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon.stellar.org",
    contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
    explorerUrl: getExplorerBaseUrl("mainnet")!,
  },
} as const;

export const activeNetwork = NETWORK_CONFIG[NETWORK];
