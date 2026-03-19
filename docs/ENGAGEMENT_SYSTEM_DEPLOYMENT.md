# Engagement Level System — Deployment Plan

## Status: READY FOR REVIEW
**Date:** 2026-03-19
**Author:** Atlas
**Reviewer:** Ben

---

## What This System Does

Implements a **three-phase lead lifecycle**:
1. **Cold** (prospecting) → max 3 attempts, then auto-dead with death_reason='no_response'
2. **Engaged** (relationship) → unlimited follow-ups, active conversation
3. **Terminal** (resolution) → overrides everything, closes lead permanently

This prevents the system from:
- Calling the same unresponsive homeowner forever
- Wasting dial capacity on dead leads
- Compliance risk from over-calling
- Losing analytics on WHY leads died

---

## Components

### 1. Database Migration ✅
**File:** `/Users/bendickinson/Projects/easyexithub-main/supabase/migrations/20260319_engagement_level_system.sql`

**Changes:**
- Creates `engagement_level_enum` (cold/warm/hot/dead/dnc)
- Creates `death_reason_enum` (no_response/wrong_number/not_interested/sold_elsewhere/family_transfer/attorney_handling/dnc_request/property_transferred/kept_property)
- Adds `engagement_level` column (enum, default 'cold')
- Adds `cold_attempts` counter (integer, default 0)
- Adds `death_reason` column (enum, nullable) for terminal outcome tracking
- Backfills existing leads based on status
- Creates indexes for dispatcher queries and analytics
- Applies 3-attempt rule to existing cold leads with death_reason='no_response'

**To deploy:**
```bash
cd ~/Projects/easyexithub-main
supabase db push
```

---

### 2. Webhook Update 📋
**Location:** Phoenix Supabase Edge Functions (`/functions/vapi-easyexit`)
**Reference doc:** `docs/ENGAGEMENT_LEVEL_MAPPING.md`

**Required changes:**
- Map call outcomes → engagement_level enum
- Increment cold_attempts for voicemail/no_answer/busy/disconnected
- Apply 3-attempt rule when cold_attempts >= 3
- Cancel pending follow_ups when lead marked dead/dnc

**Outcome mapping:**
```javascript
// HOT (unlimited)
['callback_requested', 'executor', 'interested', 'price_discussion', 
 'timeline_discussion', 'wants_offer']

// WARM (unlimited, lower priority)
['maybe_later', 'call_me_next_month', 'not_ready_yet', 'thinking_about_selling']

// COLD (3-attempt rule applies)
['voicemail', 'no_answer', 'busy', 'disconnected']

// DEAD (blocked)
['wrong_number', 'not_interested', 'hung_up', 'attorney_handling']

// DNC (compliance-blocked)
['explicit_do_not_call', 'legal_request']
```

**To deploy:**
You'll need to update the Phoenix webhook manually via Supabase dashboard or CLI.

---

### 3. Dispatcher Safety Gate 📋
**Location:** Phoenix dispatcher/engine function
**Reference doc:** `docs/DISPATCHER_GATE.md`

**Required changes:**
Add pre-call validation gate:
```javascript
if (lead.engagement_level === 'dead') return skip;
if (lead.engagement_level === 'dnc') return skip;
if (!lead.callable) return skip;
if (lead.engagement_level === 'cold' && lead.cold_attempts >= 3) return skip;
```

This is the **final enforcement layer** — even if the engine schedules a call, the dispatcher blocks it.

**To deploy:**
Update the Phoenix dispatcher function before next call cycle.

---

### 4. UI Update ✅
**File:** `/Users/bendickinson/Projects/easyexithub-main/src/components/pipeline/PipelineCalendar.tsx`

**Changes:**
Added engagement level badges after phone number:
- **Hot/Warm:** `🔥 Unlimited` or `🌡️ Unlimited`
- **Cold:** `❄️ 2/3` (shows current attempts)
- **Dead:** `💀 Blocked`
- **DNC:** `🚫 DNC`

**To deploy:**
```bash
cd ~/Projects/easyexithub-main
npm run build
# Deploy to Railway (or your hosting provider)
```

---

## Deployment Order (CRITICAL)

Follow this sequence to avoid calling dead leads during the transition:

### Phase 1: Database + UI (Safe)
1. Run migration: `supabase db push`
2. Deploy UI changes to Railway
3. Verify UI shows engagement badges correctly

**Risk:** Low. These changes are read-only from the calling system's perspective.

---

### Phase 2: Webhook + Dispatcher (Simultaneous)
4. Update Phoenix webhook with engagement_level mapping
5. Update Phoenix dispatcher with safety gate
6. Deploy both functions simultaneously

**Risk:** Medium if deployed separately. Deploy together to ensure consistency.

**Critical:** Do NOT deploy webhook without dispatcher gate — creates a window where the system could call dead leads.

---

## Testing Checklist

### After Phase 1
- [ ] UI shows correct engagement badges for existing leads
- [ ] Cold leads show `❄️ 0/3` or backfilled count
- [ ] Hot leads show `🔥 Unlimited`
- [ ] Dead leads show `💀 Blocked`

### After Phase 2
- [ ] Voicemail outcome → cold_attempts++, engagement_level='cold'
- [ ] 3rd voicemail → status='dead', callable=false, follow_ups cancelled
- [ ] Callback requested → engagement_level='hot', unlimited calls
- [ ] Dispatcher blocks leads with cold_attempts >= 3
- [ ] Dispatcher blocks leads with engagement_level='dead' or 'dnc'

---

## Rollback Plan

If something breaks:

### Rollback Phase 1 (Database + UI)
```sql
-- Remove new columns (safe, they're not being written to yet)
ALTER TABLE leads DROP COLUMN engagement_level;
ALTER TABLE leads DROP COLUMN cold_attempts;
DROP TYPE engagement_level_enum;
```

Redeploy previous UI version.

### Rollback Phase 2 (Webhook + Dispatcher)
Revert Phoenix functions to previous versions via Supabase dashboard.

---

## Next Steps (Post-Deployment)

After this system is stable:

1. **Follow-up ladder** — escalating cadence (Day 2 → 4 → 7 → 14 → 30) for engaged leads
2. **Call timing optimization** — increase answer rate 40-70% with correct time-of-day scheduling
3. **Auto-skip trace** — automatically skip trace cold leads before attempt #1

---

## Questions for Ben

1. Should we deploy Phase 1 (DB + UI) now and Phase 2 (webhook + dispatcher) tomorrow, or all together?
2. Do you want to manually test the migration on a staging database first?
3. Should I write the Phoenix webhook and dispatcher code, or do you want to handle that?

---

## Files Modified

### Local Changes (Ready)
- `supabase/migrations/20260319_engagement_level_system.sql` (new)
- `src/components/pipeline/PipelineCalendar.tsx` (edited)
- `docs/ENGAGEMENT_LEVEL_MAPPING.md` (new reference)
- `docs/DISPATCHER_GATE.md` (new reference)

### Remote Changes Needed
- Phoenix: `/functions/vapi-easyexit` (webhook update)
- Phoenix: Dispatcher function (gate logic)

---

## Estimated Impact

### After Full Deployment
- **392 new leads** can now be safely called with 3-attempt protection
- **Bourassa + engaged leads** get unlimited follow-ups (correct behavior)
- **Pipeline clarity** improves with visible attempt counters
- **Compliance risk** reduced with dispatcher gate
- **Dial efficiency** improved by auto-blocking dead leads

---

**Ready to proceed when you give the green light.**
