import { parseAbi, parseUnits, formatUnits } from 'viem';
// Official Uniswap deployment registry: https://developers.uniswap.org/deployments
export const TREASURY_MARKET = Object.freeze({ chainId: 196, factory: '0x4B2ab38DBF28D31D467aA8993f6c2585981D6804', quoter: '0xD1b797D92d87B688193A2B976eFc8D577D204343' });
export const TREASURY_ASSETS = [
  { symbol: 'USD₮0', address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', decimals: 6 },
  { symbol: 'USDC', address: '0xB6CEceAB302E2E4948951eE7843FC24E92933061', decimals: 6 },
  { symbol: 'OKB', address: '0xe538905cf8410324e03A5A23C1c177a474D59b2b', decimals: 18 },
  { symbol: 'WETH', address: '0x5A77f1443D16ee5761d310e38b62f77f726bC71c', decimals: 18 },
  { symbol: 'USDG', address: '0x4ae46a509F6b1D9056937BA4500cb143933D2dc8', decimals: 6 },
];
const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns(address)']);
const poolAbi = parseAbi(['function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)', 'function token0() view returns(address)', 'function token1() view returns(address)', 'function factory() view returns(address)', 'function fee() view returns(uint24)', 'function liquidity() view returns(uint128)']);
const quoteAbi = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const evalAbi = parseAbi(['function eval(uint256,bytes) view returns(bytes)']);
export function treasuryAmount(value, decimals) {
  if (typeof value !== 'string' || value.length > 40 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (value.split('.')[1]?.length || 0) > decimals) throw Error('Invalid amount');
  const n = parseUnits(value, decimals);
  if (n <= 0n || n > 10n ** BigInt(decimals + 12)) throw Error('Amount outside supported range');
  return n;
}
export function treasuryImpact(amount, output, sqrtPriceX96, forward) {
  if (amount <= 0n || output < 0n || sqrtPriceX96 <= 0n) throw Error('Invalid pool state');
  const square = sqrtPriceX96 * sqrtPriceX96, q192 = 1n << 192n;
  const ideal = forward ? amount * square / q192 : amount * q192 / square;
  if (ideal <= 0n) throw Error('Amount below quote precision');
  const loss = (ideal - output) * 10000n;
  return Number(loss > 0n ? (loss + ideal - 1n) / ideal : loss / ideal);
}
export function treasuryPolicy({ route, impactBps, maxImpactBps, minimumOut, target, fresh }) {
  const checks = [Boolean(route), Boolean(route && impactBps <= maxImpactBps), Boolean(route && minimumOut >= target), Boolean(fresh)];
  return { checks, mask: checks.reduce((sum, pass, i) => sum | (pass ? 1 << i : 0), 0) };
}
export async function readTreasuryReport(client, input, deployment) {
  const asset = TREASURY_ASSETS.find(t => t.symbol === input.asset);
  const output = TREASURY_ASSETS[1];
  if (!asset || asset === output || ![50,100,300,500].includes(input.maxImpactBps)) throw Error('Unsupported request');
  const amount = treasuryAmount(input.amount, asset.decimals), target = treasuryAmount(input.monthly, 6);
  const block = await client.getBlock();
  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args, blockNumber: block.number });
  const routes = await Promise.all([100,500,3000,10000].map(async fee => {
    let pool;
    try {
      pool = await read(TREASURY_MARKET.factory, factoryAbi, 'getPool', [asset.address,output.address,fee]);
      if (/^0x0{40}$/i.test(pool)) return { fee, status: 'missing' };
      const [slot,token0,token1,factory,poolFee,liquidity] = await Promise.all(['slot0','token0','token1','factory','fee','liquidity'].map(n => read(pool,poolAbi,n)));
      if (factory.toLowerCase() !== TREASURY_MARKET.factory.toLowerCase() || poolFee !== fee || ![token0,token1].some(t => t.toLowerCase() === asset.address.toLowerCase()) || ![token0,token1].some(t => t.toLowerCase() === output.address.toLowerCase())) throw Error('Pool identity mismatch');
      if (!liquidity || !slot[0]) return { fee, pool, status: 'inactive' };
      const quote = async size => {
        const { result } = await client.simulateContract({ address: TREASURY_MARKET.quoter, abi: quoteAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn:asset.address,tokenOut:output.address,amountIn:size,fee,sqrtPriceLimitX96:0n }], blockNumber:block.number });
        // A quote hitting a terminal price limit can consume less than amountIn.
        // Its output is a conservative estimate, never an executable trade promise.
        return { amount: String(size), output: String(result[0]), impactBps: treasuryImpact(size,result[0],slot[0],token0.toLowerCase() === asset.address.toLowerCase()) };
      };
      const full = await quote(amount);
      let quarter = null;
      try { if (amount >= 4n) quarter = await quote(amount / 4n); } catch { /* Preserve full-size result when a small quote fails. */ }
      return { fee,pool,status:'quoted',full,quarter };
    } catch { return { fee, ...(pool ? {pool} : {}), status: 'unavailable' }; }
  }));
  const quoted = routes.filter(r => r.status === 'quoted' && BigInt(r.full.output) > 0n);
  const best = quoted.reduce((a,b) => !a || BigInt(b.full.output) > BigInt(a.full.output) ? b : a, null);
  const minimumOut = best ? BigInt(best.full.output) * 9950n / 10000n : 0n;
  const latest = await client.getBlock();
  const fresh = latest.number >= block.number && latest.timestamp >= block.timestamp && latest.number - block.number <= 30n && latest.timestamp - block.timestamp <= 60n;
  const policy = treasuryPolicy({ route:Boolean(best), impactBps:best?.full.impactBps, maxImpactBps:input.maxImpactBps, minimumOut,target,fresh });
  let circuit = null;
  try { circuit = await read(deployment.processor,evalAbi,'eval',[BigInt(deployment.circuitId),`0x${policy.mask.toString(16).padStart(2,'0')}`]); } catch { /* No local fallback for a failed onchain evaluation. */ }
  return { version:1,chainId:196,market:TREASURY_MARKET,asset,output,input,amount:String(amount),target:String(target),block:String(block.number),blockTimestamp:Number(block.timestamp),observedAt:new Date().toISOString(),expiresAt:(Number(block.timestamp)+60)*1000,routes,bestFee:best?.fee??null,minimumOut:String(minimumOut),minimumOutFormatted:formatUnits(minimumOut,6),runwayMonths:Number(minimumOut*100n/target)/100,policy:{...policy,circuit,processor:deployment.processor,circuitId:deployment.circuitId},scope:'Uniswap V3 direct pools on X Layer only; eth_call estimates, no transaction or wallet balance validation. Not a whole-market best-execution claim. The four circuit inputs are report predicates supplied by this reader, not onchain attestation of market inputs or enforced external swaps.' };
}
