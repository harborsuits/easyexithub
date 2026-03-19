# Dispatcher Safety Gate

## Purpose
The dispatcher is the **final enforcement layer** before any call is placed.
Even if the engine schedules a follow-up, the dispatcher must validate the lead is callable.

## Implementation Location
This logic should be in the Phoenix dispatcher/engine function that:
1. Queries `follow_ups` table for due calls
2. Loads lead data
3. Places Vapi outbound call

## Gate Logic (Run Before Every Call)

```javascript
async function isLeadCallable(lead) {
  // Gate 1: Explicit blocks
  if (lead.engagement_level === 'dead') {
    console.log(`[GATE BLOCK] Lead ${lead.id} is dead`);
    return false;
  }
  
  if (lead.engagement_level === 'dnc') {
    console.log(`[GATE BLOCK] Lead ${lead.id} is DNC`);
    return false;
  }
  
  if (!lead.callable) {
    console.log(`[GATE BLOCK] Lead ${lead.id} callable=false`);
    return false;
  }
  
  // Gate 2: Cold attempt limit
  if (lead.engagement_level === 'cold' && lead.cold_attempts >= 3) {
    console.log(`[GATE BLOCK] Lead ${lead.id} exceeded cold attempt limit (${lead.cold_attempts}/3)`);
    
    // Auto-remediation: mark as dead if not already
    if (lead.status !== 'dead') {
      await updateLead(lead.id, {
        status: 'dead',
        callable: false,
        exclusion_reason: ['max_cold_attempts']
      });
    }
    
    return false;
  }
  
  // Gate 3: Phone number validation
  if (!lead.phone || lead.phone.length < 10) {
    console.log(`[GATE BLOCK] Lead ${lead.id} has invalid phone`);
    return false;
  }
  
  // All gates passed
  return true;
}
```

## Dispatcher Flow

```javascript
async function processScheduledCalls() {
  // 1. Query due follow-ups
  const dueCalls = await supabase
    .from('follow_ups')
    .select('*, leads(*)')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString());
  
  for (const followUp of dueCalls) {
    const lead = followUp.leads;
    
    // 2. Run gate check
    const callable = await isLeadCallable(lead);
    
    if (!callable) {
      // Mark follow-up as cancelled
      await supabase
        .from('follow_ups')
        .update({ 
          status: 'cancelled',
          cancelled_reason: 'failed_dispatcher_gate'
        })
        .eq('id', followUp.id);
      
      continue; // Skip to next lead
    }
    
    // 3. Place call via Vapi
    try {
      await placeVapiCall(lead);
      
      // Mark follow-up as executed
      await supabase
        .from('follow_ups')
        .update({ 
          status: 'executed',
          executed_at: new Date().toISOString()
        })
        .eq('id', followUp.id);
        
    } catch (error) {
      console.error(`[CALL ERROR] Lead ${lead.id}:`, error);
      
      // Mark as failed for retry
      await supabase
        .from('follow_ups')
        .update({ 
          status: 'failed',
          error_message: error.message
        })
        .eq('id', followUp.id);
    }
  }
}
```

## Why This Matters

### Without Dispatcher Gate
```
Webhook sets lead to dead
Engine still has pending follow-up scheduled
System calls a dead lead ❌
```

### With Dispatcher Gate
```
Webhook sets lead to dead
Engine has pending follow-up scheduled
Dispatcher blocks call at gate ✅
Follow-up marked as cancelled
```

## Auto-Remediation
If the gate detects a lead that **should** be dead but isn't (e.g., cold_attempts >= 3 but callable=true), it auto-fixes the database state and blocks the call.

This prevents data integrity issues from causing compliance problems.

## Testing

### Test Case 1: Cold Limit Enforcement
```
Setup:
  - Lead with cold_attempts=3, engagement_level='cold'
  - Pending follow-up scheduled

Expected:
  - Dispatcher blocks call
  - Follow-up marked cancelled
  - Lead marked dead
```

### Test Case 2: DNC Protection
```
Setup:
  - Lead marked dnc
  - Manual follow-up scheduled by mistake

Expected:
  - Dispatcher blocks call
  - Follow-up cancelled
  - No Vapi call placed
```

### Test Case 3: Engaged Lead Pass
```
Setup:
  - Lead with engagement_level='hot'
  - cold_attempts=5 (irrelevant because hot)
  - Pending follow-up scheduled

Expected:
  - Dispatcher allows call
  - Vapi call placed
  - Follow-up marked executed
```

## Deployment
This gate logic should be added to the Phoenix dispatcher function before the March 2026 call cycle resumes.

**Critical:** Do not deploy webhook changes without deploying dispatcher gate — that creates a window where the system could call dead leads.
