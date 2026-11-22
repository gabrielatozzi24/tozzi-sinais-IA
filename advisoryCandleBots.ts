/**
 * Advisory candle diagnostics derived from the SAME Gemini screenshot response.
 * They do not inspect candles independently, do not call external APIs, and cannot
 * release or block a signal. Unobserved features are UNKNOWN, not invented.
 */
export type Observation = "FAVORAVEL" | "ATENCAO" | "INDETERMINADO";
export type AdvisoryVerdict = {
  name: string;
  status: Observation;
  reason: string;
  mode: "OBSERVACAO";
  independent: false;
};
export type CandleObservations = {
  decision?: string;
  currentCandleDirection?: string;
  lastClosedCandleDirection?: string;
  trendSupportsDirection?: boolean;
  minorCountertrendPullback?: boolean;
  candleBodyStrength?: string;
  opposingWickPressure?: string;
  reversalEvidence?: string;
  structureContinuation?: string;
};
const directionOf=(decision: string) =>
  decision==="POSSÍVEL COMPRA" ? "ALTA" : decision==="POSSÍVEL VENDA" ? "BAIXA" : null;
const verdict=(name:string,status:Observation,reason:string):AdvisoryVerdict=>({
  name,status,reason,mode:"OBSERVACAO",independent:false
});

/** Robot six: body strength and opposing wick pressure, not a generic new vote. */
export function precisionCandleBot(vision:CandleObservations,decision:string):AdvisoryVerdict {
  const name="Tozzi Precision Candle Bot";
  const expected=directionOf(decision);
  if(!expected)return verdict(name,"INDETERMINADO","Sem direção preliminar para avaliar o corpo e os pavios.");
  const body=vision.candleBodyStrength;
  const wick=vision.opposingWickPressure;
  if(body==="INDEFINIDO"||wick==="INDEFINIDA"||!body||!wick)
    return verdict(name,"INDETERMINADO","Corpo ou pressão dos pavios não foram identificados com segurança na captura.");
  if(vision.currentCandleDirection!==expected)
    return verdict(name,"ATENCAO","Vela atual não está alinhada com o sentido proposto.");
  if(wick==="FORTE")
    return verdict(name,"ATENCAO","Pavios sugerem pressão contrária relevante à direção proposta.");
  if(body==="FRACO")
    return verdict(name,"ATENCAO","Corpo pequeno ou fraco: continuação não está demonstrada.");
  if(body==="FORTE"&&wick==="FRACA")
    return verdict(name,"FAVORAVEL","Corpo favorável e pouca pressão contrária nos pavios, segundo a mesma leitura visual.");
  return verdict(name,"INDETERMINADO","Força da vela ou pressão dos pavios não conclusiva.");
}

/** Robot seven: distinguishing continuation from possible reversal or pullback. */
export function reversalWatchBot(vision:CandleObservations,decision:string):AdvisoryVerdict {
  const name="Tozzi Reversal Watch Bot";
  const expected=directionOf(decision);
  if(!expected)return verdict(name,"INDETERMINADO","Sem direção proposta para verificar continuação ou reversão.");
  if(vision.reversalEvidence==="FORTE")
    return verdict(name,"ATENCAO","A leitura visual identificou evidência de reversão relevante.");
  if(vision.trendSupportsDirection===false)
    return verdict(name,"ATENCAO","Estrutura não sustenta a direção proposta.");
  if(vision.minorCountertrendPullback===true)
    return verdict(name,"ATENCAO","Correção contrária identificada: verificar se se transforma em reversão.");
  if(vision.structureContinuation==="INDEFINIDA"||!vision.structureContinuation)
    return verdict(name,"INDETERMINADO","Não há evidência visual suficiente de continuação da estrutura.");
  if(vision.structureContinuation==="NAO"||vision.reversalEvidence==="MODERADA")
    return verdict(name,"ATENCAO","Continuação da estrutura não confirmada ou possível reversão.");
  if(vision.structureContinuation==="SIM"&&vision.reversalEvidence==="AUSENTE"&&
     vision.currentCandleDirection===expected && vision.lastClosedCandleDirection===expected &&
     vision.trendSupportsDirection===true)
    return verdict(name,"FAVORAVEL","Estrutura e velas alinhadas; sem reversão visível segundo a mesma captura.");
  return verdict(name,"INDETERMINADO","Sinais mistos de continuação e reversão; não foi feita aprovação adicional.");
}
