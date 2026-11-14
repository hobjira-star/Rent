import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import {
  DEFAULT_POLICY,
  Fulfilment,
  Tier,
  bandOf,
  checkExposure,
  checkFulfilment,
  lateFeePerDay,
  quoteDeposit,
  type Policy,
} from "@rent/domain";
import { type FileStore, LocalFileStore, TooLargeError } from "./storage";

export interface ApiDeps {
  policy: Policy;
  store: FileStore;
  devToolsEnabled: boolean;
  dataDir: string;
}

const QuoteBody = z.object({
  agreedValue: z.number().int().positive(),
  rent: z.number().int().nonnegative(),
  rentalDays: z.number().int().positive().default(4),
  tier: Tier,
  bestCompletedBand: z.enum(["A", "B", "C"]).nullable().optional(),
  age: z.number().int().nullable().optional(),
  newDeliveryAddress: z.boolean().optional(),
  fulfilment: Fulfilment.default("PICKUP"),
  hasEkyc: z.boolean().default(false),
  clusterOpen: z
    .array(z.object({ agreedValue: z.number().int(), deposit: z.number().int(), band: z.enum(["A", "B", "C"]) }))
    .default([]),
});

const MAX_UPLOAD = 300 * 1024 * 1024;

export function createApi(deps: ApiDeps) {
  const app = new Hono().basePath("/api/v1");

  app.get("/health", (c) => c.json({ ok: true, policyVersion: deps.policy.version }));

  /** Price and deposit preview. Pure: uses the domain package only. */
  app.post("/quote", async (c) => {
    const parsed = QuoteBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_BODY", issues: parsed.error.issues }, 400);
    const b = parsed.data;
    const p = deps.policy;
    const band = bandOf(b.agreedValue, p);
    const fulfilment = checkFulfilment(b.fulfilment, band, b.tier, b.hasEkyc, p);
    if (!fulfilment.ok) return c.json({ error: fulfilment.reason }, 422);
    const quote = quoteDeposit(
      {
        agreedValue: b.agreedValue,
        rent: b.rent,
        tier: b.tier,
        bestCompletedBand: b.bestCompletedBand ?? null,
        age: b.age ?? null,
        newDeliveryAddress: b.newDeliveryAddress ?? false,
      },
      p,
    );
    const exposure = checkExposure(
      { tier: b.tier, clusterOpen: b.clusterOpen, candidate: { agreedValue: b.agreedValue, deposit: quote.amount, band } },
      p,
    );
    if (!exposure.ok) return c.json({ error: exposure.reason }, 422);
    return c.json({
      band,
      rent: b.rent,
      deposit: exposure.deposit,
      depositRate: quote.rate,
      reasons: [...quote.reasons, ...("reason" in exposure ? [exposure.reason] : [])],
      payToday: b.rent + exposure.deposit,
      lateFeePerDay: lateFeePerDay(b.rent, b.rentalDays, p),
    });
  });

  // ------------------------------------------------------------ development tools (phase ก capture test)
  const dev = new Hono();
  dev.use("*", async (c, next) => {
    if (!deps.devToolsEnabled) return c.json({ error: "NOT_FOUND" }, 404);
    await next();
  });

  dev.put("/uploads/:key", async (c) => {
    const body = c.req.raw.body;
    if (!body) return c.json({ error: "EMPTY_BODY" }, 400);
    const started = Date.now();
    try {
      const obj = await deps.store.put(c.req.param("key"), body, MAX_UPLOAD);
      return c.json({ ...obj, serverMs: Date.now() - started });
    } catch (e) {
      if (e instanceof TooLargeError) return c.json({ error: "TOO_LARGE" }, 413);
      if (e instanceof RangeError) return c.json({ error: "INVALID_KEY" }, 400);
      throw e;
    }
  });

  dev.post("/capture-reports", async (c) => {
    const report = await c.req.json().catch(() => null);
    if (!report || typeof report !== "object") return c.json({ error: "INVALID_BODY" }, 400);
    await mkdir(deps.dataDir, { recursive: true });
    const line = JSON.stringify({ receivedAt: new Date().toISOString(), ua: c.req.header("user-agent"), report });
    await appendFile(path.join(deps.dataDir, "capture-reports.jsonl"), `${line}\n`);
    return c.json({ ok: true });
  });

  app.route("/dev", dev);
  return app;
}

const dataDir = process.env.RENT_DATA_DIR ?? path.join(process.cwd(), ".data");

export const api = createApi({
  policy: DEFAULT_POLICY,
  store: new LocalFileStore(path.join(dataDir, "uploads")),
  devToolsEnabled: process.env.RENT_DEV_TOOLS === "1" || process.env.NODE_ENV !== "production",
  dataDir,
});
