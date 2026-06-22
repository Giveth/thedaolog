# theDAOlog / Murmuration — public read API

Read-only, public, CORS-open. No auth needed to read. Casting a vote
requires a signed EIP-712 ballot (a wallet), so the write paths are not
part of this read API.

Base URL:
- Production: `https://murmur.thedao.fund/api`
- Staging: `https://desktop-dvvupq4.tail301743.ts.net:10000/api`

Hit `GET /api` for a live, self-describing index of these endpoints.

## Endpoints

### `GET /api/proposals`
All votes (lightweight public view).
```json
{ "proposals": [ { "id": "r-...", "title": "...", "votingMode": "quadratic",
  "budget": 100, "options": [{ "id": 1, "title": "..." }], "deadline": "ISO",
  "opensAt": "ISO|null", "tokenAddress": "0x..", "tokenChainId": 1 } ] }
```

### `GET /api/proposals/:id`
One vote, plus the **live tally** (points allocated per option, deleted
options excluded) and the voter count.
```json
{ "proposal": { ...same shape as above, with deletedOptionIds[] },
  "tally": { "1": 12, "2": 7 },
  "voterCount": 5 }
```

### `GET /api/proposals/:id/ballots`
The signed ballots cast on a vote (each: `ballot`, `signature`, `signedAt`,
`badgeBalance`, `cid`).

### `GET /api/proposals/:id/commit`
On-chain Merkle root + ballot count (for independent verification).

### `GET /api/proposals/:id/local-root`
Locally-computed Merkle root over current ballots.

### `GET /api/health`
`{ "ok": true }`

## Proposal fields
`id`, `title`, `description`, `votingMode` (`quadratic` | `token-weight`),
`budget`, `options[]`, `deadline` (ISO close time), `opensAt` (ISO start
time; `null` = live immediately), `rolling`, `tokenAddress`, `tokenChainId`,
`createdAt`, `createdBy`.

A vote is **live** when `now` is between `opensAt` (if set) and `deadline`.

## Quick examples
```bash
curl https://murmur.thedao.fund/api/proposals
curl https://murmur.thedao.fund/api/proposals/r-abc123
```
