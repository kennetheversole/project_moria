// L402 Protocol Implementation
// https://github.com/lightninglabs/L402

export interface L402Challenge {
  macaroon: string;
  invoice: string;
  paymentHash: string;
}

export interface L402Token {
  macaroon: string;
  preimage: string;
}

// Simple macaroon-like token (base64 encoded JSON)
// In production, use proper macaroons with HMAC signatures
interface MacaroonData {
  paymentHash: string;
  gatewayId: string;
  path: string;
  price: number;
  expires: number;
  signature: string;
}

// Generate HMAC signature for macaroon
async function signMacaroon(data: Omit<MacaroonData, 'signature'>, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const message = JSON.stringify(data);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// Verify macaroon signature
async function verifyMacaroonSignature(data: MacaroonData, secret: string): Promise<boolean> {
  const { signature, ...rest } = data;
  const expectedSig = await signMacaroon(rest, secret);
  return signature === expectedSig;
}

// Create an L402 challenge (macaroon + invoice)
export async function createL402Challenge(
  paymentHash: string,
  invoice: string,
  gatewayId: string,
  path: string,
  price: number,
  secret: string
): Promise<L402Challenge> {
  const expires = Date.now() + 3600000; // 1 hour expiry

  const macaroonData: Omit<MacaroonData, 'signature'> = {
    paymentHash,
    gatewayId,
    path,
    price,
    expires,
  };

  const signature = await signMacaroon(macaroonData, secret);
  const fullMacaroon: MacaroonData = { ...macaroonData, signature };

  // Base64 encode the macaroon
  const macaroon = btoa(JSON.stringify(fullMacaroon));

  return {
    macaroon,
    invoice,
    paymentHash,
  };
}

// Parse L402 Authorization header
export function parseL402Header(authHeader: string): L402Token | null {
  // Format: L402 <macaroon>:<preimage>
  if (!authHeader.startsWith('L402 ')) {
    return null;
  }

  const token = authHeader.slice(5);
  const colonIndex = token.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  return {
    macaroon: token.slice(0, colonIndex),
    preimage: token.slice(colonIndex + 1),
  };
}

// Verify L402 token
export async function verifyL402Token(
  token: L402Token,
  gatewayId: string,
  _path: string,
  secret: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Decode macaroon
    const macaroonJson = atob(token.macaroon);
    const macaroon: MacaroonData = JSON.parse(macaroonJson);

    // Verify signature
    const sigValid = await verifyMacaroonSignature(macaroon, secret);
    if (!sigValid) {
      return { valid: false, error: 'Invalid macaroon signature' };
    }

    // Check expiry
    if (Date.now() > macaroon.expires) {
      return { valid: false, error: 'Macaroon expired' };
    }

    // Check gateway ID
    if (macaroon.gatewayId !== gatewayId) {
      return { valid: false, error: 'Macaroon not valid for this gateway' };
    }

    // Verify preimage matches payment hash
    // SHA256(preimage) should equal paymentHash
    const preimageBytes = hexToBytes(token.preimage);
    const hashBuffer = await crypto.subtle.digest('SHA-256', preimageBytes);
    const computedHash = bytesToHex(new Uint8Array(hashBuffer));

    if (computedHash !== macaroon.paymentHash) {
      return { valid: false, error: 'Invalid preimage' };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: 'Invalid macaroon format' };
  }
}

// Generate WWW-Authenticate header for L402
export function generateL402Header(challenge: L402Challenge): string {
  return `L402 macaroon="${challenge.macaroon}", invoice="${challenge.invoice}"`;
}

// Utility functions
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Match path against glob pattern
export function matchPath(pattern: string, path: string): boolean {
  // Convert glob to regex
  // * matches any single path segment
  // ** matches any number of path segments
  let regexStr = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*');

  // Ensure full match
  regexStr = `^${regexStr}$`;

  const regex = new RegExp(regexStr);
  return regex.test(path);
}
