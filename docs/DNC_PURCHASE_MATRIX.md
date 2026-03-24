# DNC Purchase Matrix — Easy Exit Homes

## Purpose
To achieve full TCPA compliance for AI-initiated outbound calls, Easy Exit needs
access to both federal and state Do-Not-Call registries. This document outlines
the options, costs, and recommended approach.

---

## Federal DNC Registry (FTC)

| Item | Detail |
|------|--------|
| Provider | Federal Trade Commission (FTC) |
| URL | https://www.ftc.gov/enforcement/do-not-call-registry |
| Access | Telemarketer Access Portal (TAP) |
| Cost | $82/area code/year (first 5 free for SAN holders) |
| Required | SAN (Subscription Account Number) |
| Format | Phone number list, downloadable |
| Update frequency | Monthly (31-day access windows) |
| Integration | Download → normalize → load into `blocked_phones` table |

### Area Codes Needed (Maine Focus)
| Area Code | Coverage | Priority |
|-----------|----------|----------|
| 207 | All of Maine | **Required** |

**Total Federal Cost: $82/year** (1 area code, after SAN registration)

### SAN Registration
1. Go to https://telemarketing.donotcall.gov/
2. Register organization (Easy Exit Homes LLC)
3. Provide EIN, contact info, phone number used for outbound
4. Receive SAN within 5 business days
5. Use SAN to purchase area code access

---

## Maine State DNC Registry

| Item | Detail |
|------|--------|
| Authority | Maine Office of the Attorney General |
| Statute | Maine Telemarketer Registration Act (32 MRSA §14716) |
| URL | https://www.maine.gov/ag/consumer/telemarketer.shtml |
| Cost | Registration fee varies ($100–$300 for telemarketers) |
| Notes | Maine piggybacks on federal DNC; no separate state list |
| AI-specific | No Maine-specific AI calling statute as of 2026 |

**Maine uses the federal registry.** No separate state list purchase needed.
Maine Attorney General may require telemarketer registration depending on
volume and whether AI calls qualify as "telemarketing" (attorney review needed).

---

## Integration Plan

### Phase 1: Internal DNC (DONE ✅)
- `blocked_phones` table with global suppression
- Webhook auto-blocks on DNC/opt-out detection
- Gate 5d checks blocked_phones before every dial

### Phase 2: Federal DNC Import (PENDING)
1. Register SAN
2. Purchase 207 area code access
3. Download registry file
4. Normalize to 10-digit format
5. Bulk insert into `blocked_phones` with reason='federal_dnc'
6. Set up monthly refresh cron job

### Phase 3: Ongoing Compliance (PENDING)
- Monthly DNC registry refresh (automated import)
- Cross-reference every new lead phone against DNC on import
- `compliance_config.dnc_registry_last_checked` tracks freshness
- Alert if DNC data is >45 days stale

---

## Cost Summary

| Item | Annual Cost | Status |
|------|------------|--------|
| Federal DNC (207 area code) | $82 | Pending purchase |
| Maine state registration | $100–$300 | Attorney review needed |
| DNC scrub service (optional) | $50–$200/mo | Not needed at current volume |
| **Total (minimum)** | **$82/year** | |

---

## Decision Needed
- [ ] Ben: approve $82 for 207 area code DNC access
- [ ] Ben: approve Maine telemarketer registration if attorney recommends
- [ ] Attorney: confirm whether AI-initiated calls require telemarketer registration in Maine
