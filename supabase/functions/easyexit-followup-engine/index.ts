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

    const [promoted, marked, callbackResults] = await Promise.all([
      buildAndDialQueue(ee, callWindowOpen),
      markMissedFollowUps(ee),
      processCallbackLifecycle(ee),
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
      callback_lifecycle: callbackResults,
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
  // HYGIENE GATE: Only clean_new or reconciled leads can auto-dial.
  // dirty_legacy and hold_review are blocked even if manual_test_approved.
  // This is NOT bypassed by manual_test_approved.
  // ---------------------------------------------------------------
  const { data: hygieneCleanLeads, error: hygieneErr } = await ee
    .from("leads")
    .select("id")
    .in("data_hygiene_status", ["clean_new", "reconciled"]);

  if (hygieneErr) {
    console.error("[ee-engine] Hygiene gate query error:", hygieneErr);
    return { breakdown: { callbacks: 0, fresh: 0, retries: 0, total: 0 }, dialedCount: 0, dialResults: [] };
  }

  const hygienePassIds = new Set((hygieneCleanLeads || []).map((l: any) => l.id));
  console.log(`[ee-engine] Hygiene gate: ${hygienePassIds.size} leads with clean_new or reconciled status`);

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
      // Hygiene gate: skip dirty_legacy/hold_review leads
      if (!hygienePassIds.has(cb.lead_id)) {
        console.log(`[ee-engine] 🧹 Callback lead ${cb.lead_id} blocked by hygiene gate`);
        continue;
      }
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
    .in("data_hygiene_status", ["clean_new", "reconciled"])  // HYGIENE GATE
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
        // Hygiene gate: skip dirty_legacy/hold_review leads
        if (!hygienePassIds.has(r.lead_id)) {
          console.log(`[ee-engine] 🧹 Retry lead ${r.lead_id} blocked by hygiene gate`);
          continue;
        }
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

// =====================================================================
// PHASE 4B.4/4B.5/4B.6: CALLBACK LIFECYCLE MANAGEMENT
//
// Finds leads with callback_status='pending' whose callback_due_at
// has passed without a successful connection. Transitions them through:
//   pending → missed_once (1st miss, reschedule)
//   missed_once → missed_multiple (2nd miss, downgrade out of callback_pending)
//
// Also handles:
//   - Canceling stale callback follow_ups when superseded
//   - Never duplicating callback follow_ups for the same lead
// =====================================================================

async function processCallbackLifecycle(ee: any) {
  const now = new Date();
  const nowISO = now.toISOString();
  // Grace period: callback_due_at + 2 hours before we consider it missed
  const gracePeriod = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  const results: any[] = [];

  // Find leads with overdue callbacks (pending or missed_once)
  const { data: overdueLeads, error: queryErr } = await ee
    .from("leads")
    .select("id, owner_name, callback_status, callback_attempts, callback_due_at, callback_last_attempt_at, pipeline_stage, next_action_type")
    .in("callback_status", ["pending", "missed_once"])
    .lt("callback_due_at", gracePeriod)
    .order("callback_due_at", { ascending: true })
    .limit(50);

  if (queryErr) {
    console.error("[ee-engine] Callback lifecycle query error:", queryErr);
    return { processed: 0, results: [] };
  }

  if (!overdueLeads || overdueLeads.length === 0) {
    console.log("[ee-engine] ✓ No overdue callbacks");
    return { processed: 0, results: [] };
  }

  console.log(`[ee-engine] Found ${overdueLeads.length} overdue callback leads`);

  for (const lead of overdueLeads) {
    try {
      // Check if a call was actually attempted since callback_due_at
      // (the webhook may have already incremented callback_attempts)
      const { data: recentComms } = await ee
        .from("communications")
        .select("id, disposition, created_at")
        .eq("lead_id", lead.id)
        .gte("created_at", lead.callback_due_at)
        .order("created_at", { ascending: false })
        .limit(1);

      const callAttempted = recentComms && recentComms.length > 0;
      const lastDisposition = callAttempted ? recentComms[0].disposition : null;

      // If a call was attempted and resulted in connection (not no_answer/voicemail),
      // the webhook should have already handled it. Skip.
      if (callAttempted && lastDisposition && !["no_answer", "voicemail"].includes(lastDisposition)) {
        console.log(`[ee-engine] Callback lead ${lead.id} already resolved by webhook (${lastDisposition}). Skipping.`);
        continue;
      }

      if (lead.callback_status === "pending") {
        // TASK 4B.4: First miss
        const newAttempts = (lead.callback_attempts || 0) + (callAttempted ? 0 : 0); // webhook already incremented if call happened
        const rescheduleDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // Reschedule 2 days out

        // Snap to call window
        const snappedDate = snapToCallWindowEngine(rescheduleDate);

        const leadUpdate: Record<string, any> = {
          callback_status: "missed_once",
          callback_last_attempt_at: nowISO,
          callback_due_at: snappedDate.toISOString(),
          next_action_at: snappedDate.toISOString(),
          updated_at: nowISO,
        };

        const { error: updateErr } = await ee
          .from("leads")
          .update(leadUpdate)
          .eq("id", lead.id);

        if (updateErr) {
          console.error(`[ee-engine] Callback missed_once update error (lead ${lead.id}):`, updateErr);
          continue;
        }

        // Cancel any existing callback follow_ups for this lead, create new one
        await ee
          .from("follow_ups")
          .update({ status: "canceled", canceled_at: nowISO, notes: "Callback missed — rescheduling" })
          .eq("lead_id", lead.id)
          .eq("kind", "callback")
          .in("status", ["pending", "scheduled"]);

        // Create rescheduled callback follow_up
        await ee.from("follow_ups").insert({
          lead_id: lead.id,
          kind: "callback",
          source: "engine_callback_reschedule",
          status: "pending",
          priority: 85,
          reason: `Callback missed once — rescheduled to ${snappedDate.toISOString()}`,
          scheduled_for: snappedDate.toISOString(),
        });

        results.push({
          lead_id: lead.id,
          owner_name: lead.owner_name,
          action: "missed_once",
          rescheduled_to: snappedDate.toISOString(),
        });
        console.log(`[ee-engine] 📞 Callback missed_once: lead ${lead.id} (${lead.owner_name}) → rescheduled to ${snappedDate.toISOString()}`);

      } else if (lead.callback_status === "missed_once") {
        // TASK 4B.5: Second miss — downgrade out of callback_pending
        const leadUpdate: Record<string, any> = {
          callback_status: "missed_multiple",
          callback_resolution: "downgraded",
          callback_resolution_at: nowISO,
          callback_last_attempt_at: nowISO,
          callback_due_at: null,
          pipeline_stage: "needs_human_followup",
          next_action_type: "human_followup",
          next_action_at: nowISO,
          handoff_status: "pending",
          sla_due_at: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
          updated_at: nowISO,
        };

        const { error: updateErr } = await ee
          .from("leads")
          .update(leadUpdate)
          .eq("id", lead.id);

        if (updateErr) {
          console.error(`[ee-engine] Callback missed_multiple update error (lead ${lead.id}):`, updateErr);
          continue;
        }

        // Cancel all callback follow_ups
        await ee
          .from("follow_ups")
          .update({ status: "canceled", canceled_at: nowISO, notes: "Callback missed twice — downgraded to human_followup" })
          .eq("lead_id", lead.id)
          .eq("kind", "callback")
          .in("status", ["pending", "scheduled"]);

        results.push({
          lead_id: lead.id,
          owner_name: lead.owner_name,
          action: "missed_multiple_downgraded",
          new_pipeline_stage: "needs_human_followup",
        });
        console.log(`[ee-engine] 📞 Callback missed_multiple: lead ${lead.id} (${lead.owner_name}) → downgraded to needs_human_followup`);
      }
    } catch (e) {
      console.error(`[ee-engine] Callback lifecycle exception (lead ${lead.id}):`, e);
    }
  }

  return { processed: results.length, results };
}

// Call window snapping for engine (mirrors webhook logic)
function snapToCallWindowEngine(targetDate: Date): Date {
  const etHour = getETHourEngine(targetDate);
  const etMin = targetDate.getUTCMinutes();
  const timeDecimal = etHour + etMin / 60;

  if (timeDecimal >= 10.5 && timeDecimal < 12) return targetDate;
  if (timeDecimal >= 16.5 && timeDecimal < 18.5) return targetDate;
  if (timeDecimal < 10.5) return setETTimeEngine(targetDate, 10, 30);
  if (timeDecimal >= 12 && timeDecimal < 16.5) return setETTimeEngine(targetDate, 16, 30);
  const nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  return setETTimeEngine(nextDay, 10, 30);
}

function getETOffsetEngine(date: Date): number {
  const year = date.getUTCFullYear();
  const marchSecondSun = nthSundayEngine(year, 2, 2);
  const novFirstSun = nthSundayEngine(year, 10, 1);
  if (date.getTime() >= marchSecondSun.getTime() && date.getTime() < novFirstSun.getTime()) return -4;
  return -5;
}

function nthSundayEngine(year: number, month: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1, 7, 0, 0));
  let count = 0;
  while (count < n) {
    if (d.getUTCDay() === 0) count++;
    if (count < n) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

function getETHourEngine(date: Date): number {
  return (date.getUTCHours() + getETOffsetEngine(date) + 24) % 24;
}

function setETTimeEngine(date: Date, etHour: number, etMin: number): Date {
  const offset = getETOffsetEngine(date);
  const utcHour = etHour - offset;
  const result = new Date(date);
  result.setUTCHours(utcHour, etMin, 0, 0);
  return result;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
