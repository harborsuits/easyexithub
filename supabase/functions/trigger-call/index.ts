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
    const { lead_id } = await req.json();
    
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
    // DISPATCHER GATE — Final compliance layer
    // See CONTACT_GOVERNANCE_POLICY.md
    // ==========================================

    const gateResult = await canDial(lead, ee);
    if (!gateResult.allowed) {
      return json({
        error: "Lead blocked by dispatcher gate",
        lead_id: lead.id,
        reason: gateResult.reason,
      }, 403);
    }

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

    // Log call initiation
    console.log(`[trigger-call] ✅ Call initiated: lead ${lead.id}, call_id ${vapiData.id}`);

    return json({
      ok: true,
      lead_id: lead.id,
      call_id: vapiData.id,
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

  // All gates passed
  console.log(`[GATE PASS] Lead ${lead.id} — all 7 gates cleared`);
  return { allowed: true, reason: "all_gates_passed" };
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

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
