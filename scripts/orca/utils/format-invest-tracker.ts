export function formatInvestTrackerData(tracker: any) {
  return {
    amountInvested: tracker.amountInvested.toString(),
    amountWithdrawn: tracker.amountWithdrawn.toString(),
    assetAmount: tracker.assetAmount.toString(),
    assetPrice: tracker.assetPrice.toString(),
    assetValue: tracker.assetValue.toString(),
    currentWeight: tracker.currentWeight,
    effectiveInvestedAmount: tracker.effectiveInvestedAmount.toString(),
    scenarioRealizedProfit: tracker.scenarioRealizedProfit.toString(),
    unrealizedProfit: tracker.unrealizedProfit.toString(), 
    unrealizedLoss: tracker.unrealizedLoss.toString(),
    txRealizedProfitAccumulated: tracker.txRealizedProfitAccumulated.toString(),
    txRealizedLossAccumulated: tracker.txRealizedLossAccumulated.toString()
  };
} 