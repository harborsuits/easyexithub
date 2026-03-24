import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EE_URL = "https://bgznglzzknmetzpwkbbz.supabase.co";
const EE_KEY = Deno.env.get("EASYEXIT_SERVICE_ROLE_KEY")!;
const VAPI_API_KEY = Deno.env.get("VAPI_API_KEY")!;
const VAPI_ASSISTANT_ID = Deno.env.get("VAPI_ASSISTANT_ID")!; // Alex

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const { lead_id, test_mode } = await req.json();
    
    if (!lead_id) {
      return json({ error: "lead_id required" }, 400);
    }

    const ee = createClient(EE_URL, EE_KEY);

    // Fetch lead with all gate fields
    const { data: lead, error: leadErr } = await ee
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (leadErr || !lead) {
      return json({ error: "Lead not found" }, 404);
    }

    // ==========================================
    // GATE -1: MASTER OUTBOUND KILL SWITCH
    // Fail-closed: if system_config is missing or unreadable, block.
    // When outbound_calling_enabled=false:
    //   - ONLY test_mode=true AND is_test_lead=true may proceed
    //   - All real leads are hard-blocked with 403
    // When test_mode_only=true:
    //   - Same restriction even if outbound_calling_enabled=true
    // ==========================================
    const { data: sysConfig, error: sysConfigErr } = await ee
      .from("system_config")
      .select("outbound_calling_enabled, test_mode_only")
      .eq("id", 1)
      .maybeSingle();

    // Fail-closed: if we can't read config, block everything
    if (sysConfigErr || !sysConfig) {
      console.error(`[GATE -1 BLOCK] system_config unreadable: ${sysConfigErr?.message || "no row"}. Fail-closed.`);
      // Still allow test leads in test mode (safe path)
      if (test_mode && lead.is_test_lead) {
        console.log(`[GATE -1 PASS] Config unreadable but test_mode+is_test_lead — allowing test call`);
      } else {
        await logComplianceEvent(ee, {
          event_type: "attempt_blocked",
          lead_id: lead.id,
          phone_number: lead.owner_phone,
          gate_name: "master_kill_switch",
          gate_result: "block",
          reason: "system_config_unreadable_fail_closed",
          source: "trigger-call",
        });
        return json({
          error: "Outbound calling blocked — system config unreadable (fail-closed)",
          lead_id: lead.id,
          reason: "outbound_paused",
        }, 403);
      }
    }

    const outboundEnabled = sysConfig?.outbound_calling_enabled ?? false;
    const testModeOnly = sysConfig?.test_mode_only ?? true;

    if (!outboundEnabled || testModeOnly) {
      const isTestCall = test_mode && lead.is_test_lead;
      if (!isTestCall) {
        const reason = !outboundEnabled
          ? "outbound_calling_disabled"
          : "test_mode_only_active";
        console.log(`[GATE -1 BLOCK] Lead ${lead.id}: ${reason}. outbound_enabled=${outboundEnabled}, test_mode_only=${testModeOnly}, test_mode=${test_mode}, is_test_lead=${lead.is_test_lead}`);
        await logComplianceEvent(ee, {
          event_type: "attempt_blocked",
          lead_id: lead.id,
          phone_number: lead.owner_phone,
          gate_name: "master_kill_switch",
          gate_result: "block",
          reason,
          source: "trigger-call",
        });
        return json({
          error: "Outbound calling is paused",
          lead_id: lead.id,
          reason: "outbound_paused",
          detail: reason,
        }, 403);
      }
      console.log(`[GATE -1 PASS] Lead ${lead.id}: test call allowed while outbound paused (test_mode=${test_mode}, is_test_lead=${lead.is_test_lead})`);
    }

    // ==========================================
    // GATE 0-PRE: TEST ISOLATION
    // If test_mode=true is passed, the lead MUST have is_test_lead=true.
    // If the lead has is_test_lead=true, only test_mode callers can dial it.
    // Real leads can NEVER be used as test/canary targets.
    // ==========================================
    if (test_mode && !lead.is_test_lead) {
      console.log(`[GATE BLOCK] Lead ${lead.id} is_test_lead=false — cannot use real lead as test target`);
      return json({
        error: "Test isolation: cannot test against a real lead",
        lead_id: lead.id,
        reason: "real_lead_in_test_mode",
      }, 403);
    }

    // ==========================================
    // DISPATCHER GATE — Final compliance layer
    // See CONTACT_GOVERNANCE_POLICY.md
    // ==========================================

    const gateResult = await canDial(lead, ee);
    if (!gateResult.allowed) {
      // Log blocked attempt to compliance audit
      await logComplianceEvent(ee, {
        event_type: "attempt_blocked",
        lead_id: lead.id,
        phone_number: lead.owner_phone,
        gate_name: gateResult.gate || "dispatcher",
        gate_result: "block",
        reason: gateResult.reason,
        consent_status: lead.consent_status || "none",
        dnc_status: gateResult.dnc_status || null,
        strict_mode: gateResult.strict_mode ?? null,
        source: "trigger-call",
      });

      return json({
        error: "Lead blocked by dispatcher gate",
        lead_id: lead.id,
        reason: gateResult.reason,
      }, 403);
    }

    // Log allowed attempt to compliance audit
    await logComplianceEvent(ee, {
      event_type: "attempt_allowed",
      lead_id: lead.id,
      phone_number: lead.owner_phone,
      gate_name: "all_gates",
      gate_result: "pass",
      reason: `All ${gateResult.gatesPassed || 9} gates cleared`,
      consent_status: lead.consent_status || "none",
      strict_mode: gateResult.strict_mode ?? null,
      source: "trigger-call",
    });

    // Gate passed — place Vapi call
    const vapiResponse = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID,
        phoneNumberId: Deno.env.get("VAPI_PHONE_NUMBER_ID") || "93be402f-255a-4706-bd77-ce3f40a785d4",
        customer: {
          number: toE164(lead.owner_phone),
        },
        // Pass lead context as variables
        assistantOverrides: {
          variableValues: {
            firstName: extractFirstName(lead.owner_name) || "there",
            ownerName: lead.owner_name || "",
            propertyAddress: getPropertyAddress(lead.property_data) || "your property",
            leadId: String(lead.id),
          }
        },
        metadata: {
          lead_id: lead.id,
          source: "easyexit-trigger-call",
        },
      }),
    });

    if (!vapiResponse.ok) {
      const errorText = await vapiResponse.text();
      console.error("[trigger-call] Vapi error:", errorText);
      return json({ error: "Vapi call failed", details: errorText }, 500);
    }

    const vapiData = await vapiResponse.json();
    const callId = vapiData.id;

    // ==========================================
    // Create comm record stub for webhook
    // ==========================================
    // The vapi-webhook requires a pre-existing comm record to update.
    // Create a minimal record now; webhook will populate outcome, analysis, etc.
    const { error: commErr } = await ee
      .from("communications")
      .insert({
        lead_id: lead.id,
        vapi_call_id: callId,
        contact_date: new Date().toISOString().split("T")[0], // YYYY-MM-DD
        contacted_party: lead.owner_name || "",
        phone_number: lead.owner_phone || "",
        owner_name: lead.owner_name || "",
        property_address: getPropertyAddress(lead.property_data) || "",
        direction: "outbound",
        outcome: "pending", // placeholder; webhook will update
        disposition: "pending",
        communication_type_id: 8, // phone call
      });

    if (commErr) {
      console.error(`[trigger-call] Comm record creation failed: ${commErr.message}`);
      // Don't fail the whole request — Vapi call is already placed.
      // Webhook will handle it if needed.
    } else {
      console.log(`[trigger-call] ✅ Comm record created for call ${callId}`);
    }

    // Log call initiation
    console.log(`[trigger-call] ✅ Call initiated: lead ${lead.id}, call_id ${callId}`);

    return json({
      ok: true,
      lead_id: lead.id,
      call_id: callId,
      comm_created: !commErr,
      vapi_data: vapiData,
    });

  } catch (error) {
    console.error("[trigger-call] Error:", error);
    return json({ error: String(error) }, 500);
  }
});

// ==========================================
// DISPATCHER GATE LOGIC
// CONTACT_GOVERNANCE_POLICY.md enforcement
// ==========================================

interface GateResult {
  allowed: boolean;
  reason: string;
  gate?: string;
  dnc_status?: string;
  strict_mode?: boolean;
  gatesPassed?: number;
}

async function canDial(lead: any, ee: any): Promise<GateResult> {
  // Gate 0: TEMPORARY SCOPE GUARD — manual test approval required
  // Only leads explicitly approved for testing can be dialed.
  // Remove this gate when moving to production.
  if (!lead.manual_test_approved) {
    console.log(`[GATE BLOCK] Lead ${lead.id} manual_test_approved=false (scope guard)`);
    return { allowed: false, reason: "not_test_approved" };
  }

  // Gate 0.5: DATA HYGIENE — only clean_new or reconciled leads may auto-dial
  // dirty_legacy and hold_review are blocked even if manual_test_approved is true.
  // manual_test_approved is NOT a bypass for hygiene gating.
  const hygieneStatus = lead.data_hygiene_status || 'dirty_legacy';
  if (!['clean_new', 'reconciled'].includes(hygieneStatus)) {
    console.log(`[GATE BLOCK] Lead ${lead.id} data_hygiene_status=${hygieneStatus} (requires clean_new or reconciled)`);
    return { allowed: false, reason: `hygiene_gate_blocked (${hygieneStatus})` };
  }

  // Gate 0.7: HANDOFF SUPPRESSION — leads in active handoff are human-owned
  // Do not auto-dial leads where handoff_status is pending or in_progress.
  if (lead.handoff_status && ['pending', 'in_progress'].includes(lead.handoff_status)) {
    console.log(`[GATE BLOCK] Lead ${lead.id} handoff_status=${lead.handoff_status} (active handoff — human-owned)`);
    return { allowed: false, reason: `handoff_suppressed (${lead.handoff_status})` };
  }

  // Gate 1: Must be callable
  if (!lead.callable) {
    console.log(`[GATE BLOCK] Lead ${lead.id} callable=false`);
    return { allowed: false, reason: "not_callable" };
  }

  // Gate 2: Must be approved for outbound
  if (!lead.outbound_approved) {
    console.log(`[GATE BLOCK] Lead ${lead.id} outbound_approved=false`);
    return { allowed: false, reason: "not_approved_for_outbound" };
  }

  // Gate 3: Terminal outcomes (dead/dnc)
  if (lead.engagement_level === 'dead') {
    console.log(`[GATE BLOCK] Lead ${lead.id} engagement_level=dead`);
    return { allowed: false, reason: "lead_is_dead" };
  }

  if (lead.engagement_level === 'dnc') {
    console.log(`[GATE BLOCK] Lead ${lead.id} engagement_level=dnc`);
    return { allowed: false, reason: "do_not_call" };
  }

  // Gate 4: Cold attempt limit
  // NOTE: cold_attempts on leads table is not reliably maintained.
  // Real attempt enforcement is in webhook countAttempts() which queries
  // communications table directly. This gate is kept as a safety net
  // but the canonical enforcement is in buildFollowUp().
  // If cold_attempts is populated (e.g. via backfill), still check it.
  if (lead.engagement_level === 'cold' && (lead.cold_attempts ?? 0) >= 3) {
    console.log(`[GATE BLOCK] Lead ${lead.id} cold_attempts=${lead.cold_attempts} >= 3 (safety net)`);
    return { allowed: false, reason: "cold_attempt_limit_exceeded" };
  }

  // Gate 5: Phone number validation
  if (!lead.owner_phone || lead.owner_phone.length < 10) {
    console.log(`[GATE BLOCK] Lead ${lead.id} has invalid phone`);
    return { allowed: false, reason: "invalid_phone_number" };
  }

  // Gate 5b: Safety net — wrong_number_flag or opt_out flag
  // Catches data integrity issues where flags weren't properly synced
  if (lead.wrong_number_flag) {
    console.log(`[GATE BLOCK] Lead ${lead.id} wrong_number_flag=true`);
    return { allowed: false, reason: "wrong_number_flag" };
  }

  if (lead.opt_out) {
    console.log(`[GATE BLOCK] Lead ${lead.id} opt_out=true`);
    return { allowed: false, reason: "opted_out" };
  }

  // Gate 5d: GLOBAL PHONE SUPPRESSION — blocked_phones table
  // This catches phones blocked through any lead row (DNC, wrong number, etc)
  // and prevents calling even if this specific lead row wasn't updated
  if (lead.owner_phone) {
    const bare10 = lead.owner_phone.replace(/[^0-9]/g, '').slice(-10);
    const { data: blocked } = await ee
      .from("blocked_phones")
      .select("id, reason")
      .eq("normalized_phone", bare10)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (blocked) {
      console.log(`[GATE BLOCK] Lead ${lead.id} phone ${bare10} is globally blocked: ${blocked.reason}`);
      return { allowed: false, reason: `phone_globally_blocked (${blocked.reason})` };
    }
  }

  // Gate 5e: PHONE-LEVEL RECENT ATTEMPT GUARD
  // Prevents calling the same phone number (across ALL leads) within 3 days.
  // This catches the "same person, multiple lead records" scenario that
  // lead-level spacing (Gate 6) misses.
  if (lead.owner_phone) {
    const bare10 = lead.owner_phone.replace(/[^0-9]/g, '').slice(-10);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentCalls, error: recentErr } = await ee
      .from("communications")
      .select("id, lead_id, created_at")
      .eq("direction", "outbound")
      .like("phone_number", `%${bare10}`)
      .gte("created_at", threeDaysAgo)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!recentErr && recentCalls && recentCalls.length > 0) {
      const lastCall = recentCalls[0];
      const hoursSince = (Date.now() - new Date(lastCall.created_at).getTime()) / (60 * 60 * 1000);
      console.log(`[GATE BLOCK] Lead ${lead.id} phone ${bare10} called ${hoursSince.toFixed(1)}h ago (lead #${lastCall.lead_id}, comm #${lastCall.id}). 3-day phone guard.`);
      return {
        allowed: false,
        reason: `phone_recently_called (${hoursSince.toFixed(1)}h ago via lead #${lastCall.lead_id})`,
        gate: "phone_recent_attempt",
      };
    }
  }

  // Gate 6: MINIMUM SPACING — Contact governance enforcement
  // Prevents calling a lead too soon after last contact.
  // Policy: no_answer=4d min, voicemail=6d min, callback=exact date only
  if (lead.last_contact_date) {
    const lastContact = new Date(lead.last_contact_date).getTime();
    const now = Date.now();
    const daysSinceContact = (now - lastContact) / (24 * 60 * 60 * 1000);

    // Hard floor: never call within 3 days of last contact
    // (callbacks with explicit dates bypass this via contact_override_until)
    if (daysSinceContact < 3) {
      // Exception: if contact_override_until is set and we're past it, allow
      // (this handles callbacks with explicit requested dates)
      if (lead.contact_override_until) {
        const overrideDate = new Date(lead.contact_override_until).getTime();
        if (now >= overrideDate) {
          console.log(`[GATE PASS] Lead ${lead.id} within 3d but contact_override_until reached — callback allowed`);
          // Fall through to pass
        } else {
          console.log(`[GATE BLOCK] Lead ${lead.id} contacted ${daysSinceContact.toFixed(1)}d ago (min 3d). Override not yet reached.`);
          return { allowed: false, reason: `min_spacing_not_met (${daysSinceContact.toFixed(1)}d < 3d minimum)` };
        }
      } else {
        console.log(`[GATE BLOCK] Lead ${lead.id} contacted ${daysSinceContact.toFixed(1)}d ago (min 3d).`);
        return { allowed: false, reason: `min_spacing_not_met (${daysSinceContact.toFixed(1)}d < 3d minimum)` };
      }
    }
  }

  // Gate 7: Cooldown check (explicit cooldown set by system or manual)
  // NOTE: No code currently writes outreach_cooldown_until. This gate exists
  // for future use (manual cool-off periods, soft-no nurture delays, etc).
  // It is structurally safe: if the field is null, this is a no-op.
  if (lead.outreach_cooldown_until) {
    const cooldownEnd = new Date(lead.outreach_cooldown_until).getTime();
    if (Date.now() < cooldownEnd) {
      console.log(`[GATE BLOCK] Lead ${lead.id} in cooldown until ${lead.outreach_cooldown_until}`);
      return { allowed: false, reason: `cooldown_active (until ${lead.outreach_cooldown_until})` };
    }
  }

  // Gate 8: DIALING HOURS — timezone-safe calling window (9am–8pm local)
  // Phase 3 enforcement: don't dial outside business hours in the lead's timezone
  // Respects contact_timezone column populated by timezone_resolver
  // Uses Intl.DateTimeFormat with hour12:false for reliable 24-hour parsing
  const tz = lead.contact_timezone || "America/New_York";
  const localHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  const localHour = parseInt(localHourStr, 10);

  if (localHour < 9 || localHour >= 20) {
    // Outside 9am–8pm window in lead's local timezone
    console.log(`[GATE BLOCK] Lead ${lead.id} (tz=${tz}) local hour ${localHour} outside 9–20 dialing window`);
    return { allowed: false, reason: `outside_dialing_hours (local ${localHour}:00 in ${tz})` };
  }

  // ==========================================
  // Gate 9: TCPA / AI VOICE COMPLIANCE
  // Strict compliance mode enforcement
  // ==========================================

  // Load compliance config (single-row table, id=1)
  const { data: compConfig } = await ee
    .from("compliance_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const strictMode = compConfig?.strict_mode ?? true; // Default strict

  if (strictMode) {
    // 9a: Compliance hold check
    if (lead.compliance_hold) {
      console.log(`[GATE BLOCK] Lead ${lead.id} on compliance hold: ${lead.compliance_hold_reason || "no reason"}`);
      return { allowed: false, reason: `compliance_hold (${lead.compliance_hold_reason || "manual hold"})`, gate: "tcpa_compliance_hold", strict_mode: true };
    }

    // 9b: Consent status check
    // In strict mode, outbound AI calls require some form of consent:
    //   - 'public_record': OK for initial contact (1st-3rd attempt)
    //   - 'verbal', 'callback', 'written': OK always
    //   - 'none': blocked after max_cold_without_consent attempts
    //   - 'revoked': always blocked
    const consentStatus = lead.consent_status || "none";
    const maxColdWithout = compConfig?.max_cold_without_consent ?? 3;
    const outreachCount = lead.outreach_count ?? 0;

    // Consent statuses that permit outbound:
    // 'open' (legacy default), 'public_record', 'verbal', 'callback', 'written'
    // Blocked: 'revoked' always, 'none' after max_cold_without_consent attempts
    const permittedConsent = ["open", "public_record", "verbal", "callback", "written"];

    if (consentStatus === "revoked") {
      console.log(`[GATE BLOCK] Lead ${lead.id} consent_status=revoked`);
      return { allowed: false, reason: "consent_revoked", gate: "tcpa_consent", strict_mode: true };
    }

    if (consentStatus === "none" && outreachCount >= maxColdWithout) {
      console.log(`[GATE BLOCK] Lead ${lead.id} consent_status=none, outreach_count=${outreachCount} >= ${maxColdWithout} (consent required)`);
      return { allowed: false, reason: `consent_required_after_${maxColdWithout}_attempts (current: ${outreachCount})`, gate: "tcpa_consent", strict_mode: true };
    }

    if (compConfig?.require_prior_consent && consentStatus === "none" && outreachCount === 0) {
      // For first contact on 'none' consent: check if lead source provides implied consent
      // Public records (VGSI, probate, foreclosure) provide implied consent for initial outreach
      const impliedSources = ["vgsi", "probate", "foreclosure", "tax_lien", "public_record"];
      const leadSource = (lead.lead_source || "").toLowerCase();
      if (!impliedSources.includes(leadSource)) {
        console.log(`[GATE BLOCK] Lead ${lead.id} no consent and non-public source (${leadSource})`);
        return { allowed: false, reason: `no_consent_non_public_source (${leadSource})`, gate: "tcpa_consent", strict_mode: true };
      }
      // Public record source — implied consent OK for initial contact
      console.log(`[GATE PASS] Lead ${lead.id} public_record implied consent from source=${leadSource}`);
    }

    // 9c: DNC registry check (internal + blocked_phones, federal when available)
    if (compConfig?.require_dnc_check) {
      // Internal DNC is already covered by Gate 5d (blocked_phones).
      // This gate checks tcpa_eligible flag which can be set by external DNC lookups.
      if (lead.tcpa_eligible === false) {
        console.log(`[GATE BLOCK] Lead ${lead.id} tcpa_eligible=false (DNC registry match or manual flag)`);
        return { allowed: false, reason: "tcpa_ineligible (DNC registry or manual flag)", gate: "tcpa_dnc", dnc_status: "blocked", strict_mode: true };
      }
    }
  }

  // All gates passed
  console.log(`[GATE PASS] Lead ${lead.id} — all 9 gates cleared (strict_mode=${strictMode})`);
  return { allowed: true, reason: "all_gates_passed", strict_mode: strictMode, gatesPassed: 9 };
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function extractFirstName(ownerName: string): string {
  if (!ownerName) return "";

  // Clean up: remove trailing "&", extra spaces
  const clean = ownerName.replace(/\s*&\s*$/, "").replace(/\s+/g, " ").trim();

  // Format 1: "LAST, FIRST MIDDLE" — comma separated
  if (clean.includes(",")) {
    const parts = clean.split(",");
    const firstPart = parts[1]?.trim() || "";
    const firstName = firstPart.split(" ")[0] || "";
    // Title case: "ANTHONY" → "Anthony"
    return titleCase(firstName);
  }

  // Format 2: "LAST FIRST MIDDLE" or "Last First" — no comma, LAST is first word
  // Property records almost always put last name first
  const words = clean.split(" ").filter(Boolean);
  if (words.length >= 2) {
    // Second word is the first name
    return titleCase(words[1]);
  }

  return titleCase(words[0] || "");
}

function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function toE164(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (phone.startsWith("+")) return phone;
  return "+1" + digits;
}

function getPropertyAddress(propertyData: any): string {
  if (!propertyData) return "";
  
  const pd = typeof propertyData === 'string' ? JSON.parse(propertyData) : propertyData;
  
  return pd?.address || pd?.property_address || "";
}

// ==========================================
// COMPLIANCE AUDIT LOGGING
// Every attempt (allowed or blocked) is recorded
// ==========================================

interface ComplianceEvent {
  event_type: string;
  lead_id: number;
  phone_number?: string;
  call_id?: string;
  follow_up_id?: number;
  gate_name: string;
  gate_result: string;
  reason: string;
  consent_status?: string;
  dnc_status?: string;
  strict_mode?: boolean | null;
  source: string;
  metadata?: Record<string, any>;
}

async function logComplianceEvent(ee: any, event: ComplianceEvent): Promise<void> {
  try {
    const { error } = await ee
      .from("compliance_audit_log")
      .insert({
        event_type: event.event_type,
        lead_id: event.lead_id,
        phone_number: event.phone_number || null,
        call_id: event.call_id || null,
        follow_up_id: event.follow_up_id || null,
        gate_name: event.gate_name,
        gate_result: event.gate_result,
        reason: event.reason,
        consent_status: event.consent_status || null,
        dnc_status: event.dnc_status || null,
        strict_mode: event.strict_mode ?? null,
        source: event.source,
        metadata: event.metadata || null,
      });

    if (error) {
      console.error(`[compliance-audit] Failed to log event: ${error.message}`);
    }
  } catch (e) {
    // Never let audit logging failure block the call flow
    console.error(`[compliance-audit] Exception: ${String(e)}`);
  }
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
