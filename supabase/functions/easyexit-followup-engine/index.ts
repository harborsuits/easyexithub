import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EE_URL = "https://bgznglzzknmetzpwkbbz.supabase.co";
const EE_KEY = Deno.env.get("EASYEXIT_SERVICE_ROLE_KEY")!;

// Throttle: max calls per 5-minute engine run
const MAX_CALLS_PER_RUN = 10;

// Minimum fresh leads per run (diversity rule)
// At least 40% of each run should be fresh leads if available
const MIN_FRESH_RATIO = 0.4;

// Rolling 7-day max per lead
const ROLLING_7D_MAX = 2;

// Call window: only place calls during these hours (ET)
// 10:30-12:00 and 16:30-18:30 (optimal dialing windows)
function isInCallWindow(): boolean {
  const now = new Date();
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMin = now.getUTCMinutes();
  const timeDecimal = etHour + etMin / 60;

  if (timeDecimal >= 10.5 && timeDecimal < 12) return true;
  if (timeDecimal >= 16.5 && timeDecimal < 18.5) return true;

  return false;
}

function isDST(date: Date): boolean {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const stdOffset = Math.max(jan, jul);
  return date.getTimezoneOffset() < stdOffset;
}

serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "POST/GET only" }, 405);
  }

  try {
    const ee = createClient(EE_URL, EE_KEY);
    const callWindowOpen = isInCallWindow();

    const [promoted, marked] = await Promise.all([
      buildAndDialQueue(ee, callWindowOpen),
      markMissedFollowUps(ee),
    ]);

    return json({
      ok: true,
      timestamp: new Date().toISOString(),
      call_window_open: callWindowOpen,
      queue_breakdown: promoted.breakdown,
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
// QUEUE TYPES — Clean separation
// =====================================================================

interface QueueItem {
  type: "callback" | "fresh" | "retry";
  lead_id: number;
  follow_up_id: number | null;  // null for fresh leads
  kind: string;
  scheduled_for: string | null;
  priority: number;
  reason: string;
}

// =====================================================================
// BUILD AND DIAL QUEUE
//
// Queue priority order (CONTACT_GOVERNANCE_POLICY.md):
//   1. Callbacks due (explicit date reached) — always first
//   2. Fresh callable leads (never contacted) — breadth before depth
//   3. Aged retries that cleared spacing — oldest first
//
// Diversity rule: at least MIN_FRESH_RATIO of each run should be
// fresh leads, if fresh leads are available.
//
// Rolling limit: no lead called more than ROLLING_7D_MAX times in 7 days.
// =====================================================================

async function buildAndDialQueue(ee: any, callWindowOpen: boolean) {
  const now = new Date().toISOString();
  const queue: QueueItem[] = [];

  // ---------------------------------------------------------------
  // SCOPE GUARD: Only process leads with manual_test_approved=true
  // Fetch approved lead IDs upfront to filter all tiers.
  // TEMPORARY — remove when moving to production.
  // ---------------------------------------------------------------
  const { data: approvedLeads, error: approvedErr } = await ee
    .from("leads")
    .select("id")
    .eq("manual_test_approved", true);

  if (approvedErr) {
    console.error("[ee-engine] Scope guard query error:", approvedErr);
    return { breakdown: { callbacks: 0, fresh: 0, retries: 0, total: 0 }, dialedCount: 0, dialResults: [] };
  }

  const approvedIds = new Set((approvedLeads || []).map((l: any) => l.id));
  console.log(`[ee-engine] Scope guard: ${approvedIds.size} leads approved for testing`);

  if (approvedIds.size === 0) {
    console.log("[ee-engine] ⛔ No approved leads — nothing to process");
    return { breakdown: { callbacks: 0, fresh: 0, retries: 0, total: 0 }, dialedCount: 0, dialResults: [] };
  }

  // ---------------------------------------------------------------
  // TIER 1: Due callbacks (follow_ups with kind=callback, due now)
  // ---------------------------------------------------------------
  const { data: callbacks, error: cbErr } = await ee
    .from("follow_ups")
    .select("id, lead_id, kind, scheduled_for, priority, reason")
    .eq("status", "pending")
    .eq("kind", "callback")
    .lte("scheduled_for", now)
    .is("dispatcher_lock_until", null)
    .order("scheduled_for", { ascending: true })
    .limit(MAX_CALLS_PER_RUN);

  if (cbErr) {
    console.error("[ee-engine] Callback query error:", cbErr);
  } else if (callbacks && callbacks.length > 0) {
    for (const cb of callbacks) {
      // Scope guard: skip unapproved leads
      if (!approvedIds.has(cb.lead_id)) continue;
      queue.push({
        type: "callback",
        lead_id: cb.lead_id,
        follow_up_id: cb.id,
        kind: cb.kind,
        scheduled_for: cb.scheduled_for,
        priority: cb.priority || 90,
        reason: cb.reason || "Callback due",
      });
    }
    console.log(`[ee-engine] Tier 1: ${callbacks.length} callbacks due`);
  }

  // ---------------------------------------------------------------
  // TIER 2: Fresh callable leads (never contacted, no follow_ups)
  //
  // Query: qualified leads with outreach_count=0 (or null),
  // callable=true, outbound_approved=true, engagement_level != dead/dnc,
  // and no pending follow_ups.
  // ---------------------------------------------------------------
  const freshBudget = Math.max(
    Math.ceil(MAX_CALLS_PER_RUN * MIN_FRESH_RATIO),
    MAX_CALLS_PER_RUN - queue.length  // Fill remaining with fresh if few callbacks
  );

  const { data: freshLeads, error: freshErr } = await ee
    .from("leads")
    .select("id, owner_name, owner_phone, engagement_level")
    .eq("callable", true)
    .eq("outbound_approved", true)
    .eq("manual_test_approved", true)  // SCOPE GUARD — temporary
    .or("outreach_count.is.null,outreach_count.eq.0")
    .not("engagement_level", "in", "(dead,dnc)")
    .not("owner_phone", "is", null)
    .order("viability_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(freshBudget);

  if (freshErr) {
    console.error("[ee-engine] Fresh leads query error:", freshErr);
  } else if (freshLeads && freshLeads.length > 0) {
    // Filter out any that already have pending follow_ups
    const freshIds = freshLeads.map((l: any) => l.id);
    const { data: existingFUs } = await ee
      .from("follow_ups")
      .select("lead_id")
      .in("lead_id", freshIds)
      .in("status", ["pending", "scheduled", "dialing"]);

    const hasActiveFU = new Set((existingFUs || []).map((f: any) => f.lead_id));

    for (const lead of freshLeads) {
      if (hasActiveFU.has(lead.id)) continue;
      if (!lead.owner_phone || lead.owner_phone.length < 10) continue;

      queue.push({
        type: "fresh",
        lead_id: lead.id,
        follow_up_id: null,
        kind: "cold_outreach",
        scheduled_for: null,
        priority: 70, // Higher than retries, lower than callbacks
        reason: `Fresh lead: ${lead.owner_name} (never contacted)`,
      });
    }
    console.log(`[ee-engine] Tier 2: ${freshLeads.length} fresh leads found, ${queue.filter(q => q.type === "fresh").length} eligible`);
  }

  // ---------------------------------------------------------------
  // TIER 3: Retries (due follow_ups with kind != callback)
  // Only fill remaining budget after callbacks + fresh
  // ---------------------------------------------------------------
  const retryBudget = MAX_CALLS_PER_RUN - queue.length;

  if (retryBudget > 0) {
    const { data: retries, error: retryErr } = await ee
      .from("follow_ups")
      .select("id, lead_id, kind, scheduled_for, priority, reason")
      .eq("status", "pending")
      .neq("kind", "callback")
      .lte("scheduled_for", now)
      .is("dispatcher_lock_until", null)
      .order("scheduled_for", { ascending: true }) // Oldest first
      .limit(retryBudget);

    if (retryErr) {
      console.error("[ee-engine] Retry query error:", retryErr);
    } else if (retries && retries.length > 0) {
      for (const r of retries) {
        // Scope guard: skip unapproved leads
        if (!approvedIds.has(r.lead_id)) continue;
        queue.push({
          type: "retry",
          lead_id: r.lead_id,
          follow_up_id: r.id,
          kind: r.kind,
          scheduled_for: r.scheduled_for,
          priority: r.priority || 40,
          reason: r.reason || "Scheduled retry",
        });
      }
      console.log(`[ee-engine] Tier 3: ${retries.length} retries due`);
    }
  }

  // ---------------------------------------------------------------
  // ROLLING 7-DAY FREQUENCY CHECK
  // Remove any lead that's been called >= ROLLING_7D_MAX in past 7 days
  // ---------------------------------------------------------------
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const leadIds = [...new Set(queue.map(q => q.lead_id))];

  if (leadIds.length > 0) {
    const { data: recentComms } = await ee
      .from("communications")
      .select("lead_id")
      .in("lead_id", leadIds)
      .eq("direction", "outbound")
      .gte("created_at", sevenDaysAgo);

    if (recentComms && recentComms.length > 0) {
      const countByLead: Record<number, number> = {};
      for (const c of recentComms) {
        countByLead[c.lead_id] = (countByLead[c.lead_id] || 0) + 1;
      }

      const beforeCount = queue.length;
      const filtered: QueueItem[] = [];
      for (const item of queue) {
        if ((countByLead[item.lead_id] || 0) >= ROLLING_7D_MAX) {
          console.log(`[ee-engine] 🔄 Lead ${item.lead_id} hit 7d rolling limit (${countByLead[item.lead_id]}/${ROLLING_7D_MAX}). Skipped.`);
          // If it has a follow_up, leave it pending — don't cancel, just skip this run
          continue;
        }
        filtered.push(item);
      }

      if (filtered.length < beforeCount) {
        console.log(`[ee-engine] Rolling 7d check: ${beforeCount - filtered.length} leads removed`);
      }

      // Replace queue
      queue.length = 0;
      queue.push(...filtered);
    }
  }

  // ---------------------------------------------------------------
  // ENFORCE DIVERSITY: ensure fresh ratio if fresh leads exist
  // If fresh leads are available but underrepresented, swap retries out
  // ---------------------------------------------------------------
  const freshCount = queue.filter(q => q.type === "fresh").length;
  const totalCount = queue.length;
  if (totalCount > 0 && freshCount > 0) {
    const actualRatio = freshCount / totalCount;
    console.log(`[ee-engine] Diversity: ${freshCount}/${totalCount} fresh (${(actualRatio * 100).toFixed(0)}%, target ${(MIN_FRESH_RATIO * 100).toFixed(0)}%)`);
  }

  // ---------------------------------------------------------------
  // LOG QUEUE STATE
  // ---------------------------------------------------------------
  const breakdown = {
    callbacks: queue.filter(q => q.type === "callback").length,
    fresh: queue.filter(q => q.type === "fresh").length,
    retries: queue.filter(q => q.type === "retry").length,
    total: queue.length,
  };

  console.log(`[ee-engine] Queue built: ${breakdown.callbacks} callbacks, ${breakdown.fresh} fresh, ${breakdown.retries} retries (${breakdown.total} total)`);

  if (queue.length === 0) {
    console.log("[ee-engine] ✓ Empty queue — nothing to dial");
    return { breakdown, dialedCount: 0, dialResults: [] };
  }

  // ---------------------------------------------------------------
  // DIAL EACH ITEM
  // ---------------------------------------------------------------
  let dialedCount = 0;
  const dialResults: any[] = [];

  for (const item of queue) {
    try {
      // For follow-up items, lock the follow-up
      if (item.follow_up_id) {
        const { error: lockErr } = await ee
          .from("follow_ups")
          .update({
            status: "dialing",
            dispatcher_lock_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            last_attempted_at: new Date().toISOString(),
          })
          .eq("id", item.follow_up_id)
          .eq("status", "pending");

        if (lockErr) {
          console.warn(`[ee-engine] Lock failed on FU ${item.follow_up_id}: ${lockErr.message}`);
          continue;
        }
      }

      // For fresh leads, create a follow_up record to track the dial attempt
      if (item.type === "fresh" && !item.follow_up_id) {
        const { data: newFU, error: createErr } = await ee
          .from("follow_ups")
          .insert({
            lead_id: item.lead_id,
            kind: "cold_outreach",
            source: "engine_fresh",
            status: "dialing",
            priority: item.priority,
            reason: item.reason,
            scheduled_for: new Date().toISOString(),
            dispatcher_lock_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            last_attempted_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (createErr || !newFU) {
          console.error(`[ee-engine] Failed to create FU for fresh lead ${item.lead_id}: ${createErr?.message}`);
          continue;
        }
        item.follow_up_id = newFU.id;
      }

      // Check call window
      if (!callWindowOpen) {
        if (item.follow_up_id) {
          await ee.from("follow_ups").update({
            status: "pending",
            dispatcher_lock_until: null,
            notes: `Promoted but outside call window. Will retry next window.`,
          }).eq("id", item.follow_up_id);
        }

        dialResults.push({
          follow_up_id: item.follow_up_id,
          lead_id: item.lead_id,
          type: item.type,
          kind: item.kind,
          result: "outside_call_window",
        });
        console.log(`[ee-engine] ⏸️ ${item.type} lead ${item.lead_id} — outside call window, deferred`);
        continue;
      }

      // DIAL
      const dialResult = await dialLead(item.lead_id, item.follow_up_id!);

      if (dialResult.ok) {
        await ee.from("follow_ups").update({
          status: "scheduled",
          dispatcher_lock_until: null,
          notes: `Call placed: ${dialResult.call_id} [${item.type}]`,
        }).eq("id", item.follow_up_id);

        dialedCount++;
        dialResults.push({
          follow_up_id: item.follow_up_id,
          lead_id: item.lead_id,
          type: item.type,
          kind: item.kind,
          result: "dialed",
          call_id: dialResult.call_id,
        });
        console.log(`[ee-engine] 📞 DIALED [${item.type}]: FU ${item.follow_up_id} → lead ${item.lead_id} → call ${dialResult.call_id}`);
      } else {
        const isGateBlock = dialResult.status === 403;

        await ee.from("follow_ups").update({
          status: isGateBlock ? "canceled" : "failed",
          dispatcher_lock_until: null,
          notes: `Dispatcher: ${dialResult.reason || dialResult.error || "unknown"} [${item.type}]`,
          ...(isGateBlock ? { canceled_at: new Date().toISOString() } : {}),
        }).eq("id", item.follow_up_id);

        dialResults.push({
          follow_up_id: item.follow_up_id,
          lead_id: item.lead_id,
          type: item.type,
          kind: item.kind,
          result: isGateBlock ? "gate_blocked" : "dial_error",
          reason: dialResult.reason || dialResult.error,
        });
        console.log(`[ee-engine] ${isGateBlock ? "🚫" : "❌"} [${item.type}] lead ${item.lead_id}: ${dialResult.reason || dialResult.error}`);
      }
    } catch (e) {
      console.error(`[ee-engine] Exception on lead ${item.lead_id}:`, e);
      if (item.follow_up_id) {
        await ee.from("follow_ups").update({
          status: "failed",
          dispatcher_lock_until: null,
          notes: `Exception: ${String(e)}`,
        }).eq("id", item.follow_up_id);
      }
    }
  }

  return { breakdown, dialedCount, dialResults };
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
