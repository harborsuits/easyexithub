import { Lead, PIPELINE_STAGES } from '@/types';
import { useCRM } from '@/context/CRMContext';
import { formatCurrency, calculateMAO } from '@/data/mockData';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ARVCalculator } from './ARVCalculator';
import { RepairEstimator } from './RepairEstimator';
import { ContactLog } from './ContactLog';
import { 
  Home, 
  User, 
  Calculator, 
  Phone, 
  DollarSign,
  Bed,
  Bath,
  Square,
  Calendar,
  MapPin,
} from 'lucide-react';

interface LeadDetailDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetailDialog({ lead, open, onOpenChange }: LeadDetailDialogProps) {
  const { updateLead, addContact, addComp, removeComp, addRepairItem, removeRepairItem, updateRepairItem, updateLeadStage } = useCRM();

  if (!lead) return null;

  const stageConfig = PIPELINE_STAGES.find((s) => s.id === lead.stage);
  
  const mao = calculateMAO(lead.arv, lead.totalRepairs, lead.assignmentFee);

  const handleUpdateField = (field: keyof Lead, value: any) => {
    updateLead(lead.id, { [field]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Home className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-xl">{lead.address}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {lead.city}, {lead.state} {lead.zip}
              </p>
            </div>
            <Select value={lead.stage} onValueChange={(v) => updateLeadStage(lead.id, v as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        <Tabs defaultValue="property" className="mt-4">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="property" className="flex items-center gap-1">
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Property</span>
            </TabsTrigger>
            <TabsTrigger value="analysis" className="flex items-center gap-1">
              <Calculator className="h-4 w-4" />
              <span className="hidden sm:inline">Analysis</span>
            </TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-1">
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">Contacts</span>
            </TabsTrigger>
            <TabsTrigger value="offer" className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Offer</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="property" className="mt-4 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              {/* Property Details */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Home className="h-4 w-4 text-primary" />
                    Property Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                      <Bed className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Beds</p>
                        <p className="font-semibold">{lead.beds}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                      <Bath className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Baths</p>
                        <p className="font-semibold">{lead.baths}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                      <Square className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Sqft</p>
                        <p className="font-semibold">{lead.sqft.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Year Built</Label>
                      <Input
                        type="number"
                        value={lead.yearBuilt || ''}
                        onChange={(e) => handleUpdateField('yearBuilt', parseInt(e.target.value) || undefined)}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Assessed Value</Label>
                      <Input
                        type="number"
                        value={lead.assessedValue || ''}
                        onChange={(e) => handleUpdateField('assessedValue', parseInt(e.target.value) || undefined)}
                        className="h-8"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Owner Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    Owner Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Owner Name</Label>
                    <Input
                      value={lead.ownerName}
                      onChange={(e) => handleUpdateField('ownerName', e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Phone</Label>
                    <Input
                      value={lead.ownerPhone || ''}
                      onChange={(e) => handleUpdateField('ownerPhone', e.target.value)}
                      className="h-8"
                      placeholder="(555) 555-5555"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Email</Label>
                    <Input
                      value={lead.ownerEmail || ''}
                      onChange={(e) => handleUpdateField('ownerEmail', e.target.value)}
                      className="h-8"
                      placeholder="owner@email.com"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Mailing Address</Label>
                    <Input
                      value={lead.ownerAddress || ''}
                      onChange={(e) => handleUpdateField('ownerAddress', e.target.value)}
                      className="h-8"
                      placeholder="123 Main St, City, ST 12345"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="analysis" className="mt-4 space-y-4">
            <ARVCalculator
              comps={lead.comps}
              arv={lead.arv}
              onAddComp={(comp) => addComp(lead.id, comp)}
              onRemoveComp={(compId) => removeComp(lead.id, compId)}
              onUpdateARV={(arv) => handleUpdateField('arv', arv)}
            />

            <RepairEstimator
              repairItems={lead.repairItems}
              totalRepairs={lead.totalRepairs}
              onAddItem={(item) => addRepairItem(lead.id, item)}
              onRemoveItem={(itemId) => removeRepairItem(lead.id, itemId)}
              onUpdateItem={(itemId, updates) => updateRepairItem(lead.id, itemId, updates)}
            />

            {/* MAO Summary */}
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Maximum Allowable Offer</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      ARV × 70% − Repairs − Assignment Fee
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-primary">{formatCurrency(mao)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(lead.arv)} × 0.70 − {formatCurrency(lead.totalRepairs)} − {formatCurrency(lead.assignmentFee)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contacts" className="mt-4">
            <ContactLog
              contacts={lead.contacts}
              onAddContact={(contact) => addContact(lead.id, contact)}
            />
          </TabsContent>

          <TabsContent value="offer" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-accent" />
                  Offer Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Assignment Fee</Label>
                    <Input
                      type="number"
                      value={lead.assignmentFee}
                      onChange={(e) => handleUpdateField('assignmentFee', parseFloat(e.target.value) || 0)}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Offer Amount</Label>
                    <Input
                      type="number"
                      value={lead.offerAmount || ''}
                      onChange={(e) => handleUpdateField('offerAmount', parseFloat(e.target.value) || undefined)}
                      className="h-9"
                      placeholder="Enter offer..."
                    />
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">ARV</p>
                    <p className="text-lg font-semibold">{formatCurrency(lead.arv)}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">Repairs</p>
                    <p className="text-lg font-semibold text-warning">{formatCurrency(lead.totalRepairs)}</p>
                  </div>
                  <div className="p-3 bg-accent/10 rounded-lg">
                    <p className="text-xs text-muted-foreground">MAO</p>
                    <p className="text-lg font-semibold text-accent">{formatCurrency(mao)}</p>
                  </div>
                </div>

                {lead.offerAmount && (
                  <div className={`p-4 rounded-lg ${lead.offerAmount <= mao ? 'bg-success/10' : 'bg-destructive/10'}`}>
                    <p className="text-sm">
                      {lead.offerAmount <= mao ? (
                        <>✓ Offer is <strong>{formatCurrency(mao - lead.offerAmount)}</strong> under MAO</>
                      ) : (
                        <>⚠ Offer is <strong>{formatCurrency(lead.offerAmount - mao)}</strong> over MAO</>
                      )}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
