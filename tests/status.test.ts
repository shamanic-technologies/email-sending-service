import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/index";

vi.mock("../src/config", () => ({
  config: {
    port: 3009,
    apiKey: "test-api-key",
    emailFromAddress: "test@example.com",
    postmark: { url: "http://localhost:3010", apiKey: "pm-key" },
    instantly: { url: "http://localhost:3011", apiKey: "inst-key" },
    brand: { url: "http://localhost:3005", apiKey: "brand-key" },
  },
}));

const API_KEY = "test-api-key";
const mockFetch = vi.fn();
global.fetch = mockFetch;

function buildStatusBody(overrides = {}) {
  return {
    campaignId: "camp_1",
    items: [
      { leadId: "lead_1", email: "john@acme.com" },
      { leadId: "lead_2", email: "jane@acme.com" },
    ],
    ...overrides,
  };
}

const emptyStatus = {
  lead: { contacted: false, delivered: false, replied: false, lastDeliveredAt: null },
  email: { contacted: false, delivered: false, bounced: false, unsubscribed: false, lastDeliveredAt: null },
};

const deliveredStatus = {
  lead: { contacted: true, delivered: true, replied: false, lastDeliveredAt: "2026-02-20T14:30:00Z" },
  email: { contacted: true, delivered: true, bounced: false, unsubscribed: false, lastDeliveredAt: "2026-02-20T14:30:00Z" },
};

function mockInstantlyResponse(results: unknown[]) {
  return {
    ok: true,
    json: () => Promise.resolve({ results }),
  };
}

function mockPostmarkResponse(results: unknown[]) {
  return {
    ok: true,
    json: () => Promise.resolve({ results }),
  };
}

function mockServiceError() {
  return {
    ok: false,
    status: 500,
    text: () => Promise.resolve("Internal Server Error"),
  };
}

describe("POST /status", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/status")
      .send(buildStatusBody());

    expect(res.status).toBe(401);
  });

  it("returns 400 for missing campaignId", async () => {
    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send({ items: [{ email: "john@acme.com" }] });

    expect(res.status).toBe(400);
  });

  it("returns 400 for empty items array", async () => {
    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send({ campaignId: "camp_1", items: [] });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid email in items", async () => {
    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send({ campaignId: "camp_1", items: [{ email: "not-an-email" }] });

    expect(res.status).toBe(400);
  });

  it("calls both sub-services in parallel and merges results", async () => {
    // instantly-service responds first (port 3011)
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("3011")) {
        return Promise.resolve(mockInstantlyResponse([
          { leadId: "lead_1", email: "john@acme.com", campaign: deliveredStatus, global: deliveredStatus },
          { leadId: "lead_2", email: "jane@acme.com", campaign: emptyStatus, global: emptyStatus },
        ]));
      }
      if (url.includes("3010")) {
        return Promise.resolve(mockPostmarkResponse([
          { leadId: "lead_1", email: "john@acme.com", campaign: emptyStatus, global: emptyStatus },
        ]));
      }
      return Promise.reject(new Error("unexpected url"));
    });

    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send(buildStatusBody());

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);

    // First item has both providers
    const first = res.body.results[0];
    expect(first.leadId).toBe("lead_1");
    expect(first.email).toBe("john@acme.com");
    expect(first.broadcast).toBeDefined();
    expect(first.broadcast.campaign.lead.delivered).toBe(true);
    expect(first.transactional).toBeDefined();

    // Second item only has broadcast (postmark didn't return it)
    const second = res.body.results[1];
    expect(second.leadId).toBe("lead_2");
    expect(second.broadcast).toBeDefined();
    expect(second.transactional).toBeUndefined();
  });

  it("forwards correct payload to both sub-services", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send(buildStatusBody());

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const calls = mockFetch.mock.calls.map(([url, opts]: [string, { body: string }]) => ({
      url,
      body: JSON.parse(opts.body),
    }));

    // Both should receive the same payload
    for (const call of calls) {
      expect(call.body.campaignId).toBe("camp_1");
      expect(call.body.items).toHaveLength(2);
      expect(call.body.items[0]).toEqual({ leadId: "lead_1", email: "john@acme.com" });
    }

    // One call to each service
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("http://localhost:3011/status");
    expect(urls).toContain("http://localhost:3010/status");
  });

  it("returns results when only broadcast succeeds", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("3011")) {
        return Promise.resolve(mockInstantlyResponse([
          { leadId: "lead_1", email: "john@acme.com", campaign: deliveredStatus, global: deliveredStatus },
        ]));
      }
      return Promise.resolve(mockServiceError());
    });

    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send(buildStatusBody({ items: [{ leadId: "lead_1", email: "john@acme.com" }] }));

    expect(res.status).toBe(200);
    expect(res.body.results[0].broadcast).toBeDefined();
    expect(res.body.results[0].transactional).toBeUndefined();
  });

  it("returns results when only transactional succeeds", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("3010")) {
        return Promise.resolve(mockPostmarkResponse([
          { leadId: "lead_1", email: "john@acme.com", campaign: deliveredStatus, global: deliveredStatus },
        ]));
      }
      return Promise.resolve(mockServiceError());
    });

    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send(buildStatusBody({ items: [{ leadId: "lead_1", email: "john@acme.com" }] }));

    expect(res.status).toBe(200);
    expect(res.body.results[0].transactional).toBeDefined();
    expect(res.body.results[0].broadcast).toBeUndefined();
  });

  it("returns 502 when both sub-services fail", async () => {
    mockFetch.mockResolvedValue(mockServiceError());

    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send(buildStatusBody({ items: [{ leadId: "lead_1", email: "john@acme.com" }] }));

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Both upstream services failed");
  });

  it("works without leadId in items (email-only lookup)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const res = await request(app)
      .post("/status")
      .set("X-API-Key", API_KEY)
      .send({ campaignId: "camp_1", items: [{ email: "john@acme.com" }] });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].email).toBe("john@acme.com");
    expect(res.body.results[0].leadId).toBeUndefined();
  });
});
