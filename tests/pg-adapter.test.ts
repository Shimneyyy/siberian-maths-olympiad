import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";

const config = { connectionString: process.env.DATABASE_URL, max: 2 };

test("concurrent adapter queries use one transaction without pg queue warnings", async () => {
  const warnings: Error[] = [];
  const record = (warning: Error) => { if (warning.message.includes("Calling client.query()")) warnings.push(warning); };
  process.on("warning", record);
  const adapter = await new PrismaPg(config).connect();
  const tx = await adapter.startTransaction();
  try {
    // Exercise the same parallel adapter calls made by Prisma's relation loader.
    const rows = await Promise.all(Array.from({ length: 8 }, (_, index) => tx.queryRaw({ sql: `SELECT ${index}::int AS value FROM pg_sleep(0.01)`, args: [], argTypes: [] })));
    assert.deepEqual(rows.map(row => row.rows[0][0]), [0, 1, 2, 3, 4, 5, 6, 7]);
    await setImmediate();
    assert.equal(warnings.length, 0, "Concurrent relation queries must not enter pg's deprecated connection queue");
  } finally {
    await tx.executeRaw({ sql: "ROLLBACK", args: [], argTypes: [] });
    await tx.rollback(); await adapter.dispose(); process.off("warning", record);
  }
});

test("failed concurrent SQL rolls back and leaves the pooled connection usable", async () => {
  const db = new PrismaClient({ adapter: new PrismaPg(config) });
  try {
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRaw`CREATE TEMP TABLE synthetic_queue_rollback (value int) ON COMMIT DROP`;
      await Promise.all([tx.$executeRaw`INSERT INTO synthetic_queue_rollback VALUES (1)`, tx.$queryRaw`SELECT 1 / 0`, tx.$queryRaw`SELECT 2`]);
    }));
    assert.deepEqual(await db.$queryRaw`SELECT 1::int AS value`, [{ value: 1 }]);
  } finally { await db.$disconnect(); }
});

test("independent transactions retain separate connections and can make progress together", { timeout: 10000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg(config) });
  let entered = 0, release!: () => void;
  const bothEntered = new Promise<void>(resolve => { release = resolve; });
  try {
    await Promise.all([0, 1].map(value => db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1`;
      if (++entered === 2) release();
      await bothEntered;
      return tx.$queryRaw`SELECT ${value}::int AS value`;
    })));
    assert.equal(entered, 2);
  } finally { await db.$disconnect(); }
});
