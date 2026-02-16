#!/usr/bin/env python3
"""
Easy Exit Homes - Scraper Runner
Executes data collectors for various municipalities and returns JSON
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

# Add collectors to path
sys.path.insert(0, str(Path(__file__).parent))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ScraperRunner")

def run_brunswick_scraper(scraper_type: str = "properties") -> Dict[str, Any]:
    """
    Run the Brunswick scraper with specified type
    
    Args:
        scraper_type: Type of data to scrape ('properties', 'tax-delinquent', 'foreclosures')
    
    Returns:
        Dictionary with results
    """
    try:
        from brunswick_simple import scrape_brunswick
        
        logger.info(f"Running Brunswick {scraper_type} scraper...")
        result = scrape_brunswick(scraper_type, limit=100)
        
        return result
        
    except ImportError as e:
        logger.error(f"Failed to import Brunswick scraper: {e}")
        return {
            "area": "brunswick",
            "type": scraper_type,
            "success": False,
            "error": f"Import error: {e}",
            "properties": []
        }
    except Exception as e:
        logger.error(f"Scraper error: {e}")
        return {
            "area": "brunswick",
            "type": scraper_type,
            "success": False,
            "error": str(e),
            "properties": []
        }

def run_scraper(area: str, scraper_type: str = "properties") -> Dict[str, Any]:
    """
    Main entry point for scraper execution
    
    Args:
        area: Municipality name (brunswick, bath, portland, etc.)
        scraper_type: Type of data to scrape
    
    Returns:
        JSON-serializable results dictionary
    """
    area = area.lower().strip()
    scraper_type = scraper_type.lower().strip()
    
    logger.info(f"Starting scraper: area={area}, type={scraper_type}")
    
    if area == "brunswick":
        return run_brunswick_scraper(scraper_type)
    else:
        # Placeholder for other towns
        return {
            "area": area,
            "type": scraper_type,
            "success": False,
            "error": f"Scraper not yet available for {area}",
            "properties": [],
            "note": "Clone Brunswick scraper to add this town"
        }

if __name__ == "__main__":
    # Called from Node.js with: python run_scraper.py <area> <type>
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing area argument"}))
        sys.exit(1)
    
    area = sys.argv[1]
    scraper_type = sys.argv[2] if len(sys.argv) > 2 else "properties"
    
    result = run_scraper(area, scraper_type)
    print(json.dumps(result, indent=2))
