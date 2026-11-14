import { mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "@rent/domain";
import { createApi } from "../src/server/api";
import { LocalFileStore } from "../src/server/storage";

async function makeApi(devToolsEnabled = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rent-api-"));
  return { dir, api: createApi({ policy: DEFAULT_POLICY, store: new LocalFileStore(path.join(dir, "uploads")), devToolsEnabled, dataDir: dir }) };
}

const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("/api/v1/quote", () => {
  it("returns the plan's worked example: 6,000 dress, 900 rent, T1", async () => {
    const { api } = await makeApi();
    const res = await api.request("/api/v1/quote", post({ agreedValue: 600000, rent: 90000, tier: "T1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ band: "B", deposit: 180000, payToday: 270000, lateFeePerDay: 45000 });
  });
  it("refuses a second band C dress for the same cluster", async () => {
    const { api } = await makeApi();
    const res = await api.request(
      "/api/v1/quote",
      post({ agreedValue: 2500000, rent: 250000, tier: "T2", bestCompletedBand: "C", clusterOpen: [{ agreedValue: 1200000, deposit: 360000, band: "C" }] }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "BAND_C_LIMIT" });
  });
  it("refuses messenger delivery without e-KYC", async () => {
    const { api } = await makeApi();
    const res = await api.request("/api/v1/quote", post({ agreedValue: 600000, rent: 90000, tier: "T1", fulfilment: "MESSENGER" }));
    expect(await res.json()).toEqual({ error: "NEEDS_EKYC" });
  });
  it("rejects an invalid body", async () => {
    const { api } = await makeApi();
    expect((await api.request("/api/v1/quote", post({ rent: -1 }))).status).toBe(400);
  });
});

describe("dev upload", () => {
  it("stores the body and returns a server-side SHA-256", async () => {
    const { api, dir } = await makeApi();
    const data = new TextEncoder().encode("hello evidence");
    const res = await api.request("/api/v1/dev/uploads/test.bin", { method: "PUT", body: data });
    const json = (await res.json()) as { bytes: number; sha256: string };
    expect(json.bytes).toBe(data.length);
    expect(json.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(await readFile(path.join(dir, "uploads", "test.bin"), "utf8")).toBe("hello evidence");
  });
  it("rejects path tricks in the key", async () => {
    const { api } = await makeApi();
    const res = await api.request("/api/v1/dev/uploads/..%2Fx", { method: "PUT", body: "x" });
    expect(res.status).toBe(400);
  });
  it("is hidden when dev tools are off", async () => {
    const { api } = await makeApi(false);
    expect((await api.request("/api/v1/dev/uploads/a.bin", { method: "PUT", body: "x" })).status).toBe(404);
  });
});
