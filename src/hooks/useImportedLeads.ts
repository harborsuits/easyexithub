import { useState, useEffect } from 'react';
import { fetchProcessedLeads, ProcessedLead } from '@/services/csvImporter';

export function useImportedLeads() {
  const [leads, setLeads] = useState<ProcessedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProcessedLeads();
      setLeads(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Auto-refresh every 60 seconds
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, []);

  return { leads, loading, error, refresh };
}
