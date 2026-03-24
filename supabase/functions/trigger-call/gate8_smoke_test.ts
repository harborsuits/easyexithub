/**
 * Gate 8 Smoke Test — Dialing Hours Logic
 * Tests the Intl.DateTimeFormat hour12:false parsing
 * Run: deno run gate8_smoke_test.ts
 */

// Replicate the exact Gate 8 logic from index.ts
function getLocalHour(tz: string, date: Date): number {
  const localHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return parseInt(localHourStr, 10);
}

function isDialingAllowed(tz: string | null, date: Date): { allowed: boolean; localHour: number; tz: string } {
  const effectiveTz = tz || "America/New_York";
  const localHour = getLocalHour(effectiveTz, date);
  const allowed = localHour >= 9 && localHour < 20;
  return { allowed, localHour, tz: effectiveTz };
}

// ---- Test Cases ----

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("\n=== Gate 8 Smoke Test: Dialing Hours ===\n");

// Use a fixed reference time: 2026-03-22 18:00 UTC (2:00 PM ET)
const refUTC = new Date("2026-03-22T18:00:00Z");

console.log(`Reference time: ${refUTC.toISOString()} (UTC)`);
console.log();

// Test 1: America/New_York at 2:00 PM → allowed
test("ET at 2:00 PM → allowed", () => {
  const r = isDialingAllowed("America/New_York", refUTC);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 14, `expected hour 14, got ${r.localHour}`);
  assert(r.allowed === true, `expected allowed=true`);
});

// Test 2: America/Los_Angeles at 11:00 AM (same UTC) → but Ben's test says 7:00 AM blocked
// At 18:00 UTC, LA is 11:00 AM (PDT, UTC-7). That's allowed.
// To test 7:00 AM LA, we need 14:00 UTC
const utc14 = new Date("2026-03-22T14:00:00Z");
test("LA at 7:00 AM → blocked", () => {
  const r = isDialingAllowed("America/Los_Angeles", utc14);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 7, `expected hour 7, got ${r.localHour}`);
  assert(r.allowed === false, `expected allowed=false`);
});

// Test 3: America/Chicago at 8:30 PM → blocked
// Chicago = UTC-5 (CDT). 8:30 PM CDT = 01:30 UTC next day
const utcChicago2030 = new Date("2026-03-23T01:30:00Z");
test("Chicago at 8:30 PM → blocked", () => {
  const r = isDialingAllowed("America/Chicago", utcChicago2030);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 20, `expected hour 20, got ${r.localHour}`);
  assert(r.allowed === false, `expected allowed=false (hour >= 20)`);
});

// Test 4: null timezone → falls back to America/New_York
test("null timezone → defaults to ET", () => {
  const r = isDialingAllowed(null, refUTC);
  console.log(`    tz=${r.tz}, localHour=${r.localHour}`);
  assert(r.tz === "America/New_York", `expected fallback to ET`);
  assert(r.localHour === 14, `expected hour 14, got ${r.localHour}`);
  assert(r.allowed === true, `expected allowed=true`);
});

// REGRESSION: "1:00:00 PM" must NOT parse as hour 1
// The old bug: toLocaleString with 12h format → "1:00:00 PM" → parseInt → 1
// With hour12:false, 1 PM should be 13
console.log();
console.log("--- Regression: 12h parsing bug ---");
const utc1pm_et = new Date("2026-03-22T17:00:00Z"); // 1:00 PM ET
test("REGRESSION: 1:00 PM ET must be hour 13, not hour 1", () => {
  const r = isDialingAllowed("America/New_York", utc1pm_et);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 13, `expected hour 13, got ${r.localHour} — 12h PARSING BUG!`);
  assert(r.allowed === true, `expected allowed=true`);
});

// Extra: verify midnight (12 AM) is 0, not 12
const utcMidnightET = new Date("2026-03-22T04:00:00Z"); // midnight ET = 04:00 UTC
test("REGRESSION: 12:00 AM (midnight) ET must be hour 0, not 12", () => {
  const r = isDialingAllowed("America/New_York", utcMidnightET);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 0 || r.localHour === 24, `expected hour 0 or 24, got ${r.localHour}`);
  assert(r.allowed === false, `expected blocked at midnight`);
});

// Extra: noon (12 PM) should be 12
const utcNoonET = new Date("2026-03-22T16:00:00Z"); // noon ET = 16:00 UTC
test("REGRESSION: 12:00 PM (noon) ET must be hour 12, not 0", () => {
  const r = isDialingAllowed("America/New_York", utcNoonET);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 12, `expected hour 12, got ${r.localHour}`);
  assert(r.allowed === true, `expected allowed=true at noon`);
});

// Edge: 8:59 AM → blocked, 9:00 AM → allowed
const utc859amET = new Date("2026-03-22T12:59:00Z"); // 8:59 AM ET
test("8:59 AM ET → blocked", () => {
  const r = isDialingAllowed("America/New_York", utc859amET);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 8, `expected hour 8, got ${r.localHour}`);
  assert(r.allowed === false, `expected blocked before 9`);
});

const utc900amET = new Date("2026-03-22T13:00:00Z"); // 9:00 AM ET
test("9:00 AM ET → allowed", () => {
  const r = isDialingAllowed("America/New_York", utc900amET);
  console.log(`    localHour=${r.localHour}`);
  assert(r.localHour === 9, `expected hour 9, got ${r.localHour}`);
  assert(r.allowed === true, `expected allowed at 9`);
});

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) Deno.exit(1);
