"""
Newspaper obituary collector

Collects obituary data from newspaper websites and filters for relevant towns
"""
import logging
import json
import re
import datetime
from typing import Dict, Any, List, Optional
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

from src.collectors.obituary_collector import ObituaryCollector

class LincolnCountyNewsObituaryCollector(ObituaryCollector):
    """
    Collector for obituaries from the Lincoln County News
    
    This collector scrapes the Lincoln County News website for obituaries
    and filters for those relevant to Midcoast Maine towns.
    """
    
    BASE_URL = "https://lcnme.com/category/obituaries/"
    
    def __init__(self, 
                cache_enabled: bool = True,
                cache_expiry: int = 43200,  # 12 hours in seconds
                max_retries: int = 3,
                timeout: int = 30,
                backoff_factor: float = 0.5,
                pages_to_check: int = 5):
        """
        Initialize Lincoln County News obituary collector
        
        Args:
            pages_to_check: Number of pages of obituaries to process
        """
        super().__init__(
            source_name="Lincoln_County_News",
            cache_enabled=cache_enabled,
            cache_expiry=cache_expiry,
            max_retries=max_retries,
            timeout=timeout,
            backoff_factor=backoff_factor
        )
        self.pages_to_check = pages_to_check
    
    def collect(self) -> Dict[str, Any]:
        """
        Collect obituary data from Lincoln County News website
        
        Returns:
            Dictionary containing collected obituary data and metadata
        """
        self.logger.info(f"Collecting obituaries from Lincoln County News (up to {self.pages_to_check} pages)")
        
        all_obituaries = []
        processed_urls = set()
        
        # Iterate through multiple pages of obituary listings
        for page in range(1, self.pages_to_check + 1):
            page_url = self.BASE_URL
            if page > 1:
                page_url = f"{self.BASE_URL}page/{page}/"
            
            self.logger.info(f"Processing page {page}: {page_url}")
            
            # Fetch the obituary listing page
            result = self.make_request(page_url)
            if not result['data']:
                self.logger.error(f"Failed to retrieve page {page}")
                continue
            
            # Parse the HTML content
            soup = BeautifulSoup(result['data']['text'], 'html.parser')
            
            # Extract obituary listings - adjust these selectors based on the actual site structure
            obit_articles = soup.select('article')
            
            if not obit_articles:
                self.logger.warning(f"No obituaries found on page {page}")
                break
            
            # Process each obituary
            for article in obit_articles:
                try:
                    # Extract link to detailed page
                    link_elem = article.select_one('h2 a, .entry-title a')
                    if not link_elem or 'href' not in link_elem.attrs:
                        continue
                    
                    full_url = link_elem['href']
                    
                    # Skip if we've already processed this URL
                    if full_url in processed_urls:
                        continue
                    
                    processed_urls.add(full_url)
                    
                    # Extract title (usually contains the name)
                    title = link_elem.text.strip()
                    
                    # Check if it's actually an obituary (title often contains name and dates)
                    if not self._looks_like_obituary(title):
                        continue
                    
                    # Extract date of publication (might be different from death date)
                    date_elem = article.select_one('.date, .entry-date, .published')
                    pub_date = date_elem.text.strip() if date_elem else ''
                    
                    # Fetch detailed page for more information
                    detailed_data = self._fetch_detailed_page(full_url, title, pub_date)
                    if not detailed_data:
                        continue
                    
                    # Normalize the record
                    normalized = self.normalize_obituary(detailed_data)
                    all_obituaries.append(normalized)
                    
                except Exception as e:
                    self.logger.warning(f"Error processing article: {str(e)}")
        
        # Filter by target towns
        filtered_obits = self.filter_by_towns(all_obituaries)
        
        # Save to CSV
        csv_path = self.save_to_csv(filtered_obits)
        
        return {
            'data': filtered_obits,
            'metadata': {
                'total_obituaries': len(all_obituaries),
                'filtered_obituaries': len(filtered_obits),
                'pages_processed': min(self.pages_to_check, page),
                'csv_path': csv_path,
                'collected_at': datetime.datetime.now().isoformat()
            }
        }
    
    def _looks_like_obituary(self, title: str) -> bool:
        """
        Check if a title appears to be an obituary
        
        Args:
            title: Article title
            
        Returns:
            True if it appears to be an obituary
        """
        # Obituaries often have dates in the title
        has_dates = bool(re.search(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}\b', title))
        
        # Or contain words like "died", "passed", etc.
        death_words = ['died', 'passed away', 'obituary', 'death', 'memorial']
        has_death_words = any(word in title.lower() for word in death_words)
        
        return has_dates or has_death_words
    
    def _fetch_detailed_page(self, url: str, title: str, pub_date: str) -> Optional[Dict[str, Any]]:
        """
        Fetch and parse a detailed obituary page
        
        Args:
            url: URL of the detailed obituary page
            title: Article title
            pub_date: Publication date
            
        Returns:
            Dictionary with extracted details or None if failed
        """
        try:
            # Make request to the detailed page
            result = self.make_request(url)
            if not result['data']:
                return None
            
            soup = BeautifulSoup(result['data']['text'], 'html.parser')
            
            # Extract the main content (adjust selector as needed)
            content = soup.select_one('article .entry-content, .post-content')
            if not content:
                return None
            
            # Parse the name from the title
            # Often in format "NAME DOB - DOD" or similar
            name = title
            dates_pattern = re.compile(r'\s+\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}\b')
            name_parts = dates_pattern.split(title)
            if len(name_parts) > 1:
                name = name_parts[0].strip()
            
            # Extract dates from title
            # This is tricky and depends on the format
            dob = None
            dod = None
            date_pattern = re.compile(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}\b')
            dates = date_pattern.findall(title)
            if len(dates) >= 2:
                dob = dates[0]
                dod = dates[1]
            elif len(dates) == 1:
                dod = dates[0]
            
            # Extract age from content
            age = None
            age_pattern = re.compile(r'\b(\d{1,3})\s+years?\s+old\b|\bage\s+(\d{1,3})\b', re.IGNORECASE)
            age_match = age_pattern.search(content.text)
            if age_match:
                # Either group 1 or 2 will have the age
                age = age_match.group(1) or age_match.group(2)
            
            # Extract town from content
            town = self.extract_town_from_text(content.text)
            
            # Create the data record
            data = {
                'name': name,
                'date_of_birth': dob,
                'date_of_death': dod,
                'age': age,
                'town': town,
                'source_url': url,
                'content': content.text,
                'publication_date': pub_date
            }
            
            return data
            
        except Exception as e:
            self.logger.warning(f"Error fetching detailed page: {str(e)}")
            return None 