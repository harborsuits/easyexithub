"""
Town Collector Template - Base class for town-specific collectors

This module provides a template for creating town-specific collectors
with standardized metrics, logging, and error handling.
"""
import logging
import time
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
import pandas as pd

from .base_collector import BaseCollector

class TownCollectorTemplate(BaseCollector):
    """
    Base class for town-specific collectors with standardized functionality
    
    Features:
    - Consistent metrics tracking
    - Standardized caching
    - Common error handling
    - Health reporting
    """
    
    def __init__(
        self, 
        town: str,
        state: str = "me",
        source_name: str = None,
        cache_dir: Optional[Path] = None,
        max_records: int = 1000,
        **kwargs
    ):
        """
        Initialize the town collector
        
        Args:
            town: Town name (lowercase)
            state: State abbreviation (lowercase)
            source_name: Name of the data source
            cache_dir: Custom cache directory
            max_records: Maximum records to collect
        """
        super().__init__(**kwargs)
        
        # Town information
        self.town = town.lower()
        self.state = state.lower()
        self.source_name = source_name or f"{self.town}_{self.data_type}"
        
        # Set up paths
        self.base_path = Path(__file__).parent.parent.parent
        
        if cache_dir:
            self.cache_dir = cache_dir
        else:
            self.cache_dir = self.base_path / 'data' / 'cache' / self.data_type / f"{self.town}_{self.state}"
        
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Sample data path
        self.sample_data_path = self.base_path / 'data' / 'sample_data' / self.data_type
        self.sample_data_path.mkdir(parents=True, exist_ok=True)
        
        # Limits
        self.max_records = max_records
        
        # Metrics tracking
        self.metrics = {
            'start_time': None,
            'end_time': None,
            'total_records': 0,
            'collected_records': 0,
            'cached_records_used': 0,
            'errors': [],
            'warnings': [],
            'using_sample_data': False,
            'status': 'not_started'  # not_started, in_progress, completed, failed
        }
        
        # Generate standard cache keys
        self.cache_key = f"{self.source_name}_{self.town}_{self.state}"
        self.daily_cache_key = f"{self.cache_key}_{datetime.now().strftime('%Y%m%d')}"
        
        # Standard logger 
        self.logger = logging.getLogger(f"{self.__class__.__name__}")
    
    @property
    def data_type(self) -> str:
        """Type of data being collected (override in subclasses)"""
        return "property_data"
    
    def collect(self) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Collect data for this town
        
        Returns:
            Collected data as list of dictionaries or structured dictionary
        """
        # Start metrics tracking
        self.metrics['start_time'] = datetime.now().isoformat()
        self.metrics['status'] = 'in_progress'
        
        # Check for cached data
        cached_data = self.get_cached_data()
        if cached_data is not None:
            self.metrics['cached_records_used'] = len(cached_data) if isinstance(cached_data, list) else 1
            self.metrics['status'] = 'completed'
            self.metrics['end_time'] = datetime.now().isoformat()
            self.save_metrics()
            return cached_data
        
        try:
            # Call the actual collection implementation
            data = self.collect_data()
            
            # Update metrics
            if isinstance(data, list):
                self.metrics['collected_records'] = len(data)
            else:
                records = data.get('properties', [])
                self.metrics['collected_records'] = len(records)
            
            # Save to cache
            self.save_to_cache(data)
            
            # Update metrics
            self.metrics['status'] = 'completed'
            self.metrics['end_time'] = datetime.now().isoformat()
            self.save_metrics()
            
            return data
            
        except Exception as e:
            # Update metrics
            self.metrics['status'] = 'failed'
            self.metrics['end_time'] = datetime.now().isoformat()
            self.metrics['errors'].append({
                'time': datetime.now().isoformat(),
                'error': str(e)
            })
            
            # Log the error
            self.logger.error(f"Error collecting data: {str(e)}")
            
            # Save metrics
            self.save_metrics()
            
            # Use sample data
            return self.get_sample_data()
    
    def collect_data(self) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Actual data collection implementation (override in subclasses)
        
        Returns:
            Collected data
        """
        raise NotImplementedError("Subclasses must implement collect_data()")
    
    def get_cached_data(self) -> Optional[Union[List[Dict[str, Any]], Dict[str, Any]]]:
        """
        Try to load data from cache
        
        Returns:
            Cached data if available, otherwise None
        """
        cache_file = self.cache_dir / f"{self.daily_cache_key}.json"
        
        if cache_file.exists():
            try:
                self.logger.info(f"Loading cached data from {cache_file}")
                with open(cache_file, 'r') as f:
                    data = json.load(f)
                return data
            except Exception as e:
                self.logger.warning(f"Error loading cached data: {e}")
                return None
        
        return None
    
    def save_to_cache(self, data: Union[List[Dict[str, Any]], Dict[str, Any]]) -> None:
        """
        Save data to cache
        
        Args:
            data: Data to save
        """
        cache_file = self.cache_dir / f"{self.daily_cache_key}.json"
        
        try:
            self.logger.info(f"Saving data to cache: {cache_file}")
            with open(cache_file, 'w') as f:
                json.dump(data, f, indent=2, default=str)
        except Exception as e:
            self.logger.warning(f"Error saving to cache: {e}")
    
    def get_sample_data(self) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Get sample data for testing or when collection fails
        
        Returns:
            Sample data
        """
        self.metrics['using_sample_data'] = True
        self.logger.warning("Using sample data")
        
        # Try to load town-specific sample data
        sample_file = self.sample_data_path / f"{self.town}_{self.state}_sample.json"
        
        # If town-specific sample doesn't exist, use generic sample
        if not sample_file.exists():
            sample_file = self.sample_data_path / f"generic_{self.data_type}_sample.json"
        
        # If any sample file exists, load it
        if sample_file.exists():
            try:
                with open(sample_file, 'r') as f:
                    data = json.load(f)
                self.logger.info(f"Loaded sample data from {sample_file}")
                return data
            except Exception as e:
                self.logger.warning(f"Error loading sample data: {e}")
        
        # Generate sample data if no files exist
        return self.generate_sample_data()
    
    def generate_sample_data(self) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Generate sample data programmatically
        
        Returns:
            Generated sample data
        """
        # Basic implementation, override in subclasses for better samples
        sample_data = {
            'properties': [
                {
                    'id': f"SAMPLE-{self.town}-001",
                    'address': f"123 Main St, {self.town.capitalize()}, {self.state.upper()}",
                    'owner': "Sample Owner",
                    'value': 250000,
                    'data_source': f"{self.source_name} (SAMPLE)"
                }
            ],
            'metadata': {
                'source': self.source_name,
                'town': self.town,
                'state': self.state,
                'timestamp': datetime.now().isoformat(),
                'is_sample': True
            }
        }
        
        # Save the generated sample
        try:
            sample_file = self.sample_data_path / f"{self.town}_{self.state}_sample.json"
            with open(sample_file, 'w') as f:
                json.dump(sample_data, f, indent=2, default=str)
            self.logger.info(f"Saved generated sample to {sample_file}")
        except Exception as e:
            self.logger.warning(f"Error saving generated sample: {e}")
            
        return sample_data
    
    def save_metrics(self) -> None:
        """Save metrics to a file"""
        try:
            metrics_file = self.cache_dir / f"{self.town}_{self.state}_metrics.json"
            with open(metrics_file, 'w') as f:
                json.dump(self.metrics, f, indent=2, default=str)
            self.logger.debug(f"Saved metrics to {metrics_file}")
        except Exception as e:
            self.logger.warning(f"Error saving metrics: {e}")
