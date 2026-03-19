# Lead Qualification System

## Problem Statement
**Callable ≠ Viable**

The dialer should NOT automatically call every `callable=true` record because some are:
- Wrong numbers
- Duplicate owners
- Corporate entities
- Utility accounts (Central Maine Power, Town of Gorham, etc.)
- Already sold properties
- Properties outside buy box
- Invalid records

## Three-State Model

### State 1: Raw (unverified)
```sql
status = 'new' OR 'raw'
callable = false
outbound_approved = false
```

**Meaning:** Just imported. Not screened yet.

---

### State 2: Qualified (safe to dial)
```sql
status = 'qualified'
callable = true
outbound_approved = true
```

**Meaning:** Passed screening rules. Only these enter the dial queue.

**Screening criteria:**
- Phone number exists and is valid format
- Owner type is NOT corporate/utility/government
- Property is within target market
- No duplicate phone in database
- Property not already sold
- Meets minimum viability criteria

---

### State 3: Disqualified (blocked)
```sql
status = 'disqualified'
callable = false
outbound_approved = false
exclusion_reason = [array of reasons]
```

**Reasons:**
- `no_phone` — no phone number available
- `corporate` — corporate/LLC owner
- `utility` — utility company record
- `municipality` — government/town record
- `duplicate_owner` — same owner already in system
- `already_sold` — property transferred/sold
- `outside_market` — not in target geography
- `invalid_data` — missing critical fields

---

## Dispatcher Gate Logic

Before placing ANY call, the dispatcher must check:

```javascript
function canDial(lead) {
  // Gate 1: Must be approved
  if (!lead.outbound_approved) {
    console.log(`[GATE BLOCK] Lead ${lead.id} not approved for outbound`);
    return false;
  }
  
  // Gate 2: Must be callable
  if (!lead.callable) {
    console.log(`[GATE BLOCK] Lead ${lead.id} callable=false`);
    return false;
  }
  
  // Gate 3: Terminal outcomes
  if (lead.engagement_level === 'dead') {
    console.log(`[GATE BLOCK] Lead ${lead.id} is dead`);
    return false;
  }
  
  if (lead.engagement_level === 'dnc') {
    console.log(`[GATE BLOCK] Lead ${lead.id} is DNC`);
    return false;
  }
  
  // Gate 4: Cold attempt limit
  if (lead.engagement_level === 'cold' && lead.cold_attempts >= 3) {
    console.log(`[GATE BLOCK] Lead ${lead.id} exceeded cold attempt limit`);
    return false;
  }
  
  // All gates passed
  return true;
}
```

**Critical:** `outbound_approved` is the qualification flag. Only qualified leads have this set to `true`.

---

## Auto-Qualification Rules (On Import)

When a lead is imported, run these checks:

```javascript
async function qualifyLead(lead) {
  const disqualifications = [];
  
  // Check 1: Phone number
  if (!lead.owner_phone || lead.owner_phone.length < 10) {
    disqualifications.push('no_phone');
  }
  
  // Check 2: Owner type
  const corporateKeywords = ['LLC', 'INC', 'CORP', 'CO', 'LTD', 'COMPANY'];
  const utilityKeywords = ['POWER', 'ELECTRIC', 'WATER', 'SEWER', 'TOWN OF', 'CITY OF'];
  
  const ownerUpper = (lead.owner_name || '').toUpperCase();
  
  if (corporateKeywords.some(kw => ownerUpper.includes(kw))) {
    disqualifications.push('corporate');
  }
  
  if (utilityKeywords.some(kw => ownerUpper.includes(kw))) {
    disqualifications.push('utility');
  }
  
  // Check 3: Duplicate phone
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('owner_phone', lead.owner_phone)
    .neq('id', lead.id)
    .limit(1);
  
  if (existing && existing.length > 0) {
    disqualifications.push('duplicate_owner');
  }
  
  // Check 4: Market geography
  const targetStates = ['ME', 'NH'];
  const propertyData = typeof lead.property_data === 'string' 
    ? JSON.parse(lead.property_data) 
    : lead.property_data;
  
  const state = propertyData?.state || propertyData?.property_state;
  if (state && !targetStates.includes(state.toUpperCase())) {
    disqualifications.push('outside_market');
  }
  
  // Decision
  if (disqualifications.length > 0) {
    await supabase
      .from('leads')
      .update({
        status: 'disqualified',
        callable: false,
        outbound_approved: false,
        exclusion_reason: disqualifications
      })
      .eq('id', lead.id);
    
    return { qualified: false, reasons: disqualifications };
  } else {
    await supabase
      .from('leads')
      .update({
        status: 'qualified',
        callable: true,
        outbound_approved: true
      })
      .eq('id', lead.id);
    
    return { qualified: true };
  }
}
```

---

## Correct Flow

```
Import Lead
    ↓
Auto-Qualification
    ↓
    ├─→ Qualified → outbound_approved=true → Dial Queue
    └─→ Disqualified → outbound_approved=false → Blocked
```

---

## Current Issue in Easy Exit

From database query:
```
new | callable=true | approved=false  ❌
```

**Problem:** Leads are `callable=true` but `outbound_approved=false`.

This means:
1. Either the dispatcher is NOT checking `outbound_approved` (dangerous)
2. Or leads were imported without running qualification

**Fix:**
1. Run qualification on all existing leads
2. Update dispatcher to enforce `outbound_approved` gate
3. Add qualification to lead import pipeline

---

## Testing Checklist

### Test 1: Corporate Lead Blocked
```
Import: "CENTRAL MAINE POWER LLC"
Expected: status=disqualified, outbound_approved=false, exclusion_reason=['corporate','utility']
Dispatcher: blocked
```

### Test 2: Valid Lead Qualified
```
Import: "John Smith" + valid phone + ME address
Expected: status=qualified, outbound_approved=true
Dispatcher: allowed (if other gates pass)
```

### Test 3: Duplicate Phone Blocked
```
Import: Lead with same phone as existing lead
Expected: status=disqualified, exclusion_reason=['duplicate_owner']
Dispatcher: blocked
```

---

## Dashboard Metrics (Corrected)

Instead of confusing numbers, show:
- **Total Leads:** 1,407
- **Qualified:** 607 (outbound_approved=true)
- **Disqualified:** 800 (utility/corporate/duplicates/etc.)
- **Calls Made Today:** 133
- **Contacted (engaged):** 50
- **Dead:** 7

Each metric has a clear, single source of truth.

---

## Implementation Priority

1. **Immediate:** Update dispatcher to enforce `outbound_approved` gate
2. **Phase 1:** Run qualification on all existing leads (backfill)
3. **Phase 2:** Add auto-qualification to lead import pipeline
4. **Phase 3:** Add manual review UI for edge cases

---

**Bottom line:** The dialer should ONLY pull leads where:
```sql
outbound_approved = true
AND callable = true
AND engagement_level NOT IN ('dead', 'dnc')
```

This prevents calling utility companies, duplicates, and garbage data.
