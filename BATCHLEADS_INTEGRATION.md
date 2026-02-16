# BatchLeads Integration - Easy Exit Hub

**Status:** ✅ Fully integrated  
**Import Page:** http://localhost:5173/leads/import  

---

## How It Works

```
BatchLeads Export → Drop in imports/ → Watcher processes (hourly)
→ Enriched CSV in exports/ → API serves JSON → Easy Exit Hub imports → Supabase database
```

---

## Quick Start

### 1. Make sure API server is running
```bash
cd ~/.openclaw/workspace-easyexit/dashboard
source venv/bin/activate
python3 api_server.py &
```

### 2. Open Easy Exit Hub
```bash
# Should already be running at:
open http://localhost:5173/leads/import
```

### 3. Import Leads
1. Click "Load Leads" - fetches from processed CSVs
2. Review the preview table (shows priority, scores, signals)
3. Click "Import X Leads" - writes to Supabase
4. Done! Leads appear in Easy Exit Hub

---

## Data Flow

**From BatchLeads to Your CRM:**

1. **Export from BatchLeads** → CSV file
2. **Drop in watched folder:**
   ```bash
   mv ~/Downloads/batchleads_export.csv ~/.openclaw/workspace-easyexit/scrapers/data/batchleads_imports/
   ```
3. **Watcher processes** (runs hourly via cron, or manual run):
   ```bash
   python3 ~/.openclaw/workspace-easyexit/scrapers/batchleads_watcher.py
   ```
4. **Enriched CSV created** in `scrapers/data/exports/`
5. **API server serves** the CSV data as JSON (http://localhost:5001/api/leads)
6. **Easy Exit Hub imports** via Import page (http://localhost:5173/leads/import)
7. **Leads stored in Supabase** and visible throughout the app

---

## What Gets Imported

**Per lead:**
- Address, city, state, zip
- Owner name, phone (real numbers only), email
- Property type, assessed value, market value
- **Distress scoring:**
  - Score (0-100)
  - Motivation level (VERY HIGH / HIGH / MODERATE / LOW)
  - Priority (1-4)
  - Signals (tax delinquent, violations, probate, lis pendens)
- Source (BatchLeads)
- Deal stage (Raw Lead)
- Created timestamp

**Duplicate detection:**
- Checks if property address already exists
- Skips duplicates automatically
- Shows success/error count after import

---

## Import Page Features

**Stats Cards:**
- Total leads available
- Very High Priority count (red)
- High Priority count (orange)
- Moderate Priority count (yellow)

**Preview Table:**
- First 20 leads shown
- Sorted by priority (1 = most urgent)
- Shows all key fields and signals
- Fake phone numbers display as "N/A"

**Actions:**
- **Load Leads** - Fetch from CSVs
- **Import X Leads** - Write to database
- **Auto-duplicate detection** - Won't create duplicates

---

## Accessing the Import Page

**Direct URL:**
```
http://localhost:5173/leads/import
```

**From Easy Exit Hub:**
- Navigate to Leads section
- Click "Import" (if added to nav)
- Or use direct URL

---

## Testing

**Current test data:** 9 leads in processed CSVs
- 3 VERY HIGH priority
- 1 HIGH priority
- 3 MODERATE priority
- 2 LOW priority

**To test:**
1. Open http://localhost:5173/leads/import
2. Click "Load Leads"
3. Should see 9 test leads in preview
4. Click "Import 9 Leads"
5. Check Leads page - should see imported leads

---

## Files Created

### In Easy Exit Hub (`/Users/bendickinson/Projects/easyexithub-main/`)
- `src/services/csvImporter.ts` - Service to fetch/convert CSV data
- `src/pages/ImportLeadsPage.tsx` - Import UI
- `src/App.tsx` - Updated with /leads/import route

### In Workspace (`~/.openclaw/workspace-easyexit/`)
- `dashboard/api_server.py` - API serving CSV data
- `scrapers/batchleads_watcher.py` - CSV processor
- `scrapers/data/exports/` - Processed CSVs (source for import)

---

## Troubleshooting

### "Failed to fetch leads from API"
**Issue:** API server not running  
**Fix:**
```bash
cd ~/.openclaw/workspace-easyexit/dashboard
source venv/bin/activate
python3 api_server.py &
```

### "No leads to import"
**Issue:** No processed CSVs available  
**Fix:** Process a CSV first:
```bash
python3 ~/.openclaw/workspace-easyexit/scrapers/batchleads_watcher.py
```

### Import page shows blank
**Issue:** Route might not be registered  
**Fix:** Restart Vite dev server:
```bash
# In easyexithub-main directory
npm run dev
```

### Leads not appearing after import
**Issue:** Database connection or Supabase credentials  
**Fix:** Check .env file in easyexithub-main/ has valid Supabase URL and key

---

## Next Steps

1. **Export real BatchLeads data** and test full pipeline
2. **Add navigation link** to Import page in Easy Exit Hub sidebar
3. **Schedule automatic imports** (cron job to import new CSVs)
4. **Add webhook** to trigger import when new CSV is processed

---

## Summary

**What's connected:**
✅ BatchLeads CSV processor (watcher)  
✅ API server serving CSV data  
✅ Easy Exit Hub import page  
✅ Supabase database storage  
✅ Distress scoring & prioritization  
✅ Duplicate detection  
✅ Fake data filtering (555 numbers = N/A)  

**Workflow:**
Export → Drop → Process → Import → Use

**Import URL:**
http://localhost:5173/leads/import
