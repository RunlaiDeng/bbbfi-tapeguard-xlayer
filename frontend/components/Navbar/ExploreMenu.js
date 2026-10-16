import LiquidityMenu from './LiquidityMenu';

export default function ExploreMenu({ chain, zh, ...props }) {
  const query = { ...(chain ? { chain } : {}), lang: zh ? 'zh' : 'en' };
  const entries = [
    [zh ? '探索资金池' : 'Explore pools', { pathname: '/explore/pools', query }],
    [zh ? '自动收款' : 'Payments & access', { pathname: '/explore/access', query }],
    [zh ? '保护兑换' : 'Guarded swap', { pathname: '/explore/tapeguard', query: { chain: 'xlayer', lang: query.lang } }],
  ];
  return <LiquidityMenu {...props} {...{ chain, zh, entries }} />;
}
