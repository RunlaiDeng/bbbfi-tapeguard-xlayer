export default function RetiredModel(){return null;}
export function getServerSideProps({query}){return{redirect:{destination:'/explore/access/business?lang='+(query.lang==='zh'?'zh':'en'),permanent:false}};}
