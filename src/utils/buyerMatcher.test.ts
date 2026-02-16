/**
 * Buyer Matcher Unit Tests and Examples
 * 
 * Demonstrates the matching algorithm with real data from EasyExit
 */

import {
  getRecommendedBuyers,
  getMatchStats,
  formatMatch,
  getMatchReason,
  type Buyer,
  type Lead,
  type MatchedBuyer,
} from './buyerMatcher';

// Sample test data: Real buyers from EasyExit database
const testBuyers: Buyer[] = [
  {
    id: 3,
    company_name: 'Dee McNeal',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 1 HOT',
  },
  {
    id: 4,
    company_name: 'Wesley Sirivongxay',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 1 HOT',
  },
  {
    id: 5,
    company_name: 'TyZhea Warren',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 1 HOT',
  },
  {
    id: 6,
    company_name: 'Ex Flipper',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 1 HOT',
  },
  {
    id: 7,
    company_name: 'Daniel Johnathan',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 2 WARM',
  },
  {
    id: 8,
    company_name: 'Mike Ferruzzi',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 1 HOT',
  },
  {
    id: 9,
    company_name: 'Derik Bannister',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 2 WARM',
  },
  {
    id: 10,
    company_name: 'Taelonn Harper',
    target_markets: 'Birmingham, AL',
    notes: 'Tier 2 WARM',
  },
  {
    id: 35,
    company_name: 'Funky Homebuyers',
    target_markets: 'Kansas City, MO',
    notes: 'Tier 2 WARM',
  },
  {
    id: 39,
    company_name: 'Mike Mann',
    target_markets: 'Kansas City, MO',
    notes: 'Tier 1 HOT',
  },
];

// Test Case 1: Birmingham, AL property with multiple tier 1 buyers
describe('getRecommendedBuyers - Birmingham Property', () => {
  const birminghamLead: Lead = {
    id: 1,
    property_address: '123 Main St, Birmingham, AL 35203',
    market: 'Birmingham, AL',
    estimated_arv: 150000,
    repair_estimate: 45000,
    estimated_profit: 20000,
  };

  it('should return Tier 1 buyers first for Birmingham property', () => {
    const matches = getRecommendedBuyers(birminghamLead, testBuyers, 5);

    console.log('\n=== BIRMINGHAM LEAD MATCHING ===');
    console.log(`Property: ${birminghamLead.property_address}`);
    console.log(`ARV: $${birminghamLead.estimated_arv}`);
    console.log(`Est. Profit: $${birminghamLead.estimated_profit}`);
    console.log('\nRecommended Buyers (Top 5):');

    matches.forEach((buyer, index) => {
      console.log(
        `  ${index + 1}. ${formatMatch(buyer)} (Score: ${buyer.match_score})`
      );
    });

    // Verify Tier 1 buyers come first
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].tier_rank).toBe(1);
    expect(
      matches.filter(m => m.tier_rank === 1).length
    ).toBeGreaterThanOrEqual(1);
  });

  it('should prioritize highest scoring buyers', () => {
    const matches = getRecommendedBuyers(birminghamLead, testBuyers, 10);

    // All matches should be sorted by score descending
    for (let i = 1; i < matches.length; i++) {
      if (matches[i - 1].tier_rank === matches[i].tier_rank) {
        expect(matches[i - 1].match_score).toBeGreaterThanOrEqual(
          matches[i].match_score
        );
      }
    }
  });
});

// Test Case 2: Kansas City property - only one Tier 1 buyer
describe('getRecommendedBuyers - Kansas City Property', () => {
  const kcLead: Lead = {
    id: 2,
    property_address: '456 Oak Ave, Kansas City, MO 64105',
    market: 'Kansas City, MO',
    estimated_arv: 120000,
    repair_estimate: 30000,
    estimated_profit: 15000,
  };

  it('should match Kansas City properties to KC buyers', () => {
    const matches = getRecommendedBuyers(kcLead, testBuyers, 5);

    console.log('\n=== KANSAS CITY LEAD MATCHING ===');
    console.log(`Property: ${kcLead.property_address}`);
    console.log(`ARV: $${kcLead.estimated_arv}`);
    console.log(`Est. Profit: $${kcLead.estimated_profit}`);
    console.log('\nRecommended Buyers:');

    matches.forEach((buyer, index) => {
      console.log(
        `  ${index + 1}. ${buyer.company_name} (${buyer.tier_name}) - Score: ${buyer.match_score}`
      );
    });

    // Should find KC buyers
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every(m => m.market_match)).toBe(true);
  });

  it('should return tier 1 buyer Mike Mann for KC property', () => {
    const matches = getRecommendedBuyers(kcLead, testBuyers, 10);
    const mikeMatch = matches.find(m => m.company_name === 'Mike Mann');

    expect(mikeMatch).toBeDefined();
    expect(mikeMatch?.tier_rank).toBe(1);
  });
});

// Test Case 3: Match statistics
describe('getMatchStats', () => {
  const birminghamLead: Lead = {
    id: 1,
    property_address: '123 Main St, Birmingham, AL 35203',
    market: 'Birmingham, AL',
  };

  it('should calculate correct match statistics', () => {
    const stats = getMatchStats(birminghamLead, testBuyers);

    console.log('\n=== MATCH STATISTICS ===');
    console.log(`Lead: ${birminghamLead.property_address}`);
    console.log(`Total Matches: ${stats.total_matches}`);
    console.log(`  Tier 1: ${stats.tier1_count}`);
    console.log(`  Tier 2: ${stats.tier2_count}`);
    console.log(`  Tier 3: ${stats.tier3_count}`);
    console.log(`Top Match: ${stats.top_match}`);
    console.log(`Top Score: ${stats.top_match_score}`);

    expect(stats.total_matches).toBe(8); // 8 Birmingham buyers
    expect(stats.tier1_count).toBe(4); // Tier 1 count
    expect(stats.tier2_count).toBe(4); // Tier 2 count
    expect(stats.top_match_score).toBeGreaterThan(0);
  });
});

// Test Case 4: Match reasons
describe('getMatchReason', () => {
  it('should generate human-readable match reasons', () => {
    const birminghamLead: Lead = {
      id: 1,
      property_address: '123 Main St',
      market: 'Birmingham, AL',
    };

    const matches = getRecommendedBuyers(birminghamLead, testBuyers, 1);
    const topMatch = matches[0];

    const reason = getMatchReason(topMatch);

    console.log('\n=== MATCH REASON ===');
    console.log(`Buyer: ${topMatch.company_name}`);
    console.log(`Reason: ${reason}`);

    expect(reason.length).toBeGreaterThan(0);
    expect(reason).toContain('Market match');
    expect(reason).toContain('Tier');
  });
});

// Test Case 5: No matches
describe('getRecommendedBuyers - No Matches', () => {
  const nonexistentMarketLead: Lead = {
    id: 100,
    property_address: '999 Nowhere St, Denver, CO 80000',
    market: 'Denver, CO',
  };

  it('should return empty array for non-existent market', () => {
    const matches = getRecommendedBuyers(
      nonexistentMarketLead,
      testBuyers,
      5
    );

    console.log('\n=== NO MATCHES TEST ===');
    console.log(`Property: ${nonexistentMarketLead.property_address}`);
    console.log(`Market: ${nonexistentMarketLead.market}`);
    console.log(`Matches Found: ${matches.length}`);

    expect(matches.length).toBe(0);
  });
});

// Test Case 6: Usage Example in React Component
export function ExampleUsage() {
  return `
// In a React component:

import { useLeads } from '@/context/LeadsContext';

export function LeadDetailPage({ leadId }: { leadId: number }) {
  const { leads, getRecommendedBuyersForLead, getMatchStatsForLead } = useLeads();
  
  const lead = leads.find(l => l.id === leadId);
  const recommendedBuyers = getRecommendedBuyersForLead(leadId, 5);
  const matchStats = getMatchStatsForLead(leadId);
  
  return (
    <div>
      <h1>{lead?.property_address}</h1>
      
      <div className="stats">
        <p>Total Matches: {matchStats.total_matches}</p>
        <p>Tier 1: {matchStats.tier1_count}</p>
        <p>Tier 2: {matchStats.tier2_count}</p>
        <p>Tier 3: {matchStats.tier3_count}</p>
      </div>
      
      <div className="recommendations">
        <h2>Recommended Buyers</h2>
        {recommendedBuyers.map(buyer => (
          <div key={buyer.id} className="buyer-card">
            <h3>{buyer.company_name}</h3>
            <p>Tier: {buyer.tier_name}</p>
            <p>Match Score: {buyer.match_score}%</p>
            <button onClick={() => assignToThis(buyer.id)}>
              Assign Lead
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
  `;
}

// Run example
console.log('\n' + '='.repeat(60));
console.log('BUYER MATCHING ALGORITHM - EXAMPLE USAGE');
console.log('='.repeat(60));

const exampleLead: Lead = {
  id: 1,
  property_address: '123 Main St, Birmingham, AL 35203',
  market: 'Birmingham, AL',
  estimated_arv: 150000,
  repair_estimate: 45000,
  estimated_profit: 20000,
};

const matches = getRecommendedBuyers(exampleLead, testBuyers, 5);

console.log(`\nProperty: ${exampleLead.property_address}`);
console.log(`Market: ${exampleLead.market}`);
console.log(`Estimated ARV: $${exampleLead.estimated_arv}`);
console.log(`Estimated Profit: $${exampleLead.estimated_profit}`);

console.log('\nTop 5 Recommended Buyers:');
matches.forEach((buyer, index) => {
  console.log(`\n${index + 1}. ${buyer.company_name}`);
  console.log(`   Tier: ${buyer.tier_name}`);
  console.log(`   Match Score: ${buyer.match_score}%`);
  console.log(`   Reason: ${getMatchReason(buyer)}`);
});

// Placeholder for expect function if not in Jest environment
if (typeof expect === 'undefined') {
  (global as any).expect = (value: any) => ({
    toBeGreaterThan: (other: any) => value > other,
    toBeGreaterThanOrEqual: (other: any) => value >= other,
    toBe: (other: any) => value === other,
    toBeDefined: () => value !== undefined,
    toContain: (str: string) => String(value).includes(str),
  });
  (global as any).describe = (name: string, fn: () => void) => fn();
  (global as any).it = (name: string, fn: () => void) => fn();
}
