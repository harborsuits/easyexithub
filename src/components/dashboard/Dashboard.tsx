import { useMemo } from 'react';
import { useCRM } from '@/context/CRMContext';
import { PIPELINE_STAGES } from '@/types';
import { formatCurrency } from '@/data/mockData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  BarChart3, 
  TrendingUp, 
  Phone, 
  MessageSquare, 
  DollarSign,
  Target,
  CheckCircle2,
  XCircle
} from 'lucide-react';

export function Dashboard() {
  const { leads } = useCRM();

  const metrics = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Pipeline summary
    const pipelineSummary = PIPELINE_STAGES.map((stage) => ({
      stage: stage.id,
      label: stage.label,
      color: stage.color,
      count: leads.filter((l) => l.stage === stage.id).length,
    }));

    // Contact metrics
    const allContacts = leads.flatMap((l) => l.contacts);
    const contactsToday = allContacts.filter(
      (c) => new Date(c.date) >= todayStart
    ).length;
    const contactsThisWeek = allContacts.filter(
      (c) => new Date(c.date) >= weekStart
    ).length;
    const responsesThisWeek = allContacts.filter(
      (c) => new Date(c.date) >= weekStart && c.response && c.response !== 'No response yet'
    ).length;

    // Offer metrics
    const offersThisMonth = leads.filter(
      (l) => 
        l.offerAmount && 
        l.offerAmount > 0 && 
        new Date(l.updatedAt) >= monthStart
    ).length;

    // Deal metrics
    const leadsWithARV = leads.filter((l) => l.arv > 0);
    const avgArv = leadsWithARV.length > 0
      ? leadsWithARV.reduce((sum, l) => sum + l.arv, 0) / leadsWithARV.length
      : 0;

    const avgAssignmentFee = leadsWithARV.length > 0
      ? leadsWithARV.reduce((sum, l) => sum + l.assignmentFee, 0) / leadsWithARV.length
      : 0;

    const closedDeals = leads.filter((l) => l.stage === 'closed');
    const closedThisMonth = closedDeals.filter(
      (l) => new Date(l.updatedAt) >= monthStart
    ).length;

    // Conversion rate (closed / total raw leads)
    const totalLeads = leads.length;
    const conversionRate = totalLeads > 0 ? (closedDeals.length / totalLeads) * 100 : 0;

    // Total pipeline value (sum of all MAOs for active deals)
    const activeStages = ['offer-made', 'negotiating', 'under-contract', 'buyer-matched', 'assigned', 'closing'];
    const totalPipelineValue = leads
      .filter((l) => activeStages.includes(l.stage))
      .reduce((sum, l) => sum + (l.offerAmount || l.mao), 0);

    return {
      pipelineSummary,
      contactsToday,
      contactsThisWeek,
      responsesThisWeek,
      offersThisMonth,
      avgArv,
      avgAssignmentFee,
      conversionRate,
      closedThisMonth,
      totalPipelineValue,
      totalLeads,
      closedDeals: closedDeals.length,
    };
  }, [leads]);

  const stageColorClass: Record<string, string> = {
    'stage-raw': 'bg-stage-raw',
    'stage-researched': 'bg-stage-researched',
    'stage-contact-ready': 'bg-stage-contact-ready',
    'stage-contacted': 'bg-stage-contacted',
    'stage-responding': 'bg-stage-responding',
    'stage-offer': 'bg-stage-offer',
    'stage-negotiating': 'bg-stage-negotiating',
    'stage-contract': 'bg-stage-contract',
    'stage-matched': 'bg-stage-matched',
    'stage-assigned': 'bg-stage-assigned',
    'stage-closing': 'bg-stage-closing',
    'stage-closed': 'bg-stage-closed',
    'stage-dead': 'bg-stage-dead',
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{metrics.totalLeads}</p>
                <p className="text-xs text-muted-foreground">Total Leads</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent/10 rounded-lg">
                <DollarSign className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(metrics.totalPipelineValue)}</p>
                <p className="text-xs text-muted-foreground">Pipeline Value</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success/10 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{metrics.closedDeals}</p>
                <p className="text-xs text-muted-foreground">Deals Closed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-warning/10 rounded-lg">
                <TrendingUp className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{metrics.conversionRate.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground">Conversion Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pipeline Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Pipeline Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {metrics.pipelineSummary.filter(s => s.count > 0).map((stage) => (
              <div key={stage.stage} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${stageColorClass[stage.color]}`} />
                <span className="text-sm flex-1">{stage.label}</span>
                <span className="text-sm font-semibold">{stage.count}</span>
                <Progress 
                  value={(stage.count / Math.max(...metrics.pipelineSummary.map(s => s.count))) * 100} 
                  className="w-20 h-2"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Activity Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              Activity Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Contacts Today</span>
                </div>
                <p className="text-2xl font-bold">{metrics.contactsToday}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Contacts (7d)</span>
                </div>
                <p className="text-2xl font-bold">{metrics.contactsThisWeek}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Responses (7d)</span>
                </div>
                <p className="text-2xl font-bold">{metrics.responsesThisWeek}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Offers (30d)</span>
                </div>
                <p className="text-2xl font-bold">{metrics.offersThisMonth}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deal Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-accent" />
            Deal Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-muted/50 rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Avg ARV</p>
              <p className="text-xl font-bold">{formatCurrency(metrics.avgArv)}</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Avg Assignment Fee</p>
              <p className="text-xl font-bold text-accent">{formatCurrency(metrics.avgAssignmentFee)}</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Closed This Month</p>
              <p className="text-xl font-bold text-success">{metrics.closedThisMonth}</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Conversion Rate</p>
              <p className="text-xl font-bold">{metrics.conversionRate.toFixed(1)}%</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
