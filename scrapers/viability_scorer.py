#!/usr/bin/env python3
"""
Lead Viability Scorer
Calculates viability scores based on distress indicators
"""

from typing import Dict, List, Any
from datetime import datetime

class ViabilityScorer:
    """
    Scores properties based on distress indicators
    0-100 scale: 60+ = viable lead
    """
    
    # Scoring weights
    WEIGHTS = {
        "tax_delinquent_1_year": 25,
        "tax_delinquent_2_years": 40,
        "tax_delinquent_3plus_years": 50,
        "probate_open": 35,
        "recent_death_probate": 50,  # Death + probate = settling estate
        "foreclosure_active": 45,
        "lis_pendens": 40,
        "code_violations": 25,
        "code_violations_serious": 35,
        "bankruptcy": 30,
        "abandoned_property": 55,
        "deed_in_lieu": 45,
    }
    
    # Threshold for viable lead
    VIABLE_THRESHOLD = 60
    
    def score_property(self, property_data: Dict[str, Any], 
                      enrichment_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Score a single property based on indicators
        
        Args:
            property_data: Raw property from scraper
            enrichment_data: Indicators (probate, obituary, code violations, etc.)
        
        Returns:
            Scoring result with viability_score and breakdown
        """
        score = 0
        indicators_triggered = []
        
        # Tax delinquency scoring
        years_delinquent = enrichment_data.get("tax_years_delinquent", 0)
        if years_delinquent >= 3:
            score += self.WEIGHTS["tax_delinquent_3plus_years"]
            indicators_triggered.append("tax_delinquent_3plus_years")
        elif years_delinquent == 2:
            score += self.WEIGHTS["tax_delinquent_2_years"]
            indicators_triggered.append("tax_delinquent_2_years")
        elif years_delinquent == 1:
            score += self.WEIGHTS["tax_delinquent_1_year"]
            indicators_triggered.append("tax_delinquent_1_year")
        
        # Probate + Death (highest priority)
        if enrichment_data.get("probate_open"):
            if enrichment_data.get("recent_death"):  # Death + probate
                score += self.WEIGHTS["recent_death_probate"]
                indicators_triggered.append("recent_death_probate")
            else:
                score += self.WEIGHTS["probate_open"]
                indicators_triggered.append("probate_open")
        
        # Foreclosure/Lis Pendens
        if enrichment_data.get("foreclosure_active"):
            score += self.WEIGHTS["foreclosure_active"]
            indicators_triggered.append("foreclosure_active")
        
        if enrichment_data.get("lis_pendens"):
            score += self.WEIGHTS["lis_pendens"]
            indicators_triggered.append("lis_pendens")
        
        # Code Violations (costly repairs = motivation to sell)
        if enrichment_data.get("code_violations"):
            violations = enrichment_data.get("code_violations", [])
            if len(violations) > 3 or any(v.get("serious") for v in violations):
                score += self.WEIGHTS["code_violations_serious"]
                indicators_triggered.append("code_violations_serious")
            else:
                score += self.WEIGHTS["code_violations"]
                indicators_triggered.append("code_violations")
        
        # Bankruptcy
        if enrichment_data.get("bankruptcy"):
            score += self.WEIGHTS["bankruptcy"]
            indicators_triggered.append("bankruptcy")
        
        # Abandoned property
        if enrichment_data.get("abandoned_property"):
            score += self.WEIGHTS["abandoned_property"]
            indicators_triggered.append("abandoned_property")
        
        # Deed in Lieu (pre-foreclosure settlement)
        if enrichment_data.get("deed_in_lieu"):
            score += self.WEIGHTS["deed_in_lieu"]
            indicators_triggered.append("deed_in_lieu")
        
        # Cap at 100
        final_score = min(score, 100)
        
        return {
            "viability_score": final_score,
            "is_viable": final_score >= self.VIABLE_THRESHOLD,
            "indicators": indicators_triggered,
            "score_breakdown": self._get_breakdown(score, indicators_triggered),
        }
    
    def score_batch(self, properties: List[Dict[str, Any]], 
                   enrichment_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Score multiple properties"""
        scored = []
        for prop in properties:
            prop_enrichment = enrichment_data.get(prop.get("id"), {})
            scored_prop = self.score_property(prop, prop_enrichment)
            
            # Merge score into property
            result = {**prop, **scored_prop}
            scored.append(result)
        
        return scored
    
    def filter_viable(self, scored_properties: List[Dict[str, Any]]) -> tuple:
        """
        Split properties into viable and non-viable
        
        Returns:
            (viable_leads, archived_low_score)
        """
        viable = [p for p in scored_properties if p.get("is_viable")]
        archived = [p for p in scored_properties if not p.get("is_viable")]
        
        return viable, archived
    
    def _get_breakdown(self, score: int, indicators: List[str]) -> str:
        """Generate human-readable score breakdown"""
        if not indicators:
            return "No distress indicators found"
        
        breakdown = "Indicators: "
        indicator_labels = {
            "tax_delinquent_1_year": "1yr unpaid taxes",
            "tax_delinquent_2_years": "2yr unpaid taxes",
            "tax_delinquent_3plus_years": "3+ yrs unpaid taxes",
            "probate_open": "Estate in probate",
            "recent_death_probate": "Recent death + probate",
            "foreclosure_active": "Active foreclosure",
            "lis_pendens": "Foreclosure notice filed",
            "code_violations": "Building violations",
            "code_violations_serious": "Serious violations",
            "bankruptcy": "Bankruptcy filed",
            "abandoned_property": "Property abandoned",
            "deed_in_lieu": "Deed-in-lieu settlement",
        }
        
        labels = [indicator_labels.get(ind, ind) for ind in indicators]
        return " + ".join(labels)
    
    def summary(self, scored_properties: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate summary statistics"""
        viable = [p for p in scored_properties if p.get("is_viable")]
        
        score_distribution = {
            "90-100": len([p for p in scored_properties if p.get("viability_score", 0) >= 90]),
            "70-89": len([p for p in scored_properties if 70 <= p.get("viability_score", 0) < 90]),
            "60-69": len([p for p in scored_properties if 60 <= p.get("viability_score", 0) < 70]),
            "0-59": len([p for p in scored_properties if p.get("viability_score", 0) < 60]),
        }
        
        indicator_counts = {}
        for prop in scored_properties:
            for ind in prop.get("indicators", []):
                indicator_counts[ind] = indicator_counts.get(ind, 0) + 1
        
        return {
            "total_properties": len(scored_properties),
            "viable_leads": len(viable),
            "viable_percentage": round(100 * len(viable) / len(scored_properties), 1) if scored_properties else 0,
            "score_distribution": score_distribution,
            "most_common_indicators": sorted(indicator_counts.items(), key=lambda x: x[1], reverse=True)[:5],
        }

if __name__ == "__main__":
    # Test scoring
    scorer = ViabilityScorer()
    
    test_property = {
        "id": "test-001",
        "address": "123 Main St",
    }
    
    # High viability (death + probate)
    test_enrichment_high = {
        "tax_years_delinquent": 2,
        "probate_open": True,
        "recent_death": True,
        "code_violations": [{"serious": True}],
    }
    
    result = scorer.score_property(test_property, test_enrichment_high)
    print(f"High Viability Score: {result}")
    
    # Low viability (no indicators)
    test_enrichment_low = {
        "tax_years_delinquent": 0,
        "probate_open": False,
    }
    
    result = scorer.score_property(test_property, test_enrichment_low)
    print(f"Low Viability Score: {result}")
