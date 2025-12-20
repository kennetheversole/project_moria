/**
 * Test script for the full Lightning API Gateway flow
 *
 * Run with: pnpm test:flow
 * (Requires the dev server to be running: pnpm dev)
 */

const BASE_URL = "http://localhost:8787";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return response.json() as Promise<ApiResponse<T>>;
}

function log(step: string, data: unknown) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📍 ${step}`);
  console.log("=".repeat(60));
  console.log(JSON.stringify(data, null, 2));
}

function success(message: string) {
  console.log(`\n✅ ${message}`);
}

function fail(message: string) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

async function main() {
  console.log("\n🚀 Lightning API Gateway - Full Flow Test\n");

  // Step 0: Health check
  log("Step 0: Health Check", await request("/health"));

  // ============================================
  // DEVELOPER FLOW
  // ============================================

  // Step 1: Register a developer
  const devEmail = `dev-${Date.now()}@example.com`;
  const devResult = await request<{
    id: string;
    token: string;
    email: string;
  }>("/api/developers/register", {
    method: "POST",
    body: JSON.stringify({
      email: devEmail,
      password: "testpass123",
      name: "Test Developer",
      lightningAddress: "testdev@getalby.com",
    }),
  });

  log("Step 1: Register Developer", devResult);

  if (!devResult.success || !devResult.data?.token) {
    fail("Failed to register developer");
  }

  const devToken = devResult.data.token;
  success(`Developer registered: ${devEmail}`);

  // Step 2: Create a gateway
  const gatewayResult = await request<{
    id: string;
    name: string;
    proxyUrl: string;
    pricePerRequestSats: number;
  }>("/api/gateways", {
    method: "POST",
    headers: { Authorization: `Bearer ${devToken}` },
    body: JSON.stringify({
      name: "Test API Gateway",
      targetUrl: "https://httpbin.org",  // Public echo API for testing
      pricePerRequestSats: 10,
      description: "A test gateway pointing to httpbin.org",
    }),
  });

  log("Step 2: Create Gateway", gatewayResult);

  if (!gatewayResult.success || !gatewayResult.data?.id) {
    fail("Failed to create gateway");
  }

  const gatewayId = gatewayResult.data.id;
  success(`Gateway created: ${gatewayId} (10 sats/request)`);

  // ============================================
  // USER FLOW
  // ============================================

  // Step 3: Register a user
  const userEmail = `user-${Date.now()}@example.com`;
  const userResult = await request<{
    id: string;
    apiKey: string;
    email: string;
    balanceSats: number;
  }>("/api/users/register", {
    method: "POST",
    body: JSON.stringify({ email: userEmail }),
  });

  log("Step 3: Register User", userResult);

  if (!userResult.success || !userResult.data?.apiKey) {
    fail("Failed to register user");
  }

  const apiKey = userResult.data.apiKey;
  success(`User registered: ${userEmail}`);
  console.log(`   API Key: ${apiKey}`);

  // Step 4: Create a top-up invoice
  const topupResult = await request<{
    topupId: string;
    amountSats: number;
    paymentRequest: string;
    paymentHash: string;
  }>("/api/users/topup", {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: JSON.stringify({ amountSats: 1000 }),
  });

  log("Step 4: Create Top-up Invoice", topupResult);

  if (!topupResult.success || !topupResult.data?.topupId) {
    fail("Failed to create top-up");
  }

  const topupId = topupResult.data.topupId;
  success(`Top-up invoice created for 1000 sats`);
  console.log(`   Payment Request: ${topupResult.data.paymentRequest.substring(0, 50)}...`);

  // Step 5: Check top-up status (mock service marks it as paid)
  const checkResult = await request<{
    status: string;
    newBalance?: number;
  }>(`/api/users/topup/${topupId}`, {
    headers: { "X-API-Key": apiKey },
  });

  log("Step 5: Check Top-up Status", checkResult);

  if (!checkResult.success) {
    fail("Failed to check top-up status");
  }

  success(`Top-up status: ${checkResult.data?.status}`);
  if (checkResult.data?.newBalance !== undefined) {
    console.log(`   New Balance: ${checkResult.data.newBalance} sats`);
  }

  // Step 6: Check user balance
  const balanceResult = await request<{
    balanceSats: number;
  }>("/api/users/me", {
    headers: { "X-API-Key": apiKey },
  });

  log("Step 6: Check User Balance", balanceResult);

  const startingBalance = balanceResult.data?.balanceSats ?? 0;
  success(`User balance: ${startingBalance} sats`);

  // ============================================
  // PROXY FLOW
  // ============================================

  // Step 7: Make proxied requests
  console.log("\n" + "=".repeat(60));
  console.log("📍 Step 7: Make Proxied API Requests");
  console.log("=".repeat(60));

  const endpoints = ["/get", "/ip", "/user-agent"];

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    console.log(`\n   Request ${i + 1}: GET /g/${gatewayId}${endpoint}`);

    const proxyResponse = await fetch(`${BASE_URL}/g/${gatewayId}${endpoint}`, {
      headers: { "X-API-Key": apiKey },
    });

    const remainingBalance = proxyResponse.headers.get("X-Balance-Remaining");
    const requestCost = proxyResponse.headers.get("X-Request-Cost");

    console.log(`   Status: ${proxyResponse.status}`);
    console.log(`   Cost: ${requestCost} sats`);
    console.log(`   Remaining Balance: ${remainingBalance} sats`);

    if (proxyResponse.status === 402) {
      console.log("   ⚠️  Insufficient balance!");
      break;
    }
  }

  // Step 8: Final balance check
  const finalBalance = await request<{
    balanceSats: number;
  }>("/api/users/me", {
    headers: { "X-API-Key": apiKey },
  });

  log("Step 8: Final Balance Check", finalBalance);

  const spent = startingBalance - (finalBalance.data?.balanceSats ?? 0);
  success(`Total spent: ${spent} sats (${spent / 10} requests at 10 sats each)`);

  // Step 9: Check developer earnings
  const devProfile = await request<{
    balanceSats: number;
  }>("/api/developers/me", {
    headers: { Authorization: `Bearer ${devToken}` },
  });

  log("Step 9: Developer Earnings", devProfile);

  const earnings = devProfile.data?.balanceSats ?? 0;
  success(`Developer earned: ${earnings} sats (after 5% platform fee)`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 TEST COMPLETE - Full flow executed successfully!");
  console.log("=".repeat(60));
  console.log(`
Summary:
  • Developer registered and created gateway
  • User registered and topped up 1000 sats
  • User made ${spent / 10} API requests at 10 sats each
  • User spent ${spent} sats total
  • Developer earned ${earnings} sats (95%)
  • Platform earned ${spent - earnings} sats (5%)
  `);
}

main().catch((err) => {
  console.error("\n💥 Test failed with error:", err);
  process.exit(1);
});
