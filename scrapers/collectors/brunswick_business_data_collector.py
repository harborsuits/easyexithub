"""
Collector for Brunswick-specific business and property data from local sources
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional
import re
from datetime import datetime
import json

class BrunswickBusinessDataCollector:
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.cache_dir = config.get('cache_dir', 'cache')
        self.session = None
        
        # Source URLs
        self.urls = {
            'business_directories': {
                'downtown': 'https://brunswickdowntown.org/business-directory/',
                'landing': 'https://brunswicklanding.us/maines-center-for-innovation/directory/',
                'alignable': 'https://www.alignable.com/brunswick-me/directory'
            },
            'planning': {
                'main': 'https://www.brunswickme.gov/229/Planning-Development',
                'permits': 'https://www.brunswickme.gov/235/Permits-Applications',
                'zoning': 'https://www.brunswickme.gov/DocumentCenter/View/126/Brunswick-Zoning-Ordinance-PDF',
                'planning_board': 'https://www.brunswickme.gov/AgendaCenter/Planning-Board-4'
            },
            'property': {
                'code_enforcement': 'https://www.brunswickme.gov/150/Code-Enforcement',
                'assessing': 'https://www.brunswickme.gov/149/Assessing',
                'property_cards': 'https://gis.vgsi.com/brunswickme/',
                'zoning_map': 'https://www.brunswickme.gov/DocumentCenter/View/127/Official-Zoning-Map-PDF'
            }
        }
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def get_business_directory(self) -> List[Dict]:
        """Get comprehensive business directory data"""
        businesses = []
        
        try:
            # Downtown businesses
            downtown_businesses = await self._scrape_downtown_directory()
            businesses.extend(downtown_businesses)
            
            # Brunswick Landing businesses
            landing_businesses = await self._scrape_landing_directory()
            businesses.extend(landing_businesses)
            
            # Remove duplicates based on business name
            seen = set()
            unique_businesses = []
            for business in businesses:
                if business['name'] not in seen:
                    seen.add(business['name'])
                    unique_businesses.append(business)
                    
            return unique_businesses
            
        except Exception as e:
            self.logger.error(f"Error getting business directory: {e}")
            return []
            
    async def get_permit_data(self) -> Dict:
        """Get current permit and application data"""
        data = {
            'building_permits': [],
            'business_permits': [],
            'pending_applications': []
        }
        
        try:
            async with self.session.get(self.urls['planning']['permits']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Extract permit information
                    permit_tables = soup.find_all('table', class_=re.compile(r'permit'))
                    for table in permit_tables:
                        permits = self._parse_permit_table(table)
                        if 'building' in table.get('class', []):
                            data['building_permits'].extend(permits)
                        elif 'business' in table.get('class', []):
                            data['business_permits'].extend(permits)
                            
                    # Extract pending applications
                    pending = soup.find('div', class_=re.compile(r'pending'))
                    if pending:
                        data['pending_applications'] = self._parse_pending_applications(pending)
                        
        except Exception as e:
            self.logger.error(f"Error getting permit data: {e}")
            
        return data
        
    async def get_property_updates(self) -> Dict:
        """Get recent property updates and changes"""
        updates = {
            'transfers': [],
            'new_construction': [],
            'zoning_changes': [],
            'property_status': []
        }
        
        try:
            # Get code enforcement updates
            async with self.session.get(self.urls['property']['code_enforcement']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Extract recent transfers
                    transfers = soup.find('div', class_=re.compile(r'transfers'))
                    if transfers:
                        updates['transfers'] = self._parse_transfers(transfers)
                        
                    # Extract new construction
                    construction = soup.find('div', class_=re.compile(r'construction'))
                    if construction:
                        updates['new_construction'] = self._parse_construction(construction)
                        
            # Get zoning changes
            async with self.session.get(self.urls['planning']['planning_board']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Extract zoning changes from meeting minutes
                    updates['zoning_changes'] = await self._parse_zoning_changes(soup)
                    
        except Exception as e:
            self.logger.error(f"Error getting property updates: {e}")
            
        return updates
        
    async def _scrape_downtown_directory(self) -> List[Dict]:
        """Scrape Brunswick Downtown Association business directory"""
        businesses = []
        try:
            async with self.session.get(self.urls['business_directories']['downtown']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Find business listings
                    listings = soup.find_all('div', class_=re.compile(r'business-listing'))
                    for listing in listings:
                        business = {
                            'name': self._safe_extract(listing, '.business-name'),
                            'address': self._safe_extract(listing, '.business-address'),
                            'phone': self._safe_extract(listing, '.business-phone'),
                            'website': self._safe_extract(listing, '.business-website', 'href'),
                            'category': self._safe_extract(listing, '.business-category'),
                            'source': 'downtown'
                        }
                        businesses.append(business)
                        
        except Exception as e:
            self.logger.error(f"Error scraping downtown directory: {e}")
            
        return businesses
        
    async def _scrape_landing_directory(self) -> List[Dict]:
        """Scrape Brunswick Landing business directory"""
        businesses = []
        try:
            async with self.session.get(self.urls['business_directories']['landing']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Find business listings
                    listings = soup.find_all('div', class_=re.compile(r'directory-item'))
                    for listing in listings:
                        business = {
                            'name': self._safe_extract(listing, '.company-name'),
                            'description': self._safe_extract(listing, '.company-description'),
                            'website': self._safe_extract(listing, '.company-website', 'href'),
                            'category': self._safe_extract(listing, '.company-category'),
                            'location': 'Brunswick Landing',
                            'source': 'landing'
                        }
                        businesses.append(business)
                        
        except Exception as e:
            self.logger.error(f"Error scraping landing directory: {e}")
            
        return businesses
        
    def _parse_permit_table(self, table: BeautifulSoup) -> List[Dict]:
        """Parse permit information from table"""
        permits = []
        try:
            rows = table.find_all('tr')
            headers = [th.text.strip().lower().replace(' ', '_') 
                      for th in rows[0].find_all('th')]
            
            for row in rows[1:]:  # Skip header row
                cells = row.find_all('td')
                permit = {}
                for header, cell in zip(headers, cells):
                    permit[header] = cell.text.strip()
                permits.append(permit)
                
        except Exception as e:
            self.logger.error(f"Error parsing permit table: {e}")
            
        return permits
        
    def _safe_extract(
        self,
        element: BeautifulSoup,
        selector: str,
        attribute: Optional[str] = None
    ) -> Optional[str]:
        """Safely extract text or attribute from element"""
        try:
            found = element.select_one(selector)
            if found:
                if attribute:
                    return found.get(attribute)
                return found.get_text(strip=True)
        except Exception:
            pass
        return None
