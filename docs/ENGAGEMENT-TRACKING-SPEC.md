# Easy Exit Engagement Tracking Specification
**Date:** 2026-03-19  
**Status:** Implementation in progress

---

## Problem

Current system treats all calls equally with a flat `outreach_count`. This creates two issues:

1. **Cold leads** (voicemail/no answer) can be called indefinitely, wasting time
2. **Engaged leads** (callback requested, interested) get killed at 3 attempts, losing deals

---

## Solution: Two-Tier Attempt Limit

Separate leads into two behavioral categories based on call outcomes:

### Tier 1: Cold/Unresponsive Leads
**Max 3 attempts**, then mark dead.

Call outcomes that count as "cold":
- `no_answer`
- `voicemail`
- `busy`
- `line_disconnected`

**Logic:**
```
cold_attempts++ on each call
IF cold_attempts >= 3 AND engaged == false
  → mark dead
```

---

### Tier 2: Engaged/Positive Leads
**Unlimited attempts**.

Call outcomes that set `engaged = true`:
- `callback_requested`
- `interested`
- `maybe_later`
- `executor_handling`
- `timing_issue`
- `wants_more_info`
- `wants_offer`
- `considering`
- `need_time`

**Logic:**
```
engaged = true
cold_attempt_limit = disabled
→ follow up indefinitely
```

---

## Database Schema

### New Columns on `leads` Table

```sql
ALTER TABLE public.leads
ADD COLUMN engaged boolean DEFAULT false,
ADD COLUMN cold_attempts integer DEFAULT 0;
```

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `engaged` | boolean | false | True if lead showed positive engagement. Removes 3-attempt limit. |
| `cold_attempts` | integer | 0 | Count of cold/unresponsive attempts. Max 3 before dead (unless engaged). |

---

## Webhook Logic

### On Call End

1. **Classify outcome** into: engaged / cold / dead
2. **Get current state** (`engaged`, `cold_attempts` from DB)
3. **Update flags**:
   - If outcome is engaged → set `engaged = true`
   - If outcome is cold AND not engaged → `cold_attempts++`
   - If `cold_attempts >= 3` AND not engaged → mark dead
   - If outcome is dead signal → mark dead immediately

### Engagement Classification

```typescript
function classifyEngagement(disposition: string) {
  const engaged = ['callback_requested', 'interested', 'maybe_later', ...];
  const cold = ['no_answer', 'voicemail', 'busy', 'line_disconnected'];
  const dead = ['wrong_number', 'not_interested', 'dnc', 'hung_up', ...];
  
  if (engaged.includes(disposition)) return { engaged: true, incrementCold: false, markDead: false };
  if (cold.includes(disposition)) return { engaged: false, incrementCold: true, markDead: false };
  if (dead.includes(disposition)) return { engaged: false, incrementCold: false, markDead: true };
  
  return { engaged: false, incrementCold: true, markDead: false }; // default: cold
}
```

---

## UI Changes

### Pipeline Cards

**Before:**
```
3× contacted
```

**After:**
```
🔥 ENGAGED
Cold attempts: 0/3
```

or

```
Cold attempts: 2/3
```

### Calendar Detail Panel

Add badge:
```tsx
{lead.engaged && (
  <Badge variant="success">🔥 Engaged - unlimited attempts</Badge>
)}
{!lead.engaged && lead.cold_attempts > 0 && (
  <Badge variant="warning">Cold {lead.cold_attempts}/3</Badge>
)}
```

### Calendar Query Filter

Add safety filter to prevent showing dead leads:

```typescript
.from('leads')
.select('...')
.not('next_followup_date', 'is', null)
.not('status', 'eq', 'dead')
.eq('callable', true)           // ADD
.eq('outbound_approved', true)  // ADD
```

---

## Follow-Up Engine Guard

Before promoting a follow-up, check eligibility:

```typescript
// Get lead state
const { data: lead } = await supabase
  .from('leads')
  .select('engaged, cold_attempts, status, callable, outbound_approved')
  .eq('id', followUp.lead_id)
  .single();

// Check if lead can be called
if (lead.status === 'dead' || !lead.callable || !lead.outbound_approved) {
  // Cancel follow-up
  await supabase.from('follow_ups')
    .update({ status: 'canceled', notes: 'Lead not callable' })
    .eq('id', followUp.id);
  return;
}

// Check cold attempt limit (only if not engaged)
if (!lead.engaged && lead.cold_attempts >= 3) {
  // Mark lead dead
  await supabase.from('leads')
    .update({
      status: 'dead',
      callable: false,
      outbound_approved: false,
      exclusion_reason: ['max_cold_attempts']
    })
    .eq('id', lead.id);
  
  // Cancel follow-up
  await supabase.from('follow_ups')
    .update({ status: 'canceled', notes: 'Exceeded 3 cold attempts' })
    .eq('id', followUp.id);
  return;
}

// Proceed with promotion
```

---

## Examples

### Example 1: Cold Lead (No Engagement)

```
Attempt 1: voicemail
  → cold_attempts = 1, schedule retry in 2 days

Attempt 2: no_answer
  → cold_attempts = 2, schedule retry in 3 days

Attempt 3: voicemail
  → cold_attempts = 3, mark DEAD, stop calling
```

---

### Example 2: Engaged Lead (Executor Handling Probate)

```
Attempt 1: voicemail
  → cold_attempts = 1

Attempt 2: callback_requested (spoke with executor Mike)
  → engaged = true, cold_attempts = 1 (frozen)

Attempt 3: voicemail
  → engaged = true, cold_attempts = 1 (not incremented, engaged leads exempt)

Attempt 4: callback_requested
  → engaged = true, schedule callback for March 31

... unlimited future attempts allowed
```

---

### Example 3: Dead Signal (Immediate)

```
Attempt 1: wrong_number
  → mark DEAD immediately, no retry
```

---

## Deployment Checklist

- [ ] Run migration: `20260319_add_engagement_tracking.sql`
- [ ] Deploy webhook with engagement classification
- [ ] Update PipelineCalendar.tsx to show engagement status
- [ ] Add calendar query filter (callable + outbound_approved)
- [ ] Update follow-up engine with eligibility guard
- [ ] Backfill existing leads:
  - Leads with callbacks/interested → `engaged = true`
  - Leads with 3+ voicemails → check if should be dead
- [ ] Test both paths (cold limit + engaged unlimited)

---

## Success Metrics

**Before:**
- Cold leads called indefinitely (wasted time)
- Engaged leads killed at 3 attempts (lost deals)

**After:**
- Cold leads auto-dead at 3 attempts (compliance + efficiency)
- Engaged leads followed indefinitely (maximize conversions)
- Clear UI distinction (🔥 ENGAGED vs Cold 2/3)

---

## Related Files

- Migration: `~/Projects/easyexithub-main/supabase/migrations/20260319_add_engagement_tracking.sql`
- Logic module: `~/.openclaw/workspace/easy-exit-engagement-logic.ts`
- Webhook patch: `~/.openclaw/workspace/webhook-engagement-patch.md`
- Calendar component: `~/Projects/easyexithub-main/src/components/pipeline/PipelineCalendar.tsx`
- Webhook source: `~/.openclaw/supabase/functions/easyexit-vapi-webhook/index.ts`
- Engine source: `~/.openclaw/supabase/functions/easyexit-followup-engine/index.ts`
