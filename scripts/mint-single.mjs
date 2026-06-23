import { createPublicClient, createWalletClient, http, formatEther, decodeEventLog, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { readDeployerKey } from "./deployer-key.mjs";

const { privateKey } = readDeployerKey();
const account = privateKeyToAccount(privateKey);
const CONTRACT = "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9";
const RECIPIENT = getAddress("0x839395e20bbb182fa440d08f850e6c7a8f6f0780"); // recipient

const abi = [
  { type: "function", name: "safeMint", inputs: [{ type: "address" }], outputs: [], stateMutability: "nonpayable" },
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

console.log("▸ deployer:", account.address);
console.log("  ETH on Arbitrum:", formatEther(await pub.getBalance({ address: account.address })));

const balBefore = await pub.readContract({ address: CONTRACT, abi, functionName: "balanceOf", args: [RECIPIENT] });
console.log("▸ recipient", RECIPIENT, "balance:", balBefore.toString());
if (balBefore > 0n) { console.log("already has badge — exiting"); process.exit(0); }

const nextIdBefore = await pub.readContract({ address: CONTRACT, abi, functionName: "nextId" });
console.log("  nextId:", nextIdBefore.toString(), "→ expected new token id");

// Use safeMintBatch with single-element array (same code path as the
// previous batch mints, keeps the on-chain trail consistent).
console.log("▸ submitting safeMintBatch([recipient])…");
const txHash = await wc.writeContract({
  address: CONTRACT,
  abi,
  functionName: "safeMintBatch",
  args: [[RECIPIENT]],
});
console.log("  tx:", txHash);
console.log("  https://arbiscan.io/tx/" + txHash);

const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== "success") throw new Error("mint failed");
const cost = receipt.gasUsed * receipt.effectiveGasPrice;
console.log(`✅ minted. gas=${receipt.gasUsed}  cost=${formatEther(cost)} ETH`);

for (const log of receipt.logs) {
  try {
    const dec = decodeEventLog({ abi, data: log.data, topics: log.topics });
    if (dec.eventName === "Transfer" && dec.args.from === "0x0000000000000000000000000000000000000000") {
      console.log(`  Transfer(0x0 → ${dec.args.to}, tokenId=${dec.args.tokenId})`);
    }
  } catch {}
}

const balAfter = await pub.readContract({ address: CONTRACT, abi, functionName: "balanceOf", args: [RECIPIENT] });
console.log("▸ recipient balance after:", balAfter.toString());
