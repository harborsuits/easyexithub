"""
Data Integration Utilities

This module provides simplified integration with existing data sources
to avoid relying on missing collector classes and focus on the core functionality
that was previously working.
"""

import os
import sys
import json
import logging
import pandas as pd
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("DataIntegration")

def load_existing_data_sources(db_path=None):
    """
    Load existing data from the database and other sources
    without relying on potentially missing collector classes.
    
    Args:
        db_path: Path to the SQLite database file
        
    Returns:
        DataFrame with combined property data
    """
    import sqlite3
    
    # Set default db path if not provided
    if db_path is None:
        project_root = Path(__file__).resolve().parent.parent.parent
        db_path = os.path.join(project_root, "data", "midcoast_leads.db")
    
    logger.info(f"Loading existing data from {db_path}")
    
    try:
        # Connect to the database
        conn = sqlite3.connect(db_path)
        
        # Get property data from leads table
        query = "SELECT * FROM leads"
        df = pd.read_sql_query(query, conn)
        
        # Convert data_json to actual fields
        if 'data_json' in df.columns:
            logger.info(f"Processing JSON data fields for {len(df)} records")
            
            # Parse JSON data into separate columns
            for idx, row in df.iterrows():
                if pd.notna(row['data_json']) and row['data_json']:
                    try:
                        data = json.loads(row['data_json'])
                        for key, value in data.items():
                            if key not in df.columns:
                                df[key] = None
                            df.at[idx, key] = value
                    except Exception as e:
                        logger.warning(f"Error parsing JSON for row {idx}: {str(e)}")
        
        # Add validation flags
        df['address_verified'] = df['property_address'].apply(lambda x: validate_address(x))
        
        logger.info(f"Successfully loaded {len(df)} records with {len(df.columns)} fields")
        return df
        
    except Exception as e:
        logger.error(f"Error loading data from database: {str(e)}")
        return pd.DataFrame()
    
def validate_address(address):
    """
    Simple address validation function to replace the address validator
    
    Args:
        address: Address string to validate
        
    Returns:
        True if address appears valid, False otherwise
    """
    if not address or pd.isna(address) or address == '':
        return False
        
    # Check for suspicious patterns
    suspicious_patterns = ['123 ', '999 ', 'test', 'example', 'main st']
    
    # Convert to lowercase for pattern matching
    address_lower = str(address).lower()
    
    # Check for suspicious patterns
    for pattern in suspicious_patterns:
        if pattern in address_lower:
            return False
            
    # Check for minimal length
    if len(address_lower) < 8:
        return False
        
    # Basic pattern check - should have numbers and letters
    has_numbers = any(c.isdigit() for c in address_lower)
    has_letters = any(c.isalpha() for c in address_lower)
    
    return has_numbers and has_letters

def enrich_property_data(df):
    """
    Enrich property data with additional fields for better display
    
    Args:
        df: DataFrame with property data
        
    Returns:
        Enriched DataFrame
    """
    # Add rehab estimates based on property age and size
    if 'year_built' in df.columns and 'sqft' in df.columns:
        df['rehab_estimate'] = df.apply(
            lambda row: calculate_rehab_estimate(row), axis=1
        )
    
    # Ensure lead score is present
    if 'lead_score' not in df.columns:
        df['lead_score'] = 50
    
    # Add data source information
    df['data_source'] = 'Integrated Data Pipeline'
    
    # Add validation notes
    df['address_validation_notes'] = df.apply(
        lambda row: 'Address validation failed' if not row.get('address_verified', True) else '',
        axis=1
    )
    
    return df

def calculate_rehab_estimate(row):
    """
    Calculate rehab estimate based on property characteristics
    
    Args:
        row: DataFrame row with property data
        
    Returns:
        Estimated rehab cost
    """
    try:
        # Get square footage and year built
        sqft = float(row.get('sqft', 0))
        year_built = int(row.get('year_built', 2000))
        
        # Base cost calculation
        base_cost = 25 * sqft  # $25 per square foot base
        
        # Age factor
        if year_built < 1950:
            age_factor = 1.5  # Old homes need more work
        elif year_built < 1980:
            age_factor = 1.3  # Older homes need work
        elif year_built < 2000:
            age_factor = 1.1  # Somewhat older homes need some work
        else:
            age_factor = 1.0  # Newer homes need less work
            
        # Property type factor
        property_type = str(row.get('property_type', '')).lower()
        
        if 'commercial' in property_type:
            type_factor = 1.5
        elif 'multi' in property_type or 'apartment' in property_type:
            type_factor = 1.3
        else:
            type_factor = 1.0  # Residential
            
        # Calculate final estimate
        rehab_cost = int(base_cost * age_factor * type_factor)
        
        return max(5000, min(rehab_cost, 500000))  # Cap between $5k and $500k
        
    except Exception:
        # Default fallback
        return 25000
