"""
Collector for Vision Government Solutions assessment data
"""
import logging
from datetime import datetime
from typing import Dict, List, Optional
import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from .base_collector import BaseCollector
from ..models.property_models import Property, Owner
from ..utils.retry import retry_with_backoff

class VisionCollector(BaseCollector):
    """
    Collects property assessment data from Vision Government Solutions
    Handles both API and web scraping as needed
    """
    
    def __init__(self, config: Dict):
        super().__init__(config)
        self.base_url = config.get('vision_url', 'https://gis.vgsi.com/brunswickme')
        self.logger = logging.getLogger(self.__class__.__name__)
        self.session = requests.Session()
        
        # Initialize Selenium for complex pages
        if config.get('use_selenium', False):
            self.driver = webdriver.Chrome()  # Would use undetected-chromedriver in production
        else:
            self.driver = None

    def collect(self, parcel_id: str = None, address: str = None) -> Dict:
        """
        Collect property data from Vision
        Can search by parcel ID or address
        """
        try:
            # First try API
            result = self._try_api_collection(parcel_id, address)
            if result.get('success'):
                return result
            
            # Fallback to web scraping
            return self._try_web_scraping(parcel_id, address)
            
        except Exception as e:
            self.logger.error(f"Error collecting from Vision: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'parcel_id': parcel_id,
                'address': address
            }

    @retry_with_backoff(max_retries=3)
    def _try_api_collection(self, parcel_id: str = None, address: str = None) -> Dict:
        """Try to collect using the API first"""
        try:
            # Search endpoint
            search_params = {}
            if parcel_id:
                search_params['pid'] = parcel_id
            if address:
                search_params['address'] = address
                
            response = self.session.get(
                f"{self.base_url}/search",
                params=search_params
            )
            
            if response.status_code != 200:
                return {'success': False, 'error': 'API error'}
                
            data = response.json()
            if not data.get('results'):
                return {'success': False, 'error': 'No results found'}
                
            # Get detailed property data
            property_id = data['results'][0]['id']
            details = self.session.get(
                f"{self.base_url}/property/{property_id}"
            ).json()
            
            return {
                'success': True,
                'data': self._parse_api_response(details)
            }
            
        except Exception as e:
            self.logger.error(f"API collection failed: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _try_web_scraping(self, parcel_id: str = None, address: str = None) -> Dict:
        """Fallback to web scraping when API fails"""
        try:
            if not self.driver:
                return {'success': False, 'error': 'Selenium not initialized'}
                
            # Navigate to search page
            self.driver.get(self.base_url)
            
            # Wait for search form
            search_input = WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.ID, "search_input"))
            )
            
            # Enter search criteria
            search_input.send_keys(parcel_id or address)
            search_input.submit()
            
            # Wait for results
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CLASS_NAME, "property-card"))
            )
            
            # Click first result
            self.driver.find_element(By.CLASS_NAME, "property-card").click()
            
            # Wait for details page
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.ID, "property-details"))
            )
            
            # Extract data
            html = self.driver.page_source
            return {
                'success': True,
                'data': self._parse_html_response(html)
            }
            
        except Exception as e:
            self.logger.error(f"Web scraping failed: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _parse_api_response(self, data: Dict) -> Dict:
        """Parse API response into standardized format"""
        return {
            'property': {
                'parcel_id': data.get('pid'),
                'address': data.get('address'),
                'city': 'Brunswick',
                'state': 'ME',
                'property_type': data.get('type'),
                'year_built': data.get('yearBuilt'),
                'square_feet': data.get('squareFeet'),
                'lot_size': data.get('lotSize'),
                'bedrooms': data.get('bedrooms'),
                'bathrooms': data.get('bathrooms'),
                'units': data.get('units', 1),
                'land_value': data.get('landValue'),
                'building_value': data.get('buildingValue'),
                'total_value': data.get('totalValue'),
                'last_assessment_date': data.get('assessmentDate'),
                'zone_code': data.get('zoning')
            },
            'owner': {
                'name': data.get('ownerName'),
                'mailing_address': data.get('ownerAddress'),
                'owner_type': 'unknown'  # Would need additional logic to determine
            }
        }

    def _parse_html_response(self, html: str) -> Dict:
        """Parse HTML response into standardized format"""
        soup = BeautifulSoup(html, 'html.parser')
        
        # Extract data from HTML structure
        details = soup.find(id="property-details")
        values = soup.find(id="assessment-values")
        owner = soup.find(id="owner-info")
        
        return {
            'property': {
                'parcel_id': self._extract_text(details, 'pid'),
                'address': self._extract_text(details, 'address'),
                'city': 'Brunswick',
                'state': 'ME',
                'property_type': self._extract_text(details, 'type'),
                'year_built': self._extract_int(details, 'year-built'),
                'square_feet': self._extract_float(details, 'square-feet'),
                'lot_size': self._extract_float(details, 'lot-size'),
                'bedrooms': self._extract_int(details, 'bedrooms'),
                'bathrooms': self._extract_float(details, 'bathrooms'),
                'units': self._extract_int(details, 'units', 1),
                'land_value': self._extract_float(values, 'land-value'),
                'building_value': self._extract_float(values, 'building-value'),
                'total_value': self._extract_float(values, 'total-value'),
                'last_assessment_date': self._extract_date(values, 'assessment-date'),
                'zone_code': self._extract_text(details, 'zoning')
            },
            'owner': {
                'name': self._extract_text(owner, 'owner-name'),
                'mailing_address': self._extract_text(owner, 'owner-address'),
                'owner_type': 'unknown'
            }
        }

    def _extract_text(self, soup: BeautifulSoup, class_name: str) -> str:
        """Safely extract text from HTML"""
        element = soup.find(class_=class_name)
        return element.text.strip() if element else None

    def _extract_int(self, soup: BeautifulSoup, class_name: str, default: int = None) -> Optional[int]:
        """Safely extract integer from HTML"""
        text = self._extract_text(soup, class_name)
        try:
            return int(text.replace(',', '')) if text else default
        except (ValueError, AttributeError):
            return default

    def _extract_float(self, soup: BeautifulSoup, class_name: str, default: float = None) -> Optional[float]:
        """Safely extract float from HTML"""
        text = self._extract_text(soup, class_name)
        try:
            return float(text.replace(',', '').replace('$', '')) if text else default
        except (ValueError, AttributeError):
            return default

    def _extract_date(self, soup: BeautifulSoup, class_name: str) -> Optional[datetime]:
        """Safely extract date from HTML"""
        text = self._extract_text(soup, class_name)
        try:
            return datetime.strptime(text, '%m/%d/%Y') if text else None
        except (ValueError, AttributeError):
            return None

    def __del__(self):
        """Cleanup Selenium driver"""
        if self.driver:
            self.driver.quit()
