# Monthly Scrape Job Configuration

This document describes how to set up recurring monthly scraping for all towns.

## Goal

Automatically scrape all configured towns (Brunswick, Bath, Portland, etc.) once per month to:
1. Find new distressed properties
2. Track changes to existing properties (added/removed tax delinquency, foreclosures, etc.)
3. Enrich with probate/obituary/code violation data
4. Filter and import viable leads automatically

## Architecture

```
Monthly Cron Job (1st of each month at 2am)
├─ For each town:
│  ├─ Run scraper (get raw property data)
│  ├─ Enrich (add probate, obituary, violations)
│  ├─ Score (calculate viability)
│  └─ Import (write viable leads to Supabase)
│
└─ Archive old leads (score < 60, age > 2 months)
```

## Setup Options

### Option 1: OpenClaw Cron (Recommended)

Using OpenClaw's built-in cron scheduler:

```bash
# Create cron job for 1st of each month at 2am EST
openclaw cron add \
  --name "Easy Exit Monthly Scrape All Towns" \
  --schedule "cron:0 7 1 * * (UTC)" \
  --payload '{"kind":"agentTurn","message":"Run monthly scrape job for all towns: brunswick, bath, portland, topsham"}' \
  --delivery '{"mode":"announce","channel":"","to":""}'
```

### Option 2: Node.js Cron Package

Add to package.json:
```bash
npm install node-cron
```

Create `scripts/monthly-scrape.js`:
```javascript
const cron = require('node-cron');

// Run 1st of each month at 2am
cron.schedule('0 2 1 * *', async () => {
  console.log('Running monthly scrape job...');
  
  const towns = ['brunswick', 'bath', 'portland', 'topsham'];
  
  for (const town of towns) {
    try {
      const response = await fetch('http://localhost:3000/api/scrape-and-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ town }),
      });
      
      if (response.ok) {
        console.log(`✓ ${town} scrape complete`);
      }
    } catch (error) {
      console.error(`✗ ${town} scrape failed:`, error);
    }
  }
  
  console.log('Monthly scrape job finished');
});
```

### Option 3: System Cron

Edit crontab:
```bash
crontab -e
```

Add line:
```cron
# 1st of each month at 2am EST
0 7 1 * * /usr/bin/curl -X POST http://localhost:3000/api/scrape-monthly-all-towns
```

## Configuration

### Towns to Scrape

Update `scrapers/config.json`:
```json
{
  "towns": {
    "brunswick": {
      "enabled": true,
      "scraper_type": "gis_vgsi",
      "probate_enabled": true,
      "obituary_enabled": true,
      "violations_enabled": true
    },
    "bath": {
      "enabled": true,
      "scraper_type": "gis_vgsi",
      "probate_enabled": true,
      "obituary_enabled": true,
      "violations_enabled": true
    },
    "portland": {
      "enabled": false,
      "note": "Ready to enable once scraper built"
    }
  },
  "monthly_job": {
    "enabled": true,
    "day_of_month": 1,
    "hour_utc": 7,
    "timeout_minutes": 120,
    "auto_import_viable": true,
    "viable_threshold": 60
  },
  "archival": {
    "enabled": true,
    "archive_after_days": 60,
    "archive_threshold_score": 60
  }
}
```

## API Endpoint

For manual monthly scrape:

```bash
curl -X POST http://localhost:3000/api/scrape-monthly-all-towns \
  -H "Content-Type: application/json" \
  -d '{
    "towns": ["brunswick", "bath", "portland"],
    "auto_import": true,
    "viable_threshold": 60
  }'
```

Response:
```json
{
  "success": true,
  "job_id": "scrape-2026-02-01-001",
  "towns_scraped": {
    "brunswick": {
      "total": 1050,
      "viable": 87,
      "imported": 87
    },
    "bath": {
      "total": 320,
      "viable": 14,
      "imported": 14
    }
  },
  "total_viable_imported": 101,
  "duration_seconds": 2847
}
```

## Monitoring

View scrape job status in Supabase:

```sql
SELECT * FROM scrape_jobs 
ORDER BY created_at DESC 
LIMIT 10;
```

Check lead imports:

```sql
SELECT source_town, COUNT(*) as count 
FROM lead_sources 
WHERE scraped_at >= DATE_TRUNC('month', NOW())
GROUP BY source_town;
```

## Troubleshooting

### Job Fails to Run

1. Check cron logs: `cat /var/log/cron.log`
2. Verify Python scrapers are working: `python3 scrapers/run_scraper.py brunswick`
3. Check Supabase connectivity: `nc -zv supabase-url:5432`

### Enrichment Takes Too Long

Current timeout: 120 minutes per month for all towns

Options:
1. Run towns in parallel (currently serial)
2. Reduce enrichment scope (disable obituaries, etc.)
3. Increase timeout: `"timeout_minutes": 180`

### Low Viable Rate

If viable leads < 10% of total properties:

1. Check viability scoring: review `viability_scorer.py` thresholds
2. Check enrichment data quality: ensure probate/obituary sources are working
3. Adjust viable threshold: `"viable_threshold": 50` (instead of 60)

## Next Steps

1. ✅ Build Brunswick scraper (100% real, no mock data)
2. ✅ Integrate probate + obituary + code violations
3. ✅ Test monthly job on Brunswick
4. Clone Brunswick to Bath, Portland, Topsham
5. Enable monthly cron job for all towns

## Data Retention

- Scraped properties: Keep indefinitely (track historical changes)
- Leads score < 60: Archive after 60 days
- Leads score >= 60: Keep in active leads until marked as deal/no-deal
