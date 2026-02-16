import { useState } from 'react';
import { RepairItem } from '@/types';
import { formatCurrency } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Wrench } from 'lucide-react';

const REPAIR_CATEGORIES = [
  'Roof',
  'HVAC',
  'Plumbing',
  'Electrical',
  'Foundation',
  'Kitchen',
  'Bathroom',
  'Flooring',
  'Paint',
  'Windows',
  'Siding',
  'Landscaping',
  'Misc',
];

interface RepairEstimatorProps {
  repairItems: RepairItem[];
  totalRepairs: number;
  onAddItem: (item: Omit<RepairItem, 'id'>) => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, updates: Partial<RepairItem>) => void;
}

export function RepairEstimator({
  repairItems,
  totalRepairs,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
}: RepairEstimatorProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ category: '', description: '', cost: '' });

  const handleAddItem = () => {
    if (newItem.category && newItem.description && newItem.cost) {
      onAddItem({
        category: newItem.category,
        description: newItem.description,
        cost: parseFloat(newItem.cost),
      });
      setNewItem({ category: '', description: '', cost: '' });
      setShowAddForm(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-4 w-4 text-warning" />
            Repair Estimator
          </CardTitle>
          <div className="text-lg font-bold text-foreground">
            {formatCurrency(totalRepairs)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {repairItems.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs text-right">Cost</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repairItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm font-medium">{item.category}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.description}</TableCell>
                    <TableCell className="text-sm text-right">
                      <Input
                        type="number"
                        value={item.cost}
                        onChange={(e) => onUpdateItem(item.id, { cost: parseFloat(e.target.value) || 0 })}
                        className="h-7 w-24 text-right text-sm ml-auto"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => onRemoveItem(item.id)}
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
                <Label className="text-xs">Category</Label>
                <Select value={newItem.category} onValueChange={(v) => setNewItem({ ...newItem, category: v })}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {REPAIR_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  placeholder="Brief description"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Cost</Label>
                <Input
                  type="number"
                  value={newItem.cost}
                  onChange={(e) => setNewItem({ ...newItem, cost: e.target.value })}
                  placeholder="5000"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddItem}>
                Add Item
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Repair Item
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
