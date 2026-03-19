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
    // ==========================================

    if (!canDial(lead)) {
      return json({
        error: "Lead blocked by dispatcher gate",
        lead_id: lead.id,
        reason: getBlockReason(lead)
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
// ==========================================

function canDial(lead: any): boolean {
  // Gate 1: Must be callable
  if (!lead.callable) {
    console.log(`[GATE BLOCK] Lead ${lead.id} callable=false`);
    return false;
  }

  // Gate 2: Must be approved for outbound
  if (!lead.outbound_approved) {
    console.log(`[GATE BLOCK] Lead ${lead.id} outbound_approved=false`);
    return false;
  }

  // Gate 3: Terminal outcomes (dead/dnc)
  if (lead.engagement_level === 'dead') {
    console.log(`[GATE BLOCK] Lead ${lead.id} engagement_level=dead`);
    return false;
  }

  if (lead.engagement_level === 'dnc') {
    console.log(`[GATE BLOCK] Lead ${lead.id} engagement_level=dnc`);
    return false;
  }

  // Gate 4: Cold attempt limit (after engagement_level migration)
  if (lead.engagement_level === 'cold' && (lead.cold_attempts ?? 0) >= 3) {
    console.log(`[GATE BLOCK] Lead ${lead.id} exceeded cold attempt limit (${lead.cold_attempts}/3)`);
    return false;
  }

  // Gate 5: Phone number validation
  if (!lead.owner_phone || lead.owner_phone.length < 10) {
    console.log(`[GATE BLOCK] Lead ${lead.id} has invalid phone`);
    return false;
  }

  // All gates passed
  return true;
}

function getBlockReason(lead: any): string {
  if (!lead.callable) return "not_callable";
  if (!lead.outbound_approved) return "not_approved_for_outbound";
  if (lead.engagement_level === 'dead') return "lead_is_dead";
  if (lead.engagement_level === 'dnc') return "do_not_call";
  if (lead.engagement_level === 'cold' && (lead.cold_attempts ?? 0) >= 3) return "cold_attempt_limit_exceeded";
  if (!lead.owner_phone || lead.owner_phone.length < 10) return "invalid_phone_number";
  return "unknown";
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
