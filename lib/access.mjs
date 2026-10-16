import {encodeFunctionData,erc20Abi,getAddress,isAddress,keccak256,stringToHex,parseUnits} from 'viem';
export const ACCESS_USDC='0xB6CEceAB302E2E4948951eE7843FC24E92933061';
export function accessOrigin(value,{local=false}={}) {
 if(typeof value!=='string'||value.length>240)throw Error('Invalid service origin');
 const url=new URL(value);
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(local&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw Error('Use an HTTPS origin without path');
 return url.origin;
}
export const accessAudience=origin=>keccak256(stringToHex(origin));
export function accessPrice(value){if(typeof value!=='string'||!/^\d{1,7}(\.\d{1,6})?$/.test(value))throw Error('Invalid USDC price');const n=parseUnits(value,6);if(n<1000000n||n>1000000000000n)throw Error('Price must be 1–1,000,000 USDC');return n;}
export function accessProofMessage(proof){
 if(!proof||proof.version!==1||proof.chainId!==196||!isAddress(proof.contract)||!isAddress(proof.address)||!/^\d{1,20}$/.test(proof.planId)||BigInt(proof.planId)<=0n||!Number.isSafeInteger(proof.issuedAt)||!/^[a-zA-Z0-9_-]{16,64}$/.test(proof.nonce)||typeof proof.resource!=='string'||!/^\/[a-zA-Z0-9/_.~-]{0,180}$/.test(proof.resource))throw Error('Invalid access proof');
 const origin=accessOrigin(proof.audience,{local:true});
 return ['BBBFi Access v1','Read-only access verification; no payment authorization.',`Chain: 196`,`Contract: ${getAddress(proof.contract)}`,`Plan: ${proof.planId}`,`Wallet: ${getAddress(proof.address)}`,`Audience: ${origin}`,`Resource: GET ${proof.resource}`,`Issued: ${proof.issuedAt}`,`Nonce: ${proof.nonce}`].join('\n');
}
// The merchant calls this on its own server before delivering the resource.
// Signatures are short-lived GET capabilities, not one-use payment approvals.
export async function verifyAccessProof(client,deployment,abi,proof,{audience,resource,planId,now=Math.floor(Date.now()/1000)}={}) {
 const message=accessProofMessage(proof),origin=accessOrigin(audience,{local:true});
 if(!/^\d{1,20}$/.test(String(planId))||String(planId)!==proof.planId)throw Error('Unexpected membership plan');
 if(!deployment.enabled||proof.contract.toLowerCase()!==deployment.address.toLowerCase()||proof.audience!==origin||proof.resource!==resource||proof.issuedAt>now+10||proof.issuedAt<now-60||!/^0x[0-9a-fA-F]{2,16384}$/.test(proof.signature||''))throw Error('Access proof scope or expiry mismatch');
 if(!await client.verifyMessage({address:proof.address,message,signature:proof.signature}))throw Error('Wallet signature invalid');
 const block=await client.getBlock();
 const result=await client.readContract({address:deployment.address,abi,functionName:'hasAccess',args:[BigInt(proof.planId),proof.address,accessAudience(origin)],blockNumber:block.number});
 if(!result[0]||BigInt(result[1])<=block.timestamp)throw Error('No current paid membership');
 return {planId:proof.planId,address:getAddress(proof.address),paidUntil:Number(result[1]),block:String(block.number),verifiedAt:now};
}
export async function buildAccessPayment(client,{deployment,abi,owner,plan,origin,cycles}) {
 if(client.chain?.id!==196||!deployment.enabled||![1,3,6,12].includes(cycles)||!isAddress(owner))throw Error('Invalid payment scope');
 const block=await client.getBlock();
 const live=await client.readContract({address:deployment.address,abi,functionName:'plans',args:[BigInt(plan.id)],blockNumber:block.number});
 if(!live[2]||live[0].toLowerCase()!==plan.merchant.toLowerCase()||String(live[3])!==plan.price||Number(live[1])!==plan.period||live[4]!==accessAudience(origin))throw Error('Plan changed; review again');
 const total=BigInt(plan.price)*BigInt(cycles);
 const [balance,allowance]=await Promise.all(['balanceOf','allowance'].map(functionName=>client.readContract({address:ACCESS_USDC,abi:erc20Abi,functionName,args:functionName==='balanceOf'?[owner]:[owner,deployment.address],blockNumber:block.number})));
 if(balance<BigInt(plan.price))throw Error('Insufficient USDC for first payment');
 if(allowance<total)return {to:ACCESS_USDC,value:0n,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[deployment.address,total]})};
 return {to:deployment.address,value:0n,data:encodeFunctionData({abi,functionName:'subscribe',args:[BigInt(plan.id),cycles,BigInt(plan.price),BigInt(plan.period),plan.merchant,accessAudience(origin),block.timestamp+300n]})};
}
