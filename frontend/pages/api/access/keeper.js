import {ACCESS_DEPLOYMENT as d} from '@/config/access';
export const config={maxDuration:15};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
 if(!d.enabled)return res.json({available:false,status:'not_deployed'});
 try{
  const response=await fetch('https://asp.bbbfi.com/api/xlayer-access/keeper',{signal:AbortSignal.timeout(7000),redirect:'error',cache:'no-store'});
  if(!response.ok)throw Error('Executor unavailable');const h=await response.json(),age=Date.now()-Date.parse(h.lastScan);
  if(h.chainId!==196||typeof h.contract!=='string'||h.contract.toLowerCase()!==d.address.toLowerCase()||!Number.isFinite(age)||age< -10000||age>180000||!['running','pending','confirming','needs_gas','degraded'].includes(h.status))throw Error('Executor observation unavailable');
  return res.json({available:true,status:h.status,keeper:h.keeper,lastScan:h.lastScan,lastSuccess:h.lastSuccess||null,executed:h.executed,pending:h.pending||null});
 }catch{return res.status(503).json({available:false,status:'unverified'});}
}
