// Permissionless renewal executor. One fixed contract, no arbitrary transaction
// target or calldata, and no access to payer signing keys.
import fs from 'node:fs';
import path from 'node:path';
import {Contract,JsonRpcProvider,Wallet,FetchRequest,formatEther} from 'ethers';
const fork=process.argv.includes('--fork'),local=process.argv.includes('--local-test'),simulation=fork||local;
if(fork&&local)throw Error('Choose one test mode');
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,local?'artifacts-access-local':fork?'artifacts-access-fork':'artifacts-access');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const d=JSON.parse(fs.readFileSync(path.join(simulation?dir:root,simulation?'deployment.json':'access-deployment.json')));
const artifact=JSON.parse(fs.readFileSync(path.join(root,'access-abi.json')));
const keyFile=path.join(dir,'keeper-key.json');
if(!fs.existsSync(keyFile)){const wallet=Wallet.createRandom();fs.writeFileSync(keyFile,JSON.stringify({privateKey:wallet.privateKey,address:wallet.address}),{mode:0o600,flag:'wx'});}
fs.chmodSync(keyFile,0o600);
const secret=JSON.parse(fs.readFileSync(keyFile));
const request=new FetchRequest(simulation?`http://127.0.0.1:${local?8598:8597}`:'https://xlayer.drpc.org');request.timeout=12000;
const provider=new JsonRpcProvider(request,196,{batchMaxCount:1,cacheTimeout:-1});
const wallet=new Wallet(secret.privateKey,provider),contract=new Contract(d.address,artifact,wallet);
if(d.chainId!==196||!d.enabled||!/^0x[0-9a-fA-F]{40}$/.test(d.address))throw Error('Invalid deployment');
const stateFile=path.join(dir,'keeper-state.json'),healthFile=path.join(dir,'keeper-health.json');
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{contract:d.address,lastSeen:0,active:[],executed:0};
if(state.contract!==d.address)throw Error('Keeper state scope changed');
const save=(file,data)=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(temp,file);};
let stopped=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;});
async function tick(){
 const chain=Number(BigInt(await provider.send('eth_chainId',[])));if(chain!==196)throw Error('Wrong network');
 let balance=await provider.getBalance(wallet.address);
 const health={version:1,chainId:196,contract:d.address,keeper:wallet.address,lastScan:new Date().toISOString(),lastSuccess:state.lastSuccess||null,executed:state.executed,nativeBalance:formatEther(balance),pending:state.pending?.hash||null,error:null};
 try{
  if(state.pending){
   const r=await provider.getTransactionReceipt(state.pending.hash);
   if(!r){
    const raw=fs.existsSync(path.join(dir,'pending-raw'))?fs.readFileSync(path.join(dir,'pending-raw'),'utf8'):null;
    const {keccak256}=await import('ethers');
    if(!raw||keccak256(raw)!==state.pending.hash)throw Error('Pending journal needs reconciliation');
    if(!await provider.getTransaction(state.pending.hash))await provider.broadcastTransaction(raw);
    save(healthFile,{...health,status:'pending'});return;
   }
   if(await provider.getBlockNumber()<r.blockNumber+2){save(healthFile,{...health,status:'confirming'});return;}
   if(r.status===1){state.executed++;state.lastSuccess=new Date().toISOString();state.lastTx=r.hash;}
   delete state.pending;save(stateFile,state);if(fs.existsSync(path.join(dir,'pending-raw')))fs.unlinkSync(path.join(dir,'pending-raw'));
  }
  const count=Number(await contract.subscriptionCount());
  if(!Number.isSafeInteger(count)||count>1000000)throw Error('Subscription range unsupported');
  // Resume discovery and persist the active set. Empty/finished subscriptions are
  // removed, rather than rescanning the entire historical ledger forever.
  for(let start=state.lastSeen;start<count;start+=100){const page=await contract.getSubscriptions(start,100);for(let i=0;i<page.length;i++)if(page[i].remaining>0n&&!page[i].cancelled)state.active.push(start+i+1);state.lastSeen=start+page.length;save(stateFile,state);}
  const next=[],active=[...new Set(state.active)],processed=new Set();
  for(const id of active.slice(0,1000)){
   processed.add(id);
   const sub=await contract.subscriptions(id);
   if(sub.remaining===0n||sub.cancelled)continue;
   next.push(id);
   if(await contract.renewalChecks(id)!==15n)continue;
   const gasPrice=(await provider.getFeeData()).gasPrice;
   if(!gasPrice||gasPrice>100000000n)continue;
   const tx=await contract.charge.populateTransaction(id),estimate=await provider.estimateGas({...tx,from:wallet.address});
   const gasLimit=estimate*120n/100n;
   if(balance<gasLimit*gasPrice+1000000000000n)continue;
   // Recheck latest nonce and journal the signed hash BEFORE broadcast.
   const nonce=await provider.getTransactionCount(wallet.address,'pending');
   if(nonce!==await provider.getTransactionCount(wallet.address,'latest'))break;
   const signed=await wallet.signTransaction({...tx,chainId:196,type:0,nonce,gasLimit,gasPrice});
   const {keccak256}=await import('ethers');
   // Journal raw bytes first, then commit the pending hash, then broadcast.
   fs.writeFileSync(path.join(dir,'pending-raw'),signed,{mode:0o600});
   state.pending={id,hash:keccak256(signed),createdAt:new Date().toISOString()};save(stateFile,state);
   await provider.broadcastTransaction(signed);
   break;
  }
  // Never drop unscanned active entries when a pending send interrupted scanning.
  state.active=[...active.filter(id=>!processed.has(id)),...next];
  save(stateFile,state);save(healthFile,{...health,executed:state.executed,pending:state.pending?.hash||null,active:state.active.length,status:balance>=1000000000000n?'running':'needs_gas',lastSuccess:state.lastSuccess||null,lastTx:state.lastTx||null});
 }catch(error){save(healthFile,{...health,status:'degraded',error:String(error.shortMessage||error.message).slice(0,140)});throw error;}
}
while(!stopped){try{await tick();}catch(error){console.error(new Date().toISOString(),String(error.shortMessage||error.message).slice(0,180));}if(process.argv.includes('--once'))break;await new Promise(resolve=>setTimeout(resolve,30000));}
provider.destroy();
