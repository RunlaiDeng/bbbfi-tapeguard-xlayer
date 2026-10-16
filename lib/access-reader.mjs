import{erc20Abi,isAddress}from'viem';
import{ACCESS_USDC}from'./access.mjs';
export async function readAccessState(client,d,abi,{planId,owner,offset=0}={}){
 if(!d.enabled) return {enabled:false,chainId:196};
 if(owner&&!isAddress(owner))throw Error('Invalid wallet');
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error('Invalid offset');
 const b=await client.getBlock();
 const read=(functionName,args=[])=>client.readContract({address:d.address,abi,functionName,args,blockNumber:b.number});
 const names=['planCount','payments','grossSettled','protocolSettled','keeperSettled','refunds'];
 const results=await Promise.all(names.map(name=>read(name)));
 const stats=Object.fromEntries(names.map((name,i)=>[name,String(results[i])]));
 const convert=(id,p)=>({id:String(id),merchant:p[0],period:Number(p[1]),enabled:p[2],price:String(p[3]),audience:p[4],title:p[5]});
 let plan=null,subscription=null,allowance=null,balance=null,merchantPlans=[],memberships=[],merchantGross=null,merchantRefunds=null;
 if(planId){if(!/^\d{1,20}$/.test(String(planId))||BigInt(planId)<=0n||BigInt(planId)>BigInt(stats.planCount))throw Error('Plan not found');plan=convert(planId,await read('plans',[BigInt(planId)]));}
 const sub=async id=>{const s=await read('subscriptions',[BigInt(id)]);return {id:String(id),payer:s[0],paidUntil:Number(s[1]),remaining:Number(s[2]),authorizedCycles:Number(s[3]),planId:String(s[4]),cancelled:s[5]};};
 if(owner){
  const [ids,payerIds,gross,refunded,a,bal]=await Promise.all([read('getMerchantPlans',[owner,BigInt(offset),20n]),read('getPayerSubscriptions',[owner,BigInt(offset),20n]),read('merchantGross',[owner]),read('merchantRefunds',[owner]),client.readContract({address:ACCESS_USDC,abi:erc20Abi,functionName:'allowance',args:[owner,d.address],blockNumber:b.number}),client.readContract({address:ACCESS_USDC,abi:erc20Abi,functionName:'balanceOf',args:[owner],blockNumber:b.number})]);
  allowance=String(a);balance=String(bal);merchantGross=String(gross);merchantRefunds=String(refunded);
  merchantPlans=await Promise.all(ids.map(async id=>convert(id,await read('plans',[id]))));
  memberships=await Promise.all(payerIds.map(sub));
  if(plan){const id=await read('membershipId',[BigInt(plan.id),owner]);if(id>0n)subscription=await sub(id);}
 }
 return{enabled:true,chainId:196,contract:d.address,block:String(b.number),timestamp:Number(b.timestamp),observedAt:Date.now(),stats,plan,subscription,owner:owner||null,allowance,balance,merchantPlans,memberships,merchantGross,merchantRefunds,offset};
}
