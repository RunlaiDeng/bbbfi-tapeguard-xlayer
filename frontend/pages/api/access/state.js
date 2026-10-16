import{createPublicClient,fallback,http}from'viem';
import{ACCESS_DEPLOYMENT,ACCESS_ABI}from'@/config/access';
import{readAccessState}from'@/lib/access-reader.mjs';
const client=createPublicClient({transport:fallback(['https://xlayer.drpc.org','https://rpc.xlayer.tech'].map(url=>http(url,{timeout:7000,retryCount:0})))});
export const config={maxDuration:60};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const {plan,owner,offset}=req.query;
 if([plan,owner,offset].some(v=>v!==undefined&&typeof v!=='string'))return res.status(400).json({error:'Invalid request'});
 try{return res.json(await readAccessState(client,ACCESS_DEPLOYMENT,ACCESS_ABI,{planId:plan,owner,offset:Number(offset||0)}));}catch(e){return res.status(/Invalid|not found/.test(e.message)?400:503).json({error:/not found/.test(e.message)?'Plan not found':'State unavailable. Retry shortly.'});}
}
