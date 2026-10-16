// SERVER ONLY. The browser never receives the merchant's session secret.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {getAddress,isAddress} from 'viem';
import {accessOrigin,accessAudience,verifyAccessProof} from './access.mjs';
function key(secret){if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('Use a random server session secret of at least 32 bytes');return secret;}
function mac(payload,secret){return createHmac('sha256',key(secret)).update(payload).digest();}
function scope(deployment,{audience,resource,planId}){
 if(!deployment.enabled||(deployment.chainId!==undefined&&deployment.chainId!==196)||!isAddress(deployment.address)||!/^\d{1,20}$/.test(String(planId))||BigInt(planId)<=0n||typeof resource!=='string'||!/^\/[a-zA-Z0-9/_.~-]{0,180}$/.test(resource))throw Error('Invalid server session scope');
 return{version:1,chainId:196,contract:getAddress(deployment.address),planId:String(planId),audience:accessOrigin(audience,{local:true}),resource};
}
export async function issueAccessSession(client,deployment,abi,proof,options){
 const {secret,maxAge=3600,now=Math.floor(Date.now()/1000)}=options,expected=scope(deployment,options);key(secret);
 if(!Number.isSafeInteger(maxAge)||maxAge<60||maxAge>43200||!Number.isSafeInteger(now))throw Error('Invalid session duration');
 const grant=await verifyAccessProof(client,deployment,abi,proof,{...expected,now});
 const payload=Buffer.from(JSON.stringify({...expected,address:grant.address,issuedAt:now,expiresAt:now+maxAge})).toString('base64url');
 return{token:payload+'.'+mac(payload,secret).toString('base64url'),grant,maxAge};
}
// The session authenticates a wallet. It never caches or grants paid status.
// Refund, expiry and new payment are evaluated at a fresh block on every read.
export async function verifyAccessSession(client,deployment,abi,token,options){
 const {secret,now=Math.floor(Date.now()/1000)}=options,expected=scope(deployment,options);key(secret);
 if(!Number.isSafeInteger(now))throw Error('Invalid server clock');
 if(typeof token!=='string'||token.length>4096||!/^[-\w]+\.[-\w]{43}$/.test(token))throw Error('Invalid session');
 const [payload,signature]=token.split('.'),received=Buffer.from(signature,'base64url'),wanted=mac(payload,secret);
 if(received.length!==wanted.length||!timingSafeEqual(received,wanted))throw Error('Invalid session signature');
 const session=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
 if(Object.keys(expected).some(name=>session[name]!==expected[name])||!isAddress(session.address)||!Number.isSafeInteger(session.issuedAt)||!Number.isSafeInteger(session.expiresAt)||session.issuedAt>now+10||session.expiresAt<=now||session.expiresAt-session.issuedAt<60||session.expiresAt-session.issuedAt>43200)throw Error('Session scope or expiry mismatch');
 const block=await client.getBlock(),result=await client.readContract({address:deployment.address,abi,functionName:'hasAccess',args:[BigInt(expected.planId),session.address,accessAudience(expected.audience)],blockNumber:block.number});
 if(!result[0]||BigInt(result[1])<=block.timestamp)throw Error('No current paid membership');
 return{planId:expected.planId,address:getAddress(session.address),paidUntil:Number(result[1]),block:String(block.number),verifiedAt:now};
}
