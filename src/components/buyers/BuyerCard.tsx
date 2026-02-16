import { Buyer } from '@/types/buyer';
import { Mail, Phone, MapPin, DollarSign } from 'lucide-react';

interface BuyerCardProps {
  buyer: Buyer;
  onClick?: () => void;
}

export function BuyerCard({ buyer, onClick }: BuyerCardProps) {
  const hasContact = buyer.contact_email || buyer.contact_phone;
  
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer"
    >
      {/* Header */}
      <div className="mb-3">
        <h3 className="font-semibold text-gray-900 text-lg">{buyer.company_name}</h3>
        {buyer.contact_name && (
          <p className="text-sm text-gray-600">{buyer.contact_name}</p>
        )}
      </div>

      {/* Contact Info */}
      {hasContact && (
        <div className="space-y-1 mb-3 pb-3 border-b border-gray-100">
          {buyer.contact_email && (
            <a
              href={`mailto:${buyer.contact_email}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
            >
              <Mail className="h-4 w-4" />
              {buyer.contact_email}
            </a>
          )}
          {buyer.contact_phone && (
            <a
              href={`tel:${buyer.contact_phone}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
            >
              <Phone className="h-4 w-4" />
              {buyer.contact_phone}
            </a>
          )}
        </div>
      )}

      {/* Market & Price Info */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        {buyer.target_markets && (
          <div className="flex items-start gap-1">
            <MapPin className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">{buyer.target_markets}</span>
          </div>
        )}
        {(buyer.min_price || buyer.max_price) && (
          <div className="flex items-start gap-1">
            <DollarSign className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <span className="text-gray-700">
              {buyer.min_price ? `$${buyer.min_price.toLocaleString()}` : 'N/A'}
              {buyer.max_price ? ` - $${buyer.max_price.toLocaleString()}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Investment Strategy */}
      {buyer.investment_strategy && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-600">Strategy</p>
          <p className="text-sm text-gray-700">{buyer.investment_strategy}</p>
        </div>
      )}

      {/* Score Badge */}
      {buyer.reliability_score && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">Reliability</span>
          <span className={`text-xs font-bold px-2 py-1 rounded ${
            buyer.reliability_score >= 8 ? 'bg-green-100 text-green-800' :
            buyer.reliability_score >= 6 ? 'bg-yellow-100 text-yellow-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {buyer.reliability_score}/10
          </span>
        </div>
      )}

      {/* Active Status */}
      {buyer.is_active === false && (
        <div className="mt-2 inline-block bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded">
          Inactive
        </div>
      )}
    </div>
  );
}
