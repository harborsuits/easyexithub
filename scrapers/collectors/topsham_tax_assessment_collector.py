#!/usr/bin/env python3
"""
Topsham Tax Assessment Collector

This module collects property data from the Topsham tax assessment database.
It uses the Vision Government Solutions (VGSI) website for Topsham.
"""

import os
import sys
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

# Add project root to path
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from src.collectors.vgsi_collector import VGSICollector

class TopshamTaxAssessmentCollector(VGSICollector):
    """
    Collects property data from the Topsham tax assessment database using VGSI
    """
    
    def __init__(self, 
                 cache_dir: Optional[Path] = None,
                 config_dir: Optional[Path] = None,
                 log_level: int = logging.INFO,
                 max_properties: int = 1000,
                 **kwargs):
        """
        Initialize the Topsham tax assessment collector
        
        Args:
            cache_dir: Directory for caching results
            config_dir: Directory for configuration files
            log_level: Logging level
            max_properties: Maximum number of properties to collect (0 for unlimited)
            **kwargs: Additional parameters that may be passed from the pipeline
        """
        # Initialize the VGSI collector with Topsham specifics
        super().__init__(town="topsham", state="me")
        
        # Set our class-specific properties
        self.source_name = "topsham_tax_assessment"
        self.location = "Topsham"
        
        # Override logger
        self.logger = logging.getLogger("TopshamTaxAssessmentCollector")
        self.logger.setLevel(log_level)
        
        # Set up custom cache directory if provided
        if cache_dir:
            self.cache_dir = Path(cache_dir) / self.source_name
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Store config directory
        self.config_dir = config_dir
        
        # Store max properties
        self.max_properties = max_properties
    
    def collect(self) -> List[Dict[str, Any]]:
        """
        Collect property data from Topsham tax assessment database
        
        Returns:
            List of property data dictionaries
        """
        self.logger.info("Starting Topsham tax assessment data collection")
        
        # Collect from VGSI using the parent implementation
        data = super().collect(max_properties=self.max_properties)
        
        # Extract properties list
        if isinstance(data, dict) and 'properties' in data:
            properties = data['properties']
        else:
            properties = []
            
        # Add source and location information
        for prop in properties:
            prop['data_source'] = "topsham_tax_assessment"
            prop['location'] = "Topsham"
            
        self.logger.info(f"Collection complete: {len(properties)} properties")
        return properties
    
    def transform_to_leads(self, properties: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Transform raw property data into standardized lead format
        
        Args:
            properties: List of raw property data
            
        Returns:
            List of leads in standardized format
        """
        leads = []
        
        for prop in properties:
            # Skip properties with missing essential data
            if not prop.get("property_address") or not prop.get("owner_name"):
                continue
                
            # Create standardized lead object
            lead = {
                "lead_id": f"topsham-tax-{prop.get('parcel_id', '')}",
                "property_id": prop.get('parcel_id', ''),
                "source": "topsham_tax_assessment",
                "source_location": "Topsham",
                "property_address": prop.get('property_address', prop.get('location', '')),
                "owner_name": prop.get('owner_name', prop.get('owner', '')),
                "property_type": prop.get('property_type', ''),
                "last_sale_date": prop.get('last_sale_date', ''),
                "last_sale_price": prop.get('last_sale_price', ''),
                "assessed_value": prop.get('assessment', prop.get('assessed_value', '')),
                "year_built": prop.get('year_built', ''),
                "collection_date": prop.get('collection_date', datetime.now().strftime("%Y-%m-%d")),
                "original_data": prop
            }
            
            leads.append(lead)
            
        return leads 