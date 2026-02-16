"""
Obituary collector module for gathering obituary data from multiple sources.

This module provides a foundational framework for collecting and normalizing
obituary data from various sources like funeral homes and newspapers.
"""
import logging
import json
import csv
import os
import re
import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup

from src.collectors.base_collector import BaseCollector

class ObituaryCollector(BaseCollector):
    """
    Base class for obituary data collectors.
    
    Provides common functionality for:
    - Collecting obituary data from various sources
    - Normalizing data into a common format
    - Deduplicating records from different sources
    - Persisting normalized data
    """
    
    def __init__(self, 
                source_name: str,
                cache_enabled: bool = True,
                cache_expiry: int = 43200,  # 12 hours in seconds
                max_retries: int = 3,
                timeout: int = 30,
                backoff_factor: float = 0.5):
        """
        Initialize obituary collector with configurable options
        
        Args:
            source_name: Name of the obituary source
            cache_enabled: Whether to cache results
            cache_expiry: Cache expiry time in seconds
            max_retries: Maximum number of retry attempts for HTTP requests
            timeout: Request timeout in seconds
            backoff_factor: Backoff factor for retries
        """
        super().__init__(
            cache_enabled=cache_enabled,
            cache_expiry=cache_expiry,
            max_retries=max_retries,
            timeout=timeout,
            backoff_factor=backoff_factor
        )
        
        self.source_name = source_name
        self.data_dir = Path(__file__).parent.parent.parent / 'data' / 'obits'
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Towns of interest in Midcoast Maine
        self.target_towns = [
            'Brunswick', 'Bath', 'Topsham', 'Harpswell', 'Bowdoin', 
            'Bowdoinham', 'Phippsburg', 'Woolwich', 'West Bath',
            'Georgetown', 'Arrowsic', 'Richmond', 'Dresden'
        ]
    
    def collect(self) -> Dict[str, Any]:
        """
        Collect obituary data from the source.
        Must be implemented by each specific collector.
        
        Returns:
            Dictionary containing collected obituary data and metadata
        """
        raise NotImplementedError("Subclasses must implement collect()")
    
    def normalize_obituary(self, raw_obit: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize a raw obituary record into a standardized format
        
        Args:
            raw_obit: Raw obituary data from source
            
        Returns:
            Normalized obituary data
        """
        # Extract name and clean it
        name = raw_obit.get('name', '')
        if isinstance(name, str):
            name = name.strip()
        
        # Extract and normalize date of death
        date_of_death = raw_obit.get('date_of_death', '')
        if isinstance(date_of_death, str):
            try:
                # Try to parse various date formats
                for fmt in ['%Y-%m-%d', '%B %d, %Y', '%m/%d/%Y', '%d %B %Y']:
                    try:
                        date_obj = datetime.datetime.strptime(date_of_death, fmt)
                        date_of_death = date_obj.strftime('%Y-%m-%d')
                        break
                    except ValueError:
                        continue
            except Exception:
                # If parsing fails, keep the original
                pass
        
        # Extract town and filter for our target towns
        town = raw_obit.get('town', '')
        town_match = None
        
        if isinstance(town, str):
            town = town.strip()
            # Check if town matches any of our target towns
            for target in self.target_towns:
                if re.search(r'\b' + re.escape(target) + r'\b', town, re.IGNORECASE):
                    town_match = target
                    break
        
        # Extract age
        age = raw_obit.get('age', '')
        if isinstance(age, str):
            # Try to extract numeric age
            age_match = re.search(r'\b(\d{1,3})\b', age)
            if age_match:
                age = int(age_match.group(1))
        
        # Build normalized record
        normalized = {
            'name': name,
            'date_of_death': date_of_death,
            'town': town_match or town,
            'age': age,
            'source': self.source_name,
            'source_url': raw_obit.get('source_url', ''),
            'original_record': raw_obit
        }
        
        return normalized
    
    def save_to_csv(self, obituaries: List[Dict[str, Any]]) -> str:
        """
        Save normalized obituaries to a CSV file
        
        Args:
            obituaries: List of normalized obituary records
            
        Returns:
            Path to the saved CSV file
        """
        if not obituaries:
            self.logger.warning("No obituaries to save")
            return ""
        
        today = datetime.datetime.now().strftime('%Y-%m-%d')
        csv_file = self.data_dir / f"{self.source_name}_{today}.csv"
        
        try:
            with open(csv_file, 'w', newline='') as f:
                # Define CSV fields
                fieldnames = ['name', 'date_of_death', 'town', 'age', 'source', 'source_url']
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                
                writer.writeheader()
                for obit in obituaries:
                    # Write only the normalized fields, not the full original record
                    writer.writerow({k: v for k, v in obit.items() if k in fieldnames})
            
            self.logger.info(f"Saved {len(obituaries)} obituaries to {csv_file}")
            return str(csv_file)
        except Exception as e:
            self.logger.error(f"Error saving obituaries to CSV: {str(e)}")
            return ""
    
    def filter_by_towns(self, obituaries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filter obituaries to only include those from target towns
        
        Args:
            obituaries: List of normalized obituary records
            
        Returns:
            Filtered list of obituary records
        """
        filtered = []
        for obit in obituaries:
            town = obit.get('town', '')
            for target in self.target_towns:
                if isinstance(town, str) and re.search(r'\b' + re.escape(target) + r'\b', town, re.IGNORECASE):
                    filtered.append(obit)
                    break
        
        self.logger.info(f"Filtered obituaries by town: {len(filtered)}/{len(obituaries)}")
        return filtered
    
    def extract_town_from_text(self, text: str) -> Optional[str]:
        """
        Extract town name from text using pattern matching
        
        Args:
            text: Text to extract town from
            
        Returns:
            Extracted town name or None if no match found
        """
        if not text:
            return None
            
        # Common patterns like "of Brunswick" or "Brunswick resident"
        patterns = [
            r'\bof\s+([A-Za-z\s]+)(?:,\s*(?:Maine|ME))?',
            r'([A-Za-z\s]+)\s+resident',
            r'lived\s+in\s+([A-Za-z\s]+)'
        ]
        
        for pattern in patterns:
            matches = re.search(pattern, text, re.IGNORECASE)
            if matches:
                potential_town = matches.group(1).strip()
                # Check if it's one of our target towns
                for town in self.target_towns:
                    if town.lower() in potential_town.lower():
                        return town
        
        return None 