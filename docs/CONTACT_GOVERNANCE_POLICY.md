# Contact Governance Policy
**Author:** Ben Dickinson
**Date:** 2026-03-19
**Status:** ACTIVE — Nothing calls without passing this.

---

## Principles

1. The system is optimized to decide whether work **should** happen, not just to do work.
2. Every call must pass through this policy before entering the queue.
3. If the queue cannot explain itself, it is not safe.

---

## Three Layers (must be separated)

### 1. Eligibility — Can this person legally/operationally be called?
- callable = true
- outbound_approved = true
- engagement_level ≠ dead
- engagement_level ≠ dnc
- Not wrong_number, deceased, no property relevance → permanent suppression

### 2. Scheduling — When is the next acceptable time?
- **No answer:** 4 days after 1st attempt, 7 days after 2nd, stop after 3rd
- **Voicemail left:** 6–7 days between attempts
- **Callback requested:** exact requested date only, no override
- **Interested/warm:** manual review or custom cadence
- **Wrong number/DNC/deceased:** permanent suppression, never schedule

### 3. Priority — Should they be called before others?
Ranking order:
1. Fresh leads (never contacted) — always first
2. Warm callbacks (explicit date from lead)
3. Aged retries that have cleared spacing rules
4. Repeated recent attempts pushed down hard

**A lead can be eligible but still not belong in today's lineup.**

---

## Campaign-Level Throttles

- Max retries per day from same campaign segment
- Max repeats in a rolling 7-day window
- Minimum percentage of new/fresh leads in each run
- Queue diversity rule — same names cannot dominate

---

## Queue Self-Explanation (UI requirements)

Every row in the dial queue MUST show:
- Last contact date
- Last outcome
- Days since last attempt
- Attempt count (e.g., "2/3")
- Why it is in queue
- Why it is ranked where it is
- Next allowed call date
- Block reason if excluded

---

## Cadence Rules (hard minimums)

| Outcome | Wait Before Retry | Max Attempts | Then |
|---------|-------------------|-------------|------|
| No answer | 4 days (1st), 7 days (2nd) | 3 | Dead (no_response) |
| Voicemail left | 6-7 days | 3 | Dead (no_response) |
| Callback requested | Exact date only | Unlimited | Manual if no pickup |
| Interested/warm | Manual/custom | Unlimited | Manual review |
| Wrong number | Never | 0 | Permanent suppress |
| DNC | Never | 0 | Permanent suppress |
| Deceased | Never | 0 | Permanent suppress |
| Not interested | Never | 0 | Dead |
| Hung up | Never | 0 | Dead |

---

## Rebuild Order

1. ✅ This policy spec (this document)
2. SQL/data model updates (cadence fields, governance columns)
3. Eligibility function (canDial + spacing check)
4. Ranking function (fresh first, diversity enforcement)
5. Queue UI explanation fields
6. Only then re-enable dispatcher

---

## Current State (2026-03-19)

- Engine: **OFF** (disabled by Atlas after Ben identified cadence abuse)
- All existing follow-ups: **TAINTED** (created under bad 1-day/2-day logic)
- Must be invalidated before engine restart
