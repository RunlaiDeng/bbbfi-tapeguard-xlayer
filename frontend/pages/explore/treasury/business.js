import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { useLanguage } from '@/components/Context/LanguageContext';
import styles from '@/styles/treasury.module.css';
const sources = [
  ['Uniswap','https://web3.okx.com/nl/learn/uniswap-xlayer'],
  ['OKX DEX','https://www.okx.com/en-us/learn/what-is-okx-aggregator'],
  ['CoW Swap','https://cow.fi/learn/cow-swap-brings-twap-orders-to-every-evm-wallet'],
  ['Safe','https://www.safe.global/blog/safe-pro-pricing'],
  ['Request Finance','https://help.request.finance/en/articles/10397958-what-does-request-cost'],
  ['Tenderly','https://tenderly.co/pricing'],
  ['Dune','https://dune.com/blog/thoughts-on-dunes-business-model'],
];
export default function Business() {
 const {locale}=useLanguage(),zh=locale==='zh';
 const [customers,setCustomers]=useState(5),[price,setPrice]=useState(199),[cost,setCost]=useState(85);
 const fixed=150,margin=price-cost,breakeven=margin>0?Math.ceil(fixed/margin):null;
 const rows=zh?[
  ['兑换与聚合','Uniswap / OKX DEX','现有流动性、路由和兑换体验已成熟','复用市场报价，不以新池补贴抢交易量'],
  ['分批执行','CoW Swap','限价与 TWAP 已覆盖大量执行需求','不把普通滑点设置包装成独创壁垒'],
  ['团队资金权限','Safe','多账户协作、策略与交易记录；Starter 189 欧元/月','不另造托管钱包；面向尚无专职财务的小团队'],
  ['支付与财务','Request Finance','发票、付款和企业订阅','聚焦支付前的代币变现与支出覆盖，不做支付全家桶'],
  ['模拟与运维','Tenderly','交易模拟、监控与团队基础设施','把链上读数变成运营负责人能读懂的备付报告'],
  ['数据分析','Dune','免费分析与专业数据产品','免费计算获客，收费交付持续整理、复核与团队解释'],
 ]:[
  ['Swaps & aggregation','Uniswap / OKX DEX','Established liquidity, routing and swap UX','Use existing market quotes; avoid subsidizing a new pool'],
  ['Execution','CoW Swap','Limit and TWAP orders already address execution needs','Ordinary slippage settings are not a defensible invention'],
  ['Team controls','Safe','Accounts, policies and records; Starter €189/month','Serve teams without dedicated finance operations'],
  ['Payments','Request Finance','Invoices, payments and business subscriptions','Focus on conversion before an operating payment'],
  ['Simulation','Tenderly','Simulations, monitoring and team infrastructure','Translate onchain observations into an operating report'],
  ['Analytics','Dune','Free analytics and professional data products','Free calculator acquisition; paid review and interpretation'],
 ];
 return <article className={`${styles.page} ${styles.prose}`}><Head><title>{zh?'资金备付商业方案｜BBBFi':'Treasury business plan | BBBFi'}</title></Head>
 <Link href={`/explore/treasury?lang=${locale}`}>← {zh?'试用资金备付':'Try Treasury runway'}</Link>
 <header className={styles.header}><div><span className={styles.eyebrow}>RESEARCH · 2026-10-16</span><h1>{zh?'把月度备付，做成可交付的服务。':'An operating service for monthly runway.'}</h1><p>{zh?'当前是可用的免费工具与待验证的付费试点方案；没有付费客户、收入或盈利的既成声明。':'A working free tool and a proposed paid pilot. No existing paid customers, revenue or profitability are claimed.'}</p></div></header>
 <h2>{zh?'跨市场研究后的选择':'Positioning after a cross-market review'}</h2><p>{zh?'本轮覆盖兑换聚合、执行策略、钱包权限、企业支付、模拟监控和数据分析六类产品。它们说明纯 Swap 与通用风控已很拥挤；团队会为可重复的运营交付付费，但并不能证明 BBBFi 已有需求。当前选择 X Layer 小团队的月度备付报告作为验证切口。这是产品推断，不是已验证的市场结论；研究不声称穷尽所有竞品。':'This review covers six adjacent markets: swaps, execution, wallet controls, business payments, simulation and analytics. Swaps and generic controls are crowded. Team operations support paid products, but that does not establish demand for BBBFi. We choose monthly treasury conversion reports for small X Layer teams as a testable niche, not a proven market conclusion or an exhaustive competitor census.'}</p>
 <div className={`${styles.card} ${styles.tableScroll}`}><table><thead><tr>{(zh?['市场','代表产品','已有能力','BBBFi 的选择']:['Market','Products','Existing capability','BBBFi choice']).map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row[0]}>{row.map(cell=><td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
 <p>{zh?'一手资料：':'Primary sources: '}{sources.map(([label,url],i)=><span key={label}>{i?' · ':''}<a href={url} target="_blank" rel="noreferrer">{label}</a></span>)}. {zh?'价格与功能为研究日观察，后续可能调整。':'Prices and features were checked on the research date and may change.'}</p>
 <h2>{zh?'客户、痛点与可交付结果':'Customer, problem and deliverable'}</h2><p>{zh?'首批客户假设：持有链上收入或项目代币、每月需要 1,000–20,000 USDC 支付运营费用、没有专职资金分析人员的 1–10 人团队。负责人需要回答“本次兑换能覆盖多久、金额放大后会损失多少、为什么本次计划没通过”。不以散户高频交易为主要付费场景。':'Initial customer hypothesis: teams of 1–10 people holding onchain revenue or tokens, with 1,000–20,000 USDC in monthly operating expenses and no dedicated treasury analyst. They need an explanation of runway, conversion size impact and failed plan checks. Retail high-frequency trading is not the primary paid use case.'}</p>
 <ul><li>{zh?'已上线免费交付：输入资产、数量与月支出 → 同区块读取四档直接池 → 全额与 ¼ 数量模拟 → 到账缓冲与覆盖月数 → TapeOut 四项布尔规则合并 → 导出带区块、池地址和限制的 JSON 报告。':'Live free workflow: asset, amount and monthly spending → four direct pool tiers at one block → full and ¼-size simulations → output buffer and runway → TapeOut combination of four predicates → JSON export with block, pools and limits.'}</li><li>{zh?'99 USDC/次试点服务：一个团队、一种输入资产、一条链的报告复核与一次 30 分钟说明；约定范围后再下单。199 USDC/月试点：每周一次、每月四份报告及一次月度对比说明。不收交易额抽成，不承诺收益。':'Proposed pilot: 99 USDC per reviewed report for one team, one input asset and one chain, plus a 30-minute explanation; scope agreed before ordering. Proposed 199 USDC/month service: four weekly reports and one monthly comparison. No volume commission or return promise.'}</li><li>{zh?'付费原因假设：节省重复查池、整理证据和解释异常的时间；持续使用来自每月真实支出。报价刷新与免费计算本身不设付费墙。人工复核与周报服务尚未有客户验证，未实现自动订阅、自动监控、自动下单或支付扣款。':'Payment hypothesis: save time spent rechecking pools, keeping evidence and explaining exceptions. Monthly spending creates repeat use. Quotes and the calculator remain free. Human reviews and weekly reports are not customer-validated; automatic subscriptions, monitoring, trading and payment collection are not implemented.'}</li></ul>
 <p><a href={zh?'https://t.me/bbbfidotcom_cn':'https://t.me/bbbfidotcom'} target="_blank" rel="noreferrer">{zh?'通过 BBBFi 社区咨询试点范围':'Discuss pilot scope in the BBBFi community'} ↗</a></p>
 <h2>{zh?'算得清的经营假设':'Explicit operating assumptions'}</h2><p>{zh?'以下为场景测算，不是实际经营数据。默认每客户每月成本 85 USDC：人工 1.5 小时 × 40 = 60，数据/运行 15，支持预留 10；固定运行成本 150/月。未计获客、税费、一次性开发与额外工时。':'These are scenarios, not actual business results. Default variable cost: 85 USDC/customer/month = 1.5 hours × 40 for review + 15 for data/runtime + 10 support reserve. Fixed runtime cost: 150/month. Acquisition, tax, initial development and extra hours are excluded.'}</p>
 <div className={styles.card}><div className={styles.calculator}>{[[zh?'客户数':'Customers',customers,setCustomers,0,100],[zh?'月服务费 · USDC':'Monthly price · USDC',price,setPrice,0,1000],[zh?'单客月成本 · USDC':'Monthly variable cost · USDC',cost,setCost,0,1000]].map(([label,value,set,min,max])=><label key={label}>{label}<input type="number" min={min} max={max} step="1" value={value} onChange={e=>set(Math.max(min,Math.min(max,Number(e.target.value)||0)))}/></label>)}</div><div className={styles.result}>{zh?'月收入':'Monthly revenue'}: {customers*price} USDC · {zh?'变动成本':'Variable cost'}: {customers*cost} USDC<br/>{zh?'固定成本后余额（扣除前述未计成本前）':'Balance after fixed cost, before excluded costs'}: <strong>{customers*margin-fixed} USDC</strong><br/>{zh?'覆盖固定运行成本所需客户':'Customers to cover fixed runtime cost'}: {breakeven===null?(zh?'单客贡献为零或负数，无法覆盖':'Cannot cover costs at zero or negative contribution'):breakeven}</div></div>
 <h2>{zh?'先验证，再扩建':'Validate before expanding'}</h2><p>{zh?'计划 30 天：从现有 BBBFi 社区与 X Layer 开发者社区邀请 20 个目标团队访谈，10 个完成免费报告，争取 3 个付费试点；随后观察是否有至少 2 个续费。尚未开展这些访谈或取得这些订单。付费试点不足 3 个则复盘需求和定价，暂停扩建自动监控与 API。获客不依赖 LP 补贴、发币或比赛奖金。':'Planned 30-day test: invite 20 target teams from BBBFi and X Layer developer communities, get 10 to finish a free report and seek three paid pilots; then observe at least two renewals. None of these interviews or orders is claimed as completed. With fewer than three paid pilots, revisit demand and pricing before building monitoring or APIs. Acquisition does not depend on LP subsidies, token issuance or contest prizes.'}</p>
 <h2>{zh?'现在能做什么，不能推断什么':'Current scope and evidence limits'}</h2><p>{zh?'当前工具只读取 X Layer 上指定 Uniswap V3 直接池，不覆盖聚合器、V2、V4、多跳或所有市场。报价为 eth_call 估算，未校验钱包余额、授权或真实成交；不可将资金池现价等同外部公允价。TapeOut 接收报告计算的四个布尔输入，不认证输入事实；只有另一个 BBBFi TapeGuard 入口在自有 V2 池交易中强制执行保护。备付工具无需给自有池注资，但能否获得所需报价取决于市场实际流动性。':'The tool reads specified Uniswap V3 direct pools on X Layer. It does not cover aggregators, V2, V4, multihop or every market. Quotes are eth_call estimates, without wallet, allowance or actual fill validation. Pool spot is not an external fair-value oracle. TapeOut combines report-supplied Boolean inputs, not attestations of market facts. Only the separate BBBFi TapeGuard entry enforces limits for its own V2 swaps. The runway tool requires no seed liquidity in BBBFi pools; quote availability still depends on actual market liquidity.'}</p>
 </article>;
}
export function getServerSideProps({query}) {return {props:{initialLocale:query.lang==='zh'?'zh':'en'}};}
