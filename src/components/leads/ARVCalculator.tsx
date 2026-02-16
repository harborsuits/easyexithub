import { useState } from 'react';
import { Comp } from '@/types';
import { formatCurrency, formatDate } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, TrendingUp } from 'lucide-react';

interface ARVCalculatorProps {
  comps: Comp[];
  arv: number;
  onAddComp: (comp: Omit<Comp, 'id'>) => void;
  onRemoveComp: (compId: string) => void;
  onUpdateARV: (arv: number) => void;
}

export function ARVCalculator({
  comps,
  arv,
  onAddComp,
  onRemoveComp,
  onUpdateARV,
}: ARVCalculatorProps) {
  const [newComp, setNewComp] = useState({ address: '', salePrice: '', saleDate: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAddComp = () => {
    if (newComp.address && newComp.salePrice && newComp.saleDate) {
      onAddComp({
        address: newComp.address,
        salePrice: parseFloat(newComp.salePrice),
        saleDate: newComp.saleDate,
      });
      setNewComp({ address: '', salePrice: '', saleDate: '' });
      setShowAddForm(false);
    }
  };

  const calculateAvgFromComps = () => {
    if (comps.length === 0) return;
    const avg = comps.reduce((sum, c) => sum + c.salePrice, 0) / comps.length;
    onUpdateARV(Math.round(avg));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent" />
            ARV Calculator
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={arv || ''}
              onChange={(e) => onUpdateARV(parseFloat(e.target.value) || 0)}
              className="w-32 h-8 text-right font-semibold"
              placeholder="ARV"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={calculateAvgFromComps}
              disabled={comps.length === 0}
            >
              Calc Avg
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {comps.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Address</TableHead>
                  <TableHead className="text-xs text-right">Price</TableHead>
                  <TableHead className="text-xs text-right">Date</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comps.map((comp) => (
                  <TableRow key={comp.id}>
                    <TableCell className="text-sm">{comp.address}</TableCell>
                    <TableCell className="text-sm text-right font-medium">
                      {formatCurrency(comp.salePrice)}
                    </TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">
                      {formatDate(comp.saleDate)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => onRemoveComp(comp.id)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {showAddForm ? (
          <div className="space-y-3 p-3 border rounded-md bg-muted/30">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Address</Label>
                <Input
                  value={newComp.address}
                  onChange={(e) => setNewComp({ ...newComp, address: e.target.value })}
                  placeholder="123 Main St"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Sale Price</Label>
                <Input
                  type="number"
                  value={newComp.salePrice}
                  onChange={(e) => setNewComp({ ...newComp, salePrice: e.target.value })}
                  placeholder="250000"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Sale Date</Label>
                <Input
                  type="date"
                  value={newComp.saleDate}
                  onChange={(e) => setNewComp({ ...newComp, saleDate: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddComp}>
                Add Comp
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Comparable Sale
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
