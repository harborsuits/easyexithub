import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EE_URL = "https://bgznglzzknmetzpwkbbz.supabase.co";
const EE_KEY = Deno.env.get("EASYEXIT_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "POST/GET only" }, 405);
  }

  try {
    const ee = createClient(EE_URL, EE_KEY);

    // Run both operations
    const [promoted, marked] = await Promise.all([
      promoteFollowUps(ee),
      markMissedFollowUps(ee),
    ]);

    return json({
      ok: true,
      timestamp: new Date().toISOString(),
      promoted: promoted.count,
      promoted_leads: promoted.leads,
      marked_missed: marked.count,
      marked_leads: marked.leads,
    });
  } catch (error) {
    console.error("[ee-engine] Error:", error);
    return json({ error: String(error) }, 500);
  }
});

// =====================================================================
// PROMOTE: Find due follow-ups and bridge to dispatcher
// =====================================================================

async function promoteFollowUps(ee: any) {
  const now = new Date().toISOString();

  // Find all pending/scheduled follow-ups that are due now
  const { data: due, error: queryErr } = await ee
    .from("follow_ups")
    .select("id, lead_id, kind, scheduled_for, priority, reason")
    .in("status", ["pending", "scheduled"])
    .lte("scheduled_for", now)
    .is("dispatcher_lock_until", null)
    .order("priority", { ascending: false })
    .order("scheduled_for", { ascending: true })
    .limit(50);

  if (queryErr) {
    console.error("[ee-engine] Query error:", queryErr);
    return { count: 0, leads: [] };
  }

  if (!due || due.length === 0) {
    console.log("[ee-engine] ✓ No due follow-ups at this moment");
    return { count: 0, leads: [] };
  }

  console.log(`[ee-engine] Found ${due.length} due follow-ups. Processing...`);

  const promoted = [];

  for (const fu of due) {
    try {
      // Lock it
      const { error: lockErr } = await ee
        .from("follow_ups")
        .update({
          status: "processing",
          dispatcher_lock_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min lock
        })
        .eq("id", fu.id);

      if (lockErr) {
        console.warn(`[ee-engine] Lock failed on ${fu.id}: ${lockErr.message}`);
        continue;
      }

      // Bridge to dispatcher: set contact_override_until on the lead
      // This tells the outbound scheduler to pick up this lead immediately
      const { error: bridgeErr } = await ee
        .from("leads")
        .update({
          contact_override_until: fu.scheduled_for,
          next_followup_date: fu.scheduled_for,
        })
        .eq("id", fu.lead_id);

      if (bridgeErr) {
        console.error(`[ee-engine] Bridge error on lead ${fu.lead_id}: ${bridgeErr.message}`);
        continue;
      }

      promoted.push({
        follow_up_id: fu.id,
        lead_id: fu.lead_id,
        kind: fu.kind,
        scheduled_for: fu.scheduled_for,
      });

      console.log(
        `[ee-engine] ✅ Promoted: follow-up ${fu.id} (lead ${fu.lead_id}, ${fu.kind})`
      );
    } catch (e) {
      console.error(`[ee-engine] Exception on ${fu.id}:`, e);
    }
  }

  return { count: promoted.length, leads: promoted };
}

// =====================================================================
// MARK MISSED: Detect follow-ups that passed deadline without execution
// =====================================================================

async function markMissedFollowUps(ee: any) {
  // A follow-up is missed if:
  // - status is pending/scheduled
  // - scheduled_for < now - 2 hours (tolerance window)
  // - missed_at is null (not already marked)

  const tolerance = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: missed, error: queryErr } = await ee
    .from("follow_ups")
    .select("id, lead_id, kind, scheduled_for")
    .in("status", ["pending", "scheduled"])
    .lt("scheduled_for", tolerance)
    .is("missed_at", null)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  if (queryErr) {
    console.error("[ee-engine] Missed query error:", queryErr);
    return { count: 0, leads: [] };
  }

  if (!missed || missed.length === 0) {
    console.log("[ee-engine] ✓ No missed follow-ups detected");
    return { count: 0, leads: [] };
  }

  console.log(`[ee-engine] Found ${missed.length} missed follow-ups. Marking...`);

  const marked = [];

  for (const fu of missed) {
    const { error: updateErr } = await ee
      .from("follow_ups")
      .update({
        status: "missed",
        missed_at: new Date().toISOString(),
      })
      .eq("id", fu.id);

    if (updateErr) {
      console.error(
        `[ee-engine] Failed to mark missed ${fu.id}: ${updateErr.message}`
      );
      continue;
    }

    marked.push({
      follow_up_id: fu.id,
      lead_id: fu.lead_id,
      kind: fu.kind,
      scheduled_for: fu.scheduled_for,
    });

    console.log(
      `[ee-engine] 🔴 Marked missed: follow-up ${fu.id} (was due ${fu.scheduled_for})`
    );
  }

  return { count: marked.length, leads: marked };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
