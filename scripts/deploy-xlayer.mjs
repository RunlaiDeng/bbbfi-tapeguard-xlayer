#!/usr/bin/env node
// Fixed-scope mainnet deployment; dry-run by default. Never prints key material.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {Contract,ContractFactory,JsonRpcProvider,JsonRpcSigner,Wallet,Interface,parseEther,formatEther,keccak256,getAddress,FetchRequest} from 'ethers';
const deploy=process.argv.includes('--deploy');
const fork=process.argv.includes('--fork');
const root=path.resolve(import.meta.dirname,'..');
const recordPath=path.resolve(root,process.env.XLAYER_RECORD || (fork?'deployments/fork-deployment.json':'deployments/mainnet-deployment.json'));
fs.mkdirSync(path.dirname(recordPath),{recursive:true});
const rpc=fork?'http://127.0.0.1:8596':'https://xlayer.drpc.org';
const request=new FetchRequest(rpc);request.timeout=20000;
const provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
provider.pollingInterval=1000;
const chain=Number(BigInt(await provider.send('eth_chainId',[])));if(chain!==196)throw Error('Wrong chain');
const owner='0x2475Dcd4Fe333bE814Ef7C8f8CE8A1E9B5FcDEA0';
if(fork) await provider.send('anvil_impersonateAccount',[owner]);
if(!fork&&!process.env.XLAYER_DEPLOYER_PRIVATE_KEY)throw Error('Set XLAYER_DEPLOYER_PRIVATE_KEY locally; never publish it');
const wallet=fork?new JsonRpcSigner(provider,owner):new Wallet(process.env.XLAYER_DEPLOYER_PRIVATE_KEY,provider);
if(wallet.address!==owner)throw Error('Unexpected signer');
const tapeFactory='0x1f09daefa827f02cbb40967cc91b259763760761';
const wokb='0xe538905cf8410324e03A5A23C1c177a474D59b2b',usdc='0x74b7F16337b8972027F6196A17a631aC6dE26d22';
const netlist='0x00000002000003000000060000060000000400000500000008000008000000070000090000000a00000a';
const factoryABI=['function createCPU(string,string,string,uint256,uint256) payable returns(address,address)','function deployFee() view returns(uint256)','function protocolFee() view returns(uint256)','function cpuCount() view returns(uint256)','function cpuAt(uint256) view returns(address)','event CPUCreated(address indexed circuits,address indexed transistors,address indexed creator,string name,uint256 supply,uint256 mintPrice)'];
const circuitABI=['function tapeout(bytes,uint32,uint32) payable returns(uint256)','function TAPEOUT_FEE() view returns(uint256)','function nextId() view returns(uint256)','function eval(uint256,bytes) view returns(bytes)','function circuitInfo(uint256) view returns(uint32,uint32,uint32,uint32)','function netlist(uint256) view returns(bytes)','function ownerOf(uint256) view returns(address)','event TapedOut(uint256 indexed circuitId,address indexed author,uint32 gateCount,uint32 nState)'];
const transistorABI=['function mint(uint256,uint256) payable','function protocolFee() view returns(uint256)','function mintPrice() view returns(uint256)','function balanceOf(address,uint256) view returns(uint256)'];
const tf=new Contract(tapeFactory,factoryABI,wallet);
const deployFee=await tf.deployFee(),protocolFee=await tf.protocolFee();
const balance=await provider.getBalance(owner),gasPrice=fork?20_000_001n:(await provider.getFeeData()).gasPrice;
if(!gasPrice || gasPrice>100_000_000n)throw Error('Gas price over cap');
const summary={network:'X Layer mainnet',chainId:196,deployer:owner,balanceOKB:formatEther(balance),deployFeeOKB:formatEther(deployFee),mintFeeOKB:formatEther(protocolFee),gasPriceWei:String(gasPrice),maxTotalSpendOKB:'0.012',minimumRetainedOKB:'0.015',broadcast:deploy,fork};
if(!deploy){console.log(JSON.stringify(summary,null,2));provider.destroy();process.exit(0);}
let record=fs.existsSync(recordPath)?JSON.parse(fs.readFileSync(recordPath)): {version:1,...summary,startedAt:new Date().toISOString(),initialBalanceWei:String(balance),transactions:[]};
if(record.chainId!==196||record.deployer!==owner||record.fork!==fork)throw Error('Record scope mismatch');
const save=()=>fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');
const rawPath=recordPath+'.pending-raw';
const spent=()=>record.transactions.reduce((s,t)=>s+BigInt(t.valueWei)+BigInt(t.gasUsed)*BigInt(t.gasPriceWei),0n);
async function finalize(receipt) {
 if(!receipt||receipt.status!==1)throw Error('Deployment transaction failed');
 const pending=record.pending;
 const item={label:pending.label,hash:receipt.hash,blockNumber:receipt.blockNumber,contractAddress:receipt.contractAddress,gasUsed:String(receipt.gasUsed),gasPriceWei:String(receipt.gasPrice),valueWei:pending.valueWei};
 if(!record.transactions.some(t=>t.hash===item.hash))record.transactions.push(item);
 if(['factory','router','guard'].includes(pending.label))record[pending.label]={address:receipt.contractAddress,creationHash:pending.creationHash};
 if(pending.label==='TapeOut.mint6NAND')record.minted=true;
 if(pending.label==='TapeOut.tapeout'){
  const iface=new Interface(circuitABI),e=receipt.logs.map(l=>{try{return iface.parseLog(l)}catch{return null}}).find(l=>l?.name==='TapedOut');
  if(!e)throw Error('Circuit event missing');record.circuit={id:String(e.args.circuitId),netlistHash:keccak256(netlist)};
 }
 if(pending.label==='TapeOut.createCPU'){
  const e=receipt.logs.map(l=>{try{return tf.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='CPUCreated');
  if(!e||getAddress(e.args.creator)!==owner)throw Error('CPU event missing');
  const count=await tf.cpuCount();let index=BigInt(pending.processorIndex);
  while(index<count&&getAddress(await tf.cpuAt(index))!==getAddress(e.args.circuits))index++;
  if(index===count)throw Error('Processor index unavailable');
  record.processor={address:e.args.circuits,transistors:e.args.transistors,index:String(index)};
 }
 delete record.pending;save();if(fs.existsSync(rawPath))fs.unlinkSync(rawPath);
 console.log(JSON.stringify(item));return receipt;
}
if(record.pending){
 let receipt=await provider.getTransactionReceipt(record.pending.hash);
 if(!receipt){
  if(!fs.existsSync(rawPath))throw Error('Pending transaction needs manual reconciliation');
  const raw=fs.readFileSync(rawPath,'utf8');if(keccak256(raw)!==record.pending.hash)throw Error('Pending raw transaction hash mismatch');
  try{await provider.broadcastTransaction(raw);}catch(error){if(!/already known|nonce too low/i.test(error.shortMessage||error.message))throw error;}
  receipt=await provider.waitForTransaction(record.pending.hash,fork?1:3,60000);
 }
 await finalize(receipt);
}
async function send(label,tx){
 if(record.pending)throw Error('Pending deployment transaction');
 const latest=await provider.getTransactionCount(owner,'latest'),pending=await provider.getTransactionCount(owner,'pending');if(latest!==pending)throw Error('Signer has pending transaction');
 const gas=(await provider.estimateGas({...tx,from:owner}))*130n/100n;
 const maximum=gas*gasPrice+(tx.value||0n);
 if(spent()+maximum>parseEther('0.012') || (await provider.getBalance(owner))-maximum<parseEther('0.015'))throw Error('Spend/retained cap exceeded');
 const full={...tx,chainId:196,gasLimit:gas,gasPrice,type:0,nonce:pending};
 let response;
 if(fork){response=await wallet.sendTransaction(full);record.pending={label,hash:response.hash,valueWei:String(tx.value||0n)};}
 else {
  const raw=await wallet.signTransaction(full);fs.writeFileSync(rawPath,raw,{mode:0o600});
  record.pending={label,hash:keccak256(raw),valueWei:String(tx.value||0n)};
  if(!tx.to)record.pending.creationHash=keccak256(tx.data);
  if(label==='TapeOut.createCPU')record.pending.processorIndex=record.proposedProcessorIndex;
  save();response=await provider.broadcastTransaction(raw);
 }
 if(!tx.to)record.pending.creationHash=keccak256(tx.data);
 if(label==='TapeOut.createCPU')record.pending.processorIndex=record.proposedProcessorIndex;
 save();return finalize(await response.wait(fork?1:3));
}
function artifact(file,name){return JSON.parse(fs.readFileSync(path.join(root,'out',file,name+'.json')));}
async function contract(label,file,name,args=[]){
 const a=artifact(file,name);if(!record[label]){const tx=await new ContractFactory(a.abi,a.bytecode.object).getDeployTransaction(...args);const receipt=await send(label,tx);record[label]={address:receipt.contractAddress,creationHash:keccak256(tx.data)};save();}
 const address=record[label].address,code=await provider.getCode(address);if(code==='0x')throw Error('Missing deployed '+label);
 const expected=a.deployedBytecode.object.slice(2).toLowerCase();let actual=code.slice(2).toLowerCase();let normalized=expected;
 for(const refs of Object.values(a.deployedBytecode.immutableReferences||{})) for(const {start,length} of refs){actual=actual.slice(0,start*2)+'0'.repeat(length*2)+actual.slice((start+length)*2);normalized=normalized.slice(0,start*2)+'0'.repeat(length*2)+normalized.slice((start+length)*2);}
 if(actual!==normalized)throw Error('Runtime mismatch '+label);record[label].runtimeHash=keccak256(code);save();return new Contract(address,a.abi,wallet);
}
if(!record.processor){
 const index=await tf.cpuCount();record.proposedProcessorIndex=String(index);save();
 const receipt=await send('TapeOut.createCPU',await tf.createCPU.populateTransaction('BBBFi TapeGuard','BBBTG','Verifiable four-condition swap protection on X Layer. Price impact, minimum received, quote freshness, gas reserve.',10000,0,{value:deployFee}));
 const decoded=receipt.logs.map(l=>{try{return tf.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='CPUCreated');
 if(!decoded||getAddress(decoded.args.creator)!==owner)throw Error('CPU event missing');
 if(!record.processor)throw Error('Processor not recorded');delete record.proposedProcessorIndex;save();
}
if(getAddress(await tf.cpuAt(record.processor.index))!==getAddress(record.processor.address))throw Error('Processor index mismatch');
const tr=new Contract(record.processor.transistors,transistorABI,wallet),cpu=new Contract(record.processor.address,circuitABI,wallet);
if(!record.minted){const held=await tr.balanceOf(owner,0);if(held<6n){const fee=await tr.protocolFee(),price=await tr.mintPrice();await send('TapeOut.mint6NAND',await tr.mint.populateTransaction(0,6n-held,{value:fee+price*(6n-held)}));}record.minted=true;save();}
if(!record.circuit){const fee=await cpu.TAPEOUT_FEE();if(fee>parseEther('0.002'))throw Error('Unexpected tapeout fee');const receipt=await send('TapeOut.tapeout',await cpu.tapeout.populateTransaction(netlist,4,1,{value:fee}));const event=receipt.logs.map(l=>{try{return cpu.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='TapedOut');if(!event)throw Error('Circuit event missing');record.circuit={id:String(event.args.circuitId),netlistHash:keccak256(netlist)};save();}
if((await cpu.netlist(record.circuit.id))!==netlist||getAddress(await cpu.ownerOf(record.circuit.id))!==owner)throw Error('Circuit identity mismatch');
const truth=[];for(let i=0;i<16;i++){const input='0x'+i.toString(16).padStart(2,'0'),out=await cpu.eval(record.circuit.id,input);if(out!==(i===15?'0x01':'0x00'))throw Error('Truth table mismatch');truth.push({input,output:out});}
record.circuit.truthTable=truth;save();
const factory=await contract('factory','BBBFiSwapXLayer.sol','BBBFiSwapXLayerFactory');
const router=await contract('router','BBBFiSwapXLayer.sol','BBBFiSwapOKBRouter',[await factory.getAddress(),wokb]);
const guard=await contract('guard','BBBFiTapeGuard.sol','BBBFiTapeGuard',[await router.getAddress(),record.processor.address,record.circuit.id]);
if(getAddress(await router.factory())!==getAddress(await factory.getAddress())||getAddress(await router.wrappedOKB())!==getAddress(wokb)||getAddress(await guard.router())!==getAddress(await router.getAddress())||String(await guard.circuitId())!==record.circuit.id||getAddress(await guard.circuits())!==getAddress(record.processor.address))throw Error('Deployment getter mismatch');
if(!record.seedPair){let address=await factory.getPair(wokb,usdc);if(BigInt(address)===0n){await send('createEmptyWOKBUSDC',await factory.createPair.populateTransaction(wokb,usdc));address=await factory.getPair(wokb,usdc);}record.seedPair={address,token0:usdc,token1:wokb,liquidityAdded:false};save();}
record.completedAt=new Date().toISOString();record.totalSpentOKB=formatEther(spent());record.remainingOKB=formatEther(await provider.getBalance(owner));record.liveLiquidityAdded=false;save();console.log(JSON.stringify({recordPath,...record},null,2));provider.destroy();
