import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Easy Exit Supabase instance
const EE_URL = "https://bgznglzzknmetzpwkbbz.supabase.co";
const EE_KEY = Deno.env.get("EASYEXIT_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return json({ ok: true }, 200);
  }

  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const body = await req.json();
    const { caller_phone } = body;

    if (!caller_phone) {
      return json({ error: "caller_phone required" }, 400);
    }

    const ee = createClient(EE_URL, EE_KEY);
    const resolved = await resolveInboundCaller(caller_phone, ee);

    return json(resolved);
  } catch (error) {
    console.error("[inbound-resolver] Error:", error);
    return json({ error: String(error) }, 500);
  }
});

// =====================================================================
// STAGE HEAT MAP — higher = hotter pipeline position
// =====================================================================
const STAGE_HEAT: Record<string, number> = {
  new: 1,
  cold_outreach: 2,
  attempting_contact: 3,
  follow_up: 4,
  warm: 5,
  callback_pending: 6,
  callback_scheduled: 7,
  needs_human_followup: 8,
  negotiating: 9,
  offer_made: 10,
  under_contract: 11,
  closed_won: 12,
  closed_lost: 0,
  dead: 0,
};

// =====================================================================
// LEAD FIELDS to select
// =====================================================================
const LEAD_FIELDS = [
  "id", "owner_name", "owner_phone", "property_data",
  "motivation_notes", "motivation_type", "status",
  "pipeline_stage", "engagement_level", "outreach_count",
  "estimated_arv", "estimated_repairs", "estimated_closing_costs",
  "distress_signals", "lead_source", "preferred_channel",
  "best_contact_time", "urgency_level", "callable",
  "next_action_type", "next_action_at", "last_disposition",
  "sla_due_at", "handoff_status", "contact_timezone",
  "updated_at", "skip_trace_data",
].join(", ");

// =====================================================================
// MAIN RESOLVER
// =====================================================================

async function resolveInboundCaller(
  callerPhone: string,
  ee: any,
): Promise<Record<string, any>> {
  const normalized = normalizePhone(callerPhone);
  const bare10 = normalized.replace(/[^0-9]/g, "").slice(-10);

  if (bare10.length !== 10) {
    return unknownCallerResponse(normalized, "invalid_phone_length");
  }

  // ---------------------------------------------------------------
  // Check global block list first
  // ---------------------------------------------------------------
  const { data: blockedPhone } = await ee
    .from("blocked_phones")
    .select("reason, blocked_at")
    .eq("normalized_phone", bare10)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (blockedPhone) {
    return {
      match_status: "blocked",
      blocked_reason: blockedPhone.reason,
      blocked_at: blockedPhone.blocked_at,
      caller_phone: normalized,
      context_card: {
        status: "blocked",
        reason: blockedPhone.reason,
        warning: `This phone number is globally blocked (${blockedPhone.reason}). Do not contact.`,
      },
    };
  }

  // ---------------------------------------------------------------
  // STEP 1: Find leads by owner_phone (exact match on bare10)
  // ---------------------------------------------------------------
  const ownerPhoneMatches = await findByOwnerPhone(ee, bare10);

  // ---------------------------------------------------------------
  // STEP 2: Find leads by skip_trace_data phones (P0)
  //   Uses Postgres text cast to avoid full table scan
  // ---------------------------------------------------------------
  const skipTraceMatches = await findBySkipTrace(ee, bare10, ownerPhoneMatches);

  // Merge — owner_phone matches first, then skip_trace additions
  const allLeads = [
    ...ownerPhoneMatches.map((l: any) => ({ ...l, match_source: "owner_phone" })),
    ...skipTraceMatches.map((l: any) => ({ ...l, match_source: "skip_trace" })),
  ];

  if (allLeads.length === 0) {
    return unknownCallerResponse(normalized, "no_matching_leads");
  }

  // ---------------------------------------------------------------
  // STEP 3: Fetch communications for each lead (for ranking + context)
  // ---------------------------------------------------------------
  const leadIds = allLeads.map((l: any) => l.id);

  // Last outbound attempt per lead (for ranking tier 2 + context)
  const { data: outboundComms } = await ee
    .from("communications")
    .select("lead_id, created_at, disposition, disposition_label, summary, notes")
    .in("lead_id", leadIds)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(50);

  // Last meaningful communication per lead (any direction, for tier 4 + context)
  const { data: allComms } = await ee
    .from("communications")
    .select("lead_id, created_at, disposition, disposition_label, summary, notes, direction, transcript")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false })
    .limit(50);

  // Index: most recent outbound per lead
  const lastOutboundByLead: Record<number, any> = {};
  for (const c of outboundComms || []) {
    if (!lastOutboundByLead[c.lead_id]) {
      lastOutboundByLead[c.lead_id] = c;
    }
  }

  // Index: most recent comm per lead (any direction)
  const lastCommByLead: Record<number, any> = {};
  for (const c of allComms || []) {
    if (!lastCommByLead[c.lead_id]) {
      lastCommByLead[c.lead_id] = c;
    }
  }

  // ---------------------------------------------------------------
  // STEP 4: Rank leads (P1 — Ben's exact priority order)
  //   1. Active callback / pending next action
  //   2. Most recent outbound attempt to this number
  //   3. Hottest live stage (needs_human_followup > callback_pending > attempting_contact > new)
  //   4. Most recent meaningful disposition / conversation
  //   5. Generic recency fallback (updated_at)
  // ---------------------------------------------------------------
  const now = Date.now();

  const rankedLeads = allLeads
    .map((l: any) => {
      let score = 0;
      const heat = STAGE_HEAT[l.pipeline_stage || "new"] ?? 0;
      const lastOutbound = lastOutboundByLead[l.id];
      const lastComm = lastCommByLead[l.id];

      // Tier 1: Active callback / pending next action (10000+ points)
      if (
        l.pipeline_stage === "callback_scheduled" ||
        l.pipeline_stage === "callback_pending" ||
        l.handoff_status === "pending" ||
        (l.next_action_type && l.next_action_at && new Date(l.next_action_at).getTime() > now - 7 * 24 * 60 * 60 * 1000)
      ) {
        score += 10000;
        // Boost further if callback was specifically scheduled
        if (l.pipeline_stage === "callback_scheduled") score += 2000;
      }

      // Tier 2: Most recent outbound attempt (up to 5000 points, decays over 7 days)
      if (lastOutbound) {
        const hoursSince = (now - new Date(lastOutbound.created_at).getTime()) / (1000 * 60 * 60);
        if (hoursSince < 168) { // within 7 days
          score += Math.max(0, 5000 - hoursSince * 30);
        }
      }

      // Tier 3: Pipeline heat (up to 1200 points)
      // Only count "live" stages (not closed_lost/dead)
      if (heat > 0) {
        score += heat * 100;
      }

      // Tier 4: Most recent meaningful disposition (up to 500 points, decays)
      if (lastComm) {
        const hoursSince = (now - new Date(lastComm.created_at).getTime()) / (1000 * 60 * 60);
        score += Math.max(0, 500 - hoursSince * 3);
      }

      // Tier 5: Generic recency fallback (up to 100 points)
      if (l.updated_at) {
        const hoursSince = (now - new Date(l.updated_at).getTime()) / (1000 * 60 * 60);
        score += Math.max(0, 100 - hoursSince * 0.5);
      }

      // Tie-breaker: owner_phone match > skip_trace match
      if (l.match_source === "owner_phone") {
        score += 50;
      }

      return { ...l, rank_score: score };
    })
    .sort((a, b) => b.rank_score - a.rank_score);

  // ---------------------------------------------------------------
  // STEP 5: Determine match status
  // ---------------------------------------------------------------
  let matchStatus: "confirmed" | "ambiguous" = "confirmed";
  const primaryLead = rankedLeads[0];

  if (rankedLeads.length > 1) {
    const topScore = rankedLeads[0].rank_score;
    const secondScore = rankedLeads[1].rank_score;
    // Ambiguous if top 2 within 500 points of each other
    if (topScore - secondScore < 500) {
      matchStatus = "ambiguous";
    }
  }

  const primaryLastComm = lastCommByLead[primaryLead.id] || null;
  const primaryLastOutbound = lastOutboundByLead[primaryLead.id] || null;

  // ---------------------------------------------------------------
  // STEP 6: Build context card + response
  // ---------------------------------------------------------------
  const contextCard = buildContextCard(
    primaryLead,
    primaryLastComm,
    primaryLastOutbound,
    rankedLeads,
    matchStatus,
  );

  return {
    match_status: matchStatus,
    caller_phone: normalized,

    // All matched leads, ranked
    leads: rankedLeads.map((l: any, idx: number) => ({
      id: l.id,
      owner_name: l.owner_name,
      property_address: getAddress(l),
      outreach_count: l.outreach_count || 0,
      status: l.status,
      pipeline_stage: l.pipeline_stage,
      engagement_level: l.engagement_level,
      callable: l.callable,
      next_action_type: l.next_action_type,
      next_action_at: l.next_action_at,
      is_primary: idx === 0,
      match_rank: idx + 1,
      match_source: l.match_source,
      rank_score: Math.round(l.rank_score),
    })),

    // Primary lead (full detail)
    primary_lead: {
      id: primaryLead.id,
      owner_name: primaryLead.owner_name,
      property_address: getAddress(primaryLead),
      outreach_count: primaryLead.outreach_count || 0,
      status: primaryLead.status,
      pipeline_stage: primaryLead.pipeline_stage,
      engagement_level: primaryLead.engagement_level,
      callable: primaryLead.callable,
      urgency_level: primaryLead.urgency_level,
      motivation_type: primaryLead.motivation_type,
      estimated_arv: primaryLead.estimated_arv,
      estimated_repairs: primaryLead.estimated_repairs,
      estimated_closing_costs: primaryLead.estimated_closing_costs,
      next_action_type: primaryLead.next_action_type,
      next_action_at: primaryLead.next_action_at,
      handoff_status: primaryLead.handoff_status,
      sla_due_at: primaryLead.sla_due_at,
      contact_timezone: primaryLead.contact_timezone,
      best_contact_time: primaryLead.best_contact_time,
      preferred_channel: primaryLead.preferred_channel,
      // P1 required fields:
      last_outbound_date: primaryLastOutbound?.created_at || null,
      last_contact_date: primaryLastComm?.created_at || null,
      last_communication: primaryLastComm
        ? {
            direction: primaryLastComm.direction,
            disposition: primaryLastComm.disposition,
            disposition_label: primaryLastComm.disposition_label,
            created_at: primaryLastComm.created_at,
            summary: primaryLastComm.summary || primaryLastComm.notes || "",
            transcript_snippet: primaryLastComm.transcript
              ? primaryLastComm.transcript.substring(0, 500)
              : "",
          }
        : null,
    },

    // Context card (for Alex / UI)
    context_card: contextCard,

    // Inbound communication skeleton
    inbound_communication: {
      caller_phone: normalized,
      resolved_lead_id: primaryLead.id,
      resolved_owner_name: primaryLead.owner_name,
      resolved_property_address: getAddress(primaryLead),
      match_status: matchStatus,
      match_confidence: matchStatus === "confirmed" ? "high" : "medium",
      ambiguity_count: rankedLeads.length,
      ambiguity_reason: matchStatus === "ambiguous"
        ? buildAmbiguityReason(rankedLeads)
        : null,
      lead_ids: rankedLeads.map((l: any) => l.id),
    },
  };
}

// =====================================================================
// PHONE MATCHING: owner_phone
// =====================================================================

async function findByOwnerPhone(ee: any, bare10: string): Promise<any[]> {
  // Build all likely storage formats for this 10-digit number
  const formats = [
    `(${bare10.slice(0, 3)}) ${bare10.slice(3, 6)}-${bare10.slice(6)}`,  // (207) 892-9465
    `${bare10.slice(0, 3)}-${bare10.slice(3, 6)}-${bare10.slice(6)}`,    // 207-892-9465
    `${bare10.slice(0, 3)}.${bare10.slice(3, 6)}.${bare10.slice(6)}`,    // 207.892.9465
    `+1${bare10}`,                                                        // +12078929465
    `1${bare10}`,                                                          // 12078929465
    bare10,                                                                // 2078929465
  ];

  // Use .in() which properly handles special characters
  const { data, error } = await ee
    .from("leads")
    .select(LEAD_FIELDS)
    .in("owner_phone", formats)
    .limit(20);

  if (error) {
    console.error("[inbound-resolver] owner_phone .in() error:", error);
  }

  if (data && data.length > 0) {
    return data;
  }

  // Fallback: ilike on last 4 digits, then verify bare10 match in code
  const last4 = bare10.slice(-4);
  const { data: fallback, error: fbErr } = await ee
    .from("leads")
    .select(LEAD_FIELDS)
    .ilike("owner_phone", `%${last4}`)
    .limit(50);

  if (fbErr) {
    console.error("[inbound-resolver] owner_phone fallback error:", fbErr);
    return [];
  }

  return (fallback || []).filter((l: any) => {
    const lBare = (l.owner_phone || "").replace(/[^0-9]/g, "").slice(-10);
    return lBare === bare10;
  });
}

// =====================================================================
// PHONE MATCHING: skip_trace_data (P0)
//   Uses Postgres text cast to search within JSONB without full scan
// =====================================================================

async function findBySkipTrace(
  ee: any,
  bare10: string,
  alreadyFound: any[],
): Promise<any[]> {
  const alreadyIds = new Set(alreadyFound.map((l: any) => l.id));

  // JSONB columns don't support ilike/text pattern matching through the
  // Supabase JS client. Use the fallback scan approach directly.
  return await findBySkipTraceFallback(ee, bare10, alreadyIds);
}

async function findBySkipTraceFallback(
  ee: any,
  bare10: string,
  alreadyIds: Set<number>,
): Promise<any[]> {
  // JSONB columns don't support ilike in PostgREST/Supabase client.
  // Strategy: fetch just id + skip_trace_data in pages, match in JS,
  // then fetch full records only for matches.
  const PAGE_SIZE = 500;
  const matchedIds: number[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore && offset < 5000) { // Safety cap
    const { data: page, error } = await ee
      .from("leads")
      .select("id, skip_trace_data")
      .not("skip_trace_data", "is", null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[inbound-resolver] skip_trace scan error:", error);
      break;
    }

    if (!page || page.length === 0) {
      hasMore = false;
      break;
    }

    for (const lead of page) {
      if (alreadyIds.has(lead.id)) continue;

      const std = typeof lead.skip_trace_data === "string"
        ? JSON.parse(lead.skip_trace_data)
        : lead.skip_trace_data;

      const phones: string[] = std?.phones || std?.phone_numbers || [];
      for (const p of phones) {
        const pBare = p.replace(/[^0-9]/g, "").slice(-10);
        if (pBare === bare10) {
          matchedIds.push(lead.id);
          break;
        }
      }
    }

    if (page.length < PAGE_SIZE) {
      hasMore = false;
    }
    offset += PAGE_SIZE;
  }

  if (matchedIds.length === 0) return [];

  // Fetch full records for matched leads
  const { data: fullLeads, error: fetchErr } = await ee
    .from("leads")
    .select(LEAD_FIELDS)
    .in("id", matchedIds)
    .limit(20);

  if (fetchErr) {
    console.error("[inbound-resolver] skip_trace full fetch error:", fetchErr);
    return [];
  }

  return fullLeads || [];
}

// =====================================================================
// CONTEXT CARD BUILDER
// =====================================================================

function buildContextCard(
  primaryLead: any,
  lastComm: any,
  lastOutbound: any,
  rankedLeads: any[],
  matchStatus: string,
): Record<string, any> {
  const addr = getAddress(primaryLead);
  const totalMatches = rankedLeads.length;

  // Badge + status
  let badge: string;
  let badgeColor: string;
  let statusText: string;

  if (matchStatus === "ambiguous") {
    badge = "AMBIGUOUS";
    badgeColor = "yellow";
    statusText = `${totalMatches} leads match this phone`;
  } else if (!primaryLead.callable) {
    badge = "BLOCKED";
    badgeColor = "red";
    statusText = `Lead is blocked or suppressed (${primaryLead.status || "unknown"})`;
  } else if (primaryLead.pipeline_stage === "callback_scheduled" || primaryLead.pipeline_stage === "callback_pending") {
    badge = "CALLBACK";
    badgeColor = "green";
    statusText = `Callback expected${primaryLead.next_action_at ? " on " + formatDate(primaryLead.next_action_at) : ""}`;
  } else if (primaryLead.engagement_level === "hot") {
    badge = "HOT";
    badgeColor = "red";
    statusText = "Hot lead — interested";
  } else if (primaryLead.engagement_level === "warm") {
    badge = "WARM";
    badgeColor = "orange";
    statusText = "Warm lead";
  } else if (primaryLead.engagement_level === "cold") {
    badge = "COLD";
    badgeColor = "blue";
    statusText = "Cold lead";
  } else {
    badge = "LEAD";
    badgeColor = "gray";
    statusText = primaryLead.pipeline_stage || primaryLead.status || "unknown";
  }

  // ---------------------------------------------------------------
  // callback_context_summary — factual narrative
  // ---------------------------------------------------------------
  let callbackContextSummary = "";

  if (lastComm) {
    const firstName = extractFirstName(primaryLead.owner_name);
    const direction = lastComm.direction === "outbound" ? "We called" : "They called";
    const timeAgo = formatRelativeTime(lastComm.created_at);
    const disposition = lastComm.disposition_label || lastComm.disposition || "unknown";
    const detail = lastComm.summary || lastComm.notes || "";

    callbackContextSummary = `${direction} ${firstName} ${timeAgo}`;
    if (addr) callbackContextSummary += ` about the property at ${addr}`;
    callbackContextSummary += `. Result: ${disposition}.`;
    if (detail) callbackContextSummary += ` ${detail}`;
  } else {
    callbackContextSummary = "No prior contact history on record.";
  }

  // ---------------------------------------------------------------
  // recommended_callback_opener — personalized
  // ---------------------------------------------------------------
  let recommendedOpener = "";

  if (matchStatus === "ambiguous") {
    // List top 2 properties for disambiguation
    const topAddrs = rankedLeads
      .slice(0, Math.min(3, rankedLeads.length))
      .map((l) => getAddress(l))
      .filter(Boolean);

    if (topAddrs.length >= 2) {
      recommendedOpener = `Thanks for calling back — are you calling about the property on ${topAddrs[0]} or ${topAddrs[1]}?`;
      if (rankedLeads.length > 2) {
        recommendedOpener += ` We also reached out about ${rankedLeads.length - 2} other ${rankedLeads.length - 2 === 1 ? "property" : "properties"}.`;
      }
    } else {
      recommendedOpener = "Thanks for calling back. We reached out about a few properties in your area — which address were you calling about?";
    }
  } else if (primaryLead.pipeline_stage === "callback_scheduled" || primaryLead.pipeline_stage === "callback_pending") {
    const firstName = extractFirstName(primaryLead.owner_name);
    recommendedOpener = `Hi ${firstName}, thanks for calling back as we discussed. We were looking at the property on ${addr || "your property"}. Do you have a few minutes to talk about your options?`;
  } else if (lastOutbound) {
    const firstName = extractFirstName(primaryLead.owner_name);
    const timeAgo = formatRelativeTime(lastOutbound.created_at);
    recommendedOpener = `Hi ${firstName}, thanks for calling back. We reached out ${timeAgo} about the property at ${addr || "your property"}. Do you have a few minutes to chat?`;
  } else if (lastComm) {
    const firstName = extractFirstName(primaryLead.owner_name);
    recommendedOpener = `Hi ${firstName}, thanks for the callback. We were in touch about the property on ${addr || "your property"}. Any updates on your end?`;
  } else {
    recommendedOpener = "Thanks for calling back. We recently reached out to property owners in your area. Can I ask which property you're calling about?";
  }

  // ---------------------------------------------------------------
  // Warnings
  // ---------------------------------------------------------------
  const warnings: string[] = [];
  if (!primaryLead.callable) warnings.push("Lead is blocked or suppressed — do not contact");
  if (primaryLead.status === "dnc") warnings.push("Lead requested DNC — do not call");
  if (primaryLead.status === "bad_number") warnings.push("Wrong number on file");
  if (primaryLead.status === "needs_review") warnings.push("Flagged for manual review");
  if (matchStatus === "ambiguous") {
    warnings.push(`AMBIGUOUS: ${buildAmbiguityReason(rankedLeads)} — verify which property`);
  }

  // Prior call summary line
  let priorCallSummary = "";
  if (lastComm) {
    const relTime = formatRelativeTime(lastComm.created_at);
    const disposition = lastComm.disposition_label || lastComm.disposition || "unknown";
    const summary = lastComm.summary || lastComm.notes || "no details";
    priorCallSummary = `${lastComm.direction || "outbound"} call ${relTime} — ${disposition}: ${summary}`;
  } else {
    priorCallSummary = "No prior contact history";
  }

  // Property details
  const pd = primaryLead.property_data || {};
  const propertyDetails = [
    pd.bedrooms ? `${pd.bedrooms} bed` : "",
    pd.bathrooms ? `${pd.bathrooms} bath` : "",
    pd.sqft ? `${pd.sqft} sqft` : "",
    pd.year_built ? `built ${pd.year_built}` : "",
  ].filter(Boolean).join(" · ");

  const distressSignals = (primaryLead.distress_signals || []).slice(0, 3).join(", ");

  return {
    // Header
    owner_name: primaryLead.owner_name || "Unknown",
    property_address: addr,
    badge: { text: badge, color: badgeColor },
    status_text: statusText,

    // Snapshot
    snapshot: {
      outreach_count: primaryLead.outreach_count || 0,
      outreach_label: primaryLead.outreach_count > 3
        ? "Multiple attempts"
        : primaryLead.outreach_count > 0
          ? `${primaryLead.outreach_count} attempt${primaryLead.outreach_count !== 1 ? "s" : ""}`
          : "First contact",
      engagement_level: primaryLead.engagement_level || "unknown",
      pipeline_stage: primaryLead.pipeline_stage || "unknown",
      urgency_level: primaryLead.urgency_level || "normal",
      motivation_type: primaryLead.motivation_type || "unknown",
    },

    // Property
    property_details: propertyDetails,
    distress_signals: distressSignals,

    // Financial
    estimated_arv: primaryLead.estimated_arv ? `$${Number(primaryLead.estimated_arv).toLocaleString()}` : "TBD",
    estimated_repairs: primaryLead.estimated_repairs ? `$${Number(primaryLead.estimated_repairs).toLocaleString()}` : "TBD",
    estimated_closing_costs: primaryLead.estimated_closing_costs ? `$${Number(primaryLead.estimated_closing_costs).toLocaleString()}` : "TBD",

    // Contact history
    prior_call_summary: priorCallSummary,
    last_contact_date: lastComm?.created_at ? formatDate(lastComm.created_at) : "Never",
    last_outbound_date: lastOutbound?.created_at ? formatDate(lastOutbound.created_at) : "Never",

    // Next action
    next_action_type: primaryLead.next_action_type || "none",
    next_action_at: primaryLead.next_action_at ? formatDate(primaryLead.next_action_at) : "None",
    sla_due_at: primaryLead.sla_due_at ? `SLA due ${formatDate(primaryLead.sla_due_at)}` : "",

    // P1 context fields
    callback_context_summary: callbackContextSummary,
    recommended_callback_opener: recommendedOpener,

    // Ambiguity
    ambiguity_count: totalMatches,
    ambiguity_reason: matchStatus === "ambiguous" ? buildAmbiguityReason(rankedLeads) : null,

    // Warnings
    warnings,
    warning_count: warnings.length,

    // Decision flags
    is_callback: primaryLead.pipeline_stage === "callback_scheduled" || primaryLead.pipeline_stage === "callback_pending",
    is_interested: primaryLead.engagement_level === "hot",
    is_ambiguous: matchStatus === "ambiguous",
    is_blocked: !primaryLead.callable,
    requires_human_followup: primaryLead.handoff_status === "pending",
  };
}

// =====================================================================
// UNKNOWN CALLER RESPONSE
// =====================================================================

function unknownCallerResponse(normalizedPhone: string, reason: string): Record<string, any> {
  return {
    match_status: "unknown",
    caller_phone: normalizedPhone,
    leads: [],
    primary_lead: null,
    context_card: {
      owner_name: "Unknown",
      property_address: "Not found in database",
      badge: { text: "NEW CALLER", color: "blue" },
      status_text: "No matching lead found",
      snapshot: {
        outreach_count: 0,
        outreach_label: "First contact",
        engagement_level: "unknown",
        pipeline_stage: "unknown",
      },
      callback_context_summary: "No prior contact history.",
      recommended_callback_opener:
        "Thanks for calling back. We recently reached out to property owners in your area. Can I ask which property you're calling about, or is this related to a specific address?",
      ambiguity_count: 0,
      ambiguity_reason: reason,
      warnings: [],
      warning_count: 0,
      is_callback: false,
      is_interested: false,
      is_ambiguous: false,
      is_blocked: false,
      requires_human_followup: false,
    },
    inbound_communication: {
      caller_phone: normalizedPhone,
      resolved_lead_id: null,
      match_status: "unknown",
      match_confidence: "low",
      ambiguity_count: 0,
      ambiguity_reason: reason,
    },
  };
}

// =====================================================================
// HELPERS
// =====================================================================

function buildAmbiguityReason(rankedLeads: any[]): string {
  const count = rankedLeads.length;
  const sources = new Set(rankedLeads.map((l: any) => l.match_source));
  const hasOwner = sources.has("owner_phone");
  const hasSkip = sources.has("skip_trace");

  if (hasOwner && hasSkip) {
    return `${count} leads match — ${rankedLeads.filter((l: any) => l.match_source === "owner_phone").length} by owner phone, ${rankedLeads.filter((l: any) => l.match_source === "skip_trace").length} by skip trace`;
  }
  return `${count} leads share this phone number`;
}

function getAddress(lead: any): string {
  const pd = lead.property_data || {};
  return pd.address || pd.property_address || pd.full_address || "";
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits;
}

function extractFirstName(ownerName: string): string {
  if (!ownerName) return "there";
  const clean = ownerName.replace(/\s*&\s*$/, "").replace(/\s+/g, " ").trim();

  if (clean.includes(",")) {
    const parts = clean.split(",");
    const firstName = (parts[1]?.trim() || "").split(" ")[0] || "";
    return titleCase(firstName);
  }

  // Property records: LAST FIRST format
  const words = clean.split(" ").filter(Boolean);
  if (words.length >= 2) return titleCase(words[1]);
  return titleCase(words[0] || "there");
}

function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatDate(isoDate: string): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) return "moments ago";
  if (diffHours < 4) return "a few hours ago";
  if (diffHours < 24) return "earlier today";
  if (diffDays < 2) return "yesterday";
  if (diffDays < 7) return `${Math.floor(diffDays)} days ago`;
  if (diffDays < 14) return "last week";
  return `${Math.floor(diffDays / 7)} weeks ago`;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
    },
  });
}
