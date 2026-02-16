import { useState } from 'react';
import { Buyer, PropertyPreference, ConditionPreference } from '@/types';
import { useCRM } from '@/context/CRMContext';
import { formatCurrency, formatDate } from '@/data/mockData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Users, Plus, Star, Phone, Mail, Search, Building2 } from 'lucide-react';

const PROPERTY_TYPES: { value: PropertyPreference; label: string }[] = [
  { value: 'single-family', label: 'Single Family' },
  { value: 'multi-family', label: 'Multi-Family' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'condo', label: 'Condo' },
  { value: 'land', label: 'Land' },
  { value: 'commercial', label: 'Commercial' },
];

const CONDITIONS: { value: ConditionPreference; label: string }[] = [
  { value: 'turnkey', label: 'Turnkey' },
  { value: 'light-rehab', label: 'Light Rehab' },
  { value: 'heavy-rehab', label: 'Heavy Rehab' },
  { value: 'tear-down', label: 'Tear Down' },
];

function ReliabilityStars({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-4 w-4 ${star <= score ? 'fill-warning text-warning' : 'text-muted'}`}
        />
      ))}
    </div>
  );
}

export function BuyerDatabase() {
  const { buyers, addBuyer, deleteBuyer } = useCRM();
  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newBuyer, setNewBuyer] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    markets: '',
    propertyTypes: [] as PropertyPreference[],
    priceMin: '',
    priceMax: '',
    conditions: [] as ConditionPreference[],
    reliabilityScore: 3,
    notes: '',
  });

  const filteredBuyers = buyers.filter(
    (buyer) =>
      buyer.name.toLowerCase().includes(search.toLowerCase()) ||
      buyer.company?.toLowerCase().includes(search.toLowerCase()) ||
      buyer.markets.some((m) => m.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAddBuyer = () => {
    addBuyer({
      name: newBuyer.name,
      company: newBuyer.company || undefined,
      phone: newBuyer.phone,
      email: newBuyer.email,
      markets: newBuyer.markets.split(',').map((m) => m.trim()).filter(Boolean),
      propertyTypes: newBuyer.propertyTypes,
      priceMin: parseFloat(newBuyer.priceMin) || 0,
      priceMax: parseFloat(newBuyer.priceMax) || 0,
      conditions: newBuyer.conditions,
      reliabilityScore: newBuyer.reliabilityScore,
      notes: newBuyer.notes || undefined,
    });
    setNewBuyer({
      name: '',
      company: '',
      phone: '',
      email: '',
      markets: '',
      propertyTypes: [],
      priceMin: '',
      priceMax: '',
      conditions: [],
      reliabilityScore: 3,
      notes: '',
    });
    setShowAddDialog(false);
  };

  const togglePropertyType = (type: PropertyPreference) => {
    setNewBuyer((prev) => ({
      ...prev,
      propertyTypes: prev.propertyTypes.includes(type)
        ? prev.propertyTypes.filter((t) => t !== type)
        : [...prev.propertyTypes, type],
    }));
  };

  const toggleCondition = (condition: ConditionPreference) => {
    setNewBuyer((prev) => ({
      ...prev,
      conditions: prev.conditions.includes(condition)
        ? prev.conditions.filter((c) => c !== condition)
        : [...prev.conditions, condition],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search buyers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Buyer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New Buyer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Name *</Label>
                  <Input
                    value={newBuyer.name}
                    onChange={(e) => setNewBuyer({ ...newBuyer, name: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <Label className="text-xs">Company</Label>
                  <Input
                    value={newBuyer.company}
                    onChange={(e) => setNewBuyer({ ...newBuyer, company: e.target.value })}
                    placeholder="ABC Investments"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Phone *</Label>
                  <Input
                    value={newBuyer.phone}
                    onChange={(e) => setNewBuyer({ ...newBuyer, phone: e.target.value })}
                    placeholder="(555) 555-5555"
                  />
                </div>
                <div>
                  <Label className="text-xs">Email *</Label>
                  <Input
                    value={newBuyer.email}
                    onChange={(e) => setNewBuyer({ ...newBuyer, email: e.target.value })}
                    placeholder="buyer@email.com"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Markets (comma-separated)</Label>
                <Input
                  value={newBuyer.markets}
                  onChange={(e) => setNewBuyer({ ...newBuyer, markets: e.target.value })}
                  placeholder="Dallas, Fort Worth, Arlington"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Min Price</Label>
                  <Input
                    type="number"
                    value={newBuyer.priceMin}
                    onChange={(e) => setNewBuyer({ ...newBuyer, priceMin: e.target.value })}
                    placeholder="100000"
                  />
                </div>
                <div>
                  <Label className="text-xs">Max Price</Label>
                  <Input
                    type="number"
                    value={newBuyer.priceMax}
                    onChange={(e) => setNewBuyer({ ...newBuyer, priceMax: e.target.value })}
                    placeholder="500000"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs mb-2 block">Property Types</Label>
                <div className="flex flex-wrap gap-2">
                  {PROPERTY_TYPES.map((type) => (
                    <label key={type.value} className="flex items-center gap-2">
                      <Checkbox
                        checked={newBuyer.propertyTypes.includes(type.value)}
                        onCheckedChange={() => togglePropertyType(type.value)}
                      />
                      <span className="text-sm">{type.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-2 block">Condition Preferences</Label>
                <div className="flex flex-wrap gap-2">
                  {CONDITIONS.map((cond) => (
                    <label key={cond.value} className="flex items-center gap-2">
                      <Checkbox
                        checked={newBuyer.conditions.includes(cond.value)}
                        onCheckedChange={() => toggleCondition(cond.value)}
                      />
                      <span className="text-sm">{cond.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-2 block">Reliability Score</Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setNewBuyer({ ...newBuyer, reliabilityScore: star })}
                    >
                      <Star
                        className={`h-6 w-6 cursor-pointer transition-colors ${
                          star <= newBuyer.reliabilityScore
                            ? 'fill-warning text-warning'
                            : 'text-muted hover:text-warning'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={handleAddBuyer} className="w-full" disabled={!newBuyer.name || !newBuyer.phone || !newBuyer.email}>
                Add Buyer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Markets</TableHead>
                  <TableHead>Price Range</TableHead>
                  <TableHead>Types</TableHead>
                  <TableHead>Reliability</TableHead>
                  <TableHead className="text-right">Deals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBuyers.map((buyer) => (
                  <TableRow key={buyer.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{buyer.name}</p>
                        {buyer.company && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {buyer.company}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm flex items-center gap-1">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {buyer.phone}
                        </p>
                        <p className="text-sm flex items-center gap-1">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          {buyer.email}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {buyer.markets.slice(0, 3).map((market) => (
                          <Badge key={market} variant="secondary" className="text-xs">
                            {market}
                          </Badge>
                        ))}
                        {buyer.markets.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{buyer.markets.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {formatCurrency(buyer.priceMin)} - {formatCurrency(buyer.priceMax)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {buyer.propertyTypes.slice(0, 2).map((type) => (
                          <Badge key={type} variant="outline" className="text-xs">
                            {type}
                          </Badge>
                        ))}
                        {buyer.propertyTypes.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{buyer.propertyTypes.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ReliabilityStars score={buyer.reliabilityScore} />
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-semibold">{buyer.totalDeals}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
