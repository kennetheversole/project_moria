import { describe, it, expect } from "vitest";
import { calculateFees, getPlatformFeePercent } from "../src/services/billing";

describe("Billing Service", () => {
  describe("calculateFees", () => {
    it("should calculate 5% platform fee by default", () => {
      const fees = calculateFees(100);
      expect(fees.totalCost).toBe(100);
      expect(fees.platformFee).toBe(5); // 5% of 100
      expect(fees.devEarnings).toBe(95); // 100 - 5
    });

    it("should round up platform fee", () => {
      const fees = calculateFees(10);
      expect(fees.platformFee).toBe(1); // ceil(0.5) = 1
      expect(fees.devEarnings).toBe(9);
    });

    it("should handle custom fee percentage", () => {
      const fees = calculateFees(100, 10);
      expect(fees.platformFee).toBe(10);
      expect(fees.devEarnings).toBe(90);
    });

    it("should handle zero cost", () => {
      const fees = calculateFees(0);
      expect(fees.totalCost).toBe(0);
      expect(fees.platformFee).toBe(0);
      expect(fees.devEarnings).toBe(0);
    });

    it("should handle large amounts", () => {
      const fees = calculateFees(1000000);
      expect(fees.platformFee).toBe(50000);
      expect(fees.devEarnings).toBe(950000);
    });
  });

  describe("getPlatformFeePercent", () => {
    it("should return default 5 when undefined", () => {
      expect(getPlatformFeePercent(undefined)).toBe(5);
    });

    it("should parse valid percentage", () => {
      expect(getPlatformFeePercent("10")).toBe(10);
      expect(getPlatformFeePercent("2.5")).toBe(2.5);
    });

    it("should return default for invalid values", () => {
      expect(getPlatformFeePercent("invalid")).toBe(5);
      expect(getPlatformFeePercent("-5")).toBe(5);
      expect(getPlatformFeePercent("150")).toBe(5);
    });
  });
});
