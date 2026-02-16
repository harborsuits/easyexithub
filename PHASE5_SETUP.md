# Phase 5: Lead Database Setup Guide

**Status:** Schema files created ✅ | Table creation pending ⏳

## What's Been Done

### Files Created:
1. **`migrations/001_create_leads_table.sql`** - Complete SQL migration for leads table
2. **`src/integrations/supabase/schema-setup.ts`** - Schema definitions and TypeScript types
3. **`src/context/LeadsContext.tsx`** - React context for managing leads data

### Schema Overview

**Leads Table Fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | BIGSERIAL | Primary key |
| `property_address` | TEXT | Street address of property |
| `market` | TEXT | Market location (Birmingham, AL \| Kansas City, MO \| Multi-Market) |
| `asking_price` | DECIMAL | List price |
| `estimated_arv` | DECIMAL | After-repair value |
| `repair_estimate` | DECIMAL | Total repair costs |
| `estimated_profit` | DECIMAL | Projected profit |
| `lead_status` | TEXT | new \| contacted \| negotiating \| under_contract \| closed \| passed |
| `assigned_buyer_id` | BIGINT | FK to buyers table |
| `deal_status` | TEXT | unassigned \| assigned \| negotiating \| contract_sent \| contract_signed \| closing \| closed \| dead |
| `contract_price` | DECIMAL | Agreed purchase price |
| `closing_date` | DATE | Expected closing |
| `notes` | TEXT | Additional details |
| `created_at` | TIMESTAMP | Auto-created |
| `updated_at` | TIMESTAMP | Auto-updated |

## Next Step: Create the Table in Supabase

### Method 1: Via Supabase Dashboard (Recommended)

1. **Go to SQL Editor:**
   - Navigate to: https://app.supabase.com/project/bgznglzzknmetzpwkbbz/sql/new
   - Or in Supabase dashboard: SQL → New Query

2. **Copy and paste this SQL:**
   ```sql
   CREATE TABLE IF NOT EXISTS leads (
     id BIGSERIAL PRIMARY KEY,
     property_address TEXT NOT NULL,
     property_city TEXT,
     property_state TEXT,
     property_zip TEXT,
     market TEXT,
     asking_price DECIMAL(12,2),
     estimated_arv DECIMAL(12,2),
     repair_estimate DECIMAL(12,2),
     estimated_profit DECIMAL(12,2),
     days_on_market INTEGER,
     property_type TEXT,
     bedrooms INTEGER,
     bathrooms INTEGER,
     square_feet INTEGER,
     year_built INTEGER,
     condition_notes TEXT,
     photo_url TEXT,
     lead_source TEXT,
     owner_name TEXT,
     owner_phone TEXT,
     owner_email TEXT,
     lead_status TEXT DEFAULT 'new',
     assigned_buyer_id BIGINT,
     assignment_date TIMESTAMP,
     deal_status TEXT DEFAULT 'unassigned',
     contract_price DECIMAL(12,2),
     closing_date DATE,
     notes TEXT,
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW(),
     created_by TEXT DEFAULT 'system',
     updated_by TEXT DEFAULT 'system'
   );

   -- Create indexes for fast lookups
   CREATE INDEX IF NOT EXISTS idx_leads_market ON leads(market);
   CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(lead_status);
   CREATE INDEX IF NOT EXISTS idx_leads_assigned_buyer ON leads(assigned_buyer_id);
   CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_leads_deal_status ON leads(deal_status);
   ```

3. **Click "Run"** and wait for confirmation

4. **Verify:** Go to Database → Tables and confirm `leads` table appears

### Method 2: Via SQL File

```bash
# Execute the migration file
psql -U postgres -h db.bgznglzzknmetzpwkbbz.supabase.co -d postgres < migrations/001_create_leads_table.sql
```
(Use the Supabase connection string from project settings)

## After Table Creation

### Add Sample Test Data

Once the table exists, you can test with:

```javascript
// In the browser console or via a script
const { data, error } = await supabase
  .from('leads')
  .insert([
    {
      property_address: "123 Main St, Birmingham, AL 35203",
      market: "Birmingham, AL",
      asking_price: 85000,
      estimated_arv: 150000,
      repair_estimate: 45000,
      estimated_profit: 20000,
      property_type: "Single Family",
      condition_notes: "Needs roof and HVAC",
      lead_source: "Direct Outreach",
      owner_name: "John Doe",
      owner_phone: "205-555-1234",
      lead_status: "new",
      deal_status: "unassigned"
    }
  ])
  .select();
```

## Available Queries

### Get all unassigned leads in Birmingham:
```javascript
const { data } = await supabase
  .from('leads')
  .select('*')
  .eq('market', 'Birmingham, AL')
  .eq('deal_status', 'unassigned')
  .order('created_at', { ascending: false });
```

### Get leads with available buyer matches:
```javascript
// Uses the available_matches view (created after first table setup)
const { data } = await supabase
  .from('available_matches')
  .select('*')
  .eq('market', 'Birmingham, AL');
```

### Assign a lead to a buyer:
```javascript
const { error } = await supabase
  .from('leads')
  .update({
    assigned_buyer_id: 5,  // buyer.id
    assignment_date: new Date().toISOString(),
    deal_status: 'assigned'
  })
  .eq('id', 123);  // lead.id
```

## Next Phase

**Phase 6: Matching Algorithm** - Will implement the logic to:
- Find best buyer matches for each lead based on market + tier
- Rank matches by buyer tier (Tier 1 first)
- Create recommendations for assignment

**Phase 7: Assignment UI** - Will build:
- Lead detail page
- Recommended buyers sidebar
- One-click assignment
- Deal tracker

## Verification Checklist

After running the SQL:
- [ ] Table `leads` appears in Supabase dashboard
- [ ] Columns match the schema above
- [ ] Indexes created successfully
- [ ] Can insert test lead via SQL or API
- [ ] Can query leads via JavaScript/React context

---

**Status:** Ready for table creation. Once created, Phase 6 (Matching Logic) can begin.
