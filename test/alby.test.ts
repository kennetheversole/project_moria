import { describe, it, expect } from "vitest";
import { MockAlbyService, createAlbyService } from "../src/services/alby";

describe("Alby Service", () => {
  describe("MockAlbyService", () => {
    const mockAlby = new MockAlbyService();

    describe("createInvoice", () => {
      it("should create a mock invoice", async () => {
        const invoice = await mockAlby.createInvoice(1000, "Test payment");

        expect(invoice.amount).toBe(1000);
        expect(invoice.description).toBe("Test payment");
        expect(invoice.payment_hash).toContain("mock_");
        expect(invoice.payment_request).toContain("lnbc1000");
        expect(invoice.expires_at).toBeDefined();
      });

      it("should generate unique payment hashes", async () => {
        const invoice1 = await mockAlby.createInvoice(100, "Test 1");
        const invoice2 = await mockAlby.createInvoice(100, "Test 2");

        expect(invoice1.payment_hash).not.toBe(invoice2.payment_hash);
      });
    });

    describe("getInvoice", () => {
      it("should return invoice as settled", async () => {
        const result = await mockAlby.getInvoice("test_hash");

        expect(result.payment_hash).toBe("test_hash");
        expect(result.settled).toBe(true);
      });
    });

    describe("payToLightningAddress", () => {
      it("should return mock payment response", async () => {
        const result = await mockAlby.payToLightningAddress(
          "test@getalby.com",
          500,
          "Payout"
        );

        expect(result.payment_hash).toContain("mock_payout");
        expect(result.preimage).toContain("test@getalby.com");
        expect(result.preimage).toContain("500");
        expect(result.fee).toBe(1); // 0.1% of 500, rounded up
      });
    });

  });

  describe("createAlbyService", () => {
    it("should return MockAlbyService when no API key", () => {
      const service = createAlbyService(undefined);
      expect(service).toBeInstanceOf(MockAlbyService);
    });

    it("should return MockAlbyService for empty string", () => {
      const service = createAlbyService("");
      expect(service).toBeInstanceOf(MockAlbyService);
    });
  });
});
