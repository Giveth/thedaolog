// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveChainId, loadTokenRegistry, saveTokenRegistry, DEFAULT_TOKEN_REGISTRY, ERC721_BALANCE_OF_ABI } from "../../src/eligibility";

describe("resolveChainId", () => {
  it("maps known chain names (case/space tolerant)", () => {
    expect(resolveChainId("Ethereum")).toBe(1);
    expect(resolveChainId("mainnet")).toBe(1);
    expect(resolveChainId("Arbitrum One")).toBe(42161);
    expect(resolveChainId("  arbitrum one  ")).toBe(42161);
    expect(resolveChainId("ETH")).toBe(1);
  });
  it("returns null for unknown / empty input", () => {
    expect(resolveChainId("Polygon")).toBeNull();
    expect(resolveChainId("")).toBeNull();
    expect(resolveChainId(null)).toBeNull();
    expect(resolveChainId(undefined)).toBeNull();
  });
});

describe("token registry persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("returns the default registry when storage is empty", () => {
    expect(loadTokenRegistry()).toEqual(DEFAULT_TOKEN_REGISTRY);
  });
  it("round-trips a saved registry", () => {
    const custom = [{ id: "x", address: "0x1" as `0x${string}`, chain: "Ethereum", symbol: "X", name: "X", kind: "ERC-721" as const }];
    saveTokenRegistry(custom);
    expect(loadTokenRegistry()).toEqual(custom);
  });
  it("falls back to default on invalid JSON", () => {
    localStorage.setItem("thedaolog:tokenRegistry", "{not json");
    expect(loadTokenRegistry()).toEqual(DEFAULT_TOKEN_REGISTRY);
  });
  it("falls back to default on an empty array", () => {
    localStorage.setItem("thedaolog:tokenRegistry", "[]");
    expect(loadTokenRegistry()).toEqual(DEFAULT_TOKEN_REGISTRY);
  });
  it("returns default and no-ops save when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadTokenRegistry()).toEqual(DEFAULT_TOKEN_REGISTRY);
    expect(() => saveTokenRegistry([])).not.toThrow();
  });
});

describe("ABI constants", () => {
  it("exposes the ERC721 balanceOf ABI", () => {
    expect(ERC721_BALANCE_OF_ABI[0]).toMatchObject({ name: "balanceOf", type: "function" });
  });
});
