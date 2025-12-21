import { LightningAddress } from "@getalby/lightning-tools";
import type { AlbyInvoice, AlbyInvoiceResponse, AlbyPaymentResponse } from "../types";

const ALBY_API_BASE = "https://api.getalby.com";

export class AlbyService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${ALBY_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Alby API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  // Create a Lightning invoice for user top-up
  async createInvoice(
    amountSats: number,
    description: string
  ): Promise<AlbyInvoice> {
    return this.request<AlbyInvoice>("/invoices", {
      method: "POST",
      body: JSON.stringify({
        amount: amountSats,
        description,
      }),
    });
  }

  // Check if an invoice has been paid
  async getInvoice(paymentHash: string): Promise<AlbyInvoiceResponse> {
    const response = await this.request<AlbyInvoiceResponse>(`/invoices/${paymentHash}`);
    console.log("Alby getInvoice response:", JSON.stringify(response));
    return response;
  }

  // Pay out to a Lightning address using @getalby/lightning-tools
  async payToLightningAddress(
    lightningAddress: string,
    amountSats: number,
    comment?: string
  ): Promise<AlbyPaymentResponse> {
    // Use lightning-tools to handle the Lightning Address
    const ln = new LightningAddress(lightningAddress);
    await ln.fetch();

    // Request an invoice from the Lightning Address
    const invoice = await ln.requestInvoice({
      satoshi: amountSats,
      comment,
    });

    // Pay the invoice via Alby API
    return this.request<AlbyPaymentResponse>("/payments/bolt11", {
      method: "POST",
      body: JSON.stringify({
        invoice: invoice.paymentRequest,
      }),
    });
  }

}

// Mock service for testing/development without Alby
export class MockAlbyService {
  async createInvoice(
    amountSats: number,
    description: string
  ): Promise<AlbyInvoice> {
    return {
      payment_hash: `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      payment_request: `lnbc${amountSats}mock...`,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      amount: amountSats,
      description,
    };
  }

  async getInvoice(paymentHash: string): Promise<AlbyInvoiceResponse> {
    // Mock: always return as settled for testing
    return {
      payment_hash: paymentHash,
      payment_request: "lnbc...",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      settled: true,
    };
  }

  async payToLightningAddress(
    lightningAddress: string,
    amountSats: number,
    _comment?: string
  ): Promise<AlbyPaymentResponse> {
    return {
      payment_hash: `mock_payout_${Date.now()}`,
      preimage: `mock_preimage_${lightningAddress}_${amountSats}`,
      fee: Math.ceil(amountSats * 0.001), // 0.1% mock fee
    };
  }
}

export function createAlbyService(
  apiKey: string | undefined,
  throwOnMock = false
): AlbyService | MockAlbyService {
  if (apiKey) {
    return new AlbyService(apiKey);
  }

  if (throwOnMock) {
    throw new Error("ALBY_API_KEY is required for payments");
  }

  console.warn("WARNING: Using MockAlbyService - payments will not work!");
  return new MockAlbyService();
}
