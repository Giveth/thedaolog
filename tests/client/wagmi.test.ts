// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { wagmiConfig } from "../../src/wagmi";
import { mainnet, arbitrum } from "wagmi/chains";

describe("wagmiConfig", () => {
  it("is configured for mainnet + arbitrum with transports", () => {
    const ids = wagmiConfig.chains.map((c) => c.id);
    expect(ids).toContain(mainnet.id);
    expect(ids).toContain(arbitrum.id);
  });
  it("registers wallet connectors", () => {
    expect(wagmiConfig.connectors.length).toBeGreaterThan(0);
  });
});
