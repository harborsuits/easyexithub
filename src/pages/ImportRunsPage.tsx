import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export default function ImportRunsPage() {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['import-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_runs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const getStatus = (run: any) => {
    if (run.errors > 0 && run.rows_imported === 0) return 'failed';
    if (run.errors > 0) return 'partial';
    return 'success';
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'success') return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (status === 'partial') return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    return <XCircle className="h-4 w-4 text-red-600" />;
  };

  const totalImported = runs?.reduce((sum, r: any) => sum + (r.rows_imported || 0), 0) || 0;
  const totalSkipped = runs?.reduce((sum, r: any) => sum + (r.rows_skipped || 0), 0) || 0;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Import Runs</h1>
          <p className="text-muted-foreground">History of property data imports</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Runs</p>
              <p className="text-3xl font-bold">{runs?.length ?? '—'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Imported</p>
              <p className="text-3xl font-bold text-green-600">{totalImported.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Skipped</p>
              <p className="text-3xl font-bold text-yellow-600">{totalSkipped.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Town</th>
                    <th className="text-left px-4 py-3 font-medium">File</th>
                    <th className="text-right px-4 py-3 font-medium">Imported</th>
                    <th className="text-right px-4 py-3 font-medium">Skipped</th>
                    <th className="text-right px-4 py-3 font-medium">Errors</th>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                  ) : runs?.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No import runs found</td></tr>
                  ) : (
                    runs?.map((run: any) => {
                      const status = getStatus(run);
                      return (
                        <tr key={run.id} className="border-b hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <StatusIcon status={status} />
                              <Badge variant={status === 'success' ? 'default' : status === 'partial' ? 'secondary' : 'destructive'}>
                                {status}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium">{run.town_slug || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">{run.file_name || '—'}</td>
                          <td className="px-4 py-3 text-right text-green-600 font-medium">{run.rows_imported ?? 0}</td>
                          <td className="px-4 py-3 text-right text-yellow-600">{run.rows_skipped ?? 0}</td>
                          <td className="px-4 py-3 text-right text-red-600">{run.errors ?? 0}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {run.created_at ? new Date(run.created_at).toLocaleString() : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
