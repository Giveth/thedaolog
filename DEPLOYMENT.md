# theDAO/log — Deployment Guide for Kay

This is the operator's runbook for taking the dapp from the current
testbed (Tailscale Funnel on a Windows machine) to production hosting
under Giveth ownership. Pair this with `HANDOFF.md`, which covers the
architecture and the verification model — this doc is the deploy-day
walkthrough.

The recommended target is **Railway** (~$5–10/mo, hobby tier), but the
checklist applies to Render or Fly.io with minor wording changes. The
app is platform-agnostic Node 20 + pnpm.

---

## 0. What you'll receive in the handover package

Zep will get you exactly two things:

1. **GitHub access** — read-only on `xerxes-openclaw/thedaolog`. Fork
   it to `Giveth/thedaolog` (or similar) so future PRs come through
   the Giveth org. Don't include `node_modules`, `.secrets`, or
   `data/` in any commits.
2. **Domain decision** — confirm with Zep/Griff which subdomain to
   point at the deploy. Plausible options: `thedaolog.giveth.io`,
   `log.thedao.fund`, `vote.thedao.fund`. DNS changes go through
   whoever holds the parent domain.

**That's it.** You will NOT receive any private keys, Pinata JWTs, or
other secrets from us. The xerxes/testbed credentials stay on the
windows machine and get retired the moment your deploy is live with
its own Giveth-owned credentials. This is intentional — the only people
who hold deploy secrets should be you (operations) and Griff (admin via
griff.eth). No legacy dev keys carry over.

### 0a. You generate your own credentials before first deploy

Two things to set up under Giveth ownership, before you push the first
deploy:

- **A fresh Pinata account.** Sign up at app.pinata.cloud using a
  `giveth.io` email. New API key, Admin scope, name it `thedaolog`.
  Copy the JWT (starts with `eyJ...`). This becomes your `PINATA_JWT`
  env var. Don't use the xerxes-issued JWT — generate fresh.
- **A fresh deployer/minter wallet.** Generate a new EVM keypair —
  either a single-sig burner (lower friction for the periodic `commit`
  tx) or a Safe multisig on Arbitrum One (more secure, requires a
  small refactor of the commit endpoint — see HANDOFF.md §10). Whatever
  you choose, the private key becomes your `DEPLOYER_PRIVATE_KEY` env
  var. Note the address — you'll need it for §4 below.

Once those exist, §4 walks through moving the on-chain roles from the
old xerxes/zep wallets onto your new wallet + `griff.eth`. After §4
runs successfully, the xerxes deployer key file gets deleted and the
testbed has zero authority over anything that matters.

---

## 1. Required code changes before deploying

The current `server/api.mjs` reads two secrets from hardcoded Windows
file paths. Three small patches make it cloud-portable while preserving
local-dev behavior. Do these on a feature branch and PR them before
your first deploy.

### 1a. `server/api.mjs` — read `PINATA_JWT` from env first

Around line 90:

```diff
 async function loadPinataJwt() {
   if (_pinataJwt !== null) return _pinataJwt;
+  if (process.env.PINATA_JWT) {
+    _pinataJwt = process.env.PINATA_JWT;
+    return _pinataJwt;
+  }
   try {
     const { readFile } = await import("node:fs/promises");
     const env = JSON.parse(await readFile("C:/Users/Xerxes/Xerxes-Claude/.secrets/env.json", "utf8"));
     _pinataJwt = env.PINATA_JWT || "";
   } catch {
     _pinataJwt = "";
   }
   return _pinataJwt;
 }
```

### 1b. `server/api.mjs` — read deployer key from env first

Around line 218:

```diff
 async function getDeployerAccount() {
   if (_deployerAccount) return _deployerAccount;
+  if (process.env.DEPLOYER_PRIVATE_KEY) {
+    _deployerAccount = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
+    return _deployerAccount;
+  }
   const keyFile = "C:\\Users\\Xerxes\\Xerxes-Claude\\.secrets\\thedaolog_deployer.json";
   const { readFile } = await import("node:fs/promises");
   const { privateKey } = JSON.parse(await readFile(keyFile, "utf8"));
   _deployerAccount = privateKeyToAccount(privateKey);
   return _deployerAccount;
 }
```

### 1c. `server/api.mjs` — bind to `0.0.0.0` on the host

Last line of the file:

```diff
-await app.listen({ port: PORT, host: "127.0.0.1" });
+await app.listen({ port: PORT, host: process.env.HOST ?? "127.0.0.1" });
```

On Railway/Render/Fly, set `HOST=0.0.0.0`. Locally, omit it and you
stay on loopback like today.

### 1d. Static file serving (decide one of two paths)

The current Fastify API only serves `/api/*`. The Vite SPA is a
separate dev process. In production you have two reasonable options.

**Option A — single Node service serves everything (simpler, recommended for first deploy).**

Add `@fastify/static` to `dependencies`:

```bash
pnpm add @fastify/static
```

Append to `server/api.mjs` *before* the `app.listen` call:

```js
if (process.env.NODE_ENV === "production") {
  const { default: fastifyStatic } = await import("@fastify/static");
  await app.register(fastifyStatic, {
    root: path.join(ROOT, "dist"),
    prefix: "/",
  });
  app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
}
```

Then `pnpm build` (produces `dist/`) and run `NODE_ENV=production node server/api.mjs`. One port, one process.

**Option B — split into two services (SPA on Cloudflare Pages / Vercel, API on Railway).**

Frontend deploys statically to a CDN, API runs on a Node host, and the SPA proxies `/api/*` to the API host via a `_redirects` file or platform routing. Faster page loads but more moving parts. Pick this only if you want the CDN benefits.

The rest of this guide assumes Option A.

### 1e. Add a `start` script to `package.json`

```diff
 "scripts": {
   "dev": "vite --port 7100 --host 127.0.0.1",
   "build": "vite build",
+  "start": "node server/api.mjs",
   "preview": "vite preview --port 7100 --host 127.0.0.1"
 }
```

Railway and most platforms look for `pnpm start` by convention.

### 1f. Pin Node version

```diff
+"engines": {
+  "node": ">=20 <23"
+},
 "scripts": { ... }
```

Same Node major across testbed and prod avoids surprises.

---

## 2. Railway deploy (concrete steps)

Assuming Option A above (single service).

1. **Project**: railway.com → New Project → Deploy from GitHub repo →
   pick the Giveth thedaolog repo.

2. **Build & start commands**: Railway auto-detects pnpm from
   `pnpm-lock.yaml`. Confirm in Settings:
   - Build: `pnpm install --frozen-lockfile && pnpm build`
   - Start: `pnpm start`

3. **Environment variables** (Settings → Variables):
   ```
   NODE_ENV=production
   HOST=0.0.0.0
   PORT=7101
   PINATA_JWT=eyJ...                # the JWT
   DEPLOYER_PRIVATE_KEY=0x...       # the deployer key (no quotes)
   ```
   Railway also auto-injects its own `PORT` for routing; the line
   above is a default for when you run locally with the same env.

4. **Persistent volume**: Settings → Volumes → Add. Mount at `/app/data`
   (or wherever your repo root + `data/` resolves to in the container).
   Size: 1 GB is overkill but cheapest. The current testbed is using
   ~8 KB of ballot/proposal JSON. You will outgrow this only if you
   end up storing tens of thousands of ballots — which would also be
   the signal to migrate to Postgres (see HANDOFF.md §10).

5. **Custom domain**: Settings → Domains → Add custom domain. Paste
   the chosen subdomain. Railway returns a CNAME target — give that
   to whoever holds the parent DNS (Giveth's Cloudflare or similar).
   Railway issues a Let's Encrypt cert automatically once the CNAME
   resolves.

6. **First deploy**: push to `main`. Watch the build logs. The build
   step runs `vite build` and outputs `dist/`. The start step boots
   Fastify which now serves both `/api/*` and the SPA.

7. **Smoke test on the live URL**:
   - Open the domain → should load the WalletGate.
   - Connect a wallet that holds a BUIDLER badge → should land on
     `F2App`.
   - Open a proposal, cast a test vote, sign in the wallet popup → API
     should return 200 and the new ballot should appear in
     `/api/proposals/<id>/ballots`.
   - Hit `https://<domain>/api/proposals` directly — should return
     the proposals list as JSON.

---

## 3. DNS, SSL, and cutover

DNS swing is the only externally-visible step in the migration. Order matters.

1. **Pre-cutover**: deploy is live at the Railway-generated URL
   (`<project>.up.railway.app`). Confirm everything works there
   first. The Tailscale funnel at
   `desktop-dvvupq4.tail301743.ts.net:10000` keeps serving in parallel.

2. **DNS swing**: point the chosen domain (e.g. `thedaolog.giveth.io`)
   at Railway. SSL provisions automatically.

3. **Soft launch**: announce the new URL. Leave the funnel running for
   a few days as a fallback. Any deep-linked references in past
   announcements still resolve.

4. **Hard decommission** (after a week of clean traffic): on the
   Windows host, run `tailscale funnel reset --https=10000` to free
   the slot for whatever comes next, and disable the
   `GreenlightFunnelHealth` scheduled task entry for the thedaolog
   processes (or delete the task entirely if no other apps use it).

---

## 4. On-chain ownership transfer (do this with your first deploy)

This is NOT optional post-deploy cleanup — it's part of getting the
production app to a clean state. Until §4 runs successfully, anyone
with access to the xerxes testbed (`.secrets/thedaolog_deployer.json`)
can still mint badges and post Merkle roots. Do it the same day your
Railway deploy goes live.

End state we're aiming for:
- **`griff.eth`** (resolves to `0x839395e20bbB182fa440d08F850E6c7A8f6F0780`)
  holds the badge contract's `DEFAULT_ADMIN_ROLE` and the TallyCommit
  contract's `admin`. Griff is the sole governance authority — he can
  grant or revoke any operational role if needed, but never signs
  routine ops txs.
- **Your Giveth ops wallet** (the one you generated in §0a) holds the
  badge contract's `MINTER_ROLE`. Only this wallet mints badges and
  signs the periodic `commit(proposalId, root, ballotCount)` tx.
- **The xerxes deployer wallet** (`0x16D89551D8635341bdB6a3dAEdc57e0ca43C42d4`)
  and **Zep's admin wallet** (`0x72315dddeb862cD484b9F37d37952eC9080557cd`)
  hold zero roles. Their key material gets deleted from the testbed.

Steps:

1. **Confirm your Giveth ops wallet exists** (from §0a). You should
   have generated it before first deploy and set `DEPLOYER_PRIVATE_KEY`
   in Railway. The wallet's address is what you'll grant roles to.

2. **Badge contract — transfer admin and minter**
   (Arbiscan, Write tab on `0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9`):

   First, Zep does these from his admin wallet
   (`0x72315dddeb862cD484b9F37d37952eC9080557cd`):
   - `grantRole(DEFAULT_ADMIN_ROLE, 0x839395e20bbB182fa440d08F850E6c7A8f6F0780)` — grants griff.eth admin authority.
     `DEFAULT_ADMIN_ROLE` = `0x0000000000000000000000000000000000000000000000000000000000000000` (32 zero bytes).
   - `grantRole(MINTER_ROLE, <Giveth ops wallet>)` — grants your Giveth ops wallet minting authority.
     `MINTER_ROLE` = `keccak256("MINTER_ROLE")` =
     `0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6`.
   - `revokeRole(MINTER_ROLE, 0x16D89551D8635341bdB6a3dAEdc57e0ca43C42d4)` — removes minting from the xerxes deployer.
   - `renounceRole(DEFAULT_ADMIN_ROLE, 0x72315dddeb862cD484b9F37d37952eC9080557cd)` — Zep gives up his own admin role.

3. **TallyCommit contract — transfer admin**
   (Arbiscan, Write tab on `0x6b6cefa25fa3ce9623806a86a08c62e24520513c`):

   The xerxes deployer wallet is currently the admin and must sign
   the transfer itself:
   - `transferAdmin(0x839395e20bbB182fa440d08F850E6c7A8f6F0780)` — moves admin to griff.eth.

   Then, separately, griff.eth needs the periodic `commit` calls signed
   by your Giveth ops wallet. Either:
   - griff.eth calls `transferAdmin(<Giveth ops wallet>)` — simplest,
     but ops wallet becomes admin too. Or:
   - Keep griff.eth as admin and refactor the API's commit endpoint
     to propose-not-send when admin is a separate wallet. See
     HANDOFF.md §10 for the multisig variant; same pattern applies.

4. **Verify** (Arbiscan, Read tab on each contract):
   - Badge: `hasRole(DEFAULT_ADMIN_ROLE, 0x839395e20bbB182fa440d08F850E6c7A8f6F0780)` → `true`.
   - Badge: `hasRole(DEFAULT_ADMIN_ROLE, 0x72315dddeb862cD484b9F37d37952eC9080557cd)` → `false`.
   - Badge: `hasRole(MINTER_ROLE, 0x16D89551D8635341bdB6a3dAEdc57e0ca43C42d4)` → `false`.
   - Badge: `hasRole(MINTER_ROLE, <Giveth ops wallet>)` → `true`.
   - TallyCommit: `admin()` → `0x839395e20bbB182fa440d08F850E6c7A8f6F0780` (or your Giveth ops wallet, depending on what you picked in step 3).

5. **Smoke test** with the new wallet on Railway:
   - Mint a test badge using `scripts/mint-batch-4.mjs` pointed at your
     new key. Should succeed.
   - Close a test proposal via the API's commit endpoint. Should
     produce a tx hash signed by your Giveth ops wallet.

6. **Burn the old testbed key**: once steps 4 and 5 pass, tell Zep he
   can delete `.secrets/thedaolog_deployer.json` from the windows
   machine. After that, the xerxes side has no operational power over
   anything in production.

---

## 5. Post-deploy operations

### Minting BUIDLER badges to new addresses

Same flow as HANDOFF.md §8, but run from Kay's machine (or wherever
holds the new deployer key):

```bash
# Edit scripts/mint-batch-4.mjs to point at the new key file or env var,
# then:
node scripts/mint-batch-4.mjs
```

Costs ~$0.01–0.05 per mint on Arbitrum (single `safeMintBatch` tx).

### Closing a vote + posting on-chain Merkle commit

After a proposal's deadline:

```bash
curl -X POST https://<your-domain>/api/proposals/<proposal-id>/commit
```

The API computes the Merkle root from canonical-ordered ballots and
submits the `commit(proposalId, root, ballotCount)` tx with the
deployer wallet. Tx hash comes back in the response. Once mined, the
in-dapp Verify panel shows ✓ "On-chain root matches".

### Backups

The only persistent state is `data/ballots.json` and `data/proposals.json`.
Railway's volume gets snapshotted by Railway, but for belt-and-braces:

- A nightly cron that `git pull`s the data into a private Giveth repo
  (or pushes to S3) is a solid pattern.
- Alternatively, every accepted ballot already auto-pins to IPFS via
  Pinata if `PINATA_JWT` is set. Ballots can be reconstructed from
  IPFS even if the JSON files vanish.

### Monitoring

Railway gives you basic uptime + CPU/memory dashboards out of the
box. For external uptime monitoring, point UptimeRobot at
`https://<your-domain>/api/proposals` — it should always return 200
JSON. Alert on >2 consecutive 5xx or >5s response time.

### Logs

`railway logs` from the CLI, or the Logs tab in the dashboard.
Important things to grep for:

- `[pinata]` — Pinata pin success / failure.
- `not_a_badgeholder` — expected for non-badge-holding callers.
- `verify_failed` — signature didn't match.
- Any 500 — bug, file an issue.

---

## 6. Sanity checklist before declaring done

- [ ] Code changes from §1 merged and deployed.
- [ ] Railway service is up at custom domain with valid SSL.
- [ ] Wallet connect → sign → /api/.../vote returns 200, ballot
      visible in `/api/.../ballots`.
- [ ] Pinata pin is logged for that test ballot (`[pinata] pinned`).
- [ ] On-chain `commit` works end-to-end on a throwaway proposal:
      curl POST → tx hash → Verify panel shows green.
- [ ] Tailscale funnel still running as fallback. Note the planned
      decommission date.
- [ ] Badge `MINTER_ROLE` moved off the testbed deployer wallet.
- [ ] TallyCommit `admin` moved off the testbed deployer wallet.
- [ ] DNS pointing at Railway (not the funnel).
- [ ] Backup strategy in place (volume snapshots + Pinata pin chain at
      minimum).

When all of these are checked, the testbed is no longer load-bearing.
Reach out to Zep/Griff (or Xerxes via Telegram) for anything that
surprises you.

---

## 7. Open questions to confirm with Zep before deploy day

1. Domain — which subdomain, and who owns the parent DNS?
2. New deployer wallet — single-sig or Safe multisig? If multisig, the
   commit endpoint needs a small refactor to propose-not-send.
3. Pinata account — keep the Xerxes-issued JWT or rotate to a
   Giveth-owned Pinata account before launch? Cleaner is to rotate now.
4. Repo location — push to `Giveth/thedaolog` or a different name?
5. Voting badge metadata `name()` mismatch ("theDAO Security Badge"
   on-chain vs "Giveth BUIDLER" display) — leave as is, or schedule a
   redeploy of the badge contract? Cosmetic only, but visible in
   Etherscan.
