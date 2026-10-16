# BBBFi Access + TapeGuard on X Layer

Native-USDC membership checkout, bounded automatic renewals and server-side paid access on X Layer, with payment predicates enforced through a real TapeOut circuit. The free treasury calculator and optional V2 swap guard remain available.

- Access product: https://www.bbbfi.com/explore/access?chain=xlayer&lang=en
- Server integration: https://www.bbbfi.com/explore/access/integrate?lang=en
- Treasury tool: https://www.bbbfi.com/explore/treasury?lang=en
- Market research & business plan: https://www.bbbfi.com/explore/access/business?lang=en
- Optional guarded swap: https://www.bbbfi.com/explore/tapeguard?chain=xlayer
- Shared Swap home: https://www.bbbfi.com/?chain=xlayer
- Current 90-second walkthrough (UI + explicitly synthetic test results): https://raw.githubusercontent.com/RunlaiDeng/bbbfi-tapeguard-xlayer/main/demo/access-walkthrough.mp4
- Earlier treasury-only demo (does not demonstrate Access): https://www.bbbfi.com/social/xlayer/treasury-demo-v2.mp4
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

The manual 99/199-USDC report proposal is discontinued. The treasury calculator remains free. The selected product is **USDC checkout + bounded renewals + automatically expiring website/API membership**. Merchants install a server verifier and pin their own plan ID; a payment link alone does not secure content. The SDK validates wallet ownership, origin, resource, plan, chain, contract, a one-minute signature window and fresh onchain entitlement before delivering protected content. Signatures are short-lived, reusable GET capabilities, not spending authority or one-use payment receipts.

Initial users must already have a paid product and customers holding native X Layer USDC. A plain transfer lacks an entitlement, paid-through date and renewal mandate; integrating those repeatedly is the work being replaced. Merchants needing only occasional transfers have no strong reason to pay. Established competitors include InviteMember ($19/month entry plan), MoonPay Commerce (standard 2%, HelioX 1%), Stripe (stablecoin recurring payments on listed networks) and Unlock. BBBFi is not a new uncontested category. Pricing comparisons are provider-published offerings, not independently verified sales or BBBFi demand.

Every successful charge sends **99% directly to the merchant**. The initial charge sends 1% to the fixed protocol recipient. Renewals split 0.8% to the protocol and 0.2% to the permissionless executor. There is no platform deposit balance, monthly report fee or token subsidy. Buyers default to a single payment. Optional recurring mandates are bounded to 3/6/12 total charges including today, require explicit consent, and are cancellable. Cancellation preserves paid time; missed periods are not back-billed. Insufficient balance or allowance stops renewal. Merchant pause stops future payments while preserving paid access. A full current-period refund closes the subscription and returns the full price from the merchant wallet; the merchant covers processing fees already settled.

Access computes four factual onchain predicates and evaluates processor **340**, circuit **1** in the payment transaction. For renewals these are: enabled plan, due period, remaining uncancelled authorization bound to the current membership, and sufficient balance/allowance. Exact terms, a short deadline and bounded allowance are enforced at checkout. A changed pinned TapeOut implementation stops payments, while cancellation and refunds remain available. Public source verification is not an independent audit.

**No established acquisition channel, paid merchants, renewal rate or profitability is claimed.** First validation gate: three independent merchants, each with at least 20 genuine non-team orders and retention over two billing cycles. Exclude self-purchases, subsidies and prize money. Do not build more channels, currencies or chains until that gate. Stop if three qualifying merchants cannot be found in 30–45 days. Public documentation and runnable examples support self-service adoption; no outreach or partnership is claimed completed.

Economics are explicit assumptions: 20 merchants × 3,000 monthly GMV = 60,000 USDC. At a conservative 0.8% renewal fee, protocol revenue is 480. Assumed monthly cost 1,235 comprises infrastructure 60, support 75, acquisition labor 100 and amortized hypothetical development/security budget 1,000. The result is a **755-USDC loss**, and 154,375 monthly GMV is needed to cover those listed costs. The security budget is not an audit quote. Taxes, disputes and extra risk costs are excluded. Merchant acquisition cost must pay back within three months of gross contribution. The interactive [research page](https://www.bbbfi.com/explore/access/business?lang=en) shows the assumptions and tradeoffs.

## Access verification and integration

```sh
npm ci
forge test --match-contract BBBFiAccessTest
npm run access:test
# Offline integration with mock USDC/TapeOut:
anvil --port 8598 --chain-id 196 --gas-price 20000001 --base-fee 20000000 --disable-min-priority-fee
npm run access:flow
# Real native-USDC and TapeOut interfaces, synthetic local-fork payments only:
anvil --fork-url https://rpc.xlayer.tech --port 8597 --chain-id 196 --gas-price 20000001 --base-fee 0 --disable-min-priority-fee
node scripts/test-access-flow.mjs --fork
```

Twenty additional Access Solidity tests, eleven SDK/payment-builder tests and nine HTTP/keeper flow checks pass. The fork uses impersonated local balances and does not submit mainnet customer payments. `deployments/access-fork-flow.json` explicitly records zero real customer orders and zero mainnet transactions. The HTTP test denies unpaid requests, delivers content only after a signed paid entitlement, runs the actual keeper to renew once, then cancels and denies access at expiry. A customer-created cheaper plan cannot unlock another server-pinned plan.

The independent renewal worker is at `scripts/access-keeper.mjs`. It signs only `charge(id)` against the fixed deployment, journals signed hashes before broadcasting and reconciles three confirmations. It holds its own limited gas wallet, not payer keys. Actual availability is checked through a fresh, contract-matched health endpoint; future uptime is not guaranteed. Public `/api/access/verify` is membership introspection only. Merchant servers must run the verifier with their own fixed plan ID and keep protected content off public frontend bundles.

## Mainnet deployment

| Contract | Address |
| --- | --- |
| Access | [`0x36757BaA2F0b767Ea4DCFb434F46ACD020046f47`](https://repo.sourcify.dev/196/0x36757BaA2F0b767Ea4DCFb434F46ACD020046f47) |
| V2 Factory | [`0xBeF275FA7E1bf43Fc80d5Bd11b3369496Ad4530A`](https://repo.sourcify.dev/196/0xBeF275FA7E1bf43Fc80d5Bd11b3369496Ad4530A) |
| OKB Router | [`0xEA34885369cC31c673544Ac733759282dFbFC67D`](https://repo.sourcify.dev/196/0xEA34885369cC31c673544Ac733759282dFbFC67D) |
| TapeGuard | [`0x39f7711e3f4f866849B39127ba1dF099924cb9aF`](https://repo.sourcify.dev/196/0x39f7711e3f4f866849B39127ba1dF099924cb9aF) |

TapeOut processor **#340**, circuit **#1** at `0x9de448A1CE9537d24199B3b5355239d73aA6F591`. All four BBBFi contracts have Sourcify **exact_match** creation and runtime verification.

Initial V2/TapeGuard deployment cost including protocol fees and gas: **0.008747463811900897 OKB**. No liquidity was added. Full initial transaction ledger: `deployments/mainnet-deployment.json`. Access was deployed separately in transaction `0x126ec44d4e14a956ec90b6e3342da1ab6b58603d03f5ebd24d26c77c906486ff`, costing 0.000053680977 OKB in gas. Its fee and real customer payment counters started at zero.

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

Additional research references (checked 16 October 2026): [InviteMember](https://www.invitemember.com/pricing), [MoonPay Commerce](https://support.moonpay.com/en/articles/466267-moonpay-commerce-faqs), [Stripe stablecoins](https://docs.stripe.com/payments/stablecoin-payments), [Unlock](https://docs.unlock-protocol.com/), [Revert](https://docs.revert.finance/revert/auto-compounder), [OKX limit orders](https://web3.okx.com/id/help/what-is-limit-order-in-dex).
