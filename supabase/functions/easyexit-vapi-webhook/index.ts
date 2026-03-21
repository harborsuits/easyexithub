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
    // ---------------------------------------------------------------
    const { data: comm, error: commErr } = await ee
      .from("communications")
      .select("*")
      .eq("vapi_call_id", callId)
      .single();

    if (commErr || !comm) {
      console.log(`[vapi-webhook] No communications record for callId=${callId}`);
      return json({ ok: true, warning: "No communication record found" });
    }

    const leadId = comm.lead_id;

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
    // ---------------------------------------------------------------
    let disposition = "unknown";
    let callOutcome = "other";

    const transcript = (payload.call?.transcript || "").toLowerCase();
    const summary = (payload.call?.analysis?.summary || "").toLowerCase();
    const endedReason = payload.call?.endedReason?.toLowerCase() || "";

    // Pattern matching for disposition
    if (
      endedReason.includes("hangup") ||
      endedReason.includes("machine") ||
      transcript.includes("leave a message")
    ) {
      disposition = "voicemail";
      callOutcome = "voicemail";
    } else if (
      transcript.includes("interested") ||
      transcript.includes("yes") ||
      summary.includes("interested")
    ) {
      disposition = "interested";
      callOutcome = "interested";
    } else if (
      transcript.includes("do not call") ||
      transcript.includes("do not contact") ||
      transcript.includes("stop calling") ||
      summary.includes("do not call")
    ) {
      disposition = "do_not_call";
      callOutcome = "dnc";
    } else if (
      transcript.includes("wrong number") ||
      transcript.includes("incorrect")
    ) {
      disposition = "wrong_number";
      callOutcome = "wrong_number";
    } else if (
      transcript.includes("callback") ||
      transcript.includes("call me back") ||
      transcript.includes("call back")
    ) {
      disposition = "callback_requested";
      callOutcome = "callback";
    } else if (
      transcript.includes("not interested") ||
      transcript.includes("not interested")
    ) {
      disposition = "not_interested";
      callOutcome = "not_interested";
    } else if (endedReason.includes("error") || endedReason.includes("failed")) {
      disposition = "failed";
      callOutcome = "other";
    } else {
      disposition = "completed";
      callOutcome = "other";
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
        disposition,
        completed_at: now,
        transcript: transcript.substring(0, 5000),
        notes: summary?.substring(0, 1000) || null,
      })
      .eq("id", comm.id);

    if (updateCommErr) {
      console.error("[vapi-webhook] Failed to update communications:", updateCommErr);
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
    };

    // Update status based on outcome
    if (callOutcome === "dnc") {
      updatePayload.dnc_listed = true;
      updatePayload.callable = false;
      updatePayload.outbound_approved = false;
      updatePayload.status = "suppressed";
      updatePayload.state_change_reason = "DNC request during call";
    } else if (callOutcome === "wrong_number") {
      updatePayload.wrong_number_flag = true;
      updatePayload.wrong_number_at = now;
      updatePayload.status = "hold_review";
      updatePayload.state_change_reason = "Wrong number identified";
    } else if (callOutcome === "interested") {
      updatePayload.engagement_level = "warm";
      updatePayload.pipeline_stage = "needs_human_followup";
      updatePayload.status = "qualified";
      updatePayload.state_change_reason = "Caller expressed interest";
      // Trigger inline score recompute
      updatePayload.operational_score = null; // Will be computed
    } else if (callOutcome === "callback") {
      updatePayload.callback_status = "scheduled";
      updatePayload.callback_due_at = callbackDueAt;
      updatePayload.pipeline_stage = "callback_scheduled";
      updatePayload.status = "callback_pending";
      updatePayload.state_change_reason = `Callback requested for ${callbackDueAt || 'unspecified date'}`;
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
// Parse callback date from natural language in transcript/summary
// =====================================================================
function parseCallbackDate(transcript: string, summary: string): string | null {
  const text = (transcript + " " + summary).toLowerCase();
  const now = new Date();

  // Tomorrow
  if (text.includes("tomorrow")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateISO(tomorrow);
  }

  // Next [day of week]
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  for (let i = 0; i < dayNames.length; i++) {
    if (text.includes(`next ${dayNames[i]}`) || text.includes(`this ${dayNames[i]}`)) {
      let targetDay = i;
      let daysAhead = targetDay - now.getDay();
      if (daysAhead <= 0) daysAhead += 7;
      const date = new Date(now);
      date.setDate(date.getDate() + daysAhead);
      return formatDateISO(date);
    }
  }

  // Next week / in X days
  const weekMatch = text.match(/next\s+week|in\s+(\d+)\s+days?/);
  if (weekMatch) {
    const days = weekMatch[1] ? parseInt(weekMatch[1]) : 7;
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    return formatDateISO(date);
  }

  // In X weeks / couple of weeks
  if (text.includes("couple") || text.includes("few")) {
    const date = new Date(now);
    date.setDate(date.getDate() + 14);
    return formatDateISO(date);
  }

  // Next month / a month
  if (text.includes("next month") || text.includes("a month")) {
    const date = new Date(now);
    date.setMonth(date.getMonth() + 1);
    return formatDateISO(date);
  }

  // Default: 3 days out
  const defaultDate = new Date(now);
  defaultDate.setDate(defaultDate.getDate() + 3);
  return formatDateISO(defaultDate);
}

function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0];
}
