# Easy Exit Deployment Checklist — 2026-03-19

## Current State
- ❌ **Calendar sync:** Fixed locally, needs Railway deployment
- ❌ **Qualification gate:** Dispatcher NOT checking `outbound_approved`
- ❌ **Engagement system:** Migration ready but not deployed
- ⚠️ **Risk:** System may be calling unqualified leads (utilities, duplicates)

---

## Deployment Order (Safe Path)

### ✅ Phase 0: Qualification System (URGENT)
**Priority:** Fix before adding engagement tracking

**Steps:**
1. [ ] Update dispatcher to check `outbound_approved` gate
   - File: Supabase Edge Function `easyexit-followup-engine`
   - Location: Easy Exit project (`bgznglzzknmetzpwkbbz`)
   - Reference: `docs/DISPATCHER_GATE_IMPLEMENTATION.md`
   
2. [ ] Run qualification script
   ```bash
   cd ~/Projects/easyexithub-main
   node scripts/qualify_existing_leads.js
   ```
   - Expected: ~600 qualified, ~800 disqualified
   - Sets `outbound_approved=true` for viable leads only
   
3. [ ] Test dispatcher gate
   - Insert test follow-up for disqualified lead (Central Maine Power, ID 186)
   - Verify follow-up marked `cancelled`, no call placed
   - Check logs for `[GATE BLOCK] Lead 186 not approved for outbound`

---

### ✅ Phase 1: Engagement Level System
**After Phase 0 is confirmed working**

**Steps:**
1. [ ] Run database migration
   ```bash
   cd ~/Projects/easyexithub-main
   supabase db push
   ```
   - Adds `engagement_level`, `cold_attempts`, `death_reason` columns
   - Backfills existing leads
   - Creates indexes

2. [ ] Verify migration
   ```sql
   SELECT engagement_level, cold_attempts, death_reason
   FROM leads
   LIMIT 10;
   ```
   - Should show values like `cold | 0 | null`

3. [ ] Deploy UI changes
   - Build: `npm run build`
   - Deploy to Railway
   - Verify engagement badges show in calendar

---

### ✅ Phase 2: Webhook + Dispatcher Updates
**After Phase 1 is deployed and verified**

**Steps:**
1. [ ] Update webhook with engagement_level mapping
   - File: Supabase Edge Function `easyexit-vapi-webhook`
   - Reference: `docs/ENGAGEMENT_LEVEL_MAPPING.md`
   - Maps call outcomes → engagement_level + death_reason

2. [ ] Update dispatcher with engagement gates
   - File: Supabase Edge Function `easyexit-followup-engine`
   - Reference: `docs/DISPATCHER_GATE.md`
   - Adds cold_attempts >= 3 gate, engagement_level checks

3. [ ] Deploy both functions simultaneously
   ```bash
   supabase functions deploy easyexit-vapi-webhook --project-ref bgznglzzknmetzpwkbbz
   supabase functions deploy easyexit-followup-engine --project-ref bgznglzzknmetzpwkbbz
   ```

---

### ✅ Phase 3: Calendar Sync Fix
**Can be deployed anytime after Phase 1**

**Steps:**
1. [ ] Deploy calendar fix to Railway
   - File: `src/components/pipeline/PipelineCalendar.tsx`
   - Fix: Added `refetchQueries` after reschedule mutation
   
2. [ ] Test calendar updates
   - Reschedule a lead in UI
   - Verify calendar shows change immediately (no manual refresh needed)

---

## Testing After Each Phase

### Phase 0 Tests
- [ ] Utility company (Central Maine Power) → blocked
- [ ] Corporate lead (LLC/INC in name) → blocked if disqualified
- [ ] Valid lead → allowed through gate
- [ ] Dashboard shows correct qualified vs disqualified counts

### Phase 1 Tests
- [ ] Voicemail outcome → cold_attempts++
- [ ] 3rd voicemail → status=dead, death_reason=no_response
- [ ] Callback requested → engagement_level=hot
- [ ] UI shows engagement badges correctly

### Phase 2 Tests
- [ ] Hot lead → unlimited follow-ups
- [ ] Cold lead at 3 attempts → blocked by dispatcher
- [ ] Wrong number → engagement_level=dead, death_reason=wrong_number
- [ ] DNC phrase in transcript → engagement_level=dnc, death_reason=dnc_request

---

## Rollback Plans

### Phase 0 Rollback
If dispatcher breaks:
1. Revert `easyexit-followup-engine` to previous version (Supabase dashboard)
2. Set all leads `outbound_approved=true` temporarily (emergency bypass)

### Phase 1 Rollback
If migration breaks:
```sql
ALTER TABLE leads DROP COLUMN engagement_level;
ALTER TABLE leads DROP COLUMN cold_attempts;
ALTER TABLE leads DROP COLUMN death_reason;
DROP TYPE engagement_level_enum;
DROP TYPE death_reason_enum;
```
Redeploy previous UI version to Railway.

### Phase 2 Rollback
Revert both Edge Functions to previous versions via Supabase dashboard.

---

## Data Integrity Checks

### Before ANY deployment
```sql
-- Check for calendar ghosts (leads with next_followup_date but no pending follow_up)
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
**Expected:** 0 rows (if any rows, run calendar sync fix first)

### After Phase 0
```sql
-- Check qualification distribution
SELECT 
  status,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM leads), 1) AS pct
FROM leads
GROUP BY status
ORDER BY count DESC;
```
**Expected:** ~600 qualified (~43%), ~800 disqualified (~57%)

### After Phase 1
```sql
-- Check engagement_level distribution
SELECT 
  engagement_level,
  COUNT(*) AS count
FROM leads
GROUP BY engagement_level
ORDER BY count DESC;
```
**Expected:** Most leads = 'cold' initially, some 'hot' for contacted leads

---

## Files Reference

### Documentation
- `docs/URGENT_FIXES_2026-03-19.md` — Issue summary
- `docs/LEAD_QUALIFICATION_SYSTEM.md` — Qualification design
- `docs/ENGAGEMENT_LEVEL_MAPPING.md` — Webhook mapping logic
- `docs/DISPATCHER_GATE.md` — Dispatcher gate theory
- `docs/DISPATCHER_GATE_IMPLEMENTATION.md` — Dispatcher code changes
- `docs/ENGAGEMENT_SYSTEM_DEPLOYMENT.md` — Original deployment plan

### Code
- `scripts/qualify_existing_leads.js` — Qualification script
- `src/components/pipeline/PipelineCalendar.tsx` — Calendar sync fix
- `supabase/migrations/20260319120000_engagement_level_system.sql` — Database migration

### Edge Functions (Supabase)
- `easyexit-followup-engine` — Dispatcher (needs gate updates)
- `easyexit-vapi-webhook` — Webhook (needs engagement_level mapping)

---

## Questions for Ben

### Q1: Dispatcher Access
Do you have access to edit Supabase Edge Functions? Or should I write the full dispatcher code for you to deploy?

### Q2: Deployment Timing
Should we:
- **Option A:** Deploy Phase 0 today, Phase 1 tomorrow (safest)
- **Option B:** Deploy all phases today (faster but riskier)
- **Option C:** I deploy Phase 0 + Phase 1, you review, then we do Phase 2 together

### Q3: Qualification Review
Before running the qualification script, do you want to:
- **Option A:** Review the script output (--dry-run) first
- **Option B:** Trust the logic and run it live
- **Option C:** Manually review a sample of leads it would disqualify

---

## Estimated Timeline

### Option A (Safest)
- **Today:** Phase 0 (dispatcher gate + qualification) — 2-3 hours
- **Tomorrow:** Verify Phase 0, deploy Phase 1 (migration + UI) — 1-2 hours
- **Day 3:** Deploy Phase 2 (webhook + dispatcher updates) — 1 hour
- **Total:** 3 days, ~5 hours work

### Option B (Faster)
- **Today:** All phases — 4-5 hours
- **Risk:** If something breaks, harder to isolate which phase caused it

---

**Recommendation:** Option A (phased deployment) for safety.

**Waiting for Ben's answers to Q1-Q3 before proceeding.**
