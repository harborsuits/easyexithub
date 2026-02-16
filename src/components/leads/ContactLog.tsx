import { useState } from 'react';
import { ContactEntry } from '@/types';
import { formatDate } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Phone, Mail, MessageSquare, Send, Home, MoreHorizontal } from 'lucide-react';

const CHANNEL_CONFIG = {
  call: { icon: Phone, label: 'Call', color: 'bg-blue-500' },
  text: { icon: MessageSquare, label: 'Text', color: 'bg-green-500' },
  email: { icon: Mail, label: 'Email', color: 'bg-purple-500' },
  mail: { icon: Send, label: 'Mail', color: 'bg-orange-500' },
  'door-knock': { icon: Home, label: 'Door Knock', color: 'bg-red-500' },
  other: { icon: MoreHorizontal, label: 'Other', color: 'bg-gray-500' },
};

interface ContactLogProps {
  contacts: ContactEntry[];
  onAddContact: (contact: Omit<ContactEntry, 'id'>) => void;
}

export function ContactLog({ contacts, onAddContact }: ContactLogProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({
    channel: '' as ContactEntry['channel'] | '',
    summary: '',
    response: '',
    followUpDate: '',
  });

  const handleAddContact = () => {
    if (newContact.channel && newContact.summary) {
      onAddContact({
        date: new Date().toISOString(),
        channel: newContact.channel as ContactEntry['channel'],
        summary: newContact.summary,
        response: newContact.response,
        followUpDate: newContact.followUpDate || undefined,
      });
      setNewContact({ channel: '', summary: '', response: '', followUpDate: '' });
      setShowAddForm(false);
    }
  };

  const sortedContacts = [...contacts].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            Contact Log
          </CardTitle>
          <Badge variant="secondary">{contacts.length} entries</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAddForm ? (
          <div className="space-y-3 p-3 border rounded-md bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Channel</Label>
                <Select
                  value={newContact.channel}
                  onValueChange={(v) => setNewContact({ ...newContact, channel: v as ContactEntry['channel'] })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select channel..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHANNEL_CONFIG).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <config.icon className="h-3 w-3" />
                          {config.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Follow-up Date</Label>
                <Input
                  type="date"
                  value={newContact.followUpDate}
                  onChange={(e) => setNewContact({ ...newContact, followUpDate: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Summary</Label>
              <Textarea
                value={newContact.summary}
                onChange={(e) => setNewContact({ ...newContact, summary: e.target.value })}
                placeholder="What happened during this contact?"
                className="text-sm min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs">Response</Label>
              <Textarea
                value={newContact.response}
                onChange={(e) => setNewContact({ ...newContact, response: e.target.value })}
                placeholder="How did they respond?"
                className="text-sm min-h-[60px]"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddContact}>
                Add Entry
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Log Contact
          </Button>
        )}

        {sortedContacts.length > 0 && (
          <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin">
            {sortedContacts.map((contact) => {
              const config = CHANNEL_CONFIG[contact.channel];
              const Icon = config.icon;
              return (
                <div
                  key={contact.id}
                  className="p-3 border rounded-md bg-card space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-1 rounded ${config.color}`}>
                        <Icon className="h-3 w-3 text-white" />
                      </div>
                      <span className="text-sm font-medium">{config.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(contact.date)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{contact.summary}</p>
                  {contact.response && (
                    <p className="text-sm text-muted-foreground border-l-2 border-accent pl-2">
                      {contact.response}
                    </p>
                  )}
                  {contact.followUpDate && (
                    <Badge variant="outline" className="text-xs">
                      Follow up: {formatDate(contact.followUpDate)}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
