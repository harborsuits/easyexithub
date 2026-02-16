import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API Routes
app.post('/api/scrape', async (req, res) => {
  const { area, type = 'properties' } = req.body;

  if (!area) {
    return res.status(400).json({ error: 'Area is required' });
  }

  try {
    const result = await runPythonScraper(area, type);
    
    if (result.success) {
      res.json({
        success: true,
        count: result.properties?.length || 0,
        area: result.area,
        type: result.type,
        properties: result.properties || [],
        metadata: result.metadata || {},
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Scraping failed',
        area,
        type,
      });
    }
  } catch (error) {
    console.error('Scraper error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Scraping failed' 
    });
  }
});

// Enrich and score leads
app.post('/api/enrich-and-score', async (req, res) => {
  const { properties, town } = req.body;

  if (!properties || !Array.isArray(properties)) {
    return res.status(400).json({ error: 'Properties array is required' });
  }

  try {
    const result = await runEnrichmentPipeline(properties, town || 'unknown');
    
    res.json({
      success: result.success,
      scored_properties: result.scored_properties || [],
      viable_leads: result.viable_leads || [],
      summary: result.summary || {},
      error: result.error || null,
    });
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Enrichment failed',
      scored_properties: [],
      summary: {},
    });
  }
});

// Import leads to Supabase
app.post('/api/import-leads', async (req, res) => {
  const { properties, town, source } = req.body;

  if (!properties || !Array.isArray(properties) || properties.length === 0) {
    return res.status(400).json({ error: 'Properties array is required' });
  }

  try {
    // TODO: Import to Supabase leads table
    // For now, return success
    res.json({
      success: true,
      count: properties.length,
      message: `Imported ${properties.length} leads from ${town}`,
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Import failed' 
    });
  }
});

function runPythonScraper(area, type) {
  return new Promise((resolve, reject) => {
    const pythonScript = join(__dirname, 'scrapers', 'run_scraper.py');
    const python = spawn('python3', [pythonScript, area, type], {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.warn('Python stderr:', data.toString());
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('Python exited with code:', code);
        reject(new Error(`Python scraper failed: ${errorOutput}`));
        return;
      }

      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        console.error('Failed to parse Python output:', output);
        reject(new Error('Failed to parse scraper output'));
      }
    });

    python.on('error', (err) => {
      console.error('Python process error:', err);
      reject(err);
    });
  });
}

function runEnrichmentPipeline(properties, town) {
  return new Promise((resolve, reject) => {
    const pythonScript = join(__dirname, 'scrapers', 'enrich_and_score.py');
    const python = spawn('python3', [pythonScript], {
      timeout: 300000, // 5 minute timeout for enrichment
      maxBuffer: 20 * 1024 * 1024, // 20MB buffer
    });

    const inputData = JSON.stringify({ properties, town });
    python.stdin.write(inputData);
    python.stdin.end();

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.warn('Python stderr:', data.toString());
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('Python exited with code:', code);
        reject(new Error(`Enrichment failed: ${errorOutput}`));
        return;
      }

      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        console.error('Failed to parse enrichment output:', output);
        reject(new Error('Failed to parse enrichment output'));
      }
    });

    python.on('error', (err) => {
      console.error('Python process error:', err);
      reject(err);
    });
  });
}

// Serve static files from dist AFTER api routes
app.use(express.static(join(__dirname, 'dist')));

// Handle SPA routing - fallback to index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API: /api/scrape`);
  console.log(`Serving from: ${join(__dirname, 'dist')}`);
});
