import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API Routes
app.post('/api/scrape', async (req, res) => {
  const { area, type } = req.body;

  if (!area) {
    return res.status(400).json({ error: 'Area is required' });
  }

  try {
    // Mock implementation - returns sample data
    // In production, this would call actual scrapers
    const mockLeads = generateMockLeads(area, type);
    
    res.json({
      success: true,
      count: mockLeads.length,
      area,
      type,
      leads: mockLeads,
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Scraping failed' 
    });
  }
});

function generateMockLeads(area, type) {
  const baseLeads = [
    {
      id: `${area}-001`,
      address: '123 Main St',
      city: area,
      state: 'ME',
      zip: '04011',
      owner_name: 'John Smith',
      owner_phone: '+12075551234',
      assessed_value: 150000,
      notes: type === 'tax-delinquent' ? 'Tax delinquent 2+ years' : 'GIS/Tax deed record',
      deal_stage_id: 1,
    },
    {
      id: `${area}-002`,
      address: '456 Oak Ave',
      city: area,
      state: 'ME',
      zip: '04011',
      owner_name: 'Jane Doe',
      owner_phone: '+12075555678',
      assessed_value: 200000,
      notes: type === 'foreclosures' ? 'Lis pendens filed' : 'Municipal GIS record',
      deal_stage_id: 1,
    },
  ];
  return baseLeads;
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
