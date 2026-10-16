import{createPublicClient,fallback,http}from'viem';
import{ACCESS_DEPLOYMENT,ACCESS_ABI}from'@/config/access';
import{verifyAccessProof}from'@/lib/access.mjs';
const client=createPublicClient({transport:fallback(['https://xlayer.drpc.org','https://rpc.xlayer.tech'].map(url=>http(url,{timeout:7000,retryCount:0})))});
export const config={maxDuration:30,api:{bodyParser:{sizeLimit:'24kb'}}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const proof=req.body?.proof;
 try{
  // Introspection only. Merchant servers must pin their own planId and resource;
  // this public endpoint does not deliver anyone's protected content.
  const result=await verifyAccessProof(client,ACCESS_DEPLOYMENT,ACCESS_ABI,proof,{planId:proof?.planId,audience:proof?.audience,resource:'/membership-check'});
  return res.json({active:true,...result});
 }catch{return res.status(401).json({active:false,error:'Signature, payment or membership validity could not be verified.'});}
}
