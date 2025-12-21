import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  generateSessionKey,
  generateToken,
  verifyToken,
} from "../src/middleware/auth";

describe("Auth Middleware", () => {
  describe("hashPassword", () => {
    it("should hash password consistently", async () => {
      const password = "testpassword123";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different passwords", async () => {
      const hash1 = await hashPassword("password1");
      const hash2 = await hashPassword("password2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyPassword", () => {
    it("should verify correct password", async () => {
      const password = "securePassword!";
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it("should reject incorrect password", async () => {
      const hash = await hashPassword("correct");
      const result = await verifyPassword("wrong", hash);
      expect(result).toBe(false);
    });
  });

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
});
