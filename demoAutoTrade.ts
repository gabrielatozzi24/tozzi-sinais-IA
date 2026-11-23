/**
 * Pure demo-only order guards. Fail closed instead of guessing option assets
 * or expiration contracts from the screenshot.
 */
export type DemoCandidate = {
  targetEpoch:number;
  asset:string;
  decision:"POSSÍVEL COMPRA"|"POSSÍVEL VENDA";
  status:string;
  expiration:string;
  optionMode?:string;
};
export const normalizeAsset=(asset:string)=>asset.toUpperCase().replace(/[^A-Z0-9]/g,"");
export const sameAsset=(selected:string,apiTicker:string)=>
  Boolean(selected && apiTicker && normalizeAsset(selected)===normalizeAsset(apiTicker));
export const expirationMs=(exp:string):number|null =>
  exp==="1min"?60000:exp==="5min"?300000:null;
/** Never enter before target, after its 1.5-second deadline or without confirmation. */
export function canSendDemoOrder(candidate:DemoCandidate|null,now:number,mode:string,asset:string,enabled:boolean) {
  if(!enabled)return "Automação desligada";
  if(!candidate||candidate.status!=="CONFIRMED")return "Não existe confirmação atual";
  if(candidate.optionMode!==mode||candidate.asset!==asset)return "Ativo ou modalidade divergente";
  if(candidate.decision!=="POSSÍVEL COMPRA"&&candidate.decision!=="POSSÍVEL VENDA")return "Sem direção";
  if(!expirationMs(candidate.expiration))return "Expiração não suportada";
  if(!Number.isFinite(candidate.targetEpoch)||now<candidate.targetEpoch||now>candidate.targetEpoch+1500)
    return "Fora do horário previsto de entrada";
  return null;
}
/** Exactly one matching contract for expiration at TARGET+period, not first available. */
export function exactExpiry<T>(contracts:T[],target:number,getExpiry:(c:T)=>number) {
  const matching=contracts.filter(c=>getExpiry(c)===target);
  return matching.length===1?matching[0]:null;
}
export function validateDemoStake(stake:number,available:number,maxPerOrder:number) {
  return Number.isFinite(stake)&&Number.isFinite(available)&&
    stake>=1&&stake<=maxPerOrder&&stake<=available;
}
