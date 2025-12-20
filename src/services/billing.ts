// Default platform fee: 2%
const DEFAULT_PLATFORM_FEE_PERCENT = 2;

export interface FeeBreakdown {
  totalCost: number;
  devEarnings: number;
  platformFee: number;
}

export function calculateFees(
  costSats: number,
  platformFeePercent: number = DEFAULT_PLATFORM_FEE_PERCENT
): FeeBreakdown {
  const platformFee = Math.ceil((costSats * platformFeePercent) / 100);
  const devEarnings = costSats - platformFee;

  return {
    totalCost: costSats,
    devEarnings,
    platformFee,
  };
}

export function getPlatformFeePercent(envValue: string | undefined): number {
  if (!envValue) {
    return DEFAULT_PLATFORM_FEE_PERCENT;
  }
  const parsed = parseFloat(envValue);
  if (isNaN(parsed) || parsed < 0 || parsed > 100) {
    return DEFAULT_PLATFORM_FEE_PERCENT;
  }
  return parsed;
}
