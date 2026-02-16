import { useState } from 'react';
import { Lead, PipelineStage } from '@/types';
import { useCRM } from '@/context/CRMContext';
import { AppLayout } from '@/components/common/AppLayout';
import { PipelineBoard } from '@/components/pipeline/PipelineBoard';
import { LeadDetailDialog } from '@/components/leads/LeadDetailDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PipelinePage() {
  const { addLead, setSelectedLead, selectedLead } = useCRM();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newLead, setNewLead] = useState({
    address: '',
    city: '',
    state: 'TX',
    zip: '',
    beds: '',
    baths: '',
    sqft: '',
    ownerName: '',
    ownerPhone: '',
  });

  const handleAddLead = () => {
    addLead({
      stage: 'raw',
      address: newLead.address,
      city: newLead.city,
      state: newLead.state,
      zip: newLead.zip,
      beds: parseInt(newLead.beds) || 0,
      baths: parseFloat(newLead.baths) || 0,
      sqft: parseInt(newLead.sqft) || 0,
      ownerName: newLead.ownerName,
      ownerPhone: newLead.ownerPhone || undefined,
      comps: [],
      arv: 0,
      repairItems: [],
      totalRepairs: 0,
      assignmentFee: 10000,
      mao: 0,
      contacts: [],
    });
    setNewLead({
      address: '',
      city: '',
      state: 'TX',
      zip: '',
      beds: '',
      baths: '',
      sqft: '',
      ownerName: '',
      ownerPhone: '',
    });
    setShowAddDialog(false);
  };

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead);
  };

  return (
    <AppLayout onAddLead={() => setShowAddDialog(true)}>
      <div className="h-full">
        <PipelineBoard onLeadClick={handleLeadClick} />
      </div>

      <LeadDetailDialog
        lead={selectedLead}
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
      />

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label className="text-xs">Property Address *</Label>
              <Input
                value={newLead.address}
                onChange={(e) => setNewLead({ ...newLead, address: e.target.value })}
                placeholder="123 Main Street"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">City *</Label>
                <Input
                  value={newLead.city}
                  onChange={(e) => setNewLead({ ...newLead, city: e.target.value })}
                  placeholder="Dallas"
                />
              </div>
              <div>
                <Label className="text-xs">State</Label>
                <Input
                  value={newLead.state}
                  onChange={(e) => setNewLead({ ...newLead, state: e.target.value })}
                  placeholder="TX"
                />
              </div>
              <div>
                <Label className="text-xs">ZIP</Label>
                <Input
                  value={newLead.zip}
                  onChange={(e) => setNewLead({ ...newLead, zip: e.target.value })}
                  placeholder="75201"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Beds</Label>
                <Input
                  type="number"
                  value={newLead.beds}
                  onChange={(e) => setNewLead({ ...newLead, beds: e.target.value })}
                  placeholder="3"
                />
              </div>
              <div>
                <Label className="text-xs">Baths</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={newLead.baths}
                  onChange={(e) => setNewLead({ ...newLead, baths: e.target.value })}
                  placeholder="2"
                />
              </div>
              <div>
                <Label className="text-xs">Sqft</Label>
                <Input
                  type="number"
                  value={newLead.sqft}
                  onChange={(e) => setNewLead({ ...newLead, sqft: e.target.value })}
                  placeholder="1800"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Owner Name *</Label>
                <Input
                  value={newLead.ownerName}
                  onChange={(e) => setNewLead({ ...newLead, ownerName: e.target.value })}
                  placeholder="John Smith"
                />
              </div>
              <div>
                <Label className="text-xs">Owner Phone</Label>
                <Input
                  value={newLead.ownerPhone}
                  onChange={(e) => setNewLead({ ...newLead, ownerPhone: e.target.value })}
                  placeholder="(555) 555-5555"
                />
              </div>
            </div>
            <Button 
              onClick={handleAddLead} 
              className="w-full"
              disabled={!newLead.address || !newLead.city || !newLead.ownerName}
            >
              Add Lead
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
