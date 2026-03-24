# Attorney Review Packet — TCPA / AI Voice Compliance
## Easy Exit Homes — Maine Real Estate Wholesaling

**Prepared:** 2026-03-22
**For:** Maine RE attorney engagement
**Purpose:** Review AI-initiated outbound calling system for TCPA, FCC, and Maine compliance

---

## 1. System Overview

Easy Exit Homes uses an AI voice assistant ("Alex") to make outbound calls to
property owners identified through public records (VGSI property databases,
probate filings, foreclosure notices). The system:

- Identifies distressed property leads from public Maine records
- Places outbound phone calls via Vapi (AI voice platform)
- Alex (AI) conducts initial property inquiry conversations
- Positive leads are handed off to a human for follow-up
- All calls are logged with full transcripts and compliance audit trail

### Call Volume
- Current: testing phase, <10 calls/day
- Projected: 50-200 calls/day at production scale

### Phone Number
- Vapi-provisioned 207 area code number
- Caller ID displays Easy Exit Homes

---

## 2. Questions for Attorney Review

### A. TCPA Classification
1. **Are these calls "telemarketing" under TCPA?**
   - We are contacting property owners about purchasing their property
   - This is a commercial transaction, but we are the buyer, not selling a service
   - Does buyer-initiated outreach to public record property owners qualify?

2. **AI-initiated calls and ATDS**
   - Vapi uses VoIP, not a traditional autodialer
   - Numbers are curated from public records, not randomly/sequentially generated
   - Does this system qualify as an ATDS under current FCC interpretation?

3. **Prior express consent**
   - Our leads come from public property records (VGSI, probate, foreclosure)
   - We have no prior relationship with these property owners
   - What consent standard applies for initial outreach?
   - Is public record sourcing sufficient for a "reasonable basis" defense?

### B. AI Disclosure Requirements
4. **FCC AI disclosure rules (effective 2024)**
   - Alex currently identifies as an AI assistant at call start
   - Is the current disclosure sufficient?
   - What exact language is recommended?
   - Must disclosure occur before any substantive conversation?

5. **Maine-specific disclosure**
   - Any Maine-specific requirements for AI/automated calls?
   - Does Maine require additional property solicitation disclosure?

### C. DNC Compliance
6. **Federal DNC registry**
   - We plan to purchase 207 area code access ($82/year)
   - Is monthly scrubbing frequency sufficient?
   - What is the safe harbor for newly-listed numbers (31-day grace)?

7. **Internal DNC**
   - We maintain a real-time internal DNC list (blocked_phones table)
   - Opt-outs are processed immediately and cascade to all lead records
   - Is this implementation sufficient?

### D. Maine Telemarketer Registration
8. **Do we need to register as a telemarketer in Maine?**
   - 32 MRSA §14716 (Maine Telemarketer Registration Act)
   - We are buying properties, not selling products/services
   - Does the buyer exemption apply?
   - AI calling — any additional registration requirements?

### E. Opt-Out Compliance
9. **Our current opt-out handling:**
   - Real-time detection of opt-out phrases in transcript
   - Immediate suppression (consent revoked, phone blocked globally)
   - Compliance audit log entry for every opt-out
   - Is there a required timeframe for honoring opt-outs? (We do it instantly)

### F. Recording / Transcript
10. **Maine call recording consent**
    - Maine is a one-party consent state (Title 15 §710)
    - AI transcription = recording. One-party consent applies?
    - Any notification requirement when AI is doing the recording?

---

## 3. Current Engineering Safeguards

| Safeguard | Status | Description |
|-----------|--------|-------------|
| AI Disclosure | ✅ Active | Alex identifies as AI in opening script |
| Opt-Out Detection | ✅ Active | Real-time transcript analysis, instant block |
| Internal DNC | ✅ Active | Global phone suppression table |
| Federal DNC | ⏳ Pending | Ready to integrate after purchase |
| Consent Tracking | ✅ Active | Per-lead consent records with full history |
| Compliance Audit Log | ✅ Active | Every attempt/block/opt-out logged |
| Dialing Hours | ✅ Active | 9am-8pm in lead's local timezone |
| Contact Spacing | ✅ Active | Minimum 3-day spacing between contacts |
| Cold Attempt Limit | ✅ Active | Max 3 cold attempts without consent upgrade |
| Compliance Hold | ✅ Active | Manual hold capability for any lead |
| Strict Mode | ✅ Active | Master switch enforces all compliance gates |

---

## 4. Requested Attorney Deliverables

1. **Written opinion** on TCPA applicability to our use case
2. **Recommended disclosure script** for Alex's opening
3. **Consent framework recommendation** (what level suffices for initial contact)
4. **Maine registration guidance** (yes/no + steps if yes)
5. **DNC compliance review** of our technical implementation
6. **Risk assessment** with specific exposure areas and mitigation recommendations

---

## 5. Relevant Statutes / Regulations

- **TCPA** — 47 U.S.C. § 227
- **FCC AI Disclosure Rule** — 2024 Declaratory Ruling (AI-generated voices)
- **FTC Telemarketing Sales Rule** — 16 CFR Part 310
- **Maine Telemarketer Registration** — 32 MRSA §14716
- **Maine Wiretapping** — 15 MRSA §710 (one-party consent)
- **FCC ATDS Definition** — Facebook v. Duguid (2021) narrowed definition

---

## 6. Attachments (to provide to attorney)

- [ ] Sample Alex call transcript (sanitized)
- [ ] Alex opening script with AI disclosure
- [ ] System architecture diagram (call flow)
- [ ] Compliance audit log sample export
- [ ] Lead sourcing documentation (VGSI, probate, foreclosure)
