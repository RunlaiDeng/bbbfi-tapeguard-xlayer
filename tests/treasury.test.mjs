import test from 'node:test';
import assert from 'node:assert/strict';
import {treasuryAmount,treasuryImpact,treasuryPolicy,readTreasuryReport,TREASURY_MARKET,TREASURY_ASSETS} from '../lib/treasury.mjs';
const deployment={processor:'0x9de448A1CE9537d24199B3b5355239d73aA6F591',circuitId:'1'};
function fixture({badFactory=false,evalError=false,quoteError=false,stale=false}={}) {
 let blocks=0;
 return {getBlock:async()=>({number:stale&&blocks++?131n:100n,timestamp:1000n}),readContract:async({functionName,args,blockNumber})=>{
 assert.equal(blockNumber,100n);
 switch(functionName){
 case 'getPool': return args[2]===100?'0x1111111111111111111111111111111111111111':'0x0000000000000000000000000000000000000000';
 case 'slot0':return[1n<<96n,0];case 'token0':return TREASURY_ASSETS[0].address;case 'token1':return TREASURY_ASSETS[1].address;
 case 'factory':return badFactory?'0x2222222222222222222222222222222222222222':TREASURY_MARKET.factory;
 case 'fee':return 100;case 'liquidity':return 100000000000n;
 case 'eval':if(evalError)throw Error('RPC unavailable');return args[1]==='0x0f'?'0x01':'0x00';
 default:throw Error(functionName);
 }},simulateContract:async({args,blockNumber})=>{assert.equal(blockNumber,100n);if(quoteError)throw Error('Quote reverted');return{result:[args[0].amountIn*9999n/10000n,0n,0,100000n]};}};
}
const input={asset:'USD₮0',amount:'1000',monthly:'500',maxImpactBps:100};
test('rejects rounding, exponent, negative, zero and oversized financial inputs',()=>{for(const v of['0','-1','1e3',' 1','1.0000001','999999999999999999999'])assert.throws(()=>treasuryAmount(v,6));assert.equal(treasuryAmount('1.000001',6),1000001n);});
test('pool-relative impact works both directions and rounds losses up',()=>{assert.equal(treasuryImpact(10000n,9900n,1n<<96n,true),100);assert.equal(treasuryImpact(10000n,9900n,1n<<96n,false),100);assert.equal(treasuryImpact(10001n,9900n,1n<<96n,true),101);});
test('every failing predicate fails the four-input circuit mask',()=>{const good={route:true,impactBps:50,maxImpactBps:100,minimumOut:100n,target:100n,fresh:true};assert.equal(treasuryPolicy(good).mask,15);for(const changed of[{route:false},{impactBps:101},{minimumOut:99n},{fresh:false}])assert.notEqual(treasuryPolicy({...good,...changed}).mask,15);});
test('quotes and pool identity are pinned to one block and report is serializable',async()=>{const r=await readTreasuryReport(fixture(),input,deployment);assert.equal(r.output.address,'0xB6CEceAB302E2E4948951eE7843FC24E92933061');assert.equal(r.policy.circuit,'0x01');assert.equal(r.minimumOut,'994900500');assert.equal(r.runwayMonths,1.98);assert.equal(r.routes.filter(r=>r.status==='quoted').length,1);assert.doesNotThrow(()=>JSON.stringify(r));});
test('wrong-factory pool cannot become a trusted quote',async()=>{const r=await readTreasuryReport(fixture({badFactory:true}),input,deployment);assert.equal(r.bestFee,null);assert.equal(r.policy.circuit,'0x00');});
test('quoter failure is unavailable, not a fabricated zero-price fill',async()=>{const r=await readTreasuryReport(fixture({quoteError:true}),input,deployment);assert.equal(r.bestFee,null);assert.equal(r.routes[0].status,'unavailable');assert.equal(r.policy.checks[0],false);});
test('failed TapeOut call has no local ALLOW fallback',async()=>{const r=await readTreasuryReport(fixture({evalError:true}),input,deployment);assert.equal(r.policy.mask,15);assert.equal(r.policy.circuit,null);});
test('a later head beyond 30 blocks marks the observation invalid',async()=>{const r=await readTreasuryReport(fixture({stale:true}),input,deployment);assert.equal(r.policy.checks[3],false);assert.equal(r.policy.circuit,'0x00');});
