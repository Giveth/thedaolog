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

// the team's list, 2026-05-14. Names with no address omitted (omitted).
const CANDIDATES = [
  { name: "holder",   addr: "0x585c4d8f227AD78b0991176f0DF27d2393F7228d" },
  { name: "holder", addr: "0x2d792c87C41131A3E6c13C83359E3C6Ab7D33Ed4" },
  { name: "holder",   addr: "0x29EE09Bd0f7f41EcD083Ad2708Df17691065790B" },
  { name: "holder",   addr: "0xF6D7E64444b35fbA42876F6639A5Ae1d54f1f740" },
  { name: "holder",   addr: "0x839395e20bbb182fa440d08f850e6c7a8f6f0780" },
  { name: "holder",     addr: "0x9a5d42598eCca26E233AcbDfC0D38e46D153B289" },
  { name: "holder",  addr: "0x735CeEe359627C2176789B5AD23216dCb5f9849e" },
  { name: "holder", addr: "0xb70A94dDaF521979FEC9Bb02Ab963F580E82cE0B" },
  { name: "holder",      addr: "0x17C8020dE84d4097b01387823f9D33Ff8E62577c" },
  { name: "holder", addr: "0xA1179f64638adb613DDAAc32D918EB6BEB824104" },
  { name: "holder",    addr: "0x939E50655cf6dA7D643CFf8Cfa31c3033b16328A" },
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

console.log("\n▸ Pre-mint balances (already-holders will be skipped):");
const recipients = [];
const skipped = [];
for (const r of normalized) {
  const b = await pub.readContract({ address: CONTRACT, abi, functionName: "balanceOf", args: [r.addr] });
  const has = b > 0n;
  console.log(`  ${r.name.padEnd(8)} ${r.addr}  balance=${b}${has ? "  [SKIP]" : "  [MINT]"}`);
  if (has) skipped.push(r); else recipients.push(r);
}

if (recipients.length === 0) {
  console.log("\n▸ Nothing to mint — everyone in the list already holds a badge.");
  process.exit(0);
}

const nextIdBefore = await pub.readContract({ address: CONTRACT, abi, functionName: "nextId" });
console.log(`\n▸ Submitting safeMintBatch for ${recipients.length} addresses…`);
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
console.log(`\n▸ Skipped (already held a badge): ${skipped.map(s => s.name).join(", ") || "(none)"}`);
