import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { serializeSignedCookie } from "better-call";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const base = process.env.TEST_BASE_URL!;
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname) || !/^\/smo_test_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Disposable local load database required");
test("F03 5000 participants per year, 200 active sessions: scoped HTTP, attendance visibility and revocation", { timeout: 180000 }, async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const uni = await db.university.findFirstOrThrow(), course = await db.courseOption.findFirstOrThrow();
    const editions: { id: string }[] = []; for (const year of [9600, 9601]) editions.push(await db.olympiadEdition.create({ data: { year, title: "Учебная нагрузка" } }));
    const venue = await db.venue.create({ data: { name: "Учебная нагрузочная площадка" } });
    const site = await db.editionVenue.create({ data: { editionId: editions[0].id, venueId: venue.id, address: "Учебный адрес" } });
    const foreign = await db.editionVenue.create({ data: { edition: { connect: { id: editions[0].id } }, venue: { create: { name: "Другая учебная площадка" } }, address: "Другой учебный адрес" } });
    const people = Array.from({ length: 5000 }, (_, i) => ({ id: randomUUID(), email: `load-${i}-${randomUUID()}@example.test`, name: `Учебный участник ${String(i).padStart(4, "0")}`, emailVerified: true }));
    for (let offset = 0; offset < people.length; offset += 500) {
      const chunk = people.slice(offset, offset + 500); await db.user.createMany({ data: chunk });
      const consents = chunk.map(u => ({ id: randomUUID(), userId: u.id, purpose: "synthetic-demo-only", textVersion: "demo", textHash: "a".repeat(64) }));
      await db.consentRecord.createMany({ data: consents });
      for (const edition of editions) await db.participation.createMany({ data: chunk.map((u, i) => ({ editionId: edition.id, userId: u.id, format: edition.id === editions[0].id ? "ONSITE" as const : "REMOTE" as const, remoteZone: edition.id === editions[1].id ? "NSK" as const : null, editionVenueId: edition.id === editions[0].id ? (offset + i === 4999 ? foreign.id : site.id) : null, fullName: u.name, universityId: uni.id, universityName: uni.name, universityAbbreviation: uni.abbreviation, courseId: course.id, courseLabel: course.label, consentId: consents[i].id })) });
    }
    const staff = Array.from({ length: 100 }, () => ({ id: randomUUID(), email: `staff-${randomUUID()}@example.test`, name: "Учебный организатор нагрузки", role: "VENUE_ORGANIZER" as const, emailVerified: true }));
    await db.user.createMany({ data: staff });
    await db.venueStaffAssignment.createMany({ data: staff.map(u => ({ userId: u.id, editionId: editions[0].id, editionVenueId: site.id })) });
    const sessions = [...staff, ...people.slice(0, 100)].map(u => ({ userId: u.id, token: randomUUID() + randomUUID(), expiresAt: new Date(Date.now() + 3600000) }));
    await db.session.createMany({ data: sessions });
    // Model already authenticated sessions. Login/scrypt capacity is a separate workload.
    const cookies = await Promise.all(sessions.map(async s => (await serializeSignedCookie("better-auth.session_token", s.token, process.env.BETTER_AUTH_SECRET!)).split(";")[0]));
    const call = async (i: number) => {
      const started = performance.now();
      const response = await fetch(`${base}${i < 100 ? "/api/registrations/search" : "/api/participations"}`, { method: i < 100 ? "POST" : "GET", headers: { Cookie: cookies[i], Origin: base, ...(i < 100 ? { "Content-Type": "application/json" } : {}) }, ...(i < 100 ? { body: JSON.stringify({ editionId: editions[0].id, pageSize: 25 }) } : {}), signal: AbortSignal.timeout(i < 100 ? 4000 : 30000) });
      assert.equal(response.status, 200, `Synthetic ${i < 100 ? "roster" : "history"} status after ${Math.round(performance.now() - started)} ms`); assert.ok(response.headers.get("cache-control")?.includes("no-store"));
      const value = await response.json();
      if (i < 100) { assert.equal(value.total, 4999); assert.ok(!JSON.stringify(value).includes(people[4999].email)); }
      else { assert.equal(value.participations.length, 2); assert.ok(value.participations.every((p: { fullName: string }) => p.fullName === people[i - 100].name)); }
      return { elapsed: performance.now() - started, value };
    };
    // Warm route compilation separately from the measured workload.
    await call(0); await call(100);
    const latencies: number[] = []; const loadStart = performance.now();
    for (let wave = 0; wave < 3; wave++) {
      const start = performance.now(); const values = await Promise.all(cookies.map((_, i) => call(i)));
      latencies.push(...values.map(v => v.elapsed));
      if (wave < 2) await delay(Math.max(0, 5000 - (performance.now() - start)));
    }
    const p = await db.participation.findUniqueOrThrow({ where: { userId_editionId: { userId: people[0].id, editionId: editions[0].id } } });
    const changed = performance.now();
    const response = await fetch(`${base}/api/attendance`, { method: "POST", headers: { Cookie: cookies[1], Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ editionId: editions[0].id, participationId: p.id, revision: 0, status: "PRESENT" }) });
    assert.equal(response.status, 200);
    const loaded = await Promise.all(cookies.map((_, i) => call(i)));
    const visible = loaded[0].value.rows.find((r: { id: string }) => r.id === p.id);
    assert.equal(visible?.attendance.status, "PRESENT"); assert.ok(performance.now() - changed < 10000, "Attendance visible during 200-session wave within ten seconds");
    await db.venueStaffAssignment.updateMany({ where: { userId: staff[0].id }, data: { revokedAt: new Date() } });
    const denied = await fetch(`${base}/api/registrations/search`, { method: "POST", headers: { Cookie: cookies[0], Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ editionId: editions[0].id }) }); assert.equal(denied.status, 403);
    await db.session.deleteMany({ where: { userId: people[0].id } }); assert.equal((await fetch(`${base}/api/participations`, { headers: { Cookie: cookies[100] } })).status, 401);
    latencies.sort((a,b) => a-b); const percentile = (p: number) => Math.round(latencies[Math.ceil(latencies.length * p) - 1]);
    console.info(JSON.stringify({ synthetic: true, participantsPerYear: 5000, years: 2, activeSessions: 200, measuredRequests: latencies.length, failures: 0, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: Math.round(latencies.at(-1)!), measuredDurationMs: Math.round(performance.now() - loadStart) }));
  } finally { await db.$disconnect(); }
});
