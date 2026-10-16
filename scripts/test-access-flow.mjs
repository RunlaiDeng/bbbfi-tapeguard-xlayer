// Offline integration: local chain 196, mock USDC/TapeOut, real Access bytecode,
// real wallet signatures, HTTP content gate and the production keeper program.
// This is not a mainnet fork, a real order or revenue evidence.
import fs from 'node:fs';
import path from 'node:path';
import httpServer from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Contract,ContractFactory,Wallet,JsonRpcProvider,FeeData,parseEther,keccak256,toUtf8Bytes} from 'ethers';
import {createPublicClient,http} from 'viem';
import {verifyAccessProof,accessProofMessage} from '../lib/access.mjs';
const fork=process.argv.includes('--fork');
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,fork?'artifacts-access-fork':'artifacts-access-local');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const p=new JsonRpcProvider(`http://127.0.0.1:${fork?8597:8598}`,196,{batchMaxCount:1,cacheTimeout:-1});p.pollingInterval=50;
if(!fork)await p.send('anvil_reset',[]);
await p.send('anvil_setNextBlockBaseFeePerGas',['0x1312d00']);await p.send('evm_mine',[]);
p.getFeeData=async()=>new FeeData(20000001n,null,null);
const deployer=await p.getSigner(0);const send=deployer.sendTransaction.bind(deployer);deployer.sendTransaction=tx=>send({...tx,type:0,gasPrice:20000001n});
const merchant=Wallet.createRandom().connect(p),buyer=Wallet.createRandom().connect(p);
for(const a of [merchant.address,buyer.address])await p.send('anvil_setBalance',[a,'0x'+parseEther('1').toString(16)]);
const artifact=(name,file='BBBFiAccess.t.sol')=>JSON.parse(fs.readFileSync(path.join(root,'out',file,name+'.json')));
async function etch(name,address){const a=artifact(name);await p.send('anvil_setCode',[address,a.deployedBytecode.object]);return new Contract(address,a.abi,deployer);}
const usdc='0xB6CEceAB302E2E4948951eE7843FC24E92933061',processor='0x9de448A1CE9537d24199B3b5355239d73aA6F591';
let token;
if(!fork){
 token=await etch('AccessUSDC',usdc);
 await etch('AccessFactory','0x1f09DAeFA827f02CBb40967cc91b259763760761');
 const beacon=await etch('AccessBeacon','0x000000000000000000000000000000000000bEEF');
 const impl=await new ContractFactory(artifact('AccessImplementation').abi,artifact('AccessImplementation').bytecode.object,deployer).deploy();await impl.waitForDeployment();await(await beacon.set(await impl.getAddress())).wait();
 await etch('AccessCircuit',processor);
}else token=new Contract(usdc,artifact('AccessUSDC').abi,deployer);
const a=artifact('BBBFiAccess','BBBFiAccess.sol'),access=await new ContractFactory(a.abi,a.bytecode.object,deployer).deploy(await deployer.getAddress(),processor,1n);await access.waitForDeployment();
const d={enabled:true,chainId:196,address:await access.getAddress()},origin='https://merchant.example',audience=keccak256(toUtf8Bytes(origin));
fs.writeFileSync(path.join(dir,'deployment.json'),JSON.stringify(d));fs.writeFileSync(path.join(root,'access-abi.json'),JSON.stringify(a.abi));
for(const file of ['keeper-state.json','keeper-health.json','pending-raw'])if(fs.existsSync(path.join(dir,file)))fs.unlinkSync(path.join(dir,file));
if(!fork)await(await token.mint(buyer.address,1000_000000n)).wait();
else{const pool='0xEEeB3C1F61DC3070C675c2670a3f2188A060012D';await p.send('anvil_impersonateAccount',[pool]);await p.send('anvil_setBalance',[pool,'0x'+parseEther('1').toString(16)]);await(await token.connect(await p.getSigner(pool)).transfer(buyer.address,1000_000000n,{type:0,gasPrice:20000001n})).wait();}
await(await access.connect(merchant).createPlan('Paid API',30_000000n,86400,audience)).wait();
const v=createPublicClient({transport:http(`http://127.0.0.1:${fork?8597:8598}`)});
const server=httpServer.createServer(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');try{const proof=JSON.parse(Buffer.from((req.headers.authorization||'').slice(6),'base64url').toString());await verifyAccessProof(v,d,a.abi,proof,{planId:'1',audience:origin,resource:'/api/member-content'});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({content:'ACTUAL_TEST_PROTECTED_CONTENT'}));}catch{res.writeHead(401);res.end('Membership required');}});
await new Promise(resolve=>server.listen(8599,'127.0.0.1',resolve));
async function request(planId='1'){const proof={version:1,chainId:196,contract:d.address,planId,address:buyer.address,audience:origin,resource:'/api/member-content',issuedAt:Math.floor(Date.now()/1000),nonce:crypto.randomUUID()};proof.signature=await buyer.signMessage(accessProofMessage(proof));return fetch('http://127.0.0.1:8599/api/member-content',{headers:{Authorization:'BBBFi '+Buffer.from(JSON.stringify(proof)).toString('base64url')}});}
const checks=[];
try{
 assert.equal((await request()).status,401);checks.push('unpaid HTTP request denied');
 await(await token.connect(buyer).approve(d.address,90_000000n)).wait();
 const b=await p.getBlock('latest');await(await access.connect(buyer).subscribe(1,3,30_000000n,86400,merchant.address,audience,b.timestamp+300)).wait();
 const paid=await request();assert.equal(paid.status,200);assert.equal((await paid.json()).content,'ACTUAL_TEST_PROTECTED_CONTENT');checks.push('paid signed request delivers protected HTTP content');
 assert.equal(await token.balanceOf(merchant.address),29_700000n);checks.push('first payment splits 99 percent directly to merchant');
 await assert.rejects(access.charge.staticCall(1));checks.push('early renewal rejected');
 const run=()=>execFileSync(process.execPath,['scripts/access-keeper.mjs',fork?'--fork':'--local-test','--once'],{cwd:root,timeout:30000,stdio:'pipe'});
 run();const key=JSON.parse(fs.readFileSync(path.join(dir,'keeper-key.json')));await p.send('anvil_setBalance',[key.address,'0x'+parseEther('.001').toString(16)]);
 await p.send('evm_increaseTime',[86401]);await p.send('evm_mine',[]);assert.equal((await request()).status,401);checks.push('expired HTTP request denied before renewal');
 run();await p.send('anvil_mine',['0x3']);run();
 assert.equal(await access.payments(),2n);assert.equal(await token.balanceOf(merchant.address),59_400000n);assert.equal(await token.balanceOf(key.address),60000n);assert.equal((await request()).status,200);checks.push('actual keeper renews once, settles fee and restores HTTP access');
 const health=JSON.parse(fs.readFileSync(path.join(dir,'keeper-health.json')));assert.equal(health.executed,1);checks.push('executor records confirmed transaction');
 await(await access.connect(buyer).cancelRenewal(1)).wait();assert.equal((await request()).status,200);await p.send('evm_increaseTime',[86401]);await p.send('evm_mine',[]);run();assert.equal((await request()).status,401);assert.equal(await access.payments(),2n);checks.push('cancel preserves paid time, then expiry denies and no further charge');
 await(await access.connect(merchant).createPlan('Cheaper plan',1_000000n,86400,audience)).wait();const b2=await p.getBlock('latest');await(await access.connect(buyer).subscribe(2,1,1_000000n,86400,merchant.address,audience,b2.timestamp+300)).wait();assert.equal((await request('2')).status,401);checks.push('paid cheaper plan cannot unlock server-pinned plan');
 const result={mode:fork?'MAINNET_FORK_SYNTHETIC_PAYMENTS':'LOCAL_MOCK_CHAIN_NOT_MAINNET',contract:d.address,checks,passed:checks.length,realCustomerOrders:0,mainnetTransactions:0};
 fs.writeFileSync(path.join(root,`artifacts-access-${fork?'fork':'local'}/result.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{server.close();p.destroy();}
