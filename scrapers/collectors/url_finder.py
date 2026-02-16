"""
URL finder for Brunswick data sources - handles dynamic URL discovery
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional, Tuple
import re
from urllib.parse import urljoin, urlparse
import json

class BrunswickUrlFinder:
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.session = None
        self.base_urls = {
            'census': 'https://www.census.gov',
            'census_reporter': 'https://censusreporter.org',
            'brunswick': 'https://www.brunswickme.gov',
            'epa': 'https://www.epa.gov',
            'fema': 'https://msc.fema.gov',
            'nces': 'https://nces.ed.gov',
            'maine_doe': 'https://www.maine.gov/doe'
        }
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def find_all_urls(self) -> Dict[str, str]:
        """Find all required URLs for data collection"""
        try:
            urls = {}
            
            # Find Census QuickFacts URL
            urls['census_quickfacts'] = await self._find_census_quickfacts_url()
            
            # Find Census Reporter URL
            urls['census_reporter'] = await self._find_census_reporter_url()
            
            # Find Brunswick Demographics URL
            urls['brunswick_demographics'] = await self._find_brunswick_demographics_url()
            
            # Find EPA Superfund URL
            urls['epa_superfund'] = await self._find_epa_superfund_url()
            
            # Find FEMA Flood Map URL
            urls['fema_flood'] = await self._find_fema_flood_url()
            
            # Find NCES Data URL
            urls['nces_data'] = await self._find_nces_url()
            
            # Find Maine DOE URL
            urls['maine_doe'] = await self._find_maine_doe_url()
            
            return urls
            
        except Exception as e:
            self.logger.error(f"Error finding URLs: {str(e)}")
            raise
            
    async def _find_census_quickfacts_url(self) -> str:
        """Find Census QuickFacts URL for Brunswick"""
        try:
            # Start with search
            search_url = f"{self.base_urls['census']}/quickfacts/search"
            params = {'q': 'Brunswick Maine'}
            
            async with self.session.get(search_url, params=params) as response:
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Look for Brunswick, ME link
                links = soup.find_all('a', href=re.compile(r'brunswickcdpmaine'))
                if links:
                    return urljoin(self.base_urls['census'], links[0]['href'])
                    
            # Fallback to known pattern
            return "https://www.census.gov/quickfacts/fact/table/brunswickcdpmaine/PST045223"
            
        except Exception as e:
            self.logger.error(f"Error finding Census QuickFacts URL: {str(e)}")
            return self.base_urls['census']
            
    async def _find_census_reporter_url(self) -> str:
        """Find Census Reporter URL for Brunswick"""
        try:
            # Search for Brunswick
            search_url = f"{self.base_urls['census_reporter']}/search/locations?q=Brunswick%2C+ME"
            
            async with self.session.get(search_url) as response:
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Look for Brunswick profile link
                links = soup.find_all('a', href=re.compile(r'profiles.*brunswick'))
                if links:
                    return urljoin(self.base_urls['census_reporter'], links[0]['href'])
                    
            # Fallback to known pattern
            return "https://censusreporter.org/profiles/16000US2308395-brunswick-me/"
            
        except Exception as e:
            self.logger.error(f"Error finding Census Reporter URL: {str(e)}")
            return self.base_urls['census_reporter']
            
    async def _find_brunswick_demographics_url(self) -> str:
        """Find Brunswick Demographics document URL"""
        try:
            # Search document center
            search_url = f"{self.base_urls['brunswick']}/DocumentCenter"
            
            async with self.session.get(search_url) as response:
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Look for demographics document
                links = soup.find_all(
                    'a',
                    text=re.compile(r'demographics|population', re.I)
                )
                if links:
                    return urljoin(self.base_urls['brunswick'], links[0]['href'])
                    
            # Fallback to known pattern
            return "https://www.brunswickme.gov/DocumentCenter/View/10542"
            
        except Exception as e:
            self.logger.error(f"Error finding Brunswick demographics URL: {str(e)}")
            return self.base_urls['brunswick']
            
    async def _find_epa_superfund_url(self) -> str:
        """Find EPA Superfund URL for Brunswick Naval Air Station"""
        try:
            # Search for Brunswick Naval Air Station
            search_url = f"{self.base_urls['epa']}/superfund-redevelopment/superfund-sites-reuse-maine"
            
            async with self.session.get(search_url) as response:
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Look for Brunswick Naval Air Station link
                links = soup.find_all(
                    'a',
                    text=re.compile(r'Brunswick Naval Air Station', re.I)
                )
                if links:
                    return urljoin(self.base_urls['epa'], links[0]['href'])
                    
            # Fallback to known pattern
            return "https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.cleanup&id=0101073"
            
        except Exception as e:
            self.logger.error(f"Error finding EPA Superfund URL: {str(e)}")
            return self.base_urls['epa']
            
    async def _find_fema_flood_url(self) -> str:
        """Find FEMA Flood Map URL for Brunswick"""
        try:
            # FEMA requires specific navigation
            # Start with the search page
            search_url = f"{self.base_urls['fema']}/portal/search"
            params = {
                'address': 'Brunswick, ME'
            }
            
            async with self.session.get(search_url, params=params) as response:
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Look for map link
                links = soup.find_all('a', href=re.compile(r'map'))
                if links:
                    return urljoin(self.base_urls['fema'], links[0]['href'])
                    
            # Fallback to base URL
            return self.base_urls['fema']
            
        except Exception as e:
            self.logger.error(f"Error finding FEMA flood URL: {str(e)}")
            return self.base_urls['fema']
            
    async def _find_nces_url(self) -> str:
        """Find NCES URL for Brunswick schools"""
        try:
            # Search for Brunswick schools
            search_url = f"{self.base_urls['nces']}/ccd/schoolsearch"
            params = {
                'q': 'Brunswick Maine'
            }
            
            async with self.session.get(search_url, params=params) as response:
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Look for school district link
                links = soup.find_all(
                    'a',
                    text=re.compile(r'Brunswick School Department', re.I)
                )
                if links:
                    return urljoin(self.base_urls['nces'], links[0]['href'])
                    
            # Fallback to base URL
            return self.base_urls['nces']
            
        except Exception as e:
            self.logger.error(f"Error finding NCES URL: {str(e)}")
            return self.base_urls['nces']
            
    async def _find_maine_doe_url(self) -> str:
        """Find Maine DOE URL for Brunswick schools"""
        try:
            # Search for Brunswick in dashboard
            search_url = f"{self.base_urls['maine_doe']}/dashboard/schools"
            params = {
                'district': 'Brunswick'
            }
            
            async with self.session.get(search_url, params=params) as response:
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Look for Brunswick schools link
                links = soup.find_all(
                    'a',
                    text=re.compile(r'Brunswick', re.I)
                )
                if links:
                    return urljoin(self.base_urls['maine_doe'], links[0]['href'])
                    
            # Fallback to dashboard
            return "https://www.maine.gov/doe/dashboard"
            
        except Exception as e:
            self.logger.error(f"Error finding Maine DOE URL: {str(e)}")
            return self.base_urls['maine_doe']
            
    def _is_valid_url(self, url: str) -> bool:
        """Validate URL format"""
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except Exception:
            return False
