import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import { useLanguage } from '@/components/Context/LanguageContext';
import { TREASURY_ASSETS, TREASURY_MARKET } from '@/lib/treasury.mjs';
import styles from '@/styles/treasury.module.css';
const defaults = {asset:'USD₮0',amount:'1000',monthly:'1000',impact:'100'};
const number = value => Number(value).toLocaleString(undefined,{maximumFractionDigits:4});
function validReport(data, input) {
  if (!data || data.version !== 1 || data.chainId !== 196 || JSON.stringify(data.input) !== JSON.stringify({asset:input.asset,amount:input.amount,monthly:input.monthly,maxImpactBps:Number(input.impact)}) || data.market?.factory !== TREASURY_MARKET.factory || !/^\d+$/.test(data.block) || !/^\d+$/.test(data.minimumOut) || !Array.isArray(data.routes) || data.routes.length !== 4 || !Array.isArray(data.policy?.checks) || data.policy.checks.length !== 4 || !Number.isFinite(data.expiresAt)) throw Error('Invalid report');
  return data;
}
export default function Treasury() {
  const {locale} = useLanguage(), zh = locale === 'zh';
  const [form,setForm] = useState(defaults), [input,setInput] = useState(defaults), [now,setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()),1000);return () => clearInterval(timer); },[]);
  const query = useQuery({ queryKey:['treasury-report',input], staleTime:10000, gcTime:300000, retry:1, refetchInterval:30000, refetchIntervalInBackground:false,
    queryFn:async({signal}) => { const r = await fetch('/api/treasury/quote?'+new URLSearchParams(input),{signal,cache:'no-store'});if(!r.ok) throw Error('Unavailable');return validReport(await r.json(),input); } });
  const report = query.data, expired = report && now > report.expiresAt, dirty = JSON.stringify(form) !== JSON.stringify(input);
  const best = report?.routes.find(r => r.fee === report.bestFee), current = report && !expired && !query.isError && !dirty;
  const passed = current && report.policy.circuit === '0x01' && report.policy.mask === 15;
  const checks = zh ? ['存在可读取的市场报价','价格冲击不超过上限','最低估算到账覆盖一月支出','市场观察未过期'] : ['A market quote is available','Impact within the selected limit','Minimum estimate covers one month','Market observation is recent'];
  const change = (field,value) => setForm(previous => ({...previous,[field]:value}));
  function download() {
    const blob = new Blob([JSON.stringify({...report,exportedAt:new Date().toISOString(),expired:Date.now()>report.expiresAt},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`bbbfi-treasury-${report.block}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <article className={styles.page}>
    <Head><title>{zh?'资金备付｜BBBFi':'Treasury runway | BBBFi'}</title></Head>
    <header className={styles.header}><div><span className={styles.eyebrow}>BBBFi Treasury · X Layer</span><h1>{zh?'先算清支出，再安排兑换。':'Plan your runway before converting.'}</h1><p>{zh?'用现有市场报价，把代币数量换算成可覆盖的 USDC 支出。':'Turn a planned token conversion into an estimated USDC operating runway.'}</p></div><Link href={`/explore/treasury/business?lang=${locale}`}>{zh?'服务与商业方案':'Service & business plan'} ↗</Link></header>
    <div className={styles.grid}>
      <section className={styles.card}><h2>{zh?'备付计划':'Conversion plan'}</h2><form onSubmit={event=>{event.preventDefault();if(dirty)setInput({...form});else query.refetch();}}>
        <label>{zh?'准备兑换的资产':'Asset to convert'}<select value={form.asset} onChange={e=>change('asset',e.target.value)}>{TREASURY_ASSETS.filter(t=>t.symbol!=='USDC').map(t=><option key={t.symbol}>{t.symbol}</option>)}</select></label>
        <label>{zh?'本次兑换数量':'Amount to convert'}<input required inputMode="decimal" pattern="[0-9]+([.][0-9]+)?" maxLength={40} value={form.amount} onChange={e=>change('amount',e.target.value)}/></label>
        <label>{zh?'每月支出 · USDC':'Monthly spending · USDC'}<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" maxLength={25} value={form.monthly} onChange={e=>change('monthly',e.target.value)}/></label>
        <label>{zh?'价格冲击上限（含池费）':'Impact limit (includes pool fee)'}<select value={form.impact} onChange={e=>change('impact',e.target.value)}>{[50,100,300,500].map(v=><option key={v} value={v}>{v/100}%</option>)}</select></label>
        <button className={styles.primary} disabled={query.isFetching} type="submit">{query.isFetching&&!report?(zh?'正在读取市场…':'Reading market…'):(zh?'计算备付':'Calculate runway')}</button>
      </form><p className={styles.note}>{zh?'无需连接钱包。读取 Uniswap V3 的四个直接池费率；不代表全市场最优路线。估算含池费及 0.5% 到账缓冲，不含网络 Gas；实际兑换须重新报价。':'No wallet required. Reads four direct Uniswap V3 fee tiers; not a whole-market best-route claim. Estimates include pool fees and a 0.5% output buffer, exclude gas, and require a fresh quote before trading.'}</p></section>
      <section className={styles.card} aria-live="polite"><div className={styles.sectionTop}><h2>{zh?'备付结果':'Runway estimate'}</h2><span className={passed?styles.good:styles.muted}>{!report?(zh?'等待数据':'Waiting'):dirty?(zh?'计划已修改':'Plan changed'):expired||query.isError?(zh?'历史观察':'Previous observation'):passed?(zh?'符合本次计划':'Plan checks passed'):(zh?'需调整计划':'Review plan')}</span></div>
        {!report?<div className={styles.placeholder}>{query.isError?(zh?'暂时无法生成报告，请稍后重试。':'Report unavailable. Please retry.'):(zh?'正在读取链上池与市场报价…':'Reading onchain pools and market quotes…')}</div>:<>
          <div className={styles.metrics}><div><span>{zh?'最低估算到账':'Minimum estimated output'}</span><strong>{best?number(report.minimumOutFormatted):'—'} <small>USDC</small></strong></div><div><span>{zh?'本次兑换可覆盖':'Runway from this conversion'}</span><strong>{best?number(report.runwayMonths):'—'} <small>{zh?'个月':'months'}</small></strong></div></div>
          <p className={styles.note}>{best?`${zh?'读取到的最高到账':'Highest observed output'} · ${(best.fee/10000)}% ${zh?'池费':'pool fee'} · ${zh?'价格冲击':'Impact'} ${(best.full.impactBps/100).toFixed(2)}%`:(zh?'已检查的直接池没有可用报价。可更换资产或数量；无法报价不等于零余额。':'No usable quote among checked direct pools. Try another asset or amount; unavailable quotes do not imply zero holdings.')}</p>
          <div className={styles.checks}>{checks.map((label,i)=><div key={label}><span className={report.policy.checks[i]?styles.good:styles.muted}>{report.policy.checks[i]?'✓':'—'}</span>{label}</div>)}</div>
          <p className={styles.note}>TapeOut #{report.policy.circuitId} · {report.policy.circuit===null?(zh?'链上计算暂不可用':'Onchain evaluation unavailable'):`${report.policy.circuit==='0x01'?'ALLOW':'BLOCK'} · ${report.policy.circuit}`}<br/>{zh?'四项输入由本报告计算，电路只合并布尔结果，不认证价格，也不约束第三方网站交易。':'This report supplies four predicates. The circuit combines them; it does not attest prices or enforce trades on external sites.'}</p>
          <div className={styles.actions}><button type="button" onClick={download}>{zh?'导出报告':'Export report'} ↓</button><button type="button" disabled={query.isFetching} onClick={()=>query.refetch()}>{zh?'刷新报价':'Refresh quotes'}</button></div>
          <p className={styles.timestamp}>{zh?'观察区块':'Observed block'} #{report.block} · {new Date(report.observedAt).toLocaleString(locale==='zh'?'zh-CN':'en-US')}<br/>{zh?'报价保留作记录；60 秒后标为历史观察。':'Quotes remain as records; marked historical after 60 seconds.'}</p>
        </>}
      </section>
    </div>
    {report?<section className={styles.card}><h2>{zh?'市场规模压力测试':'Conversion size stress test'}</h2><div className={styles.tableScroll}><table><thead><tr><th>{zh?'直接池费率':'Direct pool fee'}</th><th>{zh?'全额估算 · USDC':'Full-size estimate · USDC'}</th><th>{zh?'价格冲击':'Impact'}</th><th>{zh?'单独兑换 ¼ · USDC':'Standalone ¼-size · USDC'}</th></tr></thead><tbody>{report.routes.map(r=><tr key={r.fee}><td>{r.pool?<a href={`https://www.okx.com/web3/explorer/xlayer/address/${r.pool}`} target="_blank" rel="noreferrer">{r.fee/10000}% ↗</a>:`${r.fee/10000}%`}</td><td>{r.full?number(formatUnits(BigInt(r.full.output),6)):r.status==='missing'?(zh?'未创建':'Not created'):r.status==='inactive'?(zh?'无活跃流动性':'No active liquidity'):(zh?'无法报价':'Unavailable')}</td><td>{r.full?`${(r.full.impactBps/100).toFixed(2)}%`:'—'}</td><td>{r.quarter?number(formatUnits(BigInt(r.quarter.output),6)):'—'}</td></tr>)}</tbody></table></div><p className={styles.note}>{zh?'¼ 数量是在同一区块独立模拟，不能乘以 4 当作分批成交预测。池现价仅用于冲击计算，不是外部价格预言机。':'The ¼-size result is an independent simulation at the same block. Multiplying it by four does not predict sequential fills. Pool spot prices are impact references, not external price oracles.'}</p></section>:null}
    <footer className={styles.bottom}><Link href={`/explore/tapeguard?chain=xlayer&lang=${locale}`}>{zh?'使用 BBBFi 保护兑换':'BBBFi guarded swap'} ↗</Link><Link href={`/xlayer/about?lang=${locale}`}>{zh?'查看合约与验证':'Contracts & verification'} ↗</Link><a href="https://github.com/RunlaiDeng/bbbfi-tapeguard-xlayer" target="_blank" rel="noreferrer">GitHub ↗</a></footer>
  </article>;
}
export function getServerSideProps({query}) { return {props:{initialLocale:query.lang==='zh'?'zh':'en'}}; }
