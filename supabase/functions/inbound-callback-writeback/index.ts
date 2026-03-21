import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EE_URL = "https://bgznglzzknmetzpwkbbz.supabase.co";
const EE_KEY = Deno.env.get("EASYEXIT_SERVICE_ROLE_KEY")!;

// SLA: 4 hours for human follow-up after inbound callback
const SLA_HOURS = 4;

// Pipeline stages ranked by "heat" (higher = hotter)
const STAGE_HEAT: Record<string, number> = {
  new: 1,
  cold_outreach: 2,
  follow_up: 3,
  warm: 4,
  callback_scheduled: 5,
  needs_human_followup: 6,
  negotiating: 7,
  offer_made: 8,
  under_contract: 9,
  closed_won: 10,
  closed_lost: 0,
  dead: 0,
};

interface InboundPayload {
  caller_phone: string;
  call_outcome: "interested" | "dnc" | "callback" | "not_interested" | "wrong_number" | "other";
  vapi_call_id?: string;
  call_summary?: string;
  transcript_snippet?: string;
  call_duration_seconds?: number;
  // From resolver
  matched_leads?: Array<{
    lead_id: number;
    confidence: string; // "exact" | "fuzzy" | "skip_trace"
    owner_name?: string;
  }>;
  match_count?: number;
  ambiguous?: boolean;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const payload: InboundPayload = await req.json();

    if (!payload.caller_phone) {
      return json({ error: "caller_phone required" }, 400);
    }

    const ee = createClient(EE_URL, EE_KEY);
    const now = new Date().toISOString();
    const bare10 = payload.caller_phone.replace(/[^0-9]/g, "").slice(-10);

    // ---------------------------------------------------------------
    // STEP 1: Resolve caller to leads (if not already provided)
    // ---------------------------------------------------------------
    let matches = payload.matched_leads || [];
    let matchCount = payload.match_count ?? matches.length;
    let ambiguous = payload.ambiguous ?? false;

    if (matches.length === 0) {
      // Self-resolve: query leads by phone
      const resolved = await resolveCallerToLeads(ee, bare10);
      matches = resolved.matches;
      matchCount = resolved.count;
      ambiguous = resolved.ambiguous;
    }

    // ---------------------------------------------------------------
    // STEP 2: Route by outcome
    // ---------------------------------------------------------------
    if (payload.call_outcome === "dnc") {
      return await handleDNC(ee, payload, matches, bare10, now);
    }

    if (ambiguous || matchCount > 1) {
      return await handleAmbiguous(ee, payload, matches, matchCount, bare10, now);
    }

    if (matchCount === 0) {
      return await handleNoMatch(ee, payload, bare10, now);
    }

    // Single clear match
    const leadId = matches[0].lead_id;
    const confidence = matches[0].confidence;

    if (payload.call_outcome === "interested") {
      return await handleInterested(ee, payload, leadId, confidence, bare10, now);
    }

    // Default: inbound callback (general)
    return await handleInboundCallback(ee, payload, leadId, confidence, bare10, now);

  } catch (error) {
    console.error("[inbound-writeback] Error:", error);
    return json({ error: String(error) }, 500);
  }
});

// =====================================================================
// RESOLVE CALLER TO LEADS
// =====================================================================

async function resolveCallerToLeads(ee: any, bare10: string) {
  // Search owner_phone — phones stored as "(207) 409-7446" format
  // Use last 4 digits in ilike to cast a wide net, then filter in-code
  const last4 = bare10.slice(-4);
  const { data: directMatches, error: directErr } = await ee
    .from("leads")
    .select("id, owner_name, owner_phone")
    .ilike("owner_phone", `%${last4}`)
    .limit(50);

  if (directErr) {
    console.error("[inbound-writeback] Direct match error:", directErr);
    return { matches: [], count: 0, ambiguous: false };
  }

  // Filter to exact 10-digit match (strip formatting)
  const exactMatches = (directMatches || []).filter((l: any) => {
    const leadBare = (l.owner_phone || "").replace(/[^0-9]/g, "").slice(-10);
    return leadBare === bare10;
  });

  // Also check skip_trace_data phones
  const { data: skipTraceMatches, error: stErr } = await ee
    .from("leads")
    .select("id, owner_name, skip_trace_data")
    .not("skip_trace_data", "is", null)
    .limit(500);

  const stMatches: Array<{ lead_id: number; confidence: string; owner_name?: string }> = [];
  if (!stErr && skipTraceMatches) {
    for (const lead of skipTraceMatches) {
      // Skip if already in direct matches
      if (exactMatches.some((m: any) => m.id === lead.id)) continue;

      const std = typeof lead.skip_trace_data === "string"
        ? JSON.parse(lead.skip_trace_data)
        : lead.skip_trace_data;

      const phones: string[] = std?.phones || [];
      for (const p of phones) {
        const pBare = p.replace(/[^0-9]/g, "").slice(-10);
        if (pBare === bare10) {
          stMatches.push({
            lead_id: lead.id,
            confidence: "skip_trace",
            owner_name: lead.owner_name,
          });
          break;
        }
      }
    }
  }

  const allMatches = [
    ...exactMatches.map((m: any) => ({
      lead_id: m.id,
      confidence: "exact",
      owner_name: m.owner_name,
    })),
    ...stMatches,
  ];

  const count = allMatches.length;
  // Ambiguous: more than 1 match and no single "exact" winner
  const exactCount = allMatches.filter(m => m.confidence === "exact").length;
  const ambiguous = count > 1 && exactCount !== 1;

  // If exactly 1 exact match among multiple, prefer it (not ambiguous)
  if (count > 1 && exactCount === 1) {
    const winner = allMatches.find(m => m.confidence === "exact")!;
    return { matches: [winner], count: 1, ambiguous: false };
  }

  return { matches: allMatches, count, ambiguous };
}

// =====================================================================
// HANDLER: DNC (Stop calling)
// =====================================================================

async function handleDNC(
  ee: any, payload: InboundPayload,
  matches: any[], bare10: string, now: string
) {
  const results: any[] = [];

  // 1. Global phone block — check if already exists
  const { data: existingBlock } = await ee
    .from("blocked_phones")
    .select("id")
    .eq("normalized_phone", bare10)
    .eq("active", true)
    .maybeSingle();

  let blockErr: any = null;
  if (existingBlock) {
    // Already blocked
    console.log(`[inbound-writeback] Phone ${bare10} already in blocked_phones`);
  } else {
    const { error: bErr } = await ee.from("blocked_phones").insert({
      normalized_phone: bare10,
      reason: "dnc_inbound",
      source_lead_id: matches[0]?.lead_id || null,
      blocked_at: now,
      blocked_by: "inbound_callback_writeback",
      notes: `Caller requested DNC during inbound call ${payload.vapi_call_id || "unknown"}`,
      active: true,
    });
    blockErr = bErr;
  }

  if (blockErr) {
    console.error("[inbound-writeback] Block phone error:", blockErr);
  }
  results.push({ action: "blocked_phone", phone: bare10, error: blockErr?.message });

  // 2. Update ALL matching leads (PHASE 6: write provenance)
  for (const match of matches) {
    const { error: leadErr } = await ee
      .from("leads")
      .update({
        last_disposition: "dnc_inbound",
        pipeline_stage: "closed_lost",
        engagement_level: "dnc",
        next_action_type: null,
        next_action_at: null,
        handoff_status: "none",
        sla_due_at: null,
        dnc_listed: true,
        opt_out: true,
        opt_out_date: now,
        callable: false,
        outbound_approved: false,
        updated_at: now,
        status_update_source: "inbound_callback_writeback",
        pipeline_update_source: "inbound_callback_writeback",
        state_change_reason: "DNC request during inbound call",
      })
      .eq("id", match.lead_id);

    if (leadErr) {
      console.error(`[inbound-writeback] DNC lead update error (${match.lead_id}):`, leadErr);
    }

    // Cancel any pending follow-ups
    await ee
      .from("follow_ups")
      .update({ status: "canceled", canceled_at: now, notes: "DNC requested via inbound call" })
      .eq("lead_id", match.lead_id)
      .in("status", ["pending", "scheduled", "dialing"]);

    results.push({ action: "dnc_lead", lead_id: match.lead_id, error: leadErr?.message });
  }

  // 3. Log communication
  const commRow = buildCommRow({
    lead_id: matches[0]?.lead_id || null,
    direction: "inbound",
    phone_number: bare10,
    outcome: "dnc",
    summary: payload.call_summary || "Caller requested Do Not Call",
    vapi_call_id: payload.vapi_call_id,
    duration_seconds: payload.call_duration_seconds,
    metadata: {
      call_outcome: "dnc",
      match_count: matches.length,
      ambiguity: matches.length > 1,
      all_lead_ids: matches.map((m: any) => m.lead_id),
    },
    now,
  });

  const { error: commErr } = await ee.from("communications").insert(commRow);
  if (commErr) console.error("[inbound-writeback] Comm insert error:", commErr);

  results.push({ action: "comm_logged", error: commErr?.message });

  console.log(`[inbound-writeback] ✅ DNC processed: phone ${bare10}, ${matches.length} leads suppressed`);

  return json({
    ok: true,
    action: "dnc",
    phone: bare10,
    leads_suppressed: matches.length,
    results,
  });
}

// =====================================================================
// HANDLER: Ambiguous match (multiple leads, no clear winner)
// =====================================================================

async function handleAmbiguous(
  ee: any, payload: InboundPayload,
  matches: any[], matchCount: number, bare10: string, now: string
) {
  // Log communication with ambiguity metadata — do NOT mutate any lead
  const commRow = buildCommRow({
    lead_id: null, // No lead assigned
    direction: "inbound",
    phone_number: bare10,
    outcome: payload.call_outcome || "inbound_callback",
    summary: payload.call_summary || `Inbound call — ambiguous match (${matchCount} leads)`,
    vapi_call_id: payload.vapi_call_id,
    duration_seconds: payload.call_duration_seconds,
    metadata: {
      call_outcome: payload.call_outcome,
      match_count: matchCount,
      ambiguity: true,
      candidate_leads: matches.map((m: any) => ({
        lead_id: m.lead_id,
        confidence: m.confidence,
        owner_name: m.owner_name,
      })),
      transcript_snippet: payload.transcript_snippet,
      needs_manual_resolution: true,
    },
    now,
  });

  const { error: commErr } = await ee.from("communications").insert(commRow);
  if (commErr) console.error("[inbound-writeback] Ambiguous comm insert error:", commErr);

  console.log(`[inbound-writeback] ⚠️ Ambiguous: phone ${bare10} matched ${matchCount} leads — comm logged, no lead mutated`);

  return json({
    ok: true,
    action: "ambiguous",
    phone: bare10,
    match_count: matchCount,
    candidate_leads: matches,
    comm_logged: !commErr,
    lead_mutated: false,
  });
}

// =====================================================================
// HANDLER: No match
// =====================================================================

async function handleNoMatch(
  ee: any, payload: InboundPayload, bare10: string, now: string
) {
  const commRow = buildCommRow({
    lead_id: null,
    direction: "inbound",
    phone_number: bare10,
    outcome: payload.call_outcome || "inbound_callback",
    summary: payload.call_summary || "Inbound call — no matching lead found",
    vapi_call_id: payload.vapi_call_id,
    duration_seconds: payload.call_duration_seconds,
    metadata: {
      call_outcome: payload.call_outcome,
      match_count: 0,
      ambiguity: false,
      transcript_snippet: payload.transcript_snippet,
      unknown_caller: true,
    },
    now,
  });

  const { error: commErr } = await ee.from("communications").insert(commRow);
  if (commErr) console.error("[inbound-writeback] No-match comm insert error:", commErr);

  console.log(`[inbound-writeback] ❓ No match: phone ${bare10} — comm logged`);

  return json({
    ok: true,
    action: "no_match",
    phone: bare10,
    comm_logged: !commErr,
    lead_mutated: false,
  });
}

// =====================================================================
// HANDLER: Interested (handoff path)
// =====================================================================

async function handleInterested(
  ee: any, payload: InboundPayload,
  leadId: number, confidence: string, bare10: string, now: string
) {
  const slaDueAt = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000).toISOString();

  // Only upgrade pipeline_stage if current stage is colder
  const { data: lead } = await ee
    .from("leads")
    .select("pipeline_stage")
    .eq("id", leadId)
    .single();

  const currentHeat = STAGE_HEAT[lead?.pipeline_stage || "new"] ?? 0;
  const targetHeat = STAGE_HEAT["needs_human_followup"];

  const leadUpdate: Record<string, any> = {
    last_disposition: "inbound_interested",
    next_action_type: "human_followup",
    next_action_at: now,
    handoff_status: "pending",
    sla_due_at: slaDueAt,
    updated_at: now,
    status_update_source: "inbound_callback_writeback",
    pipeline_update_source: "inbound_callback_writeback",
    state_change_reason: "Inbound callback: caller interested, escalated to human followup",
  };

  // Only upgrade stage, never downgrade
  if (currentHeat < targetHeat) {
    leadUpdate.pipeline_stage = "needs_human_followup";
  }

  // PHASE 4B.3: If lead was in callback_pending, mark callback completed
  if (lead?.pipeline_stage === "callback_pending") {
    const { data: cbData } = await ee
      .from("leads")
      .select("callback_status, callback_attempts")
      .eq("id", leadId)
      .single();
    if (cbData && ["pending", "due", "missed_once"].includes(cbData.callback_status)) {
      leadUpdate.callback_status = "completed";
      leadUpdate.callback_resolution = "completed";
      leadUpdate.callback_resolution_at = now;
      leadUpdate.callback_last_attempt_at = now;
      leadUpdate.callback_attempts = (cbData.callback_attempts || 0) + 1;
      leadUpdate.callback_due_at = null;
    }
  }

  const { error: leadErr } = await ee
    .from("leads")
    .update(leadUpdate)
    .eq("id", leadId);

  if (leadErr) console.error(`[inbound-writeback] Interested lead update error (${leadId}):`, leadErr);

  // Log communication
  const commRow = buildCommRow({
    lead_id: leadId,
    direction: "inbound",
    phone_number: bare10,
    outcome: "interested",
    summary: payload.call_summary || "Inbound call — caller showed interest",
    vapi_call_id: payload.vapi_call_id,
    duration_seconds: payload.call_duration_seconds,
    metadata: {
      call_outcome: "interested",
      match_count: 1,
      match_confidence: confidence,
      ambiguity: false,
      transcript_snippet: payload.transcript_snippet,
    },
    now,
  });

  const { error: commErr } = await ee.from("communications").insert(commRow);
  if (commErr) console.error("[inbound-writeback] Interested comm insert error:", commErr);

  console.log(`[inbound-writeback] 🔥 Interested: lead ${leadId} → handoff pending, SLA ${slaDueAt}`);

  return json({
    ok: true,
    action: "interested",
    lead_id: leadId,
    pipeline_stage: leadUpdate.pipeline_stage || lead?.pipeline_stage,
    handoff_status: "pending",
    sla_due_at: slaDueAt,
    comm_logged: !commErr,
  });
}

// =====================================================================
// HANDLER: General inbound callback (single match)
// =====================================================================

async function handleInboundCallback(
  ee: any, payload: InboundPayload,
  leadId: number, confidence: string, bare10: string, now: string
) {
  const slaDueAt = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000).toISOString();

  // Only upgrade pipeline_stage if current stage is colder
  const { data: lead } = await ee
    .from("leads")
    .select("pipeline_stage")
    .eq("id", leadId)
    .single();

  const currentHeat = STAGE_HEAT[lead?.pipeline_stage || "new"] ?? 0;
  const targetHeat = STAGE_HEAT["needs_human_followup"];

  const leadUpdate: Record<string, any> = {
    last_disposition: "inbound_callback",
    next_action_type: "human_followup",
    next_action_at: now,
    handoff_status: "pending",
    sla_due_at: slaDueAt,
    updated_at: now,
    status_update_source: "inbound_callback_writeback",
    pipeline_update_source: "inbound_callback_writeback",
    state_change_reason: "Inbound callback received, escalated to human followup",
  };

  if (currentHeat < targetHeat) {
    leadUpdate.pipeline_stage = "needs_human_followup";
  }

  // PHASE 4B.3: If lead was in callback_pending, mark callback completed
  if (lead?.pipeline_stage === "callback_pending") {
    const { data: cbData } = await ee
      .from("leads")
      .select("callback_status, callback_attempts")
      .eq("id", leadId)
      .single();
    if (cbData && ["pending", "due", "missed_once"].includes(cbData.callback_status)) {
      leadUpdate.callback_status = "completed";
      leadUpdate.callback_resolution = "completed";
      leadUpdate.callback_resolution_at = now;
      leadUpdate.callback_last_attempt_at = now;
      leadUpdate.callback_attempts = (cbData.callback_attempts || 0) + 1;
      leadUpdate.callback_due_at = null;
    }
  }

  const { error: leadErr } = await ee
    .from("leads")
    .update(leadUpdate)
    .eq("id", leadId);

  if (leadErr) console.error(`[inbound-writeback] Callback lead update error (${leadId}):`, leadErr);

  // Log communication
  const commRow = buildCommRow({
    lead_id: leadId,
    direction: "inbound",
    phone_number: bare10,
    outcome: "inbound_callback",
    summary: payload.call_summary || "Inbound callback from lead",
    vapi_call_id: payload.vapi_call_id,
    duration_seconds: payload.call_duration_seconds,
    metadata: {
      call_outcome: payload.call_outcome || "callback",
      match_count: 1,
      match_confidence: confidence,
      ambiguity: false,
      transcript_snippet: payload.transcript_snippet,
    },
    now,
  });

  const { error: commErr } = await ee.from("communications").insert(commRow);
  if (commErr) console.error("[inbound-writeback] Callback comm insert error:", commErr);

  console.log(`[inbound-writeback] ✅ Callback: lead ${leadId} → needs_human_followup, SLA ${slaDueAt}`);

  return json({
    ok: true,
    action: "inbound_callback",
    lead_id: leadId,
    pipeline_stage: leadUpdate.pipeline_stage || lead?.pipeline_stage,
    handoff_status: "pending",
    sla_due_at: slaDueAt,
    comm_logged: !commErr,
  });
}

// =====================================================================
// HELPERS
// =====================================================================

function buildCommRow(opts: {
  lead_id: number | null;
  direction: string;
  phone_number: string;
  outcome: string;
  summary: string;
  vapi_call_id?: string;
  duration_seconds?: number;
  metadata?: any;
  now: string;
}) {
  const nowDate = new Date(opts.now);
  return {
    lead_id: opts.lead_id,
    direction: opts.direction,
    phone_number: opts.phone_number,
    outcome: opts.outcome,
    summary: opts.summary,
    vapi_call_id: opts.vapi_call_id || null,
    duration_seconds: opts.duration_seconds || null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    contact_date: nowDate.toISOString().split("T")[0],
    contact_time: nowDate.toISOString().split("T")[1].split(".")[0],
    communication_type_id: 1, // phone
    webhook_processed_at: opts.now,
  };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
