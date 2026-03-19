# Urgent Fixes — 2026-03-19

## Issue 1: Calendar Not Updating in Real-Time ✅ FIXED
**Problem:** Reschedule mutation succeeds but calendar doesn't show changes until manual refresh.

**Root cause:** React Query invalidation wasn't forcing immediate refetch.

**Fix applied:**
- Added `refetchOnWindowFocus: true` to calendar query
- Added explicit `refetchQueries` after reschedule mutation
- File: `src/components/pipeline/PipelineCalendar.tsx`

**Status:** Fixed locally, needs Railway deployment

---

## Issue 2: Qualification System Not Enforced ⚠️ CRITICAL
**Problem:** Leads with `outbound_approved=false` are being dialed.

**Evidence:**
```sql
SELECT status, callable, outbound_approved FROM leads LIMIT 10;

new       | true  | false  ← Should NOT be dialed
contacted | true  | false  ← Was dialed anyway
```

**Root cause:** Dispatcher is NOT checking `outbound_approved` gate.

**Risk:** System is calling:
- Utility companies (Central Maine Power)
- Municipality records (Town of Gorham)
- Potentially duplicate leads
- Unqualified records

---

## Three Critical Questions for Ben

### Q1: Is the dispatcher checking `outbound_approved`?
Location: Phoenix Edge Functions `/functions/vapi-easyexit-dispatcher` (or wherever dispatcher lives)

Current gate should be:
```javascript
if (!lead.outbound_approved) return skip;
```

If this gate is missing, we're calling unqualified leads.

### Q2: How are leads being approved currently?
Options:
- A) Manual approval UI (where?)
- B) Auto-approved on import (missing qualification step)
- C) Dispatcher ignores the flag entirely (dangerous)

### Q3: Should we deploy engagement_level migration now or fix qualification first?
Priority options:
- **Option A:** Fix qualification → deploy engagement_level → deploy webhook/dispatcher
- **Option B:** Deploy engagement_level now → fix qualification in parallel → deploy together

My recommendation: **Option A** (qualification first), because adding death_reason without fixing qualification means we'll track WHY we called utility companies (not ideal).

---

## Recommended Deployment Order (Revised)

### Phase 0: Qualification System (URGENT)
1. Run qualification script on all existing leads
2. Update dispatcher to enforce `outbound_approved` gate
3. Verify no utility/corporate leads are dialed

**Blocks:** ~800 disqualified leads (utilities, duplicates, etc.)
**Qualifies:** ~600 viable leads

---

### Phase 1: Engagement Level System
1. Run migration (adds engagement_level, cold_attempts, death_reason)
2. Deploy UI updates (shows engagement badges)
3. Verify schema changes

---

### Phase 2: Webhook + Dispatcher
1. Update webhook with engagement_level mapping + death_reason
2. Update dispatcher with full gate logic (outbound_approved + engagement_level + cold_attempts)
3. Deploy both simultaneously

---

## Files Ready for Deployment

### ✅ Fixed
- `src/components/pipeline/PipelineCalendar.tsx` (calendar refresh fix)
- `docs/LEAD_QUALIFICATION_SYSTEM.md` (qualification design)
- `scripts/qualify_existing_leads.js` (qualification script)

### ✅ Ready (pending Ben approval)
- `supabase/migrations/20260319120000_engagement_level_system.sql` (three-phase lifecycle)
- `docs/ENGAGEMENT_LEVEL_MAPPING.md` (webhook mapping)
- `docs/DISPATCHER_GATE.md` (dispatcher logic)

### ⏳ Blocked (need Ben answers)
- Phoenix dispatcher function (Q1: does it check outbound_approved?)
- Phoenix webhook function (needs engagement_level + death_reason mapping)

---

## Next Steps

**Immediate (Ben decides):**
1. Answer Q1-Q3 above
2. Approve qualification script run (will mark ~800 leads as disqualified)
3. Confirm dispatcher location (Phoenix function name)

**After approval:**
1. Run `node scripts/qualify_existing_leads.js` (no --dry-run)
2. Deploy calendar fix to Railway
3. Deploy engagement_level migration
4. Update dispatcher + webhook on Phoenix

---

## Data Integrity Check

Before ANY deployment, run this query to check for sync issues:

```sql
SELECT
  l.id,
  l.owner_name,
  l.next_followup_date,
  f.scheduled_for
FROM leads l
LEFT JOIN follow_ups f
  ON f.lead_id = l.id
  AND f.status = 'pending'
WHERE l.next_followup_date IS NOT NULL
  AND f.scheduled_for IS NULL;
```

If this returns rows, you have "calendar ghosts" (leads with next_followup_date but no pending follow_up).

---

**Waiting for Ben's answers to Q1-Q3 before proceeding.**
