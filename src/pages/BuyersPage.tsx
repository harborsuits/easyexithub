import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

export function BuyersPage() {
  const { data: buyers, isLoading } = useQuery({
    queryKey: ['buyers'],
    queryFn: async () => {
      const { data } = await supabase.from('buyers').select('*').order('company_name');
      return data || [];
    },
  });

  const { data: interests } = useQuery({
    queryKey: ['buyer-interests'],
    queryFn: async () => {
      const { data } = await supabase.from('buyer_interests').select('*');
      return data || [];
    },
  });

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Buyers</h1>
          <p className="text-muted-foreground">{buyers?.length ?? 0} buyers in database · {interests?.length ?? 0} buyer interests</p>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Company</th>
                    <th className="text-left px-4 py-3 font-medium">Contact</th>
                    <th className="text-left px-4 py-3 font-medium">Phone</th>
                    <th className="text-left px-4 py-3 font-medium">Email</th>
                    <th className="text-left px-4 py-3 font-medium">Markets</th>
                    <th className="text-center px-4 py-3 font-medium">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                  ) : buyers?.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12">
                        <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-muted-foreground">No buyers yet</p>
                      </td>
                    </tr>
                  ) : (
                    buyers?.map((b: any) => (
                      <tr key={b.id} className="border-b hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{b.company_name || '—'}</td>
                        <td className="px-4 py-3">{b.contact_name || '—'}</td>
                        <td className="px-4 py-3">{b.contact_phone || '—'}</td>
                        <td className="px-4 py-3">{b.contact_email || '—'}</td>
                        <td className="px-4 py-3 text-xs">{b.target_markets || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={b.is_active ? 'default' : 'secondary'}>{b.is_active ? 'Yes' : 'No'}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {interests && interests.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Buyer Interests</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Buyer ID</th>
                      <th className="text-left px-4 py-3 font-medium">Property Type</th>
                      <th className="text-left px-4 py-3 font-medium">Market</th>
                      <th className="text-right px-4 py-3 font-medium">Min Price</th>
                      <th className="text-right px-4 py-3 font-medium">Max Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interests.map((i: any) => (
                      <tr key={i.id} className="border-b">
                        <td className="px-4 py-3">{i.buyer_id}</td>
                        <td className="px-4 py-3">{i.property_type || '—'}</td>
                        <td className="px-4 py-3">{i.market_id || '—'}</td>
                        <td className="px-4 py-3 text-right">{i.min_price ? `$${i.min_price.toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-3 text-right">{i.max_price ? `$${i.max_price.toLocaleString()}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
