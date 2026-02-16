"""
Obituary aggregator module for combining data from multiple obituary sources

This module provides functionality to collect, normalize, and deduplicate
obituary data from various sources into a single cohesive dataset.
"""
import logging
import json
import csv
import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Union, Set, Tuple
import re
from fuzzywuzzy import fuzz

from src.collectors.obituary_collector import ObituaryCollector
from src.collectors.funeral_home_obituary_collector import StetsonsObituaryCollector
from src.collectors.newspaper_obituary_collector import LincolnCountyNewsObituaryCollector

class ObituaryAggregator:
    """
    Aggregator for obituary data from multiple sources
    
    This class collects data from multiple obituary sources,
    normalizes it, deduplicates records, and provides a unified
    dataset for analysis and enrichment.
    """
    
    def __init__(self, sources: List[ObituaryCollector] = None):
        """
        Initialize obituary aggregator
        
        Args:
            sources: List of obituary collector instances to use
        """
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Create default sources if none provided
        if sources is None:
            sources = [
                StetsonsObituaryCollector(),
                LincolnCountyNewsObituaryCollector()
            ]
        
        self.sources = sources
        self.data_dir = Path(__file__).parent.parent.parent / 'data' / 'obits'
        self.data_dir.mkdir(parents=True, exist_ok=True)
    
    def collect_all(self) -> Dict[str, Any]:
        """
        Collect obituary data from all sources
        
        Returns:
            Dictionary containing aggregated obituary data and metadata
        """
        self.logger.info(f"Collecting obituaries from {len(self.sources)} sources")
        
        source_results = {}
        all_obituaries = []
        
        # Collect from each source
        for source in self.sources:
            source_name = source.source_name
            self.logger.info(f"Collecting from {source_name}")
            
            result = source.collect_with_cache()
            source_results[source_name] = result
            
            if 'data' in result and result['data']:
                all_obituaries.extend(result['data'])
        
        # Deduplicate records
        self.logger.info(f"Found {len(all_obituaries)} total obituaries before deduplication")
        deduplicated = self.deduplicate_obituaries(all_obituaries)
        self.logger.info(f"After deduplication: {len(deduplicated)} unique obituaries")
        
        # Save the merged dataset
        csv_path = self.save_merged_csv(deduplicated)
        json_path = self.save_merged_json(deduplicated)
        
        return {
            'data': deduplicated,
            'metadata': {
                'total_sources': len(self.sources),
                'total_records_before_dedup': len(all_obituaries),
                'total_unique_records': len(deduplicated),
                'csv_path': csv_path,
                'json_path': json_path,
                'collected_at': datetime.datetime.now().isoformat(),
                'source_results': {name: result['metadata'] for name, result in source_results.items()}
            }
        }
    
    def deduplicate_obituaries(self, obituaries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Deduplicate obituary records across multiple sources
        
        This uses fuzzy matching on names and date of death to identify duplicates
        
        Args:
            obituaries: List of obituary records to deduplicate
            
        Returns:
            Deduplicated list of obituary records
        """
        if not obituaries:
            return []
        
        # Sort by source priority (funeral homes first, then newspapers)
        # This ensures we keep the record from the most reliable source if dupes are found
        source_priority = {
            "Stetsons_Funeral_Home": 1,      # Direct source, highest priority
            "Lincoln_County_News": 2,        # News source, medium priority
            "Bangor_Daily_News": 3,          # Regional news source, lower priority
            "Press_Herald": 4                # Another regional source, lower priority
        }
        
        sorted_obits = sorted(obituaries, key=lambda x: source_priority.get(x.get('source', ''), 99))
        
        # Deduplicate, keeping track of seen names to prevent duplicates
        deduplicated = []
        seen_keys = set()  # Set of name+date tuples we've already processed
        
        for obit in sorted_obits:
            # Skip if missing critical fields
            if not obit.get('name') or not obit.get('town'):
                continue
            
            # Create a key for basic deduplication
            basic_key = (
                obit.get('name', '').lower().strip(),
                obit.get('date_of_death', '').strip()
            )
            
            # If we have an exact match on name and date, skip
            if basic_key in seen_keys:
                continue
            
            # Check for fuzzy matches on name
            duplicate_found = False
            
            for existing_obit in deduplicated:
                # Skip direct comparison with records from same source
                if existing_obit.get('source') == obit.get('source'):
                    continue
                
                # Check for similarity in name (allow for typos, different formats)
                name_similarity = fuzz.ratio(
                    obit.get('name', '').lower().strip(),
                    existing_obit.get('name', '').lower().strip()
                )
                
                # Check dates - if both have dates, compare them
                date_match = False
                if obit.get('date_of_death') and existing_obit.get('date_of_death'):
                    date_similarity = fuzz.ratio(
                        obit.get('date_of_death', '').strip(),
                        existing_obit.get('date_of_death', '').strip()
                    )
                    date_match = date_similarity > 80
                else:
                    # If one is missing date, still consider a match if name is very similar
                    date_match = True
                
                # If both name and date are similar enough, consider it a duplicate
                if name_similarity > 85 and date_match:
                    duplicate_found = True
                    
                    # Merge additional information if the new record has more details
                    for field in ['age', 'town', 'source_url']:
                        if field not in existing_obit or not existing_obit[field]:
                            if field in obit and obit[field]:
                                existing_obit[field] = obit[field]
                    
                    # Add source reference
                    if 'alternative_sources' not in existing_obit:
                        existing_obit['alternative_sources'] = []
                    
                    existing_obit['alternative_sources'].append({
                        'source': obit.get('source'),
                        'source_url': obit.get('source_url'),
                        'name': obit.get('name')
                    })
                    
                    # Keep highest quality name
                    if len(obit.get('name', '')) > len(existing_obit.get('name', '')):
                        existing_obit['name'] = obit['name']
                    
                    break
            
            if not duplicate_found:
                seen_keys.add(basic_key)
                deduplicated.append(obit)
        
        return deduplicated
    
    def save_merged_csv(self, obituaries: List[Dict[str, Any]]) -> str:
        """
        Save merged obituary records to a CSV file
        
        Args:
            obituaries: List of deduplicated obituary records
            
        Returns:
            Path to the saved CSV file
        """
        if not obituaries:
            self.logger.warning("No obituaries to save")
            return ""
        
        today = datetime.datetime.now().strftime('%Y-%m-%d')
        csv_file = self.data_dir / f"merged_obituaries_{today}.csv"
        
        try:
            with open(csv_file, 'w', newline='') as f:
                # Define CSV fields
                fieldnames = ['name', 'date_of_death', 'town', 'age', 'source', 'source_url']
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                
                writer.writeheader()
                for obit in obituaries:
                    # Write only the normalized fields, not the full original record
                    writer.writerow({k: v for k, v in obit.items() if k in fieldnames})
            
            self.logger.info(f"Saved {len(obituaries)} merged obituaries to {csv_file}")
            return str(csv_file)
        except Exception as e:
            self.logger.error(f"Error saving merged obituaries to CSV: {str(e)}")
            return ""
    
    def save_merged_json(self, obituaries: List[Dict[str, Any]]) -> str:
        """
        Save merged obituary records to a JSON file with full details
        
        Args:
            obituaries: List of deduplicated obituary records
            
        Returns:
            Path to the saved JSON file
        """
        if not obituaries:
            self.logger.warning("No obituaries to save")
            return ""
        
        today = datetime.datetime.now().strftime('%Y-%m-%d')
        json_file = self.data_dir / f"merged_obituaries_{today}.json"
        
        try:
            # Prepare JSON-serializable version of the data
            json_data = []
            for obit in obituaries:
                # Remove non-serializable fields if any
                obit_copy = {k: v for k, v in obit.items() if k != 'original_record'}
                json_data.append(obit_copy)
            
            with open(json_file, 'w') as f:
                json.dump(json_data, f, indent=2)
            
            self.logger.info(f"Saved {len(obituaries)} merged obituaries to {json_file}")
            return str(json_file)
        except Exception as e:
            self.logger.error(f"Error saving merged obituaries to JSON: {str(e)}")
            return ""
            
    def load_latest_merged_data(self) -> List[Dict[str, Any]]:
        """
        Load the latest merged dataset
        
        Returns:
            List of obituary records from the latest merged file
        """
        # Find the latest merged JSON file
        json_files = list(self.data_dir.glob('merged_obituaries_*.json'))
        if not json_files:
            self.logger.warning("No merged obituary files found")
            return []
        
        # Sort by modification time (newest first)
        latest_file = sorted(json_files, key=lambda f: f.stat().st_mtime, reverse=True)[0]
        
        try:
            with open(latest_file, 'r') as f:
                data = json.load(f)
            
            self.logger.info(f"Loaded {len(data)} obituaries from {latest_file}")
            return data
        except Exception as e:
            self.logger.error(f"Error loading latest merged data: {str(e)}")
            return [] 