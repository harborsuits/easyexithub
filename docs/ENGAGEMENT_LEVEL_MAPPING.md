# Engagement Level Mapping Logic

## Purpose
Map Vapi call outcomes to engagement_level classification for the 3-attempt cold call rule.

## Webhook Update Required
The Phoenix Easy Exit webhook (`/functions/vapi-easyexit`) needs to update TWO fields on every end-of-call-report:

1. **engagement_level** (enum: cold/warm/hot/dead/dnc)
2. **cold_attempts** (integer counter, only incremented for cold outcomes)

## Classification Rules

### HOT (unlimited follow-ups, high priority)
- `callback_requested`
- `executor`
- `interested`
- `price_discussion`
- `timeline_discussion`
- `wants_offer`

**Logic:**
```javascript
if (hotOutcomes.includes(callOutcome)) {
  engagement_level = 'hot';
  // do NOT increment cold_attempts
}
```

### WARM (unlimited follow-ups, lower priority)
- `maybe_later`
- `call_me_next_month`
- `not_ready_yet`
- `thinking_about_selling`

**Logic:**
```javascript
if (warmOutcomes.includes(callOutcome)) {
  engagement_level = 'warm';
  // do NOT increment cold_attempts
}
```

### COLD (3-attempt rule applies)
- `voicemail`
- `no_answer`
- `busy`
- `disconnected`

**Logic:**
```javascript
if (coldOutcomes.includes(callOutcome)) {
  engagement_level = 'cold'; // keep as cold
  cold_attempts += 1;
  
  // Apply 3-attempt rule (terminal outcome)
  if (cold_attempts >= 3) {
    status = 'dead';
    callable = false;
    death_reason = 'no_response';
    // cancel all pending follow_ups for this lead
  }
}
```

### DEAD (terminal - blocked)
Terminal outcomes that override engagement level.

**Call outcomes:**
- `wrong_number` → death_reason = 'wrong_number'
- `not_interested` → death_reason = 'not_interested'
- `hung_up` → death_reason = 'not_interested'
- `attorney_handling` → death_reason = 'attorney_handling'
- `sold_elsewhere` → death_reason = 'sold_elsewhere'
- `family_transfer` → death_reason = 'family_transfer'
- `property_transferred` → death_reason = 'property_transferred'
- `kept_property` → death_reason = 'kept_property'

**Logic:**
```javascript
const deathReasonMap = {
  wrong_number: 'wrong_number',
  not_interested: 'not_interested',
  hung_up: 'not_interested',
  attorney_handling: 'attorney_handling',
  sold_elsewhere: 'sold_elsewhere',
  family_transfer: 'family_transfer',
  property_transferred: 'property_transferred',
  kept_property: 'kept_property'
};

if (deadOutcomes.includes(callOutcome)) {
  engagement_level = 'dead';
  status = 'dead';
  callable = false;
  death_reason = deathReasonMap[callOutcome] || 'not_interested';
  // cancel all pending follow_ups
}
```

### DNC (terminal - compliance-blocked)
Only assign DNC if transcript explicitly contains DNC phrases.

**DNC detection:**
```javascript
const dncPhrases = [
  'do not call',
  'remove me',
  'stop calling',
  'take me off',
  'no more calls'
];

function transcriptContainsDNC(transcript) {
  const lower = transcript.toLowerCase();
  return dncPhrases.some(phrase => lower.includes(phrase));
}
```

**Logic:**
```javascript
if (transcriptContainsDNC(transcript)) {
  engagement_level = 'dnc';
  status = 'dnc';
  callable = false;
  death_reason = 'dnc_request';
  // cancel all pending follow_ups
  // set DNC flag for compliance reporting
}
```

**Important:** Do NOT auto-assign DNC based on call outcome alone. Only set DNC when transcript confirms explicit request.

## Three-Phase Lead Lifecycle

### Phase 1: Cold (prospecting)
- No meaningful conversation yet
- 3-attempt rule applies
- Auto-dead at cold_attempts >= 3

### Phase 2: Engaged (relationship)
- Active conversation happening
- Unlimited follow-ups
- Where real deals happen

### Phase 3: Terminal (resolution)
- **Overrides everything** (even hot leads)
- Closes lead permanently
- Requires death_reason for analytics

**Example:** A hot lead (executor) who later sells to a realtor:
```javascript
engagement_level: 'hot' → 'dead'
death_reason: 'sold_elsewhere'
callable: false
```

Terminal outcomes always trump engagement level.

---

## Important Behaviors

### Upgrade Path (cold → warm/hot)
Once a lead moves from **cold** to **warm** or **hot**, the `cold_attempts` counter is **ignored** (not reset, just ignored).

Example:
```
Call 1: voicemail (cold, cold_attempts=1)
Call 2: voicemail (cold, cold_attempts=2)
Call 3: callback_requested (hot, cold_attempts=2 but ignored)
Call 4+: unlimited follow-ups allowed
```

### Downgrade Path (hot/warm → dead/dnc)
If a previously engaged lead becomes negative:
```
Call 1: executor (hot)
Call 2: hung_up (dead)
→ engagement_level = 'dead', callable = false
```

### Dispatcher Enforcement
Before placing ANY call, the dispatcher checks:
```javascript
if (lead.engagement_level === 'dead') return skip;
if (lead.engagement_level === 'dnc') return skip;
if (!lead.callable) return skip;
if (lead.engagement_level === 'cold' && lead.cold_attempts >= 3) return skip;
```

This is the **final gate** — even if the engine schedules a call, the dispatcher blocks it.

## Database Schema
```sql
CREATE TYPE engagement_level_enum AS ENUM ('cold', 'warm', 'hot', 'dead', 'dnc');

ALTER TABLE leads
  ADD COLUMN engagement_level engagement_level_enum DEFAULT 'cold',
  ADD COLUMN cold_attempts INTEGER DEFAULT 0;
```

## UI Display
Instead of showing `3x contacted`, show:
- **Cold leads:** `Cold attempts: 2 / 3`
- **Engaged leads:** `HOT lead — unlimited follow-ups` or `WARM lead — unlimited follow-ups`
- **Dead/DNC leads:** `Blocked (dead)` or `Blocked (DNC)`

## Testing Checklist
- [ ] Voicemail → cold, cold_attempts++
- [ ] 3rd voicemail → status=dead, callable=false
- [ ] Callback requested → hot, unlimited calls
- [ ] Hot lead → hung_up → dead, blocked
- [ ] Dispatcher skips leads with cold_attempts >= 3
- [ ] UI shows correct attempt counter
