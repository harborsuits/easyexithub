#!/usr/bin/env python3
"""
Enrichment and Scoring Pipeline
Adds probate, obituary, code violation data and calculates viability scores
"""

import sys
import json
import logging
from typing import Dict, List, Any

# Add to path
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from enrichment_engine import EnrichmentEngine
from viability_scorer import ViabilityScorer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("EnrichAndScore")

def enrich_and_score(properties: List[Dict[str, Any]], town: str = "brunswick") -> Dict[str, Any]:
    """
    Main enrichment and scoring pipeline
    
    Args:
        properties: Raw scraped properties
        town: Town name (brunswick, bath, etc.)
    
    Returns:
        Dictionary with scored properties and summary
    """
    try:
        logger.info(f"Starting enrichment pipeline for {len(properties)} properties from {town}")
        
        # Step 1: Enrich with additional data sources
        engine = EnrichmentEngine()
        enrichment_data = engine.enrich_properties(properties, town)
        
        # Get enrichment summary
        enrichment_summary = engine.summary(enrichment_data)
        logger.info(f"Enrichment complete: {enrichment_summary}")
        
        # Step 2: Score viability
        scorer = ViabilityScorer()
        scored_properties = scorer.score_batch(properties, enrichment_data)
        
        # Step 3: Split into viable and archived
        viable, archived = scorer.filter_viable(scored_properties)
        
        # Get scoring summary
        scoring_summary = scorer.summary(scored_properties)
        logger.info(f"Scoring complete: {scoring_summary}")
        
        return {
            "success": True,
            "properties": properties,
            "enrichment_data": enrichment_data,
            "scored_properties": scored_properties,
            "viable_leads": viable,
            "archived_leads": archived,
            "summary": {
                **enrichment_summary,
                **scoring_summary,
            }
        }
        
    except Exception as e:
        logger.error(f"Error in enrichment pipeline: {e}")
        return {
            "success": False,
            "error": str(e),
            "scored_properties": [],
            "viable_leads": [],
            "summary": {},
        }

if __name__ == "__main__":
    # Called from Node.js with: python enrich_and_score.py
    # Input is JSON on stdin
    
    try:
        input_data = json.loads(sys.stdin.read())
        properties = input_data.get("properties", [])
        town = input_data.get("town", "brunswick")
        
        result = enrich_and_score(properties, town)
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        logger.error(f"Error reading input: {e}")
        print(json.dumps({
            "success": False,
            "error": str(e),
            "scored_properties": [],
        }))
