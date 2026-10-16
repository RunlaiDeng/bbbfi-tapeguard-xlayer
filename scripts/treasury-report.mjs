import {createPublicClient,fallback,http} from 'viem';
import {readTreasuryReport} from '../lib/treasury.mjs';
const client=createPublicClient({transport:fallback(['https://xlayer.drpc.org','https://rpc.xlayer.tech'].map(url=>http(url,{timeout:8000,retryCount:0})))});
const input={asset:process.argv[2]||'USD₮0',amount:process.argv[3]||'1000',monthly:process.argv[4]||'500',maxImpactBps:100};
// Only public RPC reads and eth_call simulations. Never loads a signing key.
const report=await readTreasuryReport(client,input,{processor:'0x9de448A1CE9537d24199B3b5355239d73aA6F591',circuitId:'1'});
console.log(JSON.stringify(report,null,2));
