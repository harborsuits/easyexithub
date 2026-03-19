# Dispatcher Gate Implementation — Easy Exit

## Current Architecture (from memory)

**Dispatcher:** `easyexit-followup-engine` (Supabase Edge Function on Easy Exit project `bgznglzzknmetzpwkbbz`)

**Current flow:**
1. Polls `follow_ups` table every 5 minutes (OpenClaw cron)
2. Locks due pending rows
3. Bridges to dispatcher by setting `contact_override_until` on `leads` table
4. Dispatcher places Vapi calls

**Problem:** Dispatcher is NOT checking `outbound_approved` gate, allowing unqualified leads to be dialed.

---

## Required Changes

### Gate Function (Add to dispatcher)

```typescript
function canDial(lead: any): boolean {
  // Gate 1: Must be approved for outbound
  if (!lead.outbound_approved) {
    console.log(`[GATE BLOCK] Lead ${lead.id} not approved for outbound`);
    return false;
  }
  
  // Gate 2: Must be callable
  if (!lead.callable) {
    console.log(`[GATE BLOCK] Lead ${lead.id} callable=false`);
    return false;
  }
  
  // Gate 3: Terminal outcomes (dead/dnc)
  if (lead.engagement_level === 'dead') {
    console.log(`[GATE BLOCK] Lead ${lead.id} is dead`);
    return false;
  }
  
  if (lead.engagement_level === 'dnc') {
    console.log(`[GATE BLOCK] Lead ${lead.id} is DNC`);
    return false;
  }
  
  // Gate 4: Cold attempt limit (after engagement_level migration)
  if (lead.engagement_level === 'cold' && (lead.cold_attempts ?? 0) >= 3) {
    console.log(`[GATE BLOCK] Lead ${lead.id} exceeded cold attempt limit (${lead.cold_attempts}/3)`);
    
    // Auto-remediation: mark as dead if not already
    if (lead.status !== 'dead') {
      // Update lead to dead status
      // (implementation depends on Supabase client setup)
    }
    
    return false;
  }
  
  // All gates passed
  return true;
}
```

---

## Current Query (Needs Update)

**Before:**
```typescript
const { data: dueFollowUps } = await supabase
  .from('follow_ups')
  .select('*, leads(*)')
  .eq('status', 'pending')
  .lte('scheduled_for', now());

// Directly places calls for ALL due follow-ups ❌
```

**After:**
```typescript
const { data: dueFollowUps } = await supabase
  .from('follow_ups')
  .select('*, leads(*)')
  .eq('status', 'pending')
  .lte('scheduled_for', now());

for (const followUp of dueFollowUps) {
  const lead = followUp.leads;
  
  // Run gate check
  if (!canDial(lead)) {
    // Mark follow-up as cancelled
    await supabase
      .from('follow_ups')
      .update({ 
        status: 'cancelled',
        cancelled_reason: 'failed_dispatcher_gate',
        cancelled_at: new Date().toISOString()
      })
      .eq('id', followUp.id);
    
    continue; // Skip to next lead
  }
  
  // Gate passed — place call
  await placeVapiCall(lead);
  
  // Mark follow-up as executed
  await supabase
    .from('follow_ups')
    .update({ 
      status: 'executed',
      executed_at: new Date().toISOString()
    })
    .eq('id', followUp.id);
}
```

---

## Gate Logic Priorities

The gate checks run in order of **strictness**:

1. **outbound_approved** — MUST be true (qualification gate)
2. **callable** — MUST be true (technical gate)
3. **engagement_level = dead/dnc** — terminal outcomes (compliance gate)
4. **cold_attempts >= 3** — attempt limit gate (efficiency gate)

If ANY gate fails, the call is blocked and the follow-up is cancelled.

---

## Before Deployment

### Critical Safety Check

Run this query to see how many leads would be blocked:

```sql
SELECT 
  COUNT(*) AS blocked_count,
  CASE 
    WHEN NOT outbound_approved THEN 'not_approved'
    WHEN NOT callable THEN 'not_callable'
    WHEN status = 'dead' THEN 'dead'
    WHEN status = 'dnc' THEN 'dnc'
    ELSE 'other'
  END AS reason
FROM leads l
INNER JOIN follow_ups f ON f.lead_id = l.id
WHERE f.status = 'pending'
GROUP BY reason;
```

**Expected output:**
```
blocked_count | reason
--------------+-------------
         607  | not_approved  ← These will be blocked until qualified
           5  | dead          ← Already shouldn't be scheduled
           0  | dnc           ← Good
```

---

## After Qualification Script

Once `node scripts/qualify_existing_leads.js` runs:

```sql
SELECT 
  COUNT(*) AS qualified_count
FROM leads
WHERE outbound_approved = true
  AND callable = true
  AND status NOT IN ('dead', 'dnc');
```

**Expected:** ~600 qualified leads

Then the dispatcher will only dial those ~600, blocking the other ~800 (utilities, duplicates, etc.).

---

## Deployment Steps

### Step 1: Update Dispatcher Function
1. Add `canDial()` function to `easyexit-followup-engine`
2. Update follow-up loop to check gate before placing calls
3. Deploy to Supabase Edge Functions

### Step 2: Run Qualification Script
```bash
cd ~/Projects/easyexithub-main
node scripts/qualify_existing_leads.js
```

This will set `outbound_approved=true` for ~600 qualified leads.

### Step 3: Verify Gate is Working
Place a test follow-up for a disqualified lead (e.g., Central Maine Power):

```sql
INSERT INTO follow_ups (lead_id, kind, source, status, priority, scheduled_for)
VALUES (186, 'test', 'manual_test', 'pending', 50, NOW());
```

Then wait for next engine run (or manually trigger). 

**Expected:** Follow-up marked `cancelled`, no call placed, log shows `[GATE BLOCK] Lead 186 not approved for outbound`.

### Step 4: Deploy Engagement Level Migration
After gate is confirmed working, deploy the engagement_level system.

---

## Function Location

**Project:** Easy Exit Supabase (`bgznglzzknmetzpwkbbz`)  
**Function:** `/functions/v1/easyexit-followup-engine`  
**Creds:** `~/.openclaw/credentials/supabase-easyexit.json`

To update:
```bash
supabase functions deploy easyexit-followup-engine --project-ref bgznglzzknmetzpwkbbz
```

---

## Testing Checklist

- [ ] Dispatcher blocks leads with `outbound_approved=false`
- [ ] Dispatcher blocks leads with `callable=false`
- [ ] Dispatcher blocks leads with `status='dead'`
- [ ] Dispatcher allows qualified leads through
- [ ] Follow-ups marked `cancelled` when gate blocks
- [ ] Logs show gate block reasons

---

**Status:** Awaiting Ben confirmation of dispatcher location and access before deploying changes.
