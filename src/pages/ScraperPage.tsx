import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';

export function ScraperPage() {
  const [area, setArea] = useState('brunswick');
  const [scraperType, setScraperType] = useState('properties');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleScrape = async () => {
    if (!area.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter an area to scrape',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          area,
          type: scraperType,
        }),
      });

      if (!response.ok) throw new Error('Scraping failed');

      const data = await response.json();

      toast({
        title: 'Success',
        description: `Scraped ${data.count} ${scraperType} from ${area}`,
      });

      // Redirect to leads page to show imported data
      setTimeout(() => navigate('/leads'), 1000);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Scraping failed',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Lead Scraper</h1>
          <p className="text-muted-foreground">
            Scrape properties and leads from local GIS and tax deed records
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>New Scrape</CardTitle>
            <CardDescription>
              Configure area and scraper type
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Area / Municipality</label>
              <Input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g., brunswick, bath, portland"
                className="mt-2"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Scraper Type</label>
              <select
                value={scraperType}
                onChange={(e) => setScraperType(e.target.value)}
                className="w-full mt-2 px-3 py-2 border rounded-md"
              >
                <option value="properties">Properties (GIS + Tax Deeds)</option>
                <option value="tax-delinquent">Tax Delinquent Properties</option>
                <option value="foreclosures">Foreclosure Records</option>
              </select>
            </div>

            <Button
              onClick={handleScrape}
              disabled={isLoading || !area.trim()}
              className="w-full"
            >
              {isLoading ? 'Scraping...' : `Scrape ${area}`}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Available Scrapers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <h3 className="font-medium">Properties (GIS + Tax Deeds)</h3>
              <p className="text-sm text-muted-foreground">
                Scrapes municipal GIS maps and tax deed registries for property details
              </p>
            </div>
            <div>
              <h3 className="font-medium">Tax Delinquent Properties</h3>
              <p className="text-sm text-muted-foreground">
                Identifies properties with unpaid taxes (high motivation indicator)
              </p>
            </div>
            <div>
              <h3 className="font-medium">Foreclosure Records</h3>
              <p className="text-sm text-muted-foreground">
                Finds active foreclosure listings and lis pendens notices
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
