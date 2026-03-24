import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EE_URL = "https://bgznglzzknmetzpwkbbz.supabase.co";
const EE_KEY = Deno.env.get("EASYEXIT_SERVICE_ROLE_KEY")!;

interface VapiWebhookPayload {
  callId: string;
  call?: {
    id: string;
    status: string;
    endedReason?: string;
    duration?: number;
    phoneNumber?: {
      numberE164: string;
    };
    transcript?: string;
    analysis?: {
      summary?: string;
      nextSteps?: string;
      [key: string]: any;
    };
    messages?: Array<{
      role: string;
      content: string;
    }>;
    metadata?: {
      lead_id?: number | string;
      [key: string]: any;
    };
  };
  metadata?: {
    lead_id?: number | string;
    [key: string]: any;
  };
  message?: {
    role: string;
    content: string;
  };
  messages?: Array<{
    role: string;
    content: string;
    endTime?: number;
    startTime?: number;
  }>;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const payload: VapiWebhookPayload = await req.json();
    const callId = payload.callId || payload.call?.id;

    if (!callId) {
      return json({ error: "callId required" }, 400);
    }

    const ee = createClient(EE_URL, EE_KEY);
    const phoneNumber =
      payload.call?.phoneNumber?.numberE164 || 
      payload.call?.phoneNumber?.toString?.() ||
      "";

    // ---------------------------------------------------------------
    // STEP 1: Find the lead by call ID (from communications table)
    //         Defense-in-depth: if no row exists (e.g. trigger-call
    //         failed to insert, or call came from another path),
    //         create a fallback comm row from Vapi metadata.
    // ---------------------------------------------------------------
    let { data: comm, error: commErr } = await ee
      .from("communications")
      .select("*")
      .eq("vapi_call_id", callId)
      .maybeSingle();

    let leadId: number | null = comm?.lead_id ?? null;

    if (!comm) {
      // Attempt to resolve lead_id from Vapi metadata
      const metaLeadId = payload.call?.metadata?.lead_id
        ?? (payload as any).metadata?.lead_id
        ?? null;

      if (!metaLeadId) {
        console.error(`[vapi-webhook] No comm row AND no lead_id in metadata for callId=${callId}`);
        return json({ ok: true, warning: "No communication record and no lead_id in metadata" });
      }

      leadId = Number(metaLeadId);

      // Fetch lead to populate fallback row
      const { data: fallbackLead } = await ee
        .from("leads")
        .select("owner_name, owner_phone, property_data")
        .eq("id", leadId)
        .single();

      const fallbackPhone = fallbackLead?.owner_phone || phoneNumber || "";
      const fallbackName = fallbackLead?.owner_name || "";
      let fallbackAddr = "";
      if (fallbackLead?.property_data) {
        const pd = typeof fallbackLead.property_data === "string"
          ? JSON.parse(fallbackLead.property_data)
          : fallbackLead.property_data;
        fallbackAddr = pd?.address || pd?.property_address || "";
      }

      console.warn(`[vapi-webhook] Creating fallback comm row for callId=${callId}, lead=${leadId}`);

      const { data: newComm, error: insertErr } = await ee
        .from("communications")
        .insert({
          lead_id: leadId,
          vapi_call_id: callId,
          contact_date: new Date().toISOString().split("T")[0],
          contacted_party: fallbackName,
          phone_number: fallbackPhone,
          owner_name: fallbackName,
          property_address: fallbackAddr,
          direction: "outbound",
          outcome: "pending",
          disposition: "pending",
          communication_type_id: 8,
        })
        .select("*")
        .single();

      if (insertErr) {
        console.error(`[vapi-webhook] Fallback comm insert failed: ${insertErr.message}`);
        return json({ error: "Fallback comm insert failed", details: insertErr.message }, 500);
      }

      comm = newComm;
      console.log(`[vapi-webhook] Fallback comm row created: id=${comm!.id}`);
    }

    if (!leadId) {
      console.error(`[vapi-webhook] No lead_id resolved for callId=${callId}`);
      return json({ ok: true, warning: "Could not resolve lead_id" });
    }

    // ---------------------------------------------------------------
    // STEP 2: Fetch lead
    // ---------------------------------------------------------------
    const { data: lead, error: leadErr } = await ee
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadErr || !lead) {
      console.log(`[vapi-webhook] Lead ${leadId} not found`);
      return json({ ok: true, warning: "Lead not found" });
    }

    // ---------------------------------------------------------------
    // STEP 3: Determine disposition from Vapi payload
    //
    // ORDERING IS CRITICAL:
    //   1. DNC / wrong number (hard negatives — always win)
    //   2. Voicemail / machine / no human contact
    //   3. Not interested (explicit rejection — BEFORE "interested")
    //   4. Callback request
    //   5. Interested (requires live human contact)
    //   6. Fallback
    //
    // VOICEMAIL PRECEDENCE: kept exactly from live v19.
    // ---------------------------------------------------------------
    let disposition = "unknown";
    let callOutcome = "other";

    const transcript = (payload.call?.transcript || "").toLowerCase();
    const summary = (payload.call?.analysis?.summary || "").toLowerCase();
    const endedReason = payload.call?.endedReason?.toLowerCase() || "";
    const callDuration = payload.call?.duration ?? 0;

    // --- Voicemail detection (broad) ---
    const voicemailSignals = [
      endedReason.includes("machine"),
      endedReason.includes("voicemail"),
      endedReason.includes("answering"),
      endedReason.includes("no-answer"),
      endedReason.includes("busy"),
      transcript.includes("leave a message"),
      transcript.includes("leave your message"),
      transcript.includes("after the tone"),
      transcript.includes("after the beep"),
      transcript.includes("not available"),
      transcript.includes("voicemail"),
      transcript.includes("recording"),
      transcript.includes("please leave"),
      transcript.includes("at the tone"),
      summary.includes("voicemail"),
      summary.includes("no contact made"),
      summary.includes("no answer"),
      summary.includes("machine"),
      summary.includes("left a message"),
      summary.includes("unable to reach"),
    ];
    const isVoicemail = voicemailSignals.some(Boolean);
    const isShortCall = callDuration > 0 && callDuration < 15;

    // --- Hard negatives (always win) ---
    if (
      transcript.includes("do not call") ||
      transcript.includes("do not contact") ||
      transcript.includes("stop calling") ||
      summary.includes("do not call")
    ) {
      disposition = "do_not_call";
      callOutcome = "dnc";
    } else if (
      transcript.includes("wrong number") ||
      transcript.includes("wrong person") ||
      transcript.includes("incorrect")
    ) {
      disposition = "wrong_number";
      callOutcome = "wrong_number";

    // --- Voicemail / no human contact (BEFORE interest checks) ---
    } else if (isVoicemail) {
      disposition = "voicemail";
      callOutcome = "voicemail";

    // --- Not interested (MUST come before "interested") ---
    } else if (
      transcript.includes("not interested") ||
      summary.includes("not interested")
    ) {
      disposition = "not_interested";
      callOutcome = "not_interested";

    // --- Callback request ---
    } else if (
      transcript.includes("callback") ||
      transcript.includes("call me back") ||
      transcript.includes("call back")
    ) {
      disposition = "callback_requested";
      callOutcome = "callback";

    // --- Interest (requires NO voicemail + meaningful conversation) ---
    } else if (
      !isShortCall &&
      (
        transcript.includes("interested") ||
        summary.includes("interested")
      )
    ) {
      disposition = "interested";
      callOutcome = "interested";

    // --- Error / failure ---
    } else if (endedReason.includes("error") || endedReason.includes("failed")) {
      disposition = "failed";
      callOutcome = "other";

    // --- Short call with no signal = likely no contact ---
    } else if (isShortCall) {
      disposition = "no_contact";
      callOutcome = "voicemail";

    // --- Fallback ---
    } else {
      disposition = "completed";
      callOutcome = "other";
    }

    // Log voicemail precedence when it prevented a false promotion
    if (isVoicemail && (transcript.includes("interested") || summary.includes("interested"))) {
      console.log(
        `[vapi-webhook] VOICEMAIL PRECEDENCE: lead=${leadId} — voicemail signal blocked false "interested".`
      );
    }

    // ---------------------------------------------------------------
    // STEP 4: Extract callback date if outcome is callback
    // ---------------------------------------------------------------
    let callbackDueAt: string | null = null;
    if (callOutcome === "callback") {
      callbackDueAt = parseCallbackDate(transcript, summary);
    }

    // ---------------------------------------------------------------
    // STEP 5: Update communications record
    // ---------------------------------------------------------------
    const now = new Date().toISOString();
    const { error: updateCommErr } = await ee
      .from("communications")
      .update({
        outcome: callOutcome,
        disposition,
        transcript: transcript.substring(0, 5000),
        summary: summary?.substring(0, 1000) || null,
        webhook_processed_at: now,
      })
      .eq("id", comm.id);

    if (updateCommErr) {
      console.error("[vapi-webhook] Failed to update communications:", updateCommErr);
    }

    // ---------------------------------------------------------------
    // STEP 5.5: STALE WEBHOOK PROTECTION
    //
    // Before mutating lead state, check if the lead has been updated
    // to a stronger state since this call ended. If so, preserve the
    // stronger state (comm is still stored above).
    // ---------------------------------------------------------------
    const PROTECTED_STATES = ["dnc", "dead", "bad_number", "needs_review", "suppressed"];
    const PROTECTED_ENGAGEMENTS = ["dnc", "dead"];

    const isProtected =
      PROTECTED_STATES.includes(lead.status) ||
      PROTECTED_ENGAGEMENTS.includes(lead.engagement_level);

    const DISPOSITION_STRENGTH: Record<string, number> = {
      "do_not_call": 100,
      "wrong_number": 90,
      "not_interested": 80,
      "voicemail": 20,
      "no_contact": 10,
      "callback_requested": 50,
      "interested": 40,
      "completed": 5,
      "failed": 5,
      "unknown": 0,
    };
    const STATUS_STRENGTH: Record<string, number> = {
      "dnc": 100,
      "suppressed": 100,
      "dead": 80,
      "bad_number": 80,
      "needs_review": 70,
      "hold_review": 70,
      "callback_pending": 50,
      "qualified": 40,
      "contacted": 20,
      "raw": 0,
      "new": 0,
    };

    const incomingStrength = DISPOSITION_STRENGTH[disposition] || 0;
    const currentStrength = STATUS_STRENGTH[lead.status] || 0;

    let skipLeadUpdate = false;

    if (isProtected && incomingStrength <= currentStrength) {
      console.log(
        `[vapi-webhook] PROTECTED: Lead ${leadId} is ${lead.status}/${lead.engagement_level} ` +
        `(strength ${currentStrength}). Incoming '${disposition}' (${incomingStrength}) cannot override.`
      );
      skipLeadUpdate = true;
    } else if (isProtected && incomingStrength > currentStrength) {
      console.log(
        `[vapi-webhook] ESCALATION: Lead ${leadId} upgrading from '${lead.status}' ` +
        `to '${disposition}' (stronger terminal state).`
      );
    }

    if (skipLeadUpdate) {
      // Even when lead state is protected, DNC/wrong_number MUST still
      // write to blocked_phones for global suppression (Items 9/12).
      // A protected lead means we don't downgrade its state, but the
      // phone block must still propagate.
      if (callOutcome === "dnc" || callOutcome === "wrong_number") {
        const bare10 = phoneNumber.replace(/[^0-9]/g, "").slice(-10);
        const blockReason = callOutcome === "dnc" ? "dnc" : "wrong_number";

        if (bare10.length === 10) {
          // Check-then-insert (partial unique index incompatible with PostgREST upsert)
          const { data: existingBlockP } = await ee
            .from("blocked_phones")
            .select("id")
            .eq("normalized_phone", bare10)
            .eq("reason", blockReason)
            .eq("active", true)
            .maybeSingle();

          if (!existingBlockP) {
            await ee.from("blocked_phones").insert({
              normalized_phone: bare10,
              reason: blockReason,
              source_lead_id: leadId,
              source_comm_id: comm.id,
              blocked_by: "webhook_auto",
              notes: `Auto-blocked from call ${callId}: ${disposition} (lead state protected)`,
              active: true,
            });
          }

          // Cascade to siblings even when this lead is protected
          const { data: siblingLeads } = await ee
            .from("leads")
            .select("id")
            .neq("id", leadId)
            .eq("callable", true)
            .like("owner_phone", `%${bare10}`);

          if (siblingLeads && siblingLeads.length > 0) {
            const siblingIds = siblingLeads.map((l: any) => l.id);
            await ee.from("leads").update({
              callable: false,
              outbound_approved: false,
              status_update_source: "webhook_cascade",
              state_change_reason: `Phone ${bare10} blocked via lead ${leadId}: ${blockReason}`,
            }).in("id", siblingIds);

            console.log(`[vapi-webhook] 🚫 CASCADE (protected path): ${siblingIds.length} siblings suppressed for ${bare10}`);
          }

          await ee.from("compliance_audit_log").insert({
            event_type: "dnc_added",
            lead_id: leadId,
            phone_number: bare10,
            call_id: callId,
            gate_name: "webhook_suppression",
            gate_result: "block",
            reason: `Phone globally blocked: ${blockReason} (lead state protected, cascade only)`,
            dnc_status: "blocked",
            source: "webhook",
          });

          console.log(`[vapi-webhook] 🚫 Phone ${bare10} blocked globally (lead ${leadId} state protected — cascade only)`);
        }
      }

      // Still complete any open follow-ups for this lead
      await ee
        .from("follow_ups")
        .update({
          status: "completed",
          completed_at: now,
          dispatcher_lock_until: null,
          notes: `Call completed: ${disposition} (lead state protected, no override)`,
          status_update_source: "webhook",
          state_change_reason: `Call ${callId}: ${disposition} (lead protected)`,
        })
        .eq("lead_id", leadId)
        .in("status", ["scheduled", "processing", "pending"])
        .is("completed_at", null);

      return json({
        ok: true,
        lead_id: leadId,
        disposition,
        outcome: callOutcome,
        protected: true,
        timestamp: now,
      });
    }

    // ---------------------------------------------------------------
    // STEP 6: Update lead based on disposition
    //         PHASE 6: Write provenance fields
    // ---------------------------------------------------------------
    const updatePayload: any = {
      last_disposition: disposition,
      last_contact_date: now,
      status_update_source: "outbound_webhook",
      state_change_reason: `Call ended: ${disposition}`,
      pipeline_update_source: "outbound_webhook",
      // Increment outreach counter
      outreach_count: (lead.outreach_count || 0) + 1,
    };

    // --- DNC ---
    if (callOutcome === "dnc") {
      updatePayload.dnc_listed = true;
      updatePayload.callable = false;
      updatePayload.outbound_approved = false;
      updatePayload.status = "suppressed";
      updatePayload.engagement_level = "dnc";
      updatePayload.consent_status = "revoked";
      updatePayload.tcpa_eligible = false;
      updatePayload.opt_out = true;
      updatePayload.exhaustion_status = "exhausted";
      updatePayload.state_change_reason = "DNC request during call";

    // --- Wrong number ---
    } else if (callOutcome === "wrong_number") {
      updatePayload.wrong_number_flag = true;
      updatePayload.wrong_number_at = now;
      updatePayload.callable = false;
      updatePayload.outbound_approved = false;
      updatePayload.status = "hold_review";
      updatePayload.engagement_level = "dead";
      updatePayload.exhaustion_status = "exhausted";
      updatePayload.state_change_reason = "Wrong number identified";

    // --- Not interested — TERMINAL (PATCH 1) ---
    } else if (callOutcome === "not_interested") {
      updatePayload.callable = false;
      updatePayload.outbound_approved = false;
      updatePayload.status = "dead";
      updatePayload.engagement_level = "dead";
      updatePayload.death_reason = "not_interested";
      updatePayload.exhaustion_status = "exhausted";
      updatePayload.state_change_reason = "Lead explicitly not interested";

    // --- Voicemail ---
    } else if (callOutcome === "voicemail") {
      // Voicemail must NEVER promote lead state — only safe updates
      updatePayload.engagement_level = "cold";
      updatePayload.state_change_reason = "Voicemail — no human contact";

    // --- Interested ---
    } else if (callOutcome === "interested") {
      updatePayload.engagement_level = "warm";
      updatePayload.pipeline_stage = "needs_human_followup";
      updatePayload.status = "qualified";
      updatePayload.handoff_status = "pending";
      updatePayload.handoff_priority = "hot_interest";
      updatePayload.handoff_trigger_source = "ai_outbound";
      updatePayload.handoff_requested_at = now;
      updatePayload.sla_due_at = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      updatePayload.state_change_reason = "Caller expressed interest — human follow-up required";
      updatePayload.operational_score = null;

    // --- Callback ---
    } else if (callOutcome === "callback") {
      updatePayload.callback_status = "pending";
      updatePayload.callback_due_at = callbackDueAt;
      updatePayload.pipeline_stage = "callback_pending";
      updatePayload.status = "callback_pending";
      updatePayload.engagement_level = "warm";
      updatePayload.state_change_reason = `Callback requested for ${callbackDueAt || "unspecified date"}`;
    }

    const { error: updateLeadErr } = await ee
      .from("leads")
      .update(updatePayload)
      .eq("id", leadId);

    if (updateLeadErr) {
      console.error(`[vapi-webhook] Failed to update lead ${leadId}:`, updateLeadErr);
      return json({ error: "Failed to update lead" }, 500);
    }

    // ---------------------------------------------------------------
    // STEP 6.1: GLOBAL PHONE SUPPRESSION (Items 9/12)
    //
    // On DNC or wrong_number: write to blocked_phones + cascade
    // callable=false to ALL leads sharing this phone number.
    // This ensures a single DNC event globally blocks the phone
    // across every lead row and prevents reimport (Item 10).
    // ---------------------------------------------------------------
    if (callOutcome === "dnc" || callOutcome === "wrong_number") {
      const bare10 = phoneNumber.replace(/[^0-9]/g, "").slice(-10);
      const blockReason = callOutcome === "dnc" ? "dnc" : "wrong_number";

      if (bare10.length === 10) {
        // 1. Insert into blocked_phones (global block)
        //    Check first to avoid partial-unique-index conflict with PostgREST upsert
        const { data: existingBlock } = await ee
          .from("blocked_phones")
          .select("id")
          .eq("normalized_phone", bare10)
          .eq("reason", blockReason)
          .eq("active", true)
          .maybeSingle();

        if (!existingBlock) {
          const { error: blockErr } = await ee
            .from("blocked_phones")
            .insert({
              normalized_phone: bare10,
              reason: blockReason,
              source_lead_id: leadId,
              source_comm_id: comm.id,
              blocked_by: "webhook_auto",
              notes: `Auto-blocked from call ${callId}: ${disposition}`,
              active: true,
            });

          if (blockErr) {
            console.error(`[vapi-webhook] blocked_phones insert error: ${blockErr.message}`);
          } else {
            console.log(`[vapi-webhook] 🚫 Phone ${bare10} added to blocked_phones: ${blockReason} (lead ${leadId})`);
          }
        } else {
          console.log(`[vapi-webhook] Phone ${bare10} already in blocked_phones for ${blockReason}`);
        }

        // 2. Cascade: suppress ALL leads sharing this phone
        const { data: siblingLeads, error: siblingErr } = await ee
          .from("leads")
          .select("id")
          .neq("id", leadId)
          .eq("callable", true)
          .like("owner_phone", `%${bare10}`);

        if (!siblingErr && siblingLeads && siblingLeads.length > 0) {
          const siblingIds = siblingLeads.map((l: any) => l.id);
          const { error: cascadeErr } = await ee
            .from("leads")
            .update({
              callable: false,
              outbound_approved: false,
              status_update_source: "webhook_cascade",
              state_change_reason: `Phone ${bare10} blocked via lead ${leadId}: ${blockReason}`,
            })
            .in("id", siblingIds);

          if (cascadeErr) {
            console.error(`[vapi-webhook] Cascade error: ${cascadeErr.message}`);
          } else {
            console.log(`[vapi-webhook] 🚫 CASCADE: ${siblingIds.length} sibling leads suppressed for phone ${bare10}: [${siblingIds.join(",")}]`);
          }
        }

        // 3. Compliance audit trail
        await ee.from("compliance_audit_log").insert({
          event_type: "dnc_added",
          lead_id: leadId,
          phone_number: bare10,
          call_id: callId,
          gate_name: "webhook_suppression",
          gate_result: "block",
          reason: `Phone globally blocked: ${blockReason} from call ${callId}`,
          dnc_status: "blocked",
          source: "webhook",
        });
      } else {
        console.warn(`[vapi-webhook] Cannot block phone — invalid bare10: '${bare10}' from '${phoneNumber}'`);
      }
    }

    // ---------------------------------------------------------------
    // STEP 6.5: FOLLOW-UP CLOSE-THE-LOOP (PATCH 4)
    //
    // Mark any open follow-ups for this lead as completed, then
    // cancel any remaining pending/scheduled (superseded by new result).
    // ---------------------------------------------------------------
    await ee
      .from("follow_ups")
      .update({
        status: "completed",
        completed_at: now,
        dispatcher_lock_until: null,
        notes: `Call completed: ${disposition}`,
        status_update_source: "webhook",
        state_change_reason: `Call ${callId}: ${disposition}`,
      })
      .eq("lead_id", leadId)
      .in("status", ["scheduled", "processing"])
      .is("completed_at", null);

    await ee
      .from("follow_ups")
      .update({
        status: "canceled",
        canceled_at: now,
        notes: `Superseded by call ${callId}: ${disposition}`,
        status_update_source: "webhook",
        state_change_reason: `Superseded by call ${callId}: ${disposition}`,
      })
      .eq("lead_id", leadId)
      .eq("status", "pending");

    // ---------------------------------------------------------------
    // STEP 6.6: RETRY FOLLOW-UP CREATION (PATCH 3)
    //
    // For voicemail and no_answer/no_contact: create a retry follow-up
    // with attempt-aware spacing. Terminal dispositions get no follow-up.
    // ---------------------------------------------------------------
    const attemptCounts = await countAttempts(ee, leadId);
    const followUp = buildFollowUp(disposition, leadId, attemptCounts, callbackDueAt);

    if (followUp) {
      followUp.communication_id = comm.id;
      const { error: fuErr } = await ee.from("follow_ups").insert(followUp);
      if (fuErr) {
        console.error(`[vapi-webhook] Follow-up insert error: ${fuErr.message}`);
      } else {
        console.log(
          `[vapi-webhook] Follow-up created: ${followUp.kind} for lead ${leadId} ` +
          `at ${followUp.scheduled_for} (na=${attemptCounts.no_answer}, vm=${attemptCounts.voicemail})`
        );

        // Sync next_followup_date for calendar visibility
        await ee.from("leads").update({
          next_followup_date: followUp.scheduled_for,
        }).eq("id", leadId);
      }
    } else {
      // Clear stale calendar entry when no follow-up exists
      await ee.from("leads").update({
        next_followup_date: null,
      }).eq("id", leadId);

      // UNIFIED COLD EXHAUSTION: auto-dead when combined cold attempts >= COLD_MAX_ATTEMPTS
      if (
        (disposition === "no_contact" || disposition === "voicemail") &&
        attemptCounts.cold_total >= COLD_MAX_ATTEMPTS
      ) {
        await ee.from("leads").update({
          engagement_level: "dead",
          death_reason: "no_response",
          callable: false,
          outbound_approved: false,
          exhaustion_status: "exhausted",
          status: "dead",
          updated_at: now,
          status_update_source: "webhook",
          state_change_reason: `Auto-dead: ${attemptCounts.cold_total} cold attempts exhausted (${attemptCounts.no_answer} no-answer + ${attemptCounts.voicemail} voicemail)`,
        }).eq("id", leadId);
        console.log(
          `[vapi-webhook] Lead ${leadId} COLD EXHAUSTED: ${attemptCounts.cold_total} total ` +
          `(${attemptCounts.no_answer} no-answer + ${attemptCounts.voicemail} voicemail) → exhaustion_status=exhausted`
        );
      }
    }

    // ---------------------------------------------------------------
    // STEP 6.8: CALLBACK CAP ENFORCEMENT (Item 13B)
    //
    // After CALLBACK_MAX_ATTEMPTS callback-type calls to a lead
    // without successful resolution, transition to hold_review.
    // This prevents infinite callback loops.
    // ---------------------------------------------------------------
    if (callOutcome === "callback" && attemptCounts.callback_attempts >= CALLBACK_MAX_ATTEMPTS) {
      const DAY = 24 * 60 * 60 * 1000;
      await ee.from("leads").update({
        status: "hold_review",
        pipeline_stage: "needs_human_followup",
        callable: false,
        outbound_approved: false,
        handoff_status: "pending",
        sla_due_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        state_change_reason: `Callback cap reached: ${attemptCounts.callback_attempts}/${CALLBACK_MAX_ATTEMPTS} callback attempts without resolution`,
        updated_at: now,
        status_update_source: "webhook",
      }).eq("id", leadId);

      // Cancel any pending callback follow-ups
      await ee.from("follow_ups").update({
        status: "canceled",
        canceled_at: now,
        notes: `Callback cap (${CALLBACK_MAX_ATTEMPTS}) reached — lead moved to hold_review`,
      }).eq("lead_id", leadId).eq("kind", "callback").in("status", ["pending", "scheduled"]);

      console.log(
        `[vapi-webhook] 🛑 CALLBACK CAP (13B): lead ${leadId} hit ${attemptCounts.callback_attempts} callback attempts → hold_review`
      );
    }

    // ---------------------------------------------------------------
    // STEP 6.9: CONFLICTING DISPOSITION DETECTION (Item 13D)
    //
    // If a lead flips between interested↔not_interested within 48h,
    // something is wrong. Move to hold_review for human triage.
    // ---------------------------------------------------------------
    if (callOutcome === "interested" || callOutcome === "not_interested") {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const conflictDisp = callOutcome === "interested" ? "not_interested" : "interested";

      const { data: conflicting } = await ee
        .from("communications")
        .select("id, disposition, created_at")
        .eq("lead_id", leadId)
        .eq("direction", "outbound")
        .eq("disposition", conflictDisp)
        .gte("created_at", twoDaysAgo)
        .limit(1);

      if (conflicting && conflicting.length > 0) {
        await ee.from("leads").update({
          status: "hold_review",
          pipeline_stage: "needs_human_followup",
          callable: false,
          outbound_approved: false,
          handoff_status: "pending",
          sla_due_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          state_change_reason: `Conflicting dispositions within 48h: ${conflictDisp} then ${disposition} — requires human review`,
          updated_at: now,
          status_update_source: "webhook",
        }).eq("id", leadId);

        console.log(
          `[vapi-webhook] ⚠️ CONFLICTING DISPOSITIONS (13D): lead ${leadId} had ${conflictDisp} then ${disposition} within 48h → hold_review`
        );
      }
    }

    // ---------------------------------------------------------------
    // STEP 6.10: COOLDOWN WRITE (Item 13C)
    //
    // After 2nd voicemail, set outreach_cooldown_until = now + 7 days.
    // This gives Gate 7 in trigger-call something to enforce.
    // The field is belt-and-suspenders on top of follow-up spacing.
    // ---------------------------------------------------------------
    if (disposition === "voicemail" && attemptCounts.voicemail >= 2) {
      const cooldownUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await ee.from("leads").update({
        outreach_cooldown_until: cooldownUntil,
        updated_at: now,
      }).eq("id", leadId);
      console.log(
        `[vapi-webhook] ❄️ COOLDOWN (13C): lead ${leadId} voicemail #${attemptCounts.voicemail} → cooldown until ${cooldownUntil}`
      );
    }

    // ---------------------------------------------------------------
    // STEP 7: Post-disposition recompute (Phase 6.4)
    // ---------------------------------------------------------------
    if (
      callOutcome === "interested" ||
      callOutcome === "callback" ||
      callOutcome === "dnc"
    ) {
      try {
        const result = await ee.rpc("post_disposition_recompute", {
          p_lead_id: leadId,
        });
        if (result.error) {
          console.error(`[vapi-webhook] post_disposition_recompute error:`, result.error);
        }
      } catch (err) {
        console.error(`[vapi-webhook] post_disposition_recompute exception:`, err);
      }
    }

    return json({
      ok: true,
      lead_id: leadId,
      disposition,
      outcome: callOutcome,
      callback_due: callbackDueAt,
      timestamp: now,
    });
  } catch (error) {
    console.error("[vapi-webhook] Error:", error);
    return json({ error: String(error) }, 500);
  }
});

// =====================================================================
// ATTEMPT COUNTER: Query communications to count prior attempts
// =====================================================================

async function countAttempts(ee: any, leadId: number): Promise<{
  no_answer: number;
  voicemail: number;
  cold_total: number;
  callback_attempts: number;
  total_outbound: number;
}> {
  const { data: comms, error } = await ee
    .from("communications")
    .select("disposition, direction")
    .eq("lead_id", leadId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !comms) {
    return { no_answer: 0, voicemail: 0, cold_total: 0, callback_attempts: 0, total_outbound: 0 };
  }

  let no_answer = 0;
  let voicemail = 0;
  let callback_attempts = 0;

  for (const c of comms) {
    const d = (c.disposition || "").toLowerCase();
    if (d === "no_answer" || d === "no_contact") no_answer++;
    if (d === "voicemail") voicemail++;
    if (d === "callback_requested") callback_attempts++;
  }

  // Combined cold counter: any no-human-contact attempt counts toward
  // the single canonical exhaustion threshold (3 cold attempts total).
  const cold_total = no_answer + voicemail;

  return { no_answer, voicemail, cold_total, callback_attempts, total_outbound: comms.length };
}

// =====================================================================
// FOLLOW-UP BUILDER: Attempt-aware retry scheduling
//
// Policy (UNIFIED COLD EXHAUSTION):
//   Cold attempts (voicemail + no_answer + no_contact) share ONE counter.
//   STOP after 3 total cold attempts across all dispositions.
//   Spacing: 4 days after cold #1, 7 days after cold #2+.
//   callback:   exact requested date (handled by lead update, not here)
//   interested: NO auto-retry (manual review)
//   terminal:   no follow-up ever
// =====================================================================

const COLD_MAX_ATTEMPTS = 3;
const CALLBACK_MAX_ATTEMPTS = 5;  // 13B: 5 callback attempts → hold_review

function buildFollowUp(
  disposition: string,
  leadId: number,
  attempts: { no_answer: number; voicemail: number; cold_total: number; total_outbound: number },
  callbackDueAt?: string | null,
): Record<string, any> | null {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // --- COLD DISPOSITIONS (unified counter) ---
  if (disposition === "no_contact" || disposition === "voicemail") {
    if (attempts.cold_total >= COLD_MAX_ATTEMPTS) return null;

    // Spacing: 4 days after 1st cold attempt, 7 days after 2nd+
    const waitDays = attempts.cold_total <= 1 ? 4 : 7;
    const scheduledFor = new Date(now + waitDays * DAY).toISOString();
    const kind = disposition === "voicemail" ? "voicemail_retry" : "no_answer_retry";

    return {
      lead_id: leadId,
      kind,
      source: "vapi_webhook",
      status: "pending",
      priority: disposition === "no_contact" ? 40 : 35,
      reason: `Cold attempt #${attempts.cold_total}/${COLD_MAX_ATTEMPTS} (${disposition}) — retry in ${waitDays}d.`,
      scheduled_for: scheduledFor,
      status_update_source: "webhook",
      state_change_reason: `Cold attempt #${attempts.cold_total} (${disposition}) — auto-retry in ${waitDays}d`,
    };
  }

  // --- CALLBACK REQUESTED ---
  if (disposition === "callback_requested") {
    // Use the parsed callback date if available; fall back to +1 day
    let scheduledFor: string;
    if (callbackDueAt) {
      // callbackDueAt is YYYY-MM-DD; schedule for noon ET that day
      scheduledFor = new Date(`${callbackDueAt}T12:00:00-04:00`).toISOString();
    } else {
      scheduledFor = new Date(now + 1 * DAY).toISOString();
    }

    return {
      lead_id: leadId,
      kind: "callback",
      source: "vapi_webhook",
      status: "pending",
      priority: 70, // High priority — seller asked for this call
      reason: `Callback requested for ${callbackDueAt || "next day"}`,
      scheduled_for: scheduledFor,
      status_update_source: "webhook",
      state_change_reason: `Callback requested — auto-scheduled for ${callbackDueAt || "next day"}`,
    };
  }

  // Everything else: no automatic follow-up
  return null;
}

// =====================================================================
// Parse callback date from natural language in transcript/summary
// (kept from v19 base — no changes)
// =====================================================================
function parseCallbackDate(transcript: string, summary: string): string | null {
  const text = (transcript + " " + summary).toLowerCase();
  const now = new Date();

  if (text.includes("tomorrow")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateISO(tomorrow);
  }

  const dayNames = [
    "sunday", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday",
  ];
  for (let i = 0; i < dayNames.length; i++) {
    if (text.includes(`next ${dayNames[i]}`) || text.includes(`this ${dayNames[i]}`)) {
      let daysAhead = i - now.getDay();
      if (daysAhead <= 0) daysAhead += 7;
      const date = new Date(now);
      date.setDate(date.getDate() + daysAhead);
      return formatDateISO(date);
    }
  }

  const weekMatch = text.match(/next\s+week|in\s+(\d+)\s+days?/);
  if (weekMatch) {
    const days = weekMatch[1] ? parseInt(weekMatch[1]) : 7;
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    return formatDateISO(date);
  }

  if (text.includes("couple") || text.includes("few")) {
    const date = new Date(now);
    date.setDate(date.getDate() + 14);
    return formatDateISO(date);
  }

  if (text.includes("next month") || text.includes("a month")) {
    const date = new Date(now);
    date.setMonth(date.getMonth() + 1);
    return formatDateISO(date);
  }

  const defaultDate = new Date(now);
  defaultDate.setDate(defaultDate.getDate() + 3);
  return formatDateISO(defaultDate);
}

function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0];
}
