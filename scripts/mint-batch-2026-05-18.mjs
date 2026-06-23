import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  decodeEventLog,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { readDeployerKey } from "./deployer-key.mjs";

const { privateKey } = readDeployerKey();
const account = privateKeyToAccount(privateKey);
const CONTRACT = "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9";

// address list update 2026-05-18: 3 new addresses, a wallet
// rotation handled via self-transfer (option b), not re-minted here.
const CANDIDATES = [
  { name: "holder", addr: "0x0386C80880479B0Ddd0294FE8c0Cd9C0fCE8516E" },
  { name: "holder",    addr: "0xb760FE1bbC4A2752aBCBb28291a57Cb0cA99fF44" },
  { name: "holder",    addr: "0x864af8991100d5E2Df52a3c7ae64db111E983D24" },
];

const normalized = CANDIDATES.map((r) => ({ ...r, addr: getAddress(r.addr) }));

const abi = [
  { type: "function", name: "safeMintBatch", inputs: [{ type: "address[]" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "nextId", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "event", name: "Transfer", inputs: [
      { type: "address", indexed: true, name: "from" },
      { type: "address", indexed: true, name: "to" },
      { type: "uint256", indexed: true, name: "tokenId" },
    ] },
];

const pub = createPublicClient({ chain: arbitrum, transport: http() });
const wc = createWalletClient({ account, chain: arbitrum, transport: http() });

console.log("▸ Deployer:", account.address);
const bal = await pub.getBalance({ address: account.address });
console.log("  ETH:", formatEther(bal));

console.log("\n▸ Pre-mint balances:");
const recipients = [];
const skipped = [];
for (const r of normalized) {
  const b = await pub.readContract({ address: CONTRACT, abi, functionName: "balanceOf", args: [r.addr] });
  const has = b > 0n;
  console.log(`  ${r.name.padEnd(8)} ${r.addr}  balance=${b}${has ? "  [SKIP]" : "  [MINT]"}`);
  if (has) skipped.push(r); else recipients.push(r);
}

if (recipients.length === 0) {
  console.log("\n▸ Nothing to mint.");
  process.exit(0);
}

const nextIdBefore = await pub.readContract({ address: CONTRACT, abi, functionName: "nextId" });
console.log(`\n▸ safeMintBatch for ${recipients.length} addresses…`);
console.log(`  nextId before: ${nextIdBefore}, new tokens: ${recipients.map((_, i) => Number(nextIdBefore) + i).join(", ")}`);

const txHash = await wc.writeContract({
  address: CONTRACT,
  abi,
  functionName: "safeMintBatch",
  args: [recipients.map((r) => r.addr)],
});
console.log("  tx:", txHash);
console.log("  https://arbiscan.io/tx/" + txHash);

console.log("\n▸ Waiting for receipt…");
const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== "success") throw new Error("mint batch failed");
const cost = receipt.gasUsed * receipt.effectiveGasPrice;
console.log(`✅ minted. gas=${receipt.gasUsed}  cost=${formatEther(cost)} ETH`);

const transfers = [];
for (const log of receipt.logs) {
  try {
    const dec = decodeEventLog({ abi, data: log.data, topics: log.topics });
    if (dec.eventName === "Transfer" && dec.args.from === "0x0000000000000000000000000000000000000000") {
      transfers.push({ tokenId: dec.args.tokenId.toString(), to: dec.args.to });
    }
  } catch {}
}
console.log("\n▸ Minted in this tx:");
for (const t of transfers) {
  const r = recipients.find((x) => x.addr.toLowerCase() === t.to.toLowerCase());
  console.log(`  token #${t.tokenId} → ${r?.name ?? "?"} (${t.to})`);
}

const nextIdAfter = await pub.readContract({ address: CONTRACT, abi, functionName: "nextId" });
console.log(`\n  nextId after: ${nextIdAfter}`);
