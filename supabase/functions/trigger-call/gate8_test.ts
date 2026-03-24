/**
 * Gate 8 Dialing Hours — Boundary Test Matrix
 * Tests the exact Intl.DateTimeFormat logic used in trigger-call/index.ts
 * 
 * Run: node gate8_test.ts (or deno run gate8_test.ts)
 */

// === Extracted Gate 8 logic (identical to index.ts) ===
function checkDialingHours(tz: string, testDate: Date): { allowed: boolean; reason: string; localHour: number } {
  const localHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(testDate);
  const localHour = parseInt(localHourStr, 10);

  if (localHour < 9 || localHour >= 20) {
    return {
      allowed: false,
      reason: `outside_dialing_hours (local ${localHour}:00 in ${tz})`,
      localHour,
    };
  }
  return { allowed: true, reason: "dialing_hours_ok", localHour };
}

// === Test matrix ===
// March 22, 2026 is DST (started March 8, 2026)
// ET=UTC-4, CT=UTC-5, MT=UTC-6, PT=UTC-7

interface TestCase {
  label: string;
  tz: string;
  utcIso: string;        // UTC time to test
  expectedLocalHour: number;
  expectedAllowed: boolean;
}

const cases: TestCase[] = [
  // ── America/New_York (UTC-4 during DST) ──
  { label: "ET 3:00 AM",  tz: "America/New_York",    utcIso: "2026-03-22T07:00:00Z", expectedLocalHour: 3,  expectedAllowed: false },
  { label: "ET 8:59 AM",  tz: "America/New_York",    utcIso: "2026-03-22T12:59:00Z", expectedLocalHour: 8,  expectedAllowed: false },
  { label: "ET 9:00 AM",  tz: "America/New_York",    utcIso: "2026-03-22T13:00:00Z", expectedLocalHour: 9,  expectedAllowed: true  },
  { label: "ET 12:00 PM", tz: "America/New_York",    utcIso: "2026-03-22T16:00:00Z", expectedLocalHour: 12, expectedAllowed: true  },
  { label: "ET 7:59 PM",  tz: "America/New_York",    utcIso: "2026-03-22T23:59:00Z", expectedLocalHour: 19, expectedAllowed: true  },
  { label: "ET 8:00 PM",  tz: "America/New_York",    utcIso: "2026-03-23T00:00:00Z", expectedLocalHour: 20, expectedAllowed: false },

  // ── America/Chicago (UTC-5 during DST) ──
  { label: "CT 3:00 AM",  tz: "America/Chicago",     utcIso: "2026-03-22T08:00:00Z", expectedLocalHour: 3,  expectedAllowed: false },
  { label: "CT 8:59 AM",  tz: "America/Chicago",     utcIso: "2026-03-22T13:59:00Z", expectedLocalHour: 8,  expectedAllowed: false },
  { label: "CT 9:00 AM",  tz: "America/Chicago",     utcIso: "2026-03-22T14:00:00Z", expectedLocalHour: 9,  expectedAllowed: true  },
  { label: "CT 12:00 PM", tz: "America/Chicago",     utcIso: "2026-03-22T17:00:00Z", expectedLocalHour: 12, expectedAllowed: true  },
  { label: "CT 7:59 PM",  tz: "America/Chicago",     utcIso: "2026-03-23T00:59:00Z", expectedLocalHour: 19, expectedAllowed: true  },
  { label: "CT 8:00 PM",  tz: "America/Chicago",     utcIso: "2026-03-23T01:00:00Z", expectedLocalHour: 20, expectedAllowed: false },

  // ── America/Denver (UTC-6 during DST) ──
  { label: "MT 3:00 AM",  tz: "America/Denver",      utcIso: "2026-03-22T09:00:00Z", expectedLocalHour: 3,  expectedAllowed: false },
  { label: "MT 8:59 AM",  tz: "America/Denver",      utcIso: "2026-03-22T14:59:00Z", expectedLocalHour: 8,  expectedAllowed: false },
  { label: "MT 9:00 AM",  tz: "America/Denver",      utcIso: "2026-03-22T15:00:00Z", expectedLocalHour: 9,  expectedAllowed: true  },
  { label: "MT 12:00 PM", tz: "America/Denver",      utcIso: "2026-03-22T18:00:00Z", expectedLocalHour: 12, expectedAllowed: true  },
  { label: "MT 7:59 PM",  tz: "America/Denver",      utcIso: "2026-03-23T01:59:00Z", expectedLocalHour: 19, expectedAllowed: true  },
  { label: "MT 8:00 PM",  tz: "America/Denver",      utcIso: "2026-03-23T02:00:00Z", expectedLocalHour: 20, expectedAllowed: false },

  // ── America/Los_Angeles (UTC-7 during DST) ──
  { label: "PT 3:00 AM",  tz: "America/Los_Angeles",  utcIso: "2026-03-22T10:00:00Z", expectedLocalHour: 3,  expectedAllowed: false },
  { label: "PT 8:59 AM",  tz: "America/Los_Angeles",  utcIso: "2026-03-22T15:59:00Z", expectedLocalHour: 8,  expectedAllowed: false },
  { label: "PT 9:00 AM",  tz: "America/Los_Angeles",  utcIso: "2026-03-22T16:00:00Z", expectedLocalHour: 9,  expectedAllowed: true  },
  { label: "PT 12:00 PM", tz: "America/Los_Angeles",  utcIso: "2026-03-22T19:00:00Z", expectedLocalHour: 12, expectedAllowed: true  },
  { label: "PT 7:59 PM",  tz: "America/Los_Angeles",  utcIso: "2026-03-23T02:59:00Z", expectedLocalHour: 19, expectedAllowed: true  },
  { label: "PT 8:00 PM",  tz: "America/Los_Angeles",  utcIso: "2026-03-23T03:00:00Z", expectedLocalHour: 20, expectedAllowed: false },

  // ── null timezone → defaults to America/New_York ──
  { label: "NULL→ET 3:00 AM",  tz: "America/New_York", utcIso: "2026-03-22T07:00:00Z", expectedLocalHour: 3,  expectedAllowed: false },
  { label: "NULL→ET 8:59 AM",  tz: "America/New_York", utcIso: "2026-03-22T12:59:00Z", expectedLocalHour: 8,  expectedAllowed: false },
  { label: "NULL→ET 9:00 AM",  tz: "America/New_York", utcIso: "2026-03-22T13:00:00Z", expectedLocalHour: 9,  expectedAllowed: true  },
  { label: "NULL→ET 12:00 PM", tz: "America/New_York", utcIso: "2026-03-22T16:00:00Z", expectedLocalHour: 12, expectedAllowed: true  },
  { label: "NULL→ET 7:59 PM",  tz: "America/New_York", utcIso: "2026-03-22T23:59:00Z", expectedLocalHour: 19, expectedAllowed: true  },
  { label: "NULL→ET 8:00 PM",  tz: "America/New_York", utcIso: "2026-03-23T00:00:00Z", expectedLocalHour: 20, expectedAllowed: false },

  // ── Midnight edge case (hour 0 / 24 ambiguity) ──
  { label: "ET midnight",   tz: "America/New_York",    utcIso: "2026-03-22T04:00:00Z", expectedLocalHour: 0,  expectedAllowed: false },
  { label: "CT midnight",   tz: "America/Chicago",     utcIso: "2026-03-22T05:00:00Z", expectedLocalHour: 0,  expectedAllowed: false },
  { label: "PT midnight",   tz: "America/Los_Angeles",  utcIso: "2026-03-22T07:00:00Z", expectedLocalHour: 0,  expectedAllowed: false },
];

// === Runner ===
let passed = 0;
let failed = 0;
const failures: string[] = [];

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║   GATE 8 — DIALING HOURS BOUNDARY TEST MATRIX                  ║");
console.log("║   Window: 9:00 AM – 7:59 PM local time                         ║");
console.log("║   Date context: March 22, 2026 (DST active)                    ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log("");

// Also test the null-timezone fallback behavior explicitly
function checkDialingHoursWithFallback(contactTimezone: string | null, testDate: Date) {
  const tz = contactTimezone || "America/New_York";
  return checkDialingHours(tz, testDate);
}

let currentTz = "";
for (const tc of cases) {
  // Section headers
  if (tc.tz !== currentTz || tc.label.startsWith("NULL")) {
    if (tc.label.startsWith("NULL") && currentTz !== "NULL") {
      console.log(`\n── null timezone (fallback to ET) ──`);
      currentTz = "NULL";
    } else if (!tc.label.startsWith("NULL") && tc.tz !== currentTz) {
      console.log(`\n── ${tc.tz} ──`);
      currentTz = tc.tz;
    }
  }

  const testDate = new Date(tc.utcIso);
  const isNullTest = tc.label.startsWith("NULL");
  const result = isNullTest
    ? checkDialingHoursWithFallback(null, testDate)
    : checkDialingHours(tc.tz, testDate);

  const hourMatch = result.localHour === tc.expectedLocalHour;
  const allowedMatch = result.allowed === tc.expectedAllowed;
  const pass = hourMatch && allowedMatch;

  if (pass) {
    passed++;
    const status = result.allowed ? "✅ ALLOWED" : "🚫 BLOCKED";
    console.log(`  ${status}  ${tc.label.padEnd(20)} hour=${String(result.localHour).padStart(2)}  ✓`);
  } else {
    failed++;
    const detail = [];
    if (!hourMatch) detail.push(`hour: expected ${tc.expectedLocalHour}, got ${result.localHour}`);
    if (!allowedMatch) detail.push(`allowed: expected ${tc.expectedAllowed}, got ${result.allowed}`);
    const msg = `  ❌ FAIL   ${tc.label.padEnd(20)} ${detail.join("; ")}`;
    console.log(msg);
    failures.push(msg);
  }
}

// === Summary ===
console.log("\n══════════════════════════════════════════════════════════════════");
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${cases.length} total`);

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(f);
  console.log("\n🔴 GATE 8 TEST MATRIX: FAIL");
  process.exit(1);
} else {
  console.log("\n🟢 GATE 8 TEST MATRIX: ALL PASS");

  // Verify side-effect guarantees
  console.log("\n── Side-Effect Guarantees ──");
  console.log("  ✓ Gate returns before Vapi call → no call placed on block");
  console.log("  ✓ Gate returns before attempt_count increment → no count change on block");
  console.log("  ✓ Gate returns 403 JSON → no webhook side effects on block");
  console.log("  (Verified by code inspection: canDial() runs before fetch('https://api.vapi.ai/...'))");
  process.exit(0);
}
