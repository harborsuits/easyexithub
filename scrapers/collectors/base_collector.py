"""
Base collector module for data collection operations

Provides a foundation for all data collectors with common functionality
including retry logic, timeout handling, caching, and metrics collection.
"""
import logging
import time
import json
import os
import hashlib
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, Optional, Union, List
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

class BaseCollector(ABC):
    """
    Base class for all data collectors.
    
    Provides common functionality for:
    - HTTP requests with retries and timeouts
    - Result caching
    - Performance metrics
    - Data validation
    """
    
    def __init__(self, 
                cache_enabled: bool = True,
                cache_expiry: int = 86400, # 24 hours in seconds
                max_retries: int = 3,
                timeout: int = 30,
                backoff_factor: float = 0.5):
        """
        Initialize collector with configurable options
        
        Args:
            cache_enabled: Whether to cache results
            cache_expiry: Cache expiry time in seconds
            max_retries: Maximum number of retry attempts for HTTP requests
            timeout: Request timeout in seconds
            backoff_factor: Backoff factor for retries
        """
        # Setup logging
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Cache settings
        self.cache_enabled = cache_enabled
        self.cache_expiry = cache_expiry
        self.cache_dir = Path(__file__).parent.parent.parent / 'cache' / self.__class__.__name__
        if cache_enabled:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # HTTP settings
        self.timeout = timeout
        self.session = self._create_session(max_retries, backoff_factor)
        
        # Metrics
        self.metrics = {
            'requests': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'retries': 0,
            'failures': 0,
            'total_time': 0,
            'last_run': None
        }
    
    def _create_session(self, max_retries: int, backoff_factor: float) -> requests.Session:
        """Create a requests session with retry configuration"""
        session = requests.Session()
        
        # Configure retry strategy
        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=backoff_factor,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"]
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session
    
    @abstractmethod
    def collect(self) -> Dict[str, Any]:
        """
        Base collection method to be implemented by specific collectors
        
        Returns:
            Dictionary containing collected data and metadata
        """
        pass
    
    def collect_with_cache(self, cache_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Run collection with caching support
        
        Args:
            cache_key: Optional custom cache key, otherwise uses class name
            
        Returns:
            Dictionary containing collected data and metadata
        """
        # Generate cache key if not provided
        if cache_key is None:
            cache_key = self.__class__.__name__
        
        cache_file = self.cache_dir / f"{cache_key}.json"
        
        # Try to load from cache if enabled
        if self.cache_enabled and cache_file.exists():
            try:
                with open(cache_file, 'r') as f:
                    cached_data = json.load(f)
                
                # Check if cache is still valid
                cache_time = datetime.fromisoformat(cached_data.get('metadata', {}).get('cached_at', '2000-01-01'))
                if datetime.now() - cache_time < timedelta(seconds=self.cache_expiry):
                    self.logger.info(f"Using cached data for {cache_key}")
                    self.metrics['cache_hits'] += 1
                    return cached_data
                    
                self.logger.info(f"Cache expired for {cache_key}")
                self.metrics['cache_misses'] += 1
            except Exception as e:
                self.logger.warning(f"Error reading cache: {str(e)}")
                self.metrics['cache_misses'] += 1
        elif self.cache_enabled:
            self.metrics['cache_misses'] += 1
        
        # Start timing
        start_time = time.time()
        
        try:
            # Run the actual collection
            result = self.collect()
            
            # Record metrics
            self.metrics['total_time'] += time.time() - start_time
            self.metrics['last_run'] = datetime.now().isoformat()
            
            # Add metadata if not present
            if 'metadata' not in result:
                result['metadata'] = {}
            
            # Update metadata
            result['metadata'].update({
                'collector': self.__class__.__name__,
                'collected_at': datetime.now().isoformat(),
                'cached_at': datetime.now().isoformat() if self.cache_enabled else None,
                'execution_time': round(time.time() - start_time, 3)
            })
            
            # Save to cache if enabled
            if self.cache_enabled:
                try:
                    with open(cache_file, 'w') as f:
                        json.dump(result, f, indent=2)
                    self.logger.info(f"Saved data to cache: {cache_file}")
                except Exception as e:
                    self.logger.warning(f"Error writing to cache: {str(e)}")
            
            return result
        except Exception as e:
            self.logger.error(f"Error in collect_with_cache: {str(e)}")
            self.metrics['failures'] += 1
            
            # Return empty result with error info
            return {
                'data': None,
                'metadata': {
                    'collector': self.__class__.__name__,
                    'error': str(e),
                    'collected_at': datetime.now().isoformat(),
                }
            }
    
    def make_request(self, url: str, method: str = 'GET', params: Dict = None, 
                     data: Dict = None, headers: Dict = None, cache: bool = True) -> Dict:
        """
        Make an HTTP request with caching and error handling
        
        Args:
            url: The URL to request
            method: HTTP method (GET, POST, etc.)
            params: URL parameters
            data: Request body for POST requests
            headers: HTTP headers
            cache: Whether to cache this request
            
        Returns:
            Dictionary with response and metadata
        """
        # Generate cache key if caching is enabled
        cache_key = None
        if cache and self.cache_enabled:
            # Create a unique key based on the request
            cache_data = f"{method}:{url}:{json.dumps(params or {})}:{json.dumps(data or {})}"
            cache_key = hashlib.md5(cache_data.encode()).hexdigest()
            
            # Check cache
            cache_file = self.cache_dir / f"request_{cache_key}.json"
            if cache_file.exists():
                try:
                    with open(cache_file, 'r') as f:
                        cached_data = json.load(f)
                    
                    # Check if cache is still valid
                    cache_time = datetime.fromisoformat(cached_data.get('metadata', {}).get('cached_at', '2000-01-01'))
                    if datetime.now() - cache_time < timedelta(seconds=self.cache_expiry):
                        self.metrics['cache_hits'] += 1
                        return cached_data
                except Exception as e:
                    self.logger.warning(f"Error reading request cache: {str(e)}")
        
        # Cache miss or cache disabled
        if cache:
            self.metrics['cache_misses'] += 1
            
        start_time = time.time()
        self.metrics['requests'] += 1
        
        try:
            # Make the request
            headers = headers or {}
            response = self.session.request(
                method=method,
                url=url,
                params=params,
                json=data if method != 'GET' else None,
                headers=headers,
                timeout=self.timeout
            )
            
            # Check if successful
            response.raise_for_status()
            
            # Parse response
            try:
                response_data = response.json()
            except ValueError:
                response_data = {'text': response.text}
            
            result = {
                'data': response_data,
                'metadata': {
                    'status_code': response.status_code,
                    'url': url,
                    'method': method,
                    'execution_time': round(time.time() - start_time, 3),
                    'cached_at': datetime.now().isoformat() if cache and self.cache_enabled else None,
                    'headers': dict(response.headers)
                }
            }
            
            # Save to cache if enabled
            if cache and self.cache_enabled and cache_key:
                try:
                    cache_file = self.cache_dir / f"request_{cache_key}.json"
                    with open(cache_file, 'w') as f:
                        json.dump(result, f)
                except Exception as e:
                    self.logger.warning(f"Error writing request to cache: {str(e)}")
            
            return result
        
        except requests.exceptions.RequestException as e:
            self.logger.error(f"Request error: {str(e)}")
            self.metrics['failures'] += 1
            
            # Count retry if it was a retry
            if hasattr(e, 'response') and e.response is not None:
                if 'Retry-After' in e.response.headers:
                    self.metrics['retries'] += 1
            
            return {
                'data': None,
                'metadata': {
                    'error': str(e),
                    'url': url,
                    'method': method,
                    'execution_time': round(time.time() - start_time, 3)
                }
            }
    
    def validate_data(self, data: Any) -> bool:
        """
        Basic validation of collected data
        
        Args:
            data: Data to validate
            
        Returns:
            True if data is valid, False otherwise
        """
        if data is None:
            self.logger.warning("No data collected")
            return False
            
        # Check for empty collections
        if isinstance(data, dict) and not data:
            self.logger.warning("Empty data dictionary")
            return False
            
        if isinstance(data, list) and not data:
            self.logger.warning("Empty data list")
            return False
            
        return True
        
    def get_metrics(self) -> Dict[str, Any]:
        """Get collector performance metrics"""
        return self.metrics
        
    def clear_cache(self) -> None:
        """Clear the cache for this collector"""
        if not self.cache_enabled:
            return
            
        try:
            for cache_file in self.cache_dir.glob('*.json'):
                cache_file.unlink()
            self.logger.info(f"Cleared cache for {self.__class__.__name__}")
        except Exception as e:
            self.logger.error(f"Error clearing cache: {str(e)}")
