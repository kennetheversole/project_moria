import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

interface HealthResponse {
  name: string;
  status: string;
  database: string;
  timestamp?: string;
}

interface ErrorResponse {
  success: boolean;
  error: string;
}

describe("App Integration Tests", () => {
  describe("Health Endpoints", () => {
    it("should return API info on root", async () => {
      const response = await SELF.fetch("http://localhost/");
      const data = (await response.json()) as HealthResponse;

      expect(response.status).toBe(200);
      expect(data.name).toContain("Moria");
      expect(data.status).toBe("ok");
      // D1 is now configured in tests
      expect(data.database).toBe("connected");
    });

    it("should return health status", async () => {
      const response = await SELF.fetch("http://localhost/health");
      const data = (await response.json()) as HealthResponse;

      expect(response.status).toBe(200);
      // D1 is now configured, so it's healthy
      expect(data.status).toBe("healthy");
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for unknown routes", async () => {
      const response = await SELF.fetch("http://localhost/unknown/route");
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Not found");
    });

    it("should return 401 when no API key provided", async () => {
      const response = await SELF.fetch("http://localhost/api/users/me");
      const data = (await response.json()) as ErrorResponse;

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe("API key required");
    });
  });

  describe("CORS", () => {
    it("should include CORS headers", async () => {
      const response = await SELF.fetch("http://localhost/", {
        method: "OPTIONS",
      });

      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });
  });
});
