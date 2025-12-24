import { describe, it, expect } from "vitest";
import {
  generateSessionKey,
  generateToken,
  verifyToken,
  verifyNostrAuth,
} from "../src/middleware/auth";

describe("Auth Middleware", () => {
  describe("generateSessionKey", () => {
    it("should generate unique session keys", () => {
      const key1 = generateSessionKey();
      const key2 = generateSessionKey();
      expect(key1).not.toBe(key2);
    });

    it("should start with sk_ prefix", () => {
      const key = generateSessionKey();
      expect(key.startsWith("sk_")).toBe(true);
    });

    it("should be 67 characters long (sk_ + 64 hex chars)", () => {
      const key = generateSessionKey();
      expect(key.length).toBe(67);
    });
  });

  describe("generateToken / verifyToken", () => {
    const secret = "test-secret-key";

    it("should generate and verify valid token", async () => {
      const payload = { developerId: "dev123", name: "Test Dev" };
      const token = await generateToken(payload, secret);
      const verified = await verifyToken(token, secret);

      expect(verified).not.toBeNull();
      expect(verified?.developerId).toBe("dev123");
      expect(verified?.name).toBe("Test Dev");
    });

    it("should reject token with wrong secret", async () => {
      const token = await generateToken({ id: "123" }, secret);
      const verified = await verifyToken(token, "wrong-secret");
      expect(verified).toBeNull();
    });

    it("should reject malformed token", async () => {
      const verified = await verifyToken("invalid.token", secret);
      expect(verified).toBeNull();
    });
  });

  describe("verifyNostrAuth", () => {
    it("should reject event with wrong kind", () => {
      const event = {
        id: "test",
        pubkey: "a".repeat(64),
        created_at: Math.floor(Date.now() / 1000),
        kind: 1, // wrong kind
        tags: [],
        content: "",
        sig: "test",
      };
      const result = verifyNostrAuth(event);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid event kind");
    });

    it("should reject expired event", () => {
      const event = {
        id: "test",
        pubkey: "a".repeat(64),
        created_at: Math.floor(Date.now() / 1000) - 120, // 2 minutes ago
        kind: 22242,
        tags: [],
        content: "",
        sig: "test",
      };
      const result = verifyNostrAuth(event);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Event expired");
    });
  });
});
