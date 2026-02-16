"""
Funeral Home specific obituary collector

Collects obituary data from Stetson's Funeral Home website
"""
import logging
import json
import re
import datetime
from typing import Dict, Any, List, Optional
import requests
from bs4 import BeautifulSoup

from src.collectors.obituary_collector import ObituaryCollector

class StetsonsObituaryCollector(ObituaryCollector):
    """
    Collector for obituaries from Stetson's Funeral Home
    
    This collector scrapes the Stetson's Funeral Home website to extract
    structured obituary data for the Midcoast Maine region.
    """
    
    BASE_URL = "https://stetsonsfuneralhome.com/obituaries/"
    
    def __init__(self, 
                cache_enabled: bool = True,
                cache_expiry: int = 43200,  # 12 hours in seconds
                max_retries: int = 3,
                timeout: int = 30,
                backoff_factor: float = 0.5):
        """
        Initialize Stetson's Funeral Home obituary collector
        """
        super().__init__(
            source_name="Stetsons_Funeral_Home",
            cache_enabled=cache_enabled,
            cache_expiry=cache_expiry,
            max_retries=max_retries,
            timeout=timeout,
            backoff_factor=backoff_factor
        )
    
    def collect(self) -> Dict[str, Any]:
        """
        Collect obituary data from Stetson's Funeral Home website
        
        Returns:
            Dictionary containing collected obituary data and metadata
        """
        self.logger.info("Collecting obituaries from Stetson's Funeral Home")
        
        # Fetch the obituary listing page
        result = self.make_request(self.BASE_URL)
        if not result['data']:
            self.logger.error("Failed to retrieve obituary listings")
            return {'data': [], 'metadata': {'error': 'Failed to retrieve data'}}
        
        # Parse the HTML content
        soup = BeautifulSoup(result['data']['text'], 'html.parser')
        
        # Extract obituary listings
        obituaries = []
        # The actual selector would depend on the site's HTML structure
        # This is a placeholder example
        obit_elements = soup.select('.obituary-listing')
        
        for element in obit_elements:
            try:
                # Extract data from the element (adjust selectors as needed)
                name_elem = element.select_one('.obit-name')
                date_elem = element.select_one('.obit-date')
                details_elem = element.select_one('.obit-details')
                link_elem = element.select_one('a')
                
                # Create raw obituary record
                raw_obit = {
                    'name': name_elem.text.strip() if name_elem else '',
                    'date_of_death': date_elem.text.strip() if date_elem else '',
                    'details': details_elem.text.strip() if details_elem else '',
                    'source_url': link_elem['href'] if link_elem and 'href' in link_elem.attrs else '',
                }
                
                # If there's a link to detailed page, fetch and parse it
                if raw_obit['source_url']:
                    detailed_data = self._fetch_detailed_page(raw_obit['source_url'])
                    if detailed_data:
                        raw_obit.update(detailed_data)
                
                # Extract town from the details text if not already present
                if 'town' not in raw_obit and raw_obit['details']:
                    town = self.extract_town_from_text(raw_obit['details'])
                    if town:
                        raw_obit['town'] = town
                
                # Normalize the record
                normalized = self.normalize_obituary(raw_obit)
                obituaries.append(normalized)
                
            except Exception as e:
                self.logger.warning(f"Error parsing obituary element: {str(e)}")
        
        # Filter by target towns
        filtered_obits = self.filter_by_towns(obituaries)
        
        # Save to CSV
        csv_path = self.save_to_csv(filtered_obits)
        
        return {
            'data': filtered_obits,
            'metadata': {
                'total_obituaries': len(obituaries),
                'filtered_obituaries': len(filtered_obits),
                'csv_path': csv_path,
                'collected_at': datetime.datetime.now().isoformat()
            }
        }
    
    def _fetch_detailed_page(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Fetch and parse a detailed obituary page
        
        Args:
            url: URL of the detailed obituary page
            
        Returns:
            Dictionary with extracted details or None if failed
        """
        try:
            # Make request to the detailed page
            result = self.make_request(url)
            if not result['data']:
                return None
            
            soup = BeautifulSoup(result['data']['text'], 'html.parser')
            
            # Extract detailed information (adjust selectors as needed)
            obit_content = soup.select_one('.obituary-content')
            if not obit_content:
                return None
            
            # Extract structured data
            data = {}
            
            # Extract age using regex
            age_pattern = re.compile(r'age\s+(\d+)', re.IGNORECASE)
            age_match = age_pattern.search(obit_content.text)
            if age_match:
                data['age'] = age_match.group(1)
            
            # Extract town
            town = self.extract_town_from_text(obit_content.text)
            if town:
                data['town'] = town
            
            # Extract date of birth and death if available
            # This would depend on the structure of the page
            
            return data
            
        except Exception as e:
            self.logger.warning(f"Error fetching detailed page: {str(e)}")
            return None 