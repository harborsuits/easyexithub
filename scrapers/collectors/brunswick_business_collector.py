"""
Brunswick-specific collector for business and property updates
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional
import json
from datetime import datetime
import pandas as pd
import re

class BrunswickBusinessCollector:
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.cache_dir = config.get('cache_dir', 'cache')
        self.session = None
        self.base_urls = {
            'business': 'https://www.brunswickme.gov/businesses',
            'permits': 'https://www.brunswickme.gov/permits',
            'property': 'https://gis.brunswickme.gov/gis/property',
            'zoning': 'https://www.brunswickme.gov/zoning'
        }
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def collect_business_data(self) -> Dict:
        """Collect current business information"""
        try:
            # Get business directory
            businesses = await self._scrape_business_directory()
            
            # Get business licenses
            licenses = await self._scrape_business_licenses()
            
            # Combine data
            return {
                'businesses': businesses,
                'licenses': licenses
            }
            
        except Exception as e:
            self.logger.error(f"Error collecting business data: {e}")
            return {}
            
    async def collect_property_updates(self) -> Dict:
        """Collect recent property changes and updates"""
        try:
            # Get recent transfers
            transfers = await self._scrape_property_transfers()
            
            # Get recent permits
            permits = await self._scrape_building_permits()
            
            # Get property status updates
            status = await self._scrape_property_status()
            
            return {
                'transfers': transfers,
                'permits': permits,
                'status': status
            }
            
        except Exception as e:
            self.logger.error(f"Error collecting property updates: {e}")
            return {}
            
    async def collect_municipal_links(self) -> Dict:
        """Collect direct links to municipal resources"""
        try:
            # Get tax map links
            tax_maps = await self._scrape_tax_map_links()
            
            # Get property card links
            prop_cards = await self._scrape_property_card_links()
            
            # Get assessment links
            assessments = await self._scrape_assessment_links()
            
            # Get zoning map links
            zoning = await self._scrape_zoning_links()
            
            return {
                'tax_maps': tax_maps,
                'property_cards': prop_cards,
                'assessments': assessments,
                'zoning': zoning
            }
            
        except Exception as e:
            self.logger.error(f"Error collecting municipal links: {e}")
            return {}
            
    async def _scrape_business_directory(self) -> List[Dict]:
        """Scrape the Brunswick business directory"""
        businesses = []
        try:
            async with self.session.get(self.base_urls['business']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Find business listings
                    listings = soup.find_all('div', class_=re.compile(r'business-listing'))
                    
                    for listing in listings:
                        business = {
                            'name': self._safe_extract(listing, '.business-name'),
                            'address': self._safe_extract(listing, '.business-address'),
                            'owner': self._safe_extract(listing, '.business-owner'),
                            'type': self._safe_extract(listing, '.business-type'),
                            'status': self._safe_extract(listing, '.business-status')
                        }
                        businesses.append(business)
                        
        except Exception as e:
            self.logger.error(f"Error scraping business directory: {e}")
            
        return businesses
        
    async def _scrape_property_transfers(self) -> List[Dict]:
        """Scrape recent property transfers"""
        transfers = []
        try:
            async with self.session.get(f"{self.base_urls['property']}/transfers") as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Find transfer records
                    records = soup.find_all('div', class_=re.compile(r'transfer-record'))
                    
                    for record in records:
                        transfer = {
                            'date': self._safe_extract(record, '.transfer-date'),
                            'address': self._safe_extract(record, '.property-address'),
                            'seller': self._safe_extract(record, '.seller'),
                            'buyer': self._safe_extract(record, '.buyer'),
                            'price': self._safe_extract(record, '.sale-price')
                        }
                        transfers.append(transfer)
                        
        except Exception as e:
            self.logger.error(f"Error scraping property transfers: {e}")
            
        return transfers
        
    async def _scrape_tax_map_links(self) -> List[Dict]:
        """Scrape direct links to tax maps"""
        links = []
        try:
            async with self.session.get(f"{self.base_urls['property']}/maps") as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Find map links
                    map_links = soup.find_all('a', href=re.compile(r'tax-map|property-map'))
                    
                    for link in map_links:
                        map_info = {
                            'title': link.get_text(strip=True),
                            'url': link['href'],
                            'type': 'pdf' if link['href'].endswith('.pdf') else 'web',
                            'map_number': self._extract_map_number(link['href'])
                        }
                        links.append(map_info)
                        
        except Exception as e:
            self.logger.error(f"Error scraping tax map links: {e}")
            
        return links
        
    def _safe_extract(self, element: BeautifulSoup, selector: str) -> Optional[str]:
        """Safely extract text from an element"""
        try:
            found = element.select_one(selector)
            return found.get_text(strip=True) if found else None
        except Exception:
            return None
            
    def _extract_map_number(self, url: str) -> Optional[str]:
        """Extract map number from URL"""
        try:
            match = re.search(r'map[_-]?(\d+)', url.lower())
            return match.group(1) if match else None
        except Exception:
            return None
