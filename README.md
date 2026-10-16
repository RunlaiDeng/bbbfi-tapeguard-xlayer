# BBBFi Treasury + TapeGuard on X Layer

A free treasury runway calculator using existing X Layer market liquidity, plus optional V2 swap limits evaluated by a real TapeOut circuit.

- Treasury tool: https://www.bbbfi.com/explore/treasury?lang=en
- Market research & business plan: https://www.bbbfi.com/explore/treasury/business?lang=en
- Optional guarded swap: https://www.bbbfi.com/explore/tapeguard?chain=xlayer
- Shared Swap home: https://www.bbbfi.com/?chain=xlayer
- Revised 109-second demo: https://www.bbbfi.com/social/xlayer/treasury-demo-v2.mp4
- Interactive on-chain circuit: https://www.bbbfi.com/xlayer/about
- Event: [Build X · TapeOut Accelerate](https://web3.okx.com/zh-hans/xlayer/build-x-series)
- Network: X Layer mainnet, chain ID **196**, native gas token **OKB**.

## What is new during the event

Development began on 16 October 2026. This entry extends the existing BBBFi V2 DEX to X Layer and adds a dedicated TapeOut processor, a six-NAND combinational circuit, an immutable guarded swap entry point, and an interactive live-chain circuit verifier. The original XDC/BNB Chain products are prior work; this submission concerns the X Layer extension and TapeGuard.

The guard computes four predicates from on-chain state and calls the TapeOut processor's `eval(circuitId, inputs)` during the same transaction:

1. Fee-inclusive execution impact is within the user's cap (at most 5%), measured against the **same pool's** reserve ratio.
2. Minimum received is positive, achievable at the current quote, and within the user's slippage limit (hard cap 1%; UI uses 0.5%).
3. The quote is no more than 30 blocks old and the deadline is valid and no more than 600 seconds ahead.
4. The trader retains at least 0.0001 OKB after native input value is deducted. This is a fixed balance floor, not a guarantee of any number of future transactions.

Inputs are bit-packed LSB first. Only `0x0f` produces `0x01`; all other inputs produce `0x00`. The guard pins the exact netlist, processor, circuit ID, circuit beacon implementation and implementation code hash. A changed TapeOut circuit implementation stops guarded execution. The underlying TapeOut protocol is third-party, upgradeable and unaudited; this dependency is disclosed in the product.

The guard has no owner, upgrade function or administrative withdrawal. User assets flow through only during an atomic swap. Token input approvals to the base router are exact and cleared after use. Transfer-tax tokens are unsupported. Ordinary base-router transactions remain possible; users must select the guarded entry point to obtain this policy.

## Treasury runway: usable without seeding a new DEX

The new reader uses the official Uniswap V3 factory and QuoterV2 on X Layer. It discovers four direct fee tiers, verifies pool identities, and simulates full and quarter-sized conversions at one block. Native Circle USDC is `0xB6CEceAB302E2E4948951eE7843FC24E92933061`; legacy bridged `0x74b7…6d22` is a separate USDC.e asset and is not reused for market quotes.

The report includes output after a 0.5% buffer, monthly-spending coverage, fee-inclusive pool-relative impact, pool addresses, block/time and a JSON export. Failed routes remain unavailable. Quarter-size simulations are independent, not sequential-fill predictions. The existing market reader does not require BBBFi pool funding. It reads only Uniswap V3 direct pools, **not the whole market**.

Treasury uses the same real four-input AND circuit for report predicates: available route, impact cap, one-month spending coverage and recent observation. The application supplies these inputs. TapeOut **does not attest market facts or enforce third-party swaps**. This differs from the immutable TapeGuard below, which computes its own transaction predicates onchain and enforces them inside its own V2 swap.

Run the read-only tool with no wallet or secret:

```sh
npm ci
npm run treasury:test
npm run treasury:report -- 'USD₮0' 1000 500
```

`deployments/treasury-observation.json` is a dated mainnet observation, not a current price or a completed trade. `frontend/` contains the new Next.js page/API/style source integrated in the existing BBBFi Pages Router app; it is a source snapshot, not a separate complete Next.js app. The CLI and reader are independently runnable from this repository.

## Product, users and business

Research covered swap aggregation (Uniswap, OKX), order execution (CoW), wallet controls (Safe), enterprise payments (Request Finance), simulation (Tenderly), and analytics (Dune). Primary references, dated comparisons, explicit costs and an interactive unit-economics calculator are in the [business plan](https://www.bbbfi.com/explore/treasury/business?lang=en). This review is not an exhaustive market census or evidence of customer demand.

Initial customer hypothesis: 1–10-person teams needing 1,000–20,000 USDC per month for operations, without a dedicated treasury analyst. The free calculator delivers a usable report; proposed paid pilots are **99 USDC per human-reviewed report** and **199 USDC/month for four weekly reports and a monthly comparison**. No automatic subscriptions, monitoring, trading or payment collection is implemented. No paid customers or revenue are claimed.

Scenario: 199/month price, 85/customer variable cost (60 human time + 15 data/runtime + 10 support reserve), 150 fixed monthly runtime cost. Two customers cover those fixed costs. Five customers leave 420 USDC before acquisition, tax, development and extra time. These are assumptions, not operating results. The planned validation funnel is 20 interviews → 10 free reports → 3 paid pilots → at least 2 renewals. These milestones are not claimed as achieved; fewer than three pilots triggers a demand/pricing review before automation investment.

Distribution starts with BBBFi and X Layer builder communities, without LP subsidies or token issuance. The calculator and guard add no platform fee. V2 LP fees are 0.3%, accrue to liquidity providers and are not counted as BBBFi revenue.

## Mainnet deployment

| Contract | Address |
| --- | --- |
| V2 Factory | [`0xBeF275FA7E1bf43Fc80d5Bd11b3369496Ad4530A`](https://repo.sourcify.dev/196/0xBeF275FA7E1bf43Fc80d5Bd11b3369496Ad4530A) |
| OKB Router | [`0xEA34885369cC31c673544Ac733759282dFbFC67D`](https://repo.sourcify.dev/196/0xEA34885369cC31c673544Ac733759282dFbFC67D) |
| TapeGuard | [`0x39f7711e3f4f866849B39127ba1dF099924cb9aF`](https://repo.sourcify.dev/196/0x39f7711e3f4f866849B39127ba1dF099924cb9aF) |

TapeOut processor **#340**, circuit **#1** at `0x9de448A1CE9537d24199B3b5355239d73aA6F591`. All three BBBFi contracts have Sourcify **exact_match** creation and runtime verification.

Deployment cost including protocol fees and gas: **0.008747463811900897 OKB**. No liquidity was added. Full transaction ledger: `deployments/mainnet-deployment.json`.

## Verification

Requires Node.js 20+, npm, and Foundry supporting Solidity 0.8.23. No private key is needed for tests.

```sh
npm ci
forge test
```

Twenty Solidity tests cover arbitrary pairs, multihop liquidity, swaps in each direction, deadline and minimum enforcement, exact approvals, zero custody residue, quote freshness, insufficient gas reserve, changed TapeOut implementations and failing circuit outputs. Seven additional frontend-builder tests and eight treasury reader/policy tests pass in the application release.

For a full rehearsal against real TapeOut and WOKB contracts, start a **local fork** with synthetic accounts, deploy the candidate, then execute the smoke test:

```sh
anvil --fork-url https://rpc.xlayer.tech --port 8596 --auto-impersonate --chain-id 196 --gas-price 20000001 --base-fee 0
node scripts/deploy-xlayer.mjs --fork --deploy
node scripts/test-xlayer-fork.mjs
```

`deployments/fork-smoke.json` explicitly marks fork-only execution and synthetic funding. Fork transactions are **not mainnet trades**. New mainnet pools have no liquidity until an LP funds them; no volume, TVL, price, profit, or circulating supply is invented.

`verification/` contains the exact standard compiler input and metadata used for deployment. Compiler: `0.8.23+commit.f704f362`; optimizer 200 runs, viaIR, Shanghai EVM. These inputs reproduce creation bytecode exactly, including metadata. The deployment script checks runtime bytecode with immutable slots normalized and independently checks each immutable getter. This is reproducibility evidence, not an independent security audit.

## Limits

Reserve-relative impact is **not a market-price oracle**. It cannot detect manipulated starting reserves, scams, token administrators, or every MEV scenario. Quotes can expire or transactions can revert if pool state changes. Liquidity provision is handled by the V2 router and is outside the guarded swap path.

The live circuit test switches are test inputs, not a representation of a user's wallet or a certified trade. Actual transaction predicates are computed inside the guard.

## References and license

- [TapeKit network configuration](https://github.com/TapeOutProtocol/TapeKit/blob/main/kernel/src/config.js)
- [TapeOut X Layer integration reference](https://github.com/NetLayerLabs/Cerebr/blob/main/TAPEOUT.md), independently exercised on a fork and checked on mainnet for this release.
- [OKX canonical token list](https://github.com/okx/xlayer-tokenlist)

BBBFi contract code is MIT licensed. OpenZeppelin Contracts retain their MIT license. TapeOut is an external protocol, not authored by BBBFi. Participation does not imply endorsement by OKX, X Layer or TapeOut.

## Research references (checked 16 October 2026)

- [Circle native USDC on X Layer](https://www.circle.com/multi-chain-usdc/xlayer)
- [Official Uniswap deployment registry](https://developers.uniswap.org/deployments)
- [Uniswap on X Layer](https://web3.okx.com/nl/learn/uniswap-xlayer)
- [OKX aggregator](https://www.okx.com/en-us/learn/what-is-okx-aggregator)
- [CoW TWAP for EVM wallets](https://cow.fi/learn/cow-swap-brings-twap-orders-to-every-evm-wallet)
- [Safe Pro pricing](https://www.safe.global/blog/safe-pro-pricing)
- [Request Finance business model](https://help.request.finance/en/articles/10397958-what-does-request-cost)
- [Tenderly pricing and simulation](https://tenderly.co/pricing)
- [Dune business model](https://dune.com/blog/thoughts-on-dunes-business-model)
