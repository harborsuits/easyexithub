import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { AppLayout } from '@/components/common/AppLayout';
import { AlertCircle, CheckCircle, TrendingUp, MapPin, User, DollarSign } from 'lucide-react';

interface ScrapedProperty {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  owner_name: string;
  assessed_value: number;
  viability_score?: number;
  is_viable?: boolean;
  indicators?: string[];
  score_breakdown?: string;
}

interface PreviewState {
  properties: ScrapedProperty[];
  viableCount: number;
  town: string;
  status: 'loading' | 'ready' | 'importing' | 'complete';
}

export function ScraperPreviewPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [preview, setPreview] = useState<PreviewState>({
    properties: [],
    viableCount: 0,
    town: '',
    status: 'loading',
  });
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'score' | 'address'>('score');

  useEffect(() => {
    // Get preview data from session storage (passed from scraper page)
    const storedData = sessionStorage.getItem('scraperPreview');
    if (storedData) {
      const data = JSON.parse(storedData);
      const viableProps = data.properties.filter((p: ScrapedProperty) => p.is_viable);
      setPreview({
        properties: data.properties,
        viableCount: viableProps.length,
        town: data.town,
        status: 'ready',
      });
      // Clear session storage
      sessionStorage.removeItem('scraperPreview');
    } else {
      navigate('/scraper');
    }
  }, [navigate]);

  const handleSelectAll = () => {
    if (selectedProperties.size === viableProperties.length) {
      setSelectedProperties(new Set());
    } else {
      setSelectedProperties(new Set(viableProperties.map(p => p.id)));
    }
  };

  const handleSelectProperty = (id: string) => {
    const newSelected = new Set(selectedProperties);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedProperties(newSelected);
  };

  const handleImport = async () => {
    if (selectedProperties.size === 0) {
      toast({
        title: 'No properties selected',
        description: 'Please select at least one property to import',
        variant: 'destructive',
      });
      return;
    }

    setPreview(prev => ({ ...prev, status: 'importing' }));

    try {
      const propertiesToImport = preview.properties.filter(p => selectedProperties.has(p.id));

      const response = await fetch('/api/import-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: propertiesToImport,
          town: preview.town,
          source: 'scraper',
        }),
      });

      if (!response.ok) throw new Error('Import failed');

      const result = await response.json();

      toast({
        title: 'Success!',
        description: `Imported ${result.count} leads to ${preview.town}`,
      });

      setPreview(prev => ({ ...prev, status: 'complete' }));

      // Redirect to leads page after 2 seconds
      setTimeout(() => {
        navigate('/leads');
      }, 2000);
    } catch (error) {
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setPreview(prev => ({ ...prev, status: 'ready' }));
    }
  };

  const viableProperties = preview.properties.filter(p => p.is_viable);
  const sortedProperties = [...viableProperties].sort((a, b) => {
    if (sortBy === 'score') {
      return (b.viability_score || 0) - (a.viability_score || 0);
    }
    return a.address.localeCompare(b.address);
  });

  if (preview.status === 'complete') {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-screen space-y-6">
          <CheckCircle className="h-16 w-16 text-green-500" />
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">Import Complete!</h1>
            <p className="text-muted-foreground">
              {selectedProperties.size} leads have been imported to {preview.town}
            </p>
          </div>
          <Button onClick={() => navigate('/leads')}>View Imported Leads</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Scraper Preview - {preview.town}</h1>
          <p className="text-muted-foreground">
            Review and import viable leads before adding to database
          </p>
        </div>

        {/* Summary Card */}
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Scraping Results
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-4 gap-4">
            <div>
              <p className="text-2xl font-bold">{preview.properties.length}</p>
              <p className="text-sm text-muted-foreground">Total Properties</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{preview.viableCount}</p>
              <p className="text-sm text-muted-foreground">Viable Leads (≥60 score)</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{selectedProperties.size}</p>
              <p className="text-sm text-muted-foreground">Selected for Import</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {preview.properties.length > 0
                  ? Math.round((preview.viableCount / preview.properties.length) * 100)
                  : 0}
                %
              </p>
              <p className="text-sm text-muted-foreground">Viable Rate</p>
            </div>
          </CardContent>
        </Card>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSelectAll}
            >
              {selectedProperties.size === viableProperties.length ? 'Deselect All' : 'Select All'}
            </Button>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'score' | 'address')}
              className="px-3 py-2 border rounded-md"
            >
              <option value="score">Sort by Score (High to Low)</option>
              <option value="address">Sort by Address</option>
            </select>
          </div>
          <Button
            onClick={handleImport}
            disabled={selectedProperties.size === 0 || preview.status === 'importing'}
            className="bg-green-600 hover:bg-green-700"
          >
            {preview.status === 'importing' ? 'Importing...' : `Import ${selectedProperties.size} Leads`}
          </Button>
        </div>

        {/* Properties List */}
        <div className="space-y-3">
          {sortedProperties.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No viable leads found in this scrape.</p>
                  <p className="text-sm">Increase score threshold or try different scraper type.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            sortedProperties.map((property) => (
              <Card
                key={property.id}
                className={`cursor-pointer transition-all ${
                  selectedProperties.has(property.id)
                    ? 'ring-2 ring-green-500 bg-green-50'
                    : 'hover:bg-slate-50'
                }`}
                onClick={() => handleSelectProperty(property.id)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-3">
                      {/* Address & Location */}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <h3 className="font-semibold">{property.address}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {property.city}, {property.state} {property.zip}
                        </p>
                      </div>

                      {/* Owner & Value */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{property.owner_name || 'Unknown Owner'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">
                            ${property.assessed_value?.toLocaleString() || 'N/A'}
                          </span>
                        </div>
                      </div>

                      {/* Indicators & Score */}
                      {property.indicators && property.indicators.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">
                            Distress Indicators:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {property.indicators.map((indicator) => (
                              <Badge key={indicator} variant="secondary" className="text-xs">
                                {indicator.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {property.score_breakdown && (
                        <p className="text-xs text-muted-foreground italic">
                          {property.score_breakdown}
                        </p>
                      )}
                    </div>

                    {/* Score */}
                    <div className="text-right ml-4">
                      <div className="text-right">
                        <div className="text-3xl font-bold text-green-600">
                          {property.viability_score || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">Viability</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedProperties.has(property.id)}
                        className="mt-3"
                        onChange={() => {}} // Handled by card click
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
