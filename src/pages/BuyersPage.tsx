import { useEffect, useState, useMemo } from 'react';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Buyer, BuyerTier, MarketFilter } from '@/types/buyer';
import { BuyerCard } from '@/components/buyers/BuyerCard';
import { BuyerFilters } from '@/components/buyers/BuyerFilters';
import { Users, MapPin, TrendingUp } from 'lucide-react';

export function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTier, setSelectedTier] = useState<BuyerTier>('all');
  const [selectedMarket, setSelectedMarket] = useState<MarketFilter>('all');
  const [showOnlyWithContact, setShowOnlyWithContact] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState<Buyer | null>(null);

  // Fetch buyers from Supabase
  useEffect(() => {
    const fetchBuyers = async () => {
      try {
        console.log('Fetching buyers from Supabase...');
        const { data, error } = await supabase
          .from('buyers')
          .select('*')
          .order('company_name', { ascending: true });
        
        if (error) {
          console.error('Error fetching buyers:', error);
        } else {
          console.log(`Fetched buyers: [${data?.length} items]`);
          if (data) {
            setBuyers(data as Buyer[]);
          }
        }
      } catch (err) {
        console.error('Exception fetching buyers:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBuyers();
  }, []);

  // Filter and search logic
  const filteredBuyers = useMemo(() => {
    return buyers.filter((buyer) => {
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        buyer.company_name?.toLowerCase().includes(searchLower) ||
        buyer.contact_name?.toLowerCase().includes(searchLower) ||
        buyer.contact_email?.toLowerCase().includes(searchLower) ||
        buyer.contact_phone?.toLowerCase().includes(searchLower);

      if (!matchesSearch) return false;

      // Contact filter
      if (showOnlyWithContact && !buyer.contact_email && !buyer.contact_phone) {
        return false;
      }

      // Tier filter (based on notes or reliability score)
      if (selectedTier !== 'all') {
        const notes = buyer.notes?.toLowerCase() || '';
        const isTier1 = notes.includes('tier 1') || notes.includes('hot');
        const isTier2 = notes.includes('tier 2') || notes.includes('warm');
        const isTier3 = notes.includes('tier 3') || notes.includes('active');

        if (selectedTier === 'tier1' && !isTier1) return false;
        if (selectedTier === 'tier2' && !isTier2) return false;
        if (selectedTier === 'tier3' && !isTier3) return false;
      }

      // Market filter
      if (selectedMarket !== 'all') {
        const markets = buyer.target_markets?.toLowerCase() || '';
        if (selectedMarket === 'birmingham' && !markets.includes('birmingham')) return false;
        if (selectedMarket === 'kc' && !markets.includes('kansas')) return false;
        if (selectedMarket === 'multi' && markets.includes('birmingham') && markets.includes('kansas')) return false;
      }

      return true;
    });
  }, [buyers, searchQuery, selectedTier, selectedMarket, showOnlyWithContact]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = buyers.length;
    const withContact = buyers.filter((b) => b.contact_email || b.contact_phone).length;
    
    const birminghamCount = buyers.filter((b) =>
      b.target_markets?.toLowerCase().includes('birmingham')
    ).length;
    const kcCount = buyers.filter((b) =>
      b.target_markets?.toLowerCase().includes('kansas')
    ).length;
    const multiCount = total - birminghamCount - kcCount;

    const tier1Count = buyers.filter((b) =>
      b.notes?.toLowerCase().includes('tier 1') || b.notes?.toLowerCase().includes('hot')
    ).length;
    const tier2Count = buyers.filter((b) =>
      b.notes?.toLowerCase().includes('tier 2') || b.notes?.toLowerCase().includes('warm')
    ).length;
    const tier3Count = buyers.filter((b) =>
      b.notes?.toLowerCase().includes('tier 3') || b.notes?.toLowerCase().includes('active')
    ).length;

    return {
      total,
      withContact,
      birminghamCount,
      kcCount,
      multiCount,
      tier1Count,
      tier2Count,
      tier3Count,
    };
  }, [buyers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-gray-600">Loading buyers...</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Buyers Database</h1>
        <p className="text-gray-600 mt-2">Manage and filter your buyer network</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Buyers</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</p>
            </div>
            <Users className="h-10 w-10 text-blue-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">{stats.withContact} with contact info</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Birmingham Market</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.birminghamCount}</p>
            </div>
            <MapPin className="h-10 w-10 text-green-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">{((stats.birminghamCount / stats.total) * 100).toFixed(0)}% of total</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Kansas City Market</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.kcCount}</p>
            </div>
            <MapPin className="h-10 w-10 text-orange-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">{((stats.kcCount / stats.total) * 100).toFixed(0)}% of total</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Multi-Market Buyers</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.multiCount}</p>
            </div>
            <TrendingUp className="h-10 w-10 text-purple-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">{((stats.multiCount / stats.total) * 100).toFixed(0)}% of total</p>
        </div>
      </div>

      {/* Tier Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg border border-red-200 p-4">
          <h3 className="font-semibold text-red-900">Tier 1 (HOT)</h3>
          <p className="text-2xl font-bold text-red-900 mt-2">{stats.tier1Count}</p>
          <p className="text-xs text-red-700 mt-1">Ready to buy immediately</p>
        </div>

        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg border border-yellow-200 p-4">
          <h3 className="font-semibold text-yellow-900">Tier 2 (WARM)</h3>
          <p className="text-2xl font-bold text-yellow-900 mt-2">{stats.tier2Count}</p>
          <p className="text-xs text-yellow-700 mt-1">Actively looking</p>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 p-4">
          <h3 className="font-semibold text-blue-900">Tier 3 (ACTIVE)</h3>
          <p className="text-2xl font-bold text-blue-900 mt-2">{stats.tier3Count}</p>
          <p className="text-xs text-blue-700 mt-1">Ongoing engagement</p>
        </div>
      </div>

      {/* Filters */}
      <BuyerFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedTier={selectedTier}
        onTierChange={setSelectedTier}
        selectedMarket={selectedMarket}
        onMarketChange={setSelectedMarket}
        showOnlyWithContact={showOnlyWithContact}
        onContactFilterChange={setShowOnlyWithContact}
      />

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          {filteredBuyers.length} {filteredBuyers.length === 1 ? 'Buyer' : 'Buyers'}
          {filteredBuyers.length !== stats.total && ` (filtered from ${stats.total})`}
        </h2>
      </div>

      {/* Buyers Grid */}
      {filteredBuyers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBuyers.map((buyer) => (
            <BuyerCard
              key={buyer.id}
              buyer={buyer}
              onClick={() => setSelectedBuyer(buyer)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600">No buyers match your filters</p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedTier('all');
              setSelectedMarket('all');
              setShowOnlyWithContact(false);
            }}
            className="mt-4 text-blue-600 hover:text-blue-800 font-medium text-sm"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Buyer Details Modal */}
      {selectedBuyer && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedBuyer(null)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full max-h-96 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">{selectedBuyer.company_name}</h2>
              <button
                onClick={() => setSelectedBuyer(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {selectedBuyer.contact_name && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Contact Name</label>
                  <p className="text-gray-900">{selectedBuyer.contact_name}</p>
                </div>
              )}

              {selectedBuyer.contact_email && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Email</label>
                  <a href={`mailto:${selectedBuyer.contact_email}`} className="text-blue-600 hover:underline">
                    {selectedBuyer.contact_email}
                  </a>
                </div>
              )}

              {selectedBuyer.contact_phone && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Phone</label>
                  <a href={`tel:${selectedBuyer.contact_phone}`} className="text-blue-600 hover:underline">
                    {selectedBuyer.contact_phone}
                  </a>
                </div>
              )}

              {selectedBuyer.target_markets && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Target Markets</label>
                  <p className="text-gray-900">{selectedBuyer.target_markets}</p>
                </div>
              )}

              {selectedBuyer.investment_strategy && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Investment Strategy</label>
                  <p className="text-gray-900">{selectedBuyer.investment_strategy}</p>
                </div>
              )}

              {(selectedBuyer.min_price || selectedBuyer.max_price) && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Price Range</label>
                  <p className="text-gray-900">
                    ${selectedBuyer.min_price?.toLocaleString() || '0'} - ${selectedBuyer.max_price?.toLocaleString() || 'Unlimited'}
                  </p>
                </div>
              )}

              {selectedBuyer.property_type_preference && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Property Type Preference</label>
                  <p className="text-gray-900">{selectedBuyer.property_type_preference}</p>
                </div>
              )}

              {selectedBuyer.condition_tolerance && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Condition Tolerance</label>
                  <p className="text-gray-900">{selectedBuyer.condition_tolerance}</p>
                </div>
              )}

              {selectedBuyer.notes && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Notes</label>
                  <p className="text-gray-900 whitespace-pre-wrap">{selectedBuyer.notes}</p>
                </div>
              )}

              {selectedBuyer.reliability_score && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Reliability Score</label>
                  <p className="text-gray-900 font-semibold">{selectedBuyer.reliability_score}/10</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </AppLayout>
  );
}
