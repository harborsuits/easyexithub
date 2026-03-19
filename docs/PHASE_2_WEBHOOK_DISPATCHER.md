# Phase 2: Webhook + Dispatcher Updates

## Status: Ready for Deployment
Date: 2026-03-19
Phase 1 is live (engagement_level schema + UI). Phase 2 updates webhook and dispatcher to use engagement_level for automation.

---

## Webhook Update: `easyexit-vapi-webhook`

The webhook runs after each call via Vapi webhook callback. It updates call outcomes and engagement_level.

### Current behavior (before Phase 2)
```typescript
// Vapi calls webhook with call outcome
// Webhook creates communications record
// ❌ Doesn't set engagement_level (only exists on leads table, webhook doesn't know about it)
```

### New behavior (Phase 2)
```typescript
// Vapi calls webhook with call outcome
// Webhook creates communications record
// Webhook ALSO updates leads table:
//   - Set engagement_level based on outcome
//   - Set death_reason if terminal outcome
//   - Increment cold_attempts if voicemail/no_answer/busy
//   - Auto-mark dead if cold_attempts >= 3
```

### Implementation

**File:** Supabase Edge Function `easyexit-vapi-webhook` on Easy Exit project (`bgznglzzknmetzpwkbbz`)

**Add this logic after creating communications record:**

```typescript
// Get the updated lead
const { data: lead } = await ee
  .from('leads')
  .select('*')
  .eq('id', leadId)
  .single();

if (!lead) return;

// Determine engagement_level based on call outcome
const engagementMapping = {
  // HOT outcomes
  'callback_requested': 'hot',
  'executor': 'hot',
  'interested': 'hot',
  'price_discussion': 'hot',
  'timeline_discussion': 'hot',
  'wants_offer': 'hot',
  
  // WARM outcomes
  'maybe_later': 'warm',
  'call_me_next_month': 'warm',
  'not_ready_yet': 'warm',
  'thinking_about_selling': 'warm',
  
  // COLD outcomes (increment counter)
  'voicemail': 'cold',
  'no_answer': 'cold',
  'busy': 'cold',
  'disconnected': 'cold',
  
  // DEAD outcomes (terminal)
  'wrong_number': 'dead',
  'not_interested': 'dead',
  'hung_up': 'dead',
  'attorney_handling': 'dead',
};

const deathReasonMap = {
  'voicemail': null,
  'no_answer': null,
  'busy': null,
  'disconnected': null,
  'wrong_number': 'wrong_number',
  'not_interested': 'not_interested',
  'hung_up': 'not_interested',
  'attorney_handling': 'attorney_handling',
  'sold_elsewhere': 'sold_elsewhere',
  'family_transfer': 'family_transfer',
  'property_transferred': 'property_transferred',
  'kept_property': 'kept_property',
};

const newEngagementLevel = engagementMapping[callOutcome] || lead.engagement_level;
let newColdAttempts = lead.cold_attempts ?? 0;
let newDeathReason = lead.death_reason;
let newCallable = lead.callable;

// Increment cold_attempts only for cold outcomes
if (['voicemail', 'no_answer', 'busy', 'disconnected'].includes(callOutcome)) {
  newColdAttempts += 1;
}

// Set death_reason for terminal outcomes
if (deathReasonMap[callOutcome] !== undefined && deathReasonMap[callOutcome] !== null) {
  newDeathReason = deathReasonMap[callOutcome];
}

// Auto-dead if cold_attempts >= 3
if (newEngagementLevel === 'cold' && newColdAttempts >= 3) {
  newEngagementLevel = 'dead';
  newDeathReason = 'no_response';
  newCallable = false;
}

// Update lead
const { error: updateErr } = await ee
  .from('leads')
  .update({
    engagement_level: newEngagementLevel,
    cold_attempts: newColdAttempts,
    death_reason: newDeathReason,
    callable: newCallable,
    status: newEngagementLevel === 'dead' ? 'dead' : lead.status,
  })
  .eq('id', leadId);

if (updateErr) {
  console.error('[easyexit-vapi-webhook] Failed to update engagement:', updateErr);
}
```

---

## Dispatcher Update: `trigger-call` Edge Function

The dispatcher already has the gate logic deployed. Phase 2 adds the cold_attempts gate (which was stubbed in Phase 0).

### Current state
The gate checks:
- callable ✅
- outbound_approved ✅
- engagement_level != dead ✅
- engagement_level != dnc ✅
- cold_attempts < 3 (stub) ← **needs implementation**

### Implementation

**File:** Supabase Edge Function `trigger-call` on Easy Exit project (`bgznglzzknmetzpwkbbz`)

The logic is already in the function. Just ensure it's working:

```typescript
// Gate 4 is already in the code:
if (lead.engagement_level === 'cold' && (lead.cold_attempts ?? 0) >= 3) {
  console.log(`[GATE BLOCK] Lead ${lead.id} exceeded cold attempt limit (${lead.cold_attempts}/3)`);
  return false;
}
```

No changes needed — Phase 0 deployment already has this.

---

## Deployment Checklist

### Step 1: Update Webhook
1. Download current `easyexit-vapi-webhook` function
2. Add engagement_level mapping logic (see above)
3. Test with a voicemail outcome
   - Expected: engagement_level stays cold (or becomes warm if previously cold)
   - cold_attempts incremented
   - If cold_attempts >= 3, marked dead
4. Deploy

### Step 2: Test Engagement Gates
1. Place a test call to a lead with `cold_attempts=2`
   - Expected: call succeeds
2. Place test call to same lead again (now cold_attempts=3)
   - Expected: call blocked by dispatcher gate
3. Test with a hot lead at any attempt count
   - Expected: call succeeds (no attempt limit)

### Step 3: Monitor Logs
After deployment, watch dispatcher logs:
```
[GATE BLOCK] Lead XXX exceeded cold attempt limit
[GATE BLOCK] Lead XXX engagement_level=dead
[GATE BLOCK] Lead XXX not_approved_for_outbound
```

These indicate the system is correctly enforcing limits.

---

## Expected Behavior After Phase 2

### Cold Lead Lifecycle
```
Attempt 1 → voicemail → cold_attempts=1, engagement_level=cold
Attempt 2 → no answer → cold_attempts=2, engagement_level=cold
Attempt 3 → voicemail → cold_attempts=3 → auto-dead (engagement_level=dead, death_reason=no_response)
Attempt 4 → BLOCKED by dispatcher gate
```

### Engaged Lead Lifecycle
```
Attempt 1 → executor → engagement_level=hot
Attempt 2+ → unlimited follow-ups
Eventually → "Sold to realtor" → engagement_level=dead, death_reason=sold_elsewhere
```

### Terminal Outcomes
```
wrong_number → engagement_level=dead, death_reason=wrong_number
not_interested → engagement_level=dead, death_reason=not_interested
attorney_handling → engagement_level=dead, death_reason=attorney_handling
hung_up → engagement_level=dead, death_reason=not_interested
```

---

## Testing Commands

### Test 1: Verify cold_attempts increment
```bash
# Place call to cold lead
curl -X POST "https://bgznglzzknmetzpwkbbz.supabase.co/functions/v1/trigger-call" \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"lead_id": 340}'

# Simulate voicemail via direct communications insert
curl -X POST "https://bgznglzzknmetzpwkbbz.supabase.co/rest/v1/communications" \
  -H "apikey: <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "lead_id": 340,
    "communication_type_label": "call",
    "outcome": "voicemail",
    "transcript": "Left message at voicemail"
  }'

# Check result
curl "https://bgznglzzknmetzpwkbbz.supabase.co/rest/v1/leads?id=eq.340&select=engagement_level,cold_attempts" \
  -H "apikey: <service_role_key>"
```

### Test 2: Hit cold attempt limit
```bash
# Simulate 3 cold attempts
# Each call outcome voicemail/no_answer/busy increments cold_attempts
# When cold_attempts >= 3:
#   engagement_level = dead
#   status = dead
#   callable = false
#   death_reason = no_response

# Try to call after limit
curl -X POST "https://bgznglzzknmetzpwkbbz.supabase.co/functions/v1/trigger-call" \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"lead_id": 340}'

# Expected response:
# {
#   "error": "Lead blocked by dispatcher gate",
#   "reason": "cold_attempt_limit_exceeded"
# }
```

---

## Rollback Plan

If webhook updates break call logging:
1. Revert `easyexit-vapi-webhook` to previous version (Supabase dashboard)
2. Redeploy without the engagement_level mapping logic
3. All calls will still be logged, engagement_level just won't update automatically
4. System still has Phase 0 dispatcher gate (safe)

---

## Monitoring Metrics

After Phase 2 deployment, track these metrics:

```sql
-- Engagement distribution
SELECT 
  engagement_level,
  COUNT(*) as count,
  ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM leads),1) as pct
FROM leads
WHERE callable = true
GROUP BY engagement_level
ORDER BY count DESC;

-- Death reasons
SELECT 
  death_reason,
  COUNT(*) as count
FROM leads
WHERE engagement_level = 'dead'
GROUP BY death_reason
ORDER BY count DESC;

-- Cold attempt distribution
SELECT 
  cold_attempts,
  COUNT(*) as count
FROM leads
WHERE engagement_level = 'cold'
GROUP BY cold_attempts
ORDER BY cold_attempts;
```

Expected after first week:
- Most leads still cold (just starting dialing)
- Death reasons: mostly no_response, some wrong_number
- Cold attempts: bell curve, peak at 0-1

---

## Timeline

- Phase 0: ✅ Dispatcher gate deployed 2026-03-19 13:13
- Phase 1: ✅ Engagement_level schema + UI deployed 2026-03-19 13:50
- Phase 2: ⏳ Webhook + dispatcher updates (today or tomorrow)

**Ready to deploy when you are.**
