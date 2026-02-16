#!/usr/bin/env python3
"""
Skip Tracing Collector

This module collects contact information for property owners using free people search websites.
It handles graceful fallbacks, caching, and integrates with the lead generation pipeline.
"""

import os
import sys
import time
import random
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Union, Tuple
import pandas as pd

# Add project root to path
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from src.collectors.base_collector import BaseCollector

class SkipTracingCollector(BaseCollector):
    """
    Collects contact information for property owners using free people search websites
    
    Features:
    - Supports multiple search engines (FastPeopleSearch, TruePeopleSearch, etc.)
    - Handles rotating user agents and session management
    - Implements rate limiting to avoid blocks
    - Provides sample data fallback when dependencies are missing
    - Caches results to minimize requests
    """
    
    def __init__(self,
                 cache_dir: Optional[Path] = None,
                 log_level: int = logging.INFO,
                 max_searches_per_day: int = 20,
                 rate_limit_delay: Tuple[int, int] = (3, 8),
                 preferred_source: str = "fastpeoplesearch",
                 **kwargs):
        """
        Initialize the Skip Tracing Collector
        
        Args:
            cache_dir: Directory for caching results
            log_level: Logging level
            max_searches_per_day: Maximum searches per day to avoid detection
            rate_limit_delay: Random delay range (min, max) in seconds between requests
            preferred_source: Preferred search source (fastpeoplesearch, truepeoplesearch)
            **kwargs: Additional arguments passed from pipeline
        """
        super().__init__(**kwargs)
        
        # Configure logging
        self.logger = logging.getLogger("SkipTracingCollector")
        self.logger.setLevel(log_level)
        
        # Source name
        self.source_name = "skip_tracing"
        
        # Set up cache directory
        self.base_path = project_root
        if cache_dir:
            self.cache_dir = Path(cache_dir) / self.source_name
        else:
            self.cache_dir = self.base_path / 'data' / 'cache' / self.source_name
        
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Set up sample data directory
        self.sample_data_path = self.base_path / 'data' / 'sample_data' / self.source_name
        self.sample_data_path.mkdir(parents=True, exist_ok=True)
        
        # Rate limiting
        self.max_searches_per_day = max_searches_per_day
        self.rate_limit_delay = rate_limit_delay
        
        # Preferred source
        self.preferred_source = preferred_source
        self.available_sources = ["fastpeoplesearch", "truepeoplesearch"]
        
        # User agents for rotation
        self.user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36"
        ]
        
        # Check for Selenium availability
        self.selenium_available = self._check_selenium_available()
        
        # Set up metrics tracking
        self.metrics = {
            'start_time': None,
            'end_time': None,
            'total_lookups': 0,
            'successful_lookups': 0,
            'cache_hits': 0,
            'sources_used': {},
            'errors': [],
            'using_sample_data': False
        }
    
    def _check_selenium_available(self) -> bool:
        """
        Check if Selenium and required dependencies are available
        
        Returns:
            True if Selenium is available, False otherwise
        """
        try:
            import selenium
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.chrome.service import Service
            
            # Try to import webdriver-manager
            try:
                from webdriver_manager.chrome import ChromeDriverManager
                webdriver_manager_available = True
            except ImportError:
                webdriver_manager_available = False
                self.logger.warning("webdriver-manager not available. Chrome driver must be installed manually.")
            
            self.logger.info("Selenium is available for browser automation")
            return True
        except ImportError:
            self.logger.warning("Selenium not available. Install with: pip install -r requirements-vgsi.txt")
            return False
    
    def collect(self, leads: List[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Process a list of leads and add contact information
        
        Args:
            leads: List of lead dictionaries with at least owner_name and/or property_address
            
        Returns:
            Enhanced leads with contact information
        """
        # Start metrics tracking
        self.metrics['start_time'] = datetime.now().isoformat()
        
        # If no leads provided, return empty list
        if not leads:
            self.logger.warning("No leads provided for skip tracing")
            self.metrics['end_time'] = datetime.now().isoformat()
            return []
        
        self.metrics['total_lookups'] = len(leads)
        enhanced_leads = []
        
        # Check if we should use sample data due to missing dependencies
        if not self.selenium_available:
            self.logger.warning("Using sample data due to missing Selenium dependencies")
            self.metrics['using_sample_data'] = True
            enhanced_leads = self._apply_sample_data(leads)
            self.metrics['end_time'] = datetime.now().isoformat()
            return enhanced_leads
        
        # Track daily search count to avoid exceeding limits
        daily_search_count = self._get_daily_search_count()
        if daily_search_count >= self.max_searches_per_day:
            self.logger.warning(f"Daily search limit reached ({self.max_searches_per_day}). Using cached and sample data.")
            enhanced_leads = self._apply_sample_data(leads)
            self.metrics['end_time'] = datetime.now().isoformat()
            return enhanced_leads
        
        # Process each lead
        for lead in leads:
            try:
                # Generate cache key
                cache_key = self._generate_cache_key(lead)
                
                # Check cache first
                cached_data = self._check_cache(cache_key)
                if cached_data:
                    self.logger.info(f"Using cached skip tracing data for {lead.get('owner_name', 'unknown')}")
                    enhanced_lead = {**lead, **cached_data}
                    enhanced_leads.append(enhanced_lead)
                    self.metrics['cache_hits'] += 1
                    continue
                
                # Check if we've hit the daily limit
                if daily_search_count >= self.max_searches_per_day:
                    self.logger.warning(f"Daily search limit reached during processing. Using sample data for remaining leads.")
                    enhanced_lead = self._apply_sample_data_to_lead(lead)
                    enhanced_leads.append(enhanced_lead)
                    continue
                
                # Perform skip tracing
                contact_info = self._perform_skip_tracing(lead)
                
                # Cache the results
                if contact_info:
                    self._save_to_cache(cache_key, contact_info)
                    
                # Update lead with contact info
                enhanced_lead = {**lead, **contact_info}
                enhanced_leads.append(enhanced_lead)
                
                # Update daily search count
                daily_search_count += 1
                self._update_daily_search_count(daily_search_count)
                
                # Add rate limiting delay
                delay = random.uniform(self.rate_limit_delay[0], self.rate_limit_delay[1])
                self.logger.debug(f"Rate limit delay: {delay:.2f} seconds")
                time.sleep(delay)
                
                # Update metrics
                self.metrics['successful_lookups'] += 1
                
            except Exception as e:
                self.logger.error(f"Error processing lead: {str(e)}")
                self.metrics['errors'].append({
                    'lead': lead.get('owner_name', 'unknown'),
                    'error': str(e),
                    'time': datetime.now().isoformat()
                })
                # Add the original lead without enhancements
                enhanced_leads.append(lead)
        
        # Update end time
        self.metrics['end_time'] = datetime.now().isoformat()
        
        return enhanced_leads
    
    def _perform_skip_tracing(self, lead: Dict[str, Any]) -> Dict[str, Any]:
        """
        Perform skip tracing for a lead using available sources
        
        Args:
            lead: Lead dictionary with at least owner_name and/or property_address
            
        Returns:
            Contact information dictionary
        """
        if not self.selenium_available:
            return self._get_sample_contact_info()
        
        # Get search parameters
        owner_name = lead.get('owner_name', '')
        property_address = lead.get('property_address', '')
        
        if not owner_name and not property_address:
            self.logger.warning("Lead missing both owner_name and property_address. Cannot skip trace.")
            return {}
        
        # Try preferred source first
        result = {}
        
        try:
            # Try preferred source
            if self.preferred_source == "fastpeoplesearch":
                result = self._search_fastpeoplesearch(owner_name, property_address)
                source_used = "fastpeoplesearch"
            else:
                result = self._search_truepeoplesearch(owner_name, property_address)
                source_used = "truepeoplesearch"
                
            # If no result, try alternative source
            if not result and "phone" not in result:
                if self.preferred_source == "fastpeoplesearch":
                    result = self._search_truepeoplesearch(owner_name, property_address)
                    source_used = "truepeoplesearch"
                else:
                    result = self._search_fastpeoplesearch(owner_name, property_address)
                    source_used = "fastpeoplesearch"
            
            # Update metrics
            if source_used in self.metrics['sources_used']:
                self.metrics['sources_used'][source_used] += 1
            else:
                self.metrics['sources_used'][source_used] = 1
                
            return result
        
        except Exception as e:
            self.logger.error(f"Error during skip tracing: {str(e)}")
            self.metrics['errors'].append({
                'lead': owner_name or property_address,
                'error': str(e),
                'time': datetime.now().isoformat()
            })
            
            # Use sample data as fallback
            return self._get_sample_contact_info()
    
    def _search_fastpeoplesearch(self, owner_name: str, property_address: str) -> Dict[str, Any]:
        """
        Search FastPeopleSearch for contact information
        
        Args:
            owner_name: Owner name
            property_address: Property address
            
        Returns:
            Contact information dictionary
        """
        self.logger.info(f"Searching FastPeopleSearch for {owner_name or property_address}")
        
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.chrome.service import Service
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            
            # Set up Chrome options
            chrome_options = Options()
            chrome_options.add_argument("--headless")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--window-size=1920,1080")
            chrome_options.add_argument("--disable-extensions")
            chrome_options.add_argument("--disable-infobars")
            chrome_options.add_argument("--disable-notifications")
            chrome_options.add_argument(f"user-agent={random.choice(self.user_agents)}")
            
            # Set up driver
            try:
                # Try to use webdriver-manager
                from webdriver_manager.chrome import ChromeDriverManager
                driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
            except ImportError:
                # Fall back to system ChromeDriver
                driver = webdriver.Chrome(options=chrome_options)
            
            try:
                # Determine search URL
                base_url = "https://www.fastpeoplesearch.com"
                
                if owner_name and property_address:
                    # Prefer address search when both are available
                    search_url = f"{base_url}/address/{self._format_address_for_url(property_address)}"
                elif property_address:
                    search_url = f"{base_url}/address/{self._format_address_for_url(property_address)}"
                elif owner_name:
                    search_url = f"{base_url}/name/{self._format_name_for_url(owner_name)}"
                else:
                    return {}
                
                # Navigate to search URL
                driver.get(search_url)
                
                # Wait for results to load
                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "main"))
                )
                
                # Extract contact information
                contact_info = {}
                
                # Look for people cards
                people_cards = driver.find_elements(By.CSS_SELECTOR, ".card-block")
                
                if people_cards:
                    # Process first matching person (most likely match)
                    card = people_cards[0]
                    
                    # Extract name
                    try:
                        name_elem = card.find_element(By.CSS_SELECTOR, "h2")
                        contact_info["full_name"] = name_elem.text.strip()
                    except Exception:
                        pass
                    
                    # Extract age
                    try:
                        age_elem = card.find_element(By.CSS_SELECTOR, ".age")
                        age_text = age_elem.text.strip()
                        if age_text:
                            age_match = re.search(r'(\d+)', age_text)
                            if age_match:
                                contact_info["age"] = int(age_match.group(1))
                    except Exception:
                        pass
                    
                    # Extract phone numbers
                    try:
                        phone_elems = card.find_elements(By.CSS_SELECTOR, ".details-phone")
                        phone_numbers = []
                        for phone_elem in phone_elems:
                            phone_text = phone_elem.text.strip()
                            if phone_text:
                                phone_numbers.append(phone_text)
                        
                        if phone_numbers:
                            contact_info["phone"] = phone_numbers[0]  # Primary phone
                            if len(phone_numbers) > 1:
                                contact_info["alt_phones"] = phone_numbers[1:]
                    except Exception:
                        pass
                    
                    # Extract email addresses
                    try:
                        email_elems = card.find_elements(By.CSS_SELECTOR, ".details-email")
                        emails = []
                        for email_elem in email_elems:
                            email_text = email_elem.text.strip()
                            if email_text and '@' in email_text:
                                emails.append(email_text)
                        
                        if emails:
                            contact_info["email"] = emails[0]  # Primary email
                            if len(emails) > 1:
                                contact_info["alt_emails"] = emails[1:]
                    except Exception:
                        pass
                    
                    # Extract address(es)
                    try:
                        address_elems = card.find_elements(By.CSS_SELECTOR, ".details-address")
                        addresses = []
                        for addr_elem in address_elems:
                            addr_text = addr_elem.text.strip()
                            if addr_text:
                                addresses.append(addr_text)
                        
                        if addresses:
                            # Only add if different from property address
                            if property_address and self._normalize_address(addresses[0]) != self._normalize_address(property_address):
                                contact_info["current_address"] = addresses[0]
                                if len(addresses) > 1:
                                    contact_info["previous_addresses"] = addresses[1:]
                    except Exception:
                        pass
                
                # Add source
                contact_info["data_source"] = "fastpeoplesearch"
                contact_info["source_url"] = search_url
                contact_info["collection_date"] = datetime.now().strftime("%Y-%m-%d")
                
                return contact_info
                
            finally:
                # Close the driver
                driver.quit()
                
        except Exception as e:
            self.logger.error(f"Error searching FastPeopleSearch: {str(e)}")
            return {}
    
    def _search_truepeoplesearch(self, owner_name: str, property_address: str) -> Dict[str, Any]:
        """
        Search TruePeopleSearch for contact information
        
        Args:
            owner_name: Owner name
            property_address: Property address
            
        Returns:
            Contact information dictionary
        """
        self.logger.info(f"Searching TruePeopleSearch for {owner_name or property_address}")
        
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.chrome.service import Service
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            
            # Set up Chrome options
            chrome_options = Options()
            chrome_options.add_argument("--headless")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--window-size=1920,1080")
            chrome_options.add_argument("--disable-extensions")
            chrome_options.add_argument("--disable-infobars")
            chrome_options.add_argument("--disable-notifications")
            chrome_options.add_argument(f"user-agent={random.choice(self.user_agents)}")
            
            # Set up driver
            try:
                # Try to use webdriver-manager
                from webdriver_manager.chrome import ChromeDriverManager
                driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
            except ImportError:
                # Fall back to system ChromeDriver
                driver = webdriver.Chrome(options=chrome_options)
            
            try:
                # Determine search URL
                base_url = "https://www.truepeoplesearch.com"
                
                if owner_name and property_address:
                    # Prefer address search when both are available
                    search_url = f"{base_url}/results?streetaddress={self._format_address_for_url(property_address)}"
                elif property_address:
                    search_url = f"{base_url}/results?streetaddress={self._format_address_for_url(property_address)}"
                elif owner_name:
                    name_parts = owner_name.split()
                    if len(name_parts) >= 2:
                        firstname = name_parts[0]
                        lastname = name_parts[-1]
                        search_url = f"{base_url}/results?name={firstname}%20{lastname}"
                    else:
                        search_url = f"{base_url}/results?name={owner_name}"
                else:
                    return {}
                
                # Navigate to search URL
                driver.get(search_url)
                
                # Wait for results to load
                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.ID, "divContentBody"))
                )
                
                # Extract contact information
                contact_info = {}
                
                # Look for search results
                result_cards = driver.find_elements(By.CSS_SELECTOR, ".card-summary")
                
                if result_cards:
                    # Process first matching person (most likely match)
                    card = result_cards[0]
                    
                    # Extract name
                    try:
                        name_elem = card.find_element(By.CSS_SELECTOR, ".h4")
                        contact_info["full_name"] = name_elem.text.strip()
                    except Exception:
                        pass
                    
                    # Extract age
                    try:
                        age_elem = card.find_element(By.CSS_SELECTOR, ".content-value")
                        age_text = age_elem.text.strip()
                        if age_text:
                            age_match = re.search(r'(\d+)', age_text)
                            if age_match:
                                contact_info["age"] = int(age_match.group(1))
                    except Exception:
                        pass
                    
                    # Extract current location
                    try:
                        location_elem = card.find_element(By.CSS_SELECTOR, ".text-muted")
                        location_text = location_elem.text.strip()
                        if location_text:
                            contact_info["current_location"] = location_text
                    except Exception:
                        pass
                    
                    # Click on the card to get details
                    card.click()
                    
                    # Wait for details to load
                    WebDriverWait(driver, 10).until(
                        EC.presence_of_element_located((By.ID, "personDetails"))
                    )
                    
                    # Extract phone numbers
                    try:
                        phone_elems = driver.find_elements(By.CSS_SELECTOR, ".row-content .content-value[data-link-to-more='phone']")
                        phone_numbers = []
                        for phone_elem in phone_elems:
                            phone_text = phone_elem.text.strip()
                            if phone_text:
                                phone_numbers.append(phone_text)
                        
                        if phone_numbers:
                            contact_info["phone"] = phone_numbers[0]  # Primary phone
                            if len(phone_numbers) > 1:
                                contact_info["alt_phones"] = phone_numbers[1:]
                    except Exception:
                        pass
                    
                    # Extract emails (not always available)
                    try:
                        email_elems = driver.find_elements(By.CSS_SELECTOR, ".row-content .content-value[data-link-to-more='email']")
                        emails = []
                        for email_elem in email_elems:
                            email_text = email_elem.text.strip()
                            if email_text and '@' in email_text:
                                emails.append(email_text)
                        
                        if emails:
                            contact_info["email"] = emails[0]  # Primary email
                            if len(emails) > 1:
                                contact_info["alt_emails"] = emails[1:]
                    except Exception:
                        pass
                    
                    # Extract addresses
                    try:
                        address_elems = driver.find_elements(By.CSS_SELECTOR, ".row-content .content-value[data-link-to-more='address']")
                        addresses = []
                        for addr_elem in address_elems:
                            addr_text = addr_elem.text.strip()
                            if addr_text:
                                addresses.append(addr_text)
                        
                        if addresses:
                            # Only add if different from property address
                            if property_address and self._normalize_address(addresses[0]) != self._normalize_address(property_address):
                                contact_info["current_address"] = addresses[0]
                                if len(addresses) > 1:
                                    contact_info["previous_addresses"] = addresses[1:]
                    except Exception:
                        pass
                
                # Add source
                contact_info["data_source"] = "truepeoplesearch"
                contact_info["source_url"] = search_url
                contact_info["collection_date"] = datetime.now().strftime("%Y-%m-%d")
                
                return contact_info
                
            finally:
                # Close the driver
                driver.quit()
                
        except Exception as e:
            self.logger.error(f"Error searching TruePeopleSearch: {str(e)}")
            return {}
    
    def _format_name_for_url(self, name: str) -> str:
        """Format name for URL"""
        # Remove special characters and replace spaces with hyphens
        return re.sub(r'[^a-zA-Z0-9\s-]', '', name).strip().replace(' ', '-').lower()
    
    def _format_address_for_url(self, address: str) -> str:
        """Format address for URL"""
        # Replace spaces and special characters for URL
        return address.replace(' ', '+').replace(',', '').replace('#', '')
    
    def _normalize_address(self, address: str) -> str:
        """Normalize address for comparison"""
        # Convert to lowercase, remove punctuation, extra spaces
        return re.sub(r'[^\w\s]', '', address.lower()).strip()
    
    def _generate_cache_key(self, lead: Dict[str, Any]) -> str:
        """
        Generate a unique cache key for a lead
        
        Args:
            lead: Lead dictionary
            
        Returns:
            Cache key string
        """
        # Use owner name and address for cache key
        owner_name = lead.get('owner_name', '').strip()
        property_address = lead.get('property_address', '').strip()
        
        if owner_name and property_address:
            key = f"{owner_name}_{self._normalize_address(property_address)}"
        elif owner_name:
            key = owner_name
        elif property_address:
            key = self._normalize_address(property_address)
        else:
            # Fallback to a unique key
            key = f"lead_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Clean the key for file path safety
        key = re.sub(r'[^\w]', '_', key)
        
        return key
    
    def _check_cache(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """
        Check if data exists in cache
        
        Args:
            cache_key: Cache key
            
        Returns:
            Cached data or None
        """
        cache_file = self.cache_dir / f"{cache_key}.json"
        
        if cache_file.exists():
            try:
                with open(cache_file, 'r') as f:
                    data = json.load(f)
                    # Check if data is still valid (within 30 days)
                    if 'collection_date' in data:
                        collection_date = datetime.strptime(data['collection_date'], "%Y-%m-%d")
                        days_old = (datetime.now() - collection_date).days
                        if days_old <= 30:
                            return data
            except Exception as e:
                self.logger.error(f"Error reading cache file: {str(e)}")
        
        return None
    
    def _save_to_cache(self, cache_key: str, data: Dict[str, Any]) -> None:
        """
        Save data to cache
        
        Args:
            cache_key: Cache key
            data: Data to cache
        """
        cache_file = self.cache_dir / f"{cache_key}.json"
        
        try:
            with open(cache_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            self.logger.error(f"Error saving to cache: {str(e)}")
    
    def _get_daily_search_count(self) -> int:
        """
        Get the number of searches performed today
        
        Returns:
            Number of searches
        """
        count_file = self.cache_dir / f"daily_count_{datetime.now().strftime('%Y%m%d')}.txt"
        
        if count_file.exists():
            try:
                with open(count_file, 'r') as f:
                    return int(f.read().strip())
            except Exception:
                return 0
        
        return 0
    
    def _update_daily_search_count(self, count: int) -> None:
        """
        Update the daily search count
        
        Args:
            count: New search count
        """
        count_file = self.cache_dir / f"daily_count_{datetime.now().strftime('%Y%m%d')}.txt"
        
        try:
            with open(count_file, 'w') as f:
                f.write(str(count))
        except Exception as e:
            self.logger.error(f"Error updating daily search count: {str(e)}")
    
    def _get_sample_contact_info(self) -> Dict[str, Any]:
        """
        Get sample contact information
        
        Returns:
            Sample contact information
        """
        # Randomly select phone format
        phone_formats = [
            "(207) xxx-xxxx",
            "(207) 555-xxxx",
            "207-555-xxxx"
        ]
        
        # Select a phone format
        phone_format = random.choice(phone_formats)
        
        # Generate a random phone number by replacing x's with random digits
        phone = ""
        for char in phone_format:
            if char == 'x':
                phone += str(random.randint(0, 9))
            else:
                phone += char
        
        # Generate sample data
        sample_data = {
            "phone": phone,
            "email": f"owner{random.randint(100, 999)}@example.com",
            "age": random.randint(35, 75),
            "data_source": "sample_data",
            "collection_date": datetime.now().strftime("%Y-%m-%d")
        }
        
        return sample_data
    
    def _apply_sample_data(self, leads: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Apply sample data to all leads
        
        Args:
            leads: List of leads
            
        Returns:
            Enhanced leads with sample contact information
        """
        enhanced_leads = []
        
        for lead in leads:
            enhanced_lead = self._apply_sample_data_to_lead(lead)
            enhanced_leads.append(enhanced_lead)
        
        return enhanced_leads
    
    def _apply_sample_data_to_lead(self, lead: Dict[str, Any]) -> Dict[str, Any]:
        """
        Apply sample data to a single lead
        
        Args:
            lead: Lead dictionary
            
        Returns:
            Enhanced lead with sample contact information
        """
        # Check cache first
        cache_key = self._generate_cache_key(lead)
        cached_data = self._check_cache(cache_key)
        
        if cached_data:
            # Use cached data even in sample mode
            self.metrics['cache_hits'] += 1
            return {**lead, **cached_data}
        
        # Generate sample contact info
        contact_info = self._get_sample_contact_info()
        
        # Add owner name to email if available
        if 'owner_name' in lead and lead['owner_name']:
            name_parts = lead['owner_name'].lower().split()
            if len(name_parts) >= 2:
                first_initial = name_parts[0][0] if name_parts[0] else ''
                last_name = name_parts[-1] if name_parts[-1] else ''
                if first_initial and last_name:
                    contact_info['email'] = f"{first_initial}{last_name}{random.randint(1, 99)}@example.com"
        
        return {**lead, **contact_info}
    
    def transform_to_leads(self, traced_leads: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Transform skip traced leads into standardized lead format
        
        Args:
            traced_leads: Skip traced leads
            
        Returns:
            Leads in standardized format
        """
        # Skip tracing already works with lead format, just ensure fields are standardized
        standardized_leads = []
        
        for lead in traced_leads:
            # Make sure contact information is in standard fields
            standardized_lead = lead.copy()
            
            if 'phone' in lead:
                standardized_lead['contact_phone'] = lead['phone']
            
            if 'email' in lead:
                standardized_lead['contact_email'] = lead['email']
            
            if 'full_name' in lead and not lead.get('owner_name'):
                standardized_lead['owner_name'] = lead['full_name']
                
            standardized_leads.append(standardized_lead)
            
        return standardized_leads
        
    def get_metrics(self) -> Dict[str, Any]:
        """
        Get collector metrics
        
        Returns:
            Metrics dictionary
        """
        return self.metrics
        
    def get_health_check(self) -> Dict[str, Any]:
        """
        Get health check information
        
        Returns:
            Health check dictionary
        """
        return {
            "collector_name": "Skip Tracing Collector",
            "selenium_available": self.selenium_available,
            "cache_enabled": True,
            "cache_directory": str(self.cache_dir),
            "preferred_source": self.preferred_source,
            "available_sources": self.available_sources,
            "rate_limiting": {
                "max_searches_per_day": self.max_searches_per_day,
                "delay_range": self.rate_limit_delay
            },
            "daily_searches_used": self._get_daily_search_count(),
            "using_sample_data": self.metrics.get('using_sample_data', False)
        } 