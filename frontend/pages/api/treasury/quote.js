import { createPublicClient, fallback, http } from 'viem';
import { readTreasuryReport } from '@/lib/treasury.mjs';
import { XLAYER_DEPLOYMENT } from '@/config/xlayer';
const client = createPublicClient({ transport: fallback(['https://xlayer.drpc.org','https://rpc.xlayer.tech'].map(url => http(url,{timeout:8000,retryCount:0}))) });
const pending = new Map(), cache = new Map();
export const config = { maxDuration: 60 };
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method !== 'GET') { res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'}); }
  const { asset, amount, monthly, impact } = req.query;
  if (![asset,amount,monthly,impact].every(v => typeof v === 'string' && v.length <= 40)) return res.status(400).json({error:'Invalid request'});
  const input = {asset,amount,monthly,maxImpactBps:Number(impact)}, key = JSON.stringify(input);
  try {
    const previous = cache.get(key);
    if(previous && Date.now() - previous.at < 10000) return res.json(previous.data);
    if(!pending.has(key)) {
      if(pending.size >= 4) return res.status(429).json({error:'Busy; please retry shortly'});
      const task = readTreasuryReport(client,input,XLAYER_DEPLOYMENT).then(data => { if(cache.size >= 100) cache.clear();cache.set(key,{at:Date.now(),data});return data; }).finally(() => pending.delete(key));
      pending.set(key,task);
    }
    return res.json(await pending.get(key));
  } catch(error) { return res.status(error.message?.includes('amount') || error.message?.includes('request') || error.message?.includes('range') ? 400 : 503).json({error:'Report unavailable. Check inputs or retry.'}); }
}
