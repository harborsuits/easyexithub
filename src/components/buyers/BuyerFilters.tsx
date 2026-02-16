import { BuyerTier, MarketFilter } from '@/types/buyer';
import { Search, X } from 'lucide-react';

interface BuyerFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedTier: BuyerTier;
  onTierChange: (tier: BuyerTier) => void;
  selectedMarket: MarketFilter;
  onMarketChange: (market: MarketFilter) => void;
  showOnlyWithContact: boolean;
  onContactFilterChange: (show: boolean) => void;
}

export function BuyerFilters({
  searchQuery,
  onSearchChange,
  selectedTier,
  onTierChange,
  selectedMarket,
  onMarketChange,
  showOnlyWithContact,
  onContactFilterChange,
}: BuyerFiltersProps) {
  const hasActiveFilters = searchQuery || selectedTier !== 'all' || selectedMarket !== 'all' || showOnlyWithContact;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name, email, phone..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Tier Filter */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Buyer Tier</label>
        <div className="flex flex-wrap gap-2">
          {(['all', 'tier1', 'tier2', 'tier3'] as BuyerTier[]).map((tier) => (
            <button
              key={tier}
              onClick={() => onTierChange(tier)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                selectedTier === tier
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tier === 'all' ? 'All Tiers' : tier.charAt(0).toUpperCase() + tier.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Market Filter */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Market</label>
        <div className="flex flex-wrap gap-2">
          {(['all', 'birmingham', 'kc', 'multi'] as MarketFilter[]).map((market) => (
            <button
              key={market}
              onClick={() => onMarketChange(market)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                selectedMarket === market
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {market === 'all' ? 'All Markets' : market.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Contact Filter */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="contact-filter"
          checked={showOnlyWithContact}
          onChange={(e) => onContactFilterChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="contact-filter" className="text-sm font-medium text-gray-700">
          Only show buyers with contact info
        </label>
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <button
          onClick={() => {
            onSearchChange('');
            onTierChange('all');
            onMarketChange('all');
            onContactFilterChange(false);
          }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm font-medium transition-colors"
        >
          <X className="h-4 w-4" />
          Clear Filters
        </button>
      )}
    </div>
  );
}
