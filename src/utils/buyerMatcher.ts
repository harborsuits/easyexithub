/**
 * Buyer Matching Algorithm
 * Matches leads to buyers based on market relationships and tier priority
 * 
 * Schema:
 * - leads.market_id → markets.id (foreign key)
 * - buyers.target_markets → TEXT field containing market names (comma or space separated)
 */

interface Lead {
  id: number;
  market_id: number;
  estimated_arv?: number;
  estimated_equity?: number;
  market?: { id: number; name: string };
}

interface Buyer {
  id: number;
  company_name: string;
  target_markets?: string;
  notes?: string;
  reliability_score?: number;
  contact_phone?: string;
  contact_email?: string;
}

interface MarketMap {
  [key: number]: string;
}

interface MatchResult extends Buyer {
  match_score: number;
  tier: number;
  tier_label: string;
}

export const buyerMatcher = {
  /**
   * Get tier level from buyer notes
   */
  getTierLevel(notes?: string): number {
    if (!notes) return 3;
    const lower = notes.toLowerCase();
    if (lower.includes('tier 1') || lower.includes('hot')) return 1;
    if (lower.includes('tier 2') || lower.includes('warm')) return 2;
    return 3;
  },

  /**
   * Get tier label from buyer notes
   */
  getTierLabel(notes?: string): string {
    const tier = this.getTierLevel(notes);
    switch (tier) {
      case 1:
        return 'Tier 1 HOT';
      case 2:
        return 'Tier 2 WARM';
      default:
        return 'Tier 3 ACTIVE';
    }
  },

  /**
   * Check if buyer serves the market
   * Compares buyer.target_markets (text) with market.name
   */
  servesMarket(buyer: Buyer, marketName?: string): boolean {
    if (!buyer.target_markets || !marketName) {
      // If no market info, assume buyer can work any market
      return true;
    }

    const targets = buyer.target_markets.toLowerCase();
    const market = marketName.toLowerCase();

    // Check if market name is in target markets
    if (targets.includes(market)) return true;

    // Check for multi-market designation
    if (targets.includes('multi')) return true;

    return false;
  },

  /**
   * Calculate match score for a buyer against a lead
   * Factors:
   * - Tier (1 = 50pts, 2 = 30pts, 3 = 10pts)
   * - Market match (40pts)
   * - Reliability score (20pts)
   */
  calculateScore(buyer: Buyer, lead: Lead, marketName?: string): number {
    let score = 0;

    // Tier-based points
    const tier = this.getTierLevel(buyer.notes);
    score += tier === 1 ? 50 : tier === 2 ? 30 : 10;

    // Market match
    if (this.servesMarket(buyer, marketName)) {
      score += 40;
    }

    // Reliability
    if (buyer.reliability_score && buyer.reliability_score > 0) {
      score += Math.min(20, (buyer.reliability_score / 10) * 20);
    }

    return Math.min(100, score);
  },

  /**
   * Find matching buyers for a lead
   * Returns buyers sorted by tier, then by score
   */
  findMatches(
    lead: Lead,
    buyers: Buyer[],
    marketName?: string
  ): MatchResult[] {
    return buyers
      .filter((buyer) => this.servesMarket(buyer, marketName))
      .map((buyer) => {
        const tier = this.getTierLevel(buyer.notes);
        const score = this.calculateScore(buyer, lead, marketName);

        return {
          ...buyer,
          match_score: score,
          tier,
          tier_label: this.getTierLabel(buyer.notes),
        };
      })
      .sort((a, b) => {
        // Sort by tier first (lower is better)
        if (a.tier !== b.tier) {
          return a.tier - b.tier;
        }
        // Then by score (higher is better)
        return b.match_score - a.match_score;
      });
  },

  /**
   * Get top N matches
   */
  getTopMatches(
    lead: Lead,
    buyers: Buyer[],
    marketName?: string,
    limit: number = 5
  ): MatchResult[] {
    return this.findMatches(lead, buyers, marketName).slice(0, limit);
  },

  /**
   * Get match statistics for a lead
   */
  getMatchStats(
    lead: Lead,
    buyers: Buyer[],
    marketName?: string
  ): {
    total_matches: number;
    tier1_count: number;
    tier2_count: number;
    tier3_count: number;
    top_match?: MatchResult;
    top_match_score?: number;
  } {
    const matches = this.findMatches(lead, buyers, marketName);

    return {
      total_matches: matches.length,
      tier1_count: matches.filter((m) => m.tier === 1).length,
      tier2_count: matches.filter((m) => m.tier === 2).length,
      tier3_count: matches.filter((m) => m.tier === 3).length,
      top_match: matches[0],
      top_match_score: matches[0]?.match_score,
    };
  },
};
