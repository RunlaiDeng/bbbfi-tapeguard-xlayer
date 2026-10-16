import Head from 'next/head';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useState} from 'react';
import {useLanguage} from '@/components/Context/LanguageContext';
import {ACCESS_DEPLOYMENT as d} from '@/config/access';
import {accessOrigin} from '@/lib/access.mjs';
import styles from '@/styles/access.module.css';
export default function Integrate(){
 const {locale}=useLanguage(),zh=locale==='zh',router=useRouter(),[copied,setCopied]=useState(false);
 let origin='https://YOUR-SERVICE.example';try{if(typeof router.query.audience==='string')origin=accessOrigin(router.query.audience,{local:true});}catch{}
 const plan=typeof router.query.plan==='string'&&/^[1-9]\d{0,19}$/.test(router.query.plan)?router.query.plan:'YOUR_PLAN_ID';
 const server=`// pages/api/member-content.js — trusted SERVER config only.
import { createPublicClient, http, parseAbi } from 'viem';
import { issueAccessSession, verifyAccessSession } from '../../lib/access-session.mjs';
const client = createPublicClient({ transport: http('https://xlayer.drpc.org') });
const deployment = { enabled: true, chainId: 196, address: ${JSON.stringify(d.address)} };
const abi = parseAbi(['function hasAccess(uint256,address,bytes32) view returns(bool,uint64)']);
const options = { secret: process.env.BBBFI_ACCESS_SESSION_SECRET,
  planId: ${JSON.stringify(plan)}, audience: ${JSON.stringify(origin)},
  resource: '/api/member-content', maxAge: 3600,
};
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const header = req.headers.authorization || '';
    let grant;
    if (header) {
      if (!header.startsWith('BBBFi ') || header.length > 24000) throw Error('Invalid proof');
      const proof = JSON.parse(Buffer.from(header.slice(6), 'base64url').toString('utf8'));
      const session = await issueAccessSession(client, deployment, abi, proof, options);
      grant = session.grant;
      res.setHeader('Set-Cookie', 'bbbfi_access=' + session.token
        + '; HttpOnly; Secure; SameSite=Strict; Path=/api/member-content; Max-Age=3600');
    } else {
      const cookie = (req.headers.cookie || '').split(';').map(s => s.trim())
        .find(s => s.startsWith('bbbfi_access='));
      grant = await verifyAccessSession(client, deployment, abi,
        cookie?.slice('bbbfi_access='.length), options);
    }
    // Every request checks fresh onchain paid status, including session reads.
    return res.json({ content: 'YOUR_PAID_CONTENT', paidUntil: grant.paidUntil });
  } catch { return res.status(401).json({ error: 'Paid membership required' }); }
}`;
 const browser=`// First request: one read-only wallet signature, no token spending.
import { createWalletClient, custom } from 'viem';
import { accessProofMessage } from './access.mjs';
const wallet = createWalletClient({ transport: custom(window.ethereum) });
const [address] = await wallet.getAddresses();
const proof = { version: 1, chainId: 196,
  contract: ${JSON.stringify(d.address)}, planId: ${JSON.stringify(plan)}, address,
  audience: ${JSON.stringify(origin)}, resource: '/api/member-content',
  issuedAt: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID(),
};
proof.signature = await wallet.signMessage({ account: address, message: accessProofMessage(proof) });
const encoded = btoa(JSON.stringify(proof)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
await fetch('/api/member-content', { headers: { Authorization: 'BBBFi ' + encoded } });
// Subsequent reads use the HttpOnly session cookie without another wallet prompt.
const response = await fetch('/api/member-content');`;
 return <article className={`${styles.page} ${styles.prose}`}><Head><title>{zh?'接入自动付费权限｜BBBFi':'Integrate paid access | BBBFi'}</title></Head>
 <Link href={`/explore/access?chain=xlayer&lang=${locale}`}>← {zh?'返回自动收款':'Back to Access'}</Link>
 <header className={styles.header}><div><h1>{zh?'把收款，接到真实交付。':'Connect payment to actual delivery.'}</h1><p>{zh?'签名一次登录一小时；每次访问仍实时核验付费期限。适用于有服务器或 API 的网站。':'Sign once for a one-hour login. Every request still checks live paid access. For websites with a server or API.'}</p></div></header>
 <h2>{zh?'1. 创建方案，固定服务站点':'1. Create a plan and bind your service origin'}</h2>
 <p>{zh?'使用你控制的收款钱包创建方案，设置价格、周期和 HTTPS 站点。将方案编号固定在服务器配置里，不能接受浏览器指定的任意方案。仅创建收款链接不会保护内容。':'Create a plan with your merchant wallet, price, period and HTTPS origin. Pin its plan ID in trusted server configuration; do not accept arbitrary buyer-selected plans. A checkout link alone does not protect content.'}</p>
 <h2>{zh?'2. 下载组件，配置会话密钥':'2. Download the components and configure a session secret'}</h2>
 <p><a href="/access/access.mjs" download="access.mjs">access.mjs ↓</a> · <a href="/access/access-session.mjs" download="access-session.mjs">access-session.mjs ↓</a></p>
 <p>{zh?'两个文件一起放入 lib。会话组件只供服务器导入，密钥留在商家服务器；浏览器只导入 access.mjs。安装 viem 后，在商家应用的服务器环境设置 BBBFI_ACCESS_SESSION_SECRET，使用至少 32 字节的随机值。不要添加 NEXT_PUBLIC_ 前缀。':'Place both files in lib. Import access-session.mjs only on the server; browsers import access.mjs. Install viem and set BBBFI_ACCESS_SESSION_SECRET to a random value of at least 32 bytes in the merchant server environment. Never prefix it with NEXT_PUBLIC_.'}</p>
 <pre className={styles.code}>{`npm install viem@2.48.1
# Generate a merchant-server secret, then store it in your server environment:
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`}</pre>
 <h2>{zh?'3. 在服务器验证后交付':'3. Verify on the server before delivery'}</h2><pre className={styles.code}>{server}</pre>
 <button className={styles.secondary} onClick={async()=>{await navigator.clipboard.writeText(server);setCopied(true);}}>{copied?(zh?'已复制':'Copied'):(zh?'复制服务端示例':'Copy server example')}</button>
 <h2>{zh?'4. 买家签名登录，后续访问使用会话':'4. Customer signs in; subsequent reads use the session'}</h2><pre className={styles.code}>{browser}</pre>
 <p>{zh?'首次签名绑定链、合约、方案、钱包、站点、资源和一分钟有效窗口。它是可在短窗口重用的读取证明，不是一次性凭证或扣款许可。示例用它建立一小时的服务端登录；此后通过 HttpOnly、安全 Cookie 识别钱包，不重复弹签名。会话仅证明身份，每次请求仍读取最新链上资格，退款、到期和数据读取失败时拒绝交付。会话最长可配置 12 小时。':'The initial signature binds chain, contract, plan, wallet, origin, resource and a one-minute proof window. It is a short-lived reusable read proof, not a one-use receipt or spending mandate. The example exchanges it for a one-hour server login, using an HttpOnly Secure cookie for later reads. A session authenticates a wallet only: every request still checks fresh onchain entitlement, rejecting refunds, expiry and failed reads. The maximum configurable login lifetime is 12 hours.'}</p>
 <h2>{zh?'上线前检查':'Before serving paid customers'}</h2><ul>
 <li>{zh?'未付款、过期、错误方案或站点、篡改 Cookie 和错误签名均拒绝交付；取消续费保留已付费期限，退款立即关闭该期限。':'Deny unpaid, expired, wrong-plan/origin, tampered-cookie and invalid-signature requests. Cancellation preserves paid time; a refund closes it immediately.'}</li>
 <li>{zh?'通过 HTTPS 部署 Cookie 示例，不把受保护内容或会话密钥打包进前端；商家自行托管内容/API。':'Deploy the cookie example over HTTPS. Keep protected content and the session secret out of frontend bundles. Merchants host their content/API.'}</li>
 <li>{zh?'商家负责开票、税务、交付和退款。公开源码与测试不等于独立审计。':'Merchants remain responsible for invoices, taxes, delivery and refunds. Public source and tests are not an independent audit.'}</li></ul>
 </article>;
}
export function getServerSideProps({query}){return{props:{initialLocale:query.lang==='zh'?'zh':'en'}};}
