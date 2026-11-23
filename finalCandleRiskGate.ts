/** Experimental risk gate against clear contrary evidence at the final candle.
 * Uses only existing Gemini fields, never independent or predictive evidence.
 * Designed to reduce risk, NOT validated to improve historical WIN rate.
 */
export type AdverseCandle = {
  opposingWickPressure?:string;
  reversalEvidence?:string;
  structureContinuation?:string;
  currentCandleDirection?:string;
  lastClosedCandleDirection?:string;
};
export function finalCandleRiskGate(phase:"PREPARE"|"CONFIRM",vision:AdverseCandle) {
  if(phase!=="CONFIRM")
    return {passed:true,reason:"Filtro de conflito final reservado à reconfirmação.",code:"NOT_FINAL"};
  if(vision.reversalEvidence==="FORTE")
    return {passed:false,reason:"Possível reversão forte identificada na imagem atual. Entrada bloqueada.",code:"STRONG_REVERSAL"};
  if(vision.opposingWickPressure==="FORTE")
    return {passed:false,reason:"Pavios com pressão contrária forte na imagem atual. Entrada bloqueada.",code:"STRONG_OPPOSING_WICK"};
  if(vision.structureContinuation==="NAO")
    return {passed:false,reason:"A estrutura não favorece continuação da direção do sinal. Entrada bloqueada.",code:"NO_CONTINUATION"};
  return {passed:true,reason:"Nenhum conflito visual forte foi declarado na reconfirmação.",code:"NO_STRONG_CONFLICT"};
}
