import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EE_URL = "https://bgznglzzknmetzpwkbbz.supabase.co";
const EE_KEY = Deno.env.get("EASYEXIT_SERVICE_ROLE_KEY")!;

// Throttle: max calls per 5-minute engine run
const MAX_CALLS_PER_RUN = 10;

// Call window: only place calls during these hours (ET)
// 10:30-12:00 and 16:30-18:30 (optimal dialing windows)
function isInCallWindow(): boolean {
  const now = new Date();
  // Convert to ET (UTC-4 in EDT, UTC-5 in EST)
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMin = now.getUTCMinutes();
  const timeDecimal = etHour + etMin / 60;

  // Window 1: 10:30-12:00
  if (timeDecimal >= 10.5 && timeDecimal < 12) return true;
  // Window 2: 16:30-18:30
  if (timeDecimal >= 16.5 && timeDecimal < 18.5) return true;

  return false;
}

function isDST(date: Date): boolean {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const stdOffset = Math.max(jan, jul);
  // This is a rough check; works for US timezones
  return date.getTimezoneOffset() < stdOffset;
}

serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "POST/GET only" }, 405);
  }

  try {
    const ee = createClient(EE_URL, EE_KEY);
    const callWindowOpen = isInCallWindow();

    // Run promotion + missed marking in parallel
    const [promoted, marked] = await Promise.all([
      promoteAndDial(ee, callWindowOpen),
      markMissedFollowUps(ee),
    ]);

    return json({
      ok: true,
      timestamp: new Date().toISOString(),
      call_window_open: callWindowOpen,
      promoted: promoted.promotedCount,
      dialed: promoted.dialedCount,
      dial_results: promoted.dialResults,
      marked_missed: marked.count,
      marked_leads: marked.leads,
    });
  } catch (error) {
    console.error("[ee-engine] Error:", error);
    return json({ error: String(error) }, 500);
  }
});

// =====================================================================
// PROMOTE AND DIAL: Find due follow-ups, promote, then invoke dispatcher
// =====================================================================

async function promoteAndDial(ee: any, callWindowOpen: boolean) {
  const now = new Date().toISOString();

  // Find pending follow-ups that are due
  const { data: due, error: queryErr } = await ee
    .from("follow_ups")
    .select("id, lead_id, kind, scheduled_for, priority, reason")
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .is("dispatcher_lock_until", null)
    .order("priority", { ascending: false })
    .order("scheduled_for", { ascending: true })
    .limit(MAX_CALLS_PER_RUN);

  if (queryErr) {
    console.error("[ee-engine] Query error:", queryErr);
    return { promotedCount: 0, dialedCount: 0, dialResults: [] };
  }

  if (!due || due.length === 0) {
    console.log("[ee-engine] ✓ No due follow-ups");
    return { promotedCount: 0, dialedCount: 0, dialResults: [] };
  }

  console.log(`[ee-engine] Found ${due.length} due follow-ups. Call window: ${callWindowOpen ? "OPEN" : "CLOSED"}`);

  let promotedCount = 0;
  let dialedCount = 0;
  const dialResults: any[] = [];

  for (const fu of due) {
    try {
      // Step 1: Lock the follow-up → "dialing" status
      const { error: lockErr } = await ee
        .from("follow_ups")
        .update({
          status: "dialing",
          dispatcher_lock_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          last_attempted_at: new Date().toISOString(),
        })
        .eq("id", fu.id)
        .eq("status", "pending"); // Atomic: only if still pending

      if (lockErr) {
        console.warn(`[ee-engine] Lock failed on FU ${fu.id}: ${lockErr.message}`);
        continue;
      }

      // Step 2: Update lead's follow-up fields
      const { error: bridgeErr } = await ee
        .from("leads")
        .update({
          contact_override_until: fu.scheduled_for,
          next_followup_date: fu.scheduled_for,
        })
        .eq("id", fu.lead_id);

      if (bridgeErr) {
        console.error(`[ee-engine] Bridge error on lead ${fu.lead_id}: ${bridgeErr.message}`);
        await ee.from("follow_ups").update({
          status: "failed",
          notes: `Bridge error: ${bridgeErr.message}`,
          dispatcher_lock_until: null,
        }).eq("id", fu.id);
        continue;
      }

      promotedCount++;

      // Step 3: If call window is open, invoke trigger-call dispatcher
      if (!callWindowOpen) {
        // Outside call window — leave as "dialing" so next window picks it up
        // Actually, revert to pending so it re-enters the queue next window
        await ee.from("follow_ups").update({
          status: "pending",
          dispatcher_lock_until: null,
          notes: `Promoted but outside call window. Will retry next window.`,
        }).eq("id", fu.id);

        dialResults.push({
          follow_up_id: fu.id,
          lead_id: fu.lead_id,
          kind: fu.kind,
          result: "outside_call_window",
        });
        console.log(`[ee-engine] ⏸️ FU ${fu.id} (lead ${fu.lead_id}) — outside call window, deferred`);
        continue;
      }

      // DIAL: Call the trigger-call edge function
      const dialResult = await dialLead(fu.lead_id, fu.id);

      if (dialResult.ok) {
        // Call placed — mark as "scheduled" (webhook will complete it)
        await ee.from("follow_ups").update({
          status: "scheduled",
          dispatcher_lock_until: null,
          notes: `Call placed: ${dialResult.call_id}`,
        }).eq("id", fu.id);

        dialedCount++;
        dialResults.push({
          follow_up_id: fu.id,
          lead_id: fu.lead_id,
          kind: fu.kind,
          result: "dialed",
          call_id: dialResult.call_id,
        });
        console.log(`[ee-engine] 📞 DIALED: FU ${fu.id} → lead ${fu.lead_id} → call ${dialResult.call_id}`);
      } else {
        // Dispatcher blocked the call (gate rejection) or error
        const isGateBlock = dialResult.status === 403;

        await ee.from("follow_ups").update({
          status: isGateBlock ? "canceled" : "failed",
          dispatcher_lock_until: null,
          notes: `Dispatcher: ${dialResult.reason || dialResult.error || "unknown"}`,
          ...(isGateBlock ? { canceled_at: new Date().toISOString() } : {}),
        }).eq("id", fu.id);

        dialResults.push({
          follow_up_id: fu.id,
          lead_id: fu.lead_id,
          kind: fu.kind,
          result: isGateBlock ? "gate_blocked" : "dial_error",
          reason: dialResult.reason || dialResult.error,
        });
        console.log(`[ee-engine] ${isGateBlock ? "🚫" : "❌"} FU ${fu.id} → lead ${fu.lead_id}: ${dialResult.reason || dialResult.error}`);
      }
    } catch (e) {
      console.error(`[ee-engine] Exception on FU ${fu.id}:`, e);
      // Unlock on exception
      await ee.from("follow_ups").update({
        status: "failed",
        dispatcher_lock_until: null,
        notes: `Exception: ${String(e)}`,
      }).eq("id", fu.id);
    }
  }

  return { promotedCount, dialedCount, dialResults };
}

// =====================================================================
// DIAL LEAD: Invoke the trigger-call edge function
// =====================================================================

async function dialLead(leadId: number, followUpId: number): Promise<any> {
  try {
    const res = await fetch(`${EE_URL}/functions/v1/trigger-call`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${EE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lead_id: leadId }),
    });

    const data = await res.json();

    if (res.ok) {
      return { ok: true, call_id: data.call_id || data.vapi_data?.id || "unknown", status: res.status };
    } else {
      return { ok: false, status: res.status, reason: data.reason || data.error, error: data.error };
    }
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

// =====================================================================
// MARK MISSED: Detect follow-ups that passed deadline without execution
// =====================================================================

async function markMissedFollowUps(ee: any) {
  const tolerance = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: missed, error: queryErr } = await ee
    .from("follow_ups")
    .select("id, lead_id, kind, scheduled_for")
    .eq("status", "pending")
    .lt("scheduled_for", tolerance)
    .is("missed_at", null)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  if (queryErr) {
    console.error("[ee-engine] Missed query error:", queryErr);
    return { count: 0, leads: [] };
  }

  if (!missed || missed.length === 0) {
    console.log("[ee-engine] ✓ No missed follow-ups");
    return { count: 0, leads: [] };
  }

  console.log(`[ee-engine] Found ${missed.length} missed follow-ups`);
  const marked = [];

  for (const fu of missed) {
    const { error: updateErr } = await ee
      .from("follow_ups")
      .update({ status: "missed", missed_at: new Date().toISOString() })
      .eq("id", fu.id);

    if (updateErr) {
      console.error(`[ee-engine] Mark missed failed ${fu.id}: ${updateErr.message}`);
      continue;
    }

    marked.push({
      follow_up_id: fu.id,
      lead_id: fu.lead_id,
      kind: fu.kind,
      scheduled_for: fu.scheduled_for,
    });
    console.log(`[ee-engine] 🔴 Missed: FU ${fu.id} (was due ${fu.scheduled_for})`);
  }

  return { count: marked.length, leads: marked };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
