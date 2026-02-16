"""
Tax Map Crawler - Discovers and navigates through tax maps automatically
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional, Set, Tuple
import re
from urllib.parse import urljoin, urlparse, parse_qs
import json
from dataclasses import dataclass
from datetime import datetime
import hashlib
import os
import pickle

@dataclass
class TaxMapMetadata:
    url: str
    map_id: str
    title: str
    area: str
    found_at: datetime
    parent_url: Optional[str] = None
    related_maps: List[str] = None
    features: Dict = None

@dataclass
class MapNavigationState:
    visited_urls: Set[str]
    pending_urls: Set[str]
    found_maps: Dict[str, TaxMapMetadata]
    base_domain: str

class TaxMapCrawler:
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.session = None
        self.cache_dir = config.get('cache_dir', 'cache/tax_maps')
        self.state_file = os.path.join(self.cache_dir, 'crawler_state.pkl')
        self.map_patterns = [
            r'tax[_\s-]*map',
            r'parcel[_\s-]*map',
            r'property[_\s-]*map',
            r'assessor[_\s-]*map',
            r'lot[_\s-]*map'
        ]
        self.max_depth = config.get('max_crawl_depth', 5)
        self.max_maps = config.get('max_maps', 1000)
        os.makedirs(self.cache_dir, exist_ok=True)
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    def _load_state(self) -> Optional[MapNavigationState]:
        """Load saved crawler state"""
        try:
            if os.path.exists(self.state_file):
                with open(self.state_file, 'rb') as f:
                    return pickle.load(f)
        except Exception as e:
            self.logger.warning(f"Could not load state: {e}")
        return None
        
    def _save_state(self, state: MapNavigationState):
        """Save crawler state"""
        try:
            with open(self.state_file, 'wb') as f:
                pickle.dump(state, f)
        except Exception as e:
            self.logger.error(f"Could not save state: {e}")
            
    async def discover_tax_maps(self, start_url: str) -> Dict[str, TaxMapMetadata]:
        """
        Discover all related tax maps starting from a given URL
        
        Args:
            start_url: Initial tax map URL to start crawling from
            
        Returns:
            Dictionary of discovered map URLs and their metadata
        """
        try:
            # Parse base domain
            parsed = urlparse(start_url)
            base_domain = f"{parsed.scheme}://{parsed.netloc}"
            
            # Initialize or load state
            state = self._load_state() or MapNavigationState(
                visited_urls=set(),
                pending_urls={start_url},
                found_maps={},
                base_domain=base_domain
            )
            
            depth = 0
            while state.pending_urls and depth < self.max_depth:
                current_urls = state.pending_urls.copy()
                state.pending_urls.clear()
                
                # Process current batch of URLs
                tasks = [
                    self._process_url(url, state)
                    for url in current_urls
                    if url not in state.visited_urls
                ]
                
                if tasks:
                    await asyncio.gather(*tasks)
                    
                depth += 1
                
                # Save state after each batch
                self._save_state(state)
                
                if len(state.found_maps) >= self.max_maps:
                    self.logger.info(f"Reached max maps limit: {self.max_maps}")
                    break
                    
            return state.found_maps
            
        except Exception as e:
            self.logger.error(f"Error discovering tax maps: {e}")
            raise
            
    async def _process_url(self, url: str, state: MapNavigationState):
        """Process a single URL for tax map discovery"""
        try:
            if url in state.visited_urls:
                return
                
            self.logger.debug(f"Processing URL: {url}")
            
            async with self.session.get(url) as response:
                if response.status != 200:
                    return
                    
                text = await response.text()
                soup = BeautifulSoup(text, 'html.parser')
                
                # Check if current page is a tax map
                if await self._is_tax_map(url, soup):
                    metadata = await self._extract_map_metadata(url, soup)
                    state.found_maps[url] = metadata
                    
                # Find related maps and navigation links
                await self._find_related_links(url, soup, state)
                
            state.visited_urls.add(url)
            
        except Exception as e:
            self.logger.error(f"Error processing URL {url}: {e}")
            
    async def _is_tax_map(self, url: str, soup: BeautifulSoup) -> bool:
        """Determine if a page is a tax map"""
        try:
            # Check URL patterns
            url_lower = url.lower()
            if any(re.search(pattern, url_lower) for pattern in self.map_patterns):
                return True
                
            # Check page title
            title = soup.title.string.lower() if soup.title else ""
            if any(re.search(pattern, title) for pattern in self.map_patterns):
                return True
                
            # Check for map viewers or embedded maps
            map_elements = soup.find_all(['iframe', 'div', 'object'], {
                'class': lambda x: x and any(
                    word in x.lower() 
                    for word in ['map', 'viewer', 'arcgis', 'gis']
                )
            })
            if map_elements:
                return True
                
            # Check for map-related text content
            content = soup.get_text().lower()
            map_indicators = [
                'parcel', 'lot', 'tax map', 'property map',
                'assessor', 'zoning', 'boundary'
            ]
            if any(indicator in content for indicator in map_indicators):
                return True
                
            return False
            
        except Exception as e:
            self.logger.error(f"Error checking tax map: {e}")
            return False
            
    async def _extract_map_metadata(
        self,
        url: str,
        soup: BeautifulSoup
    ) -> TaxMapMetadata:
        """Extract metadata from a tax map page"""
        try:
            # Extract title
            title = soup.title.string if soup.title else ""
            
            # Try to find map ID
            map_id = self._extract_map_id(url, soup)
            
            # Try to determine area
            area = self._extract_area(url, soup)
            
            # Look for related maps
            related_maps = await self._find_related_maps(url, soup)
            
            # Extract any special features
            features = self._extract_features(soup)
            
            return TaxMapMetadata(
                url=url,
                map_id=map_id,
                title=title,
                area=area,
                found_at=datetime.utcnow(),
                related_maps=related_maps,
                features=features
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting metadata: {e}")
            return TaxMapMetadata(
                url=url,
                map_id="unknown",
                title="unknown",
                area="unknown",
                found_at=datetime.utcnow()
            )
            
    def _extract_map_id(self, url: str, soup: BeautifulSoup) -> str:
        """Extract map ID from URL or content"""
        try:
            # Check URL for map ID
            url_match = re.search(r'map[_-]?(\d+)', url, re.I)
            if url_match:
                return url_match.group(1)
                
            # Check content for map ID
            content = soup.get_text()
            content_match = re.search(
                r'(?:tax|parcel|property)\s*map\s*#?\s*(\d+)',
                content,
                re.I
            )
            if content_match:
                return content_match.group(1)
                
            # Generate hash-based ID if nothing found
            return hashlib.md5(url.encode()).hexdigest()[:8]
            
        except Exception as e:
            self.logger.error(f"Error extracting map ID: {e}")
            return "unknown"
            
    def _extract_area(self, url: str, soup: BeautifulSoup) -> str:
        """Extract area information from map"""
        try:
            # Look for area in text
            content = soup.get_text()
            area_patterns = [
                r'(?:area|district|zone|section)\s*:\s*([^\.]+)',
                r'(?:located in|location):\s*([^\.]+)'
            ]
            
            for pattern in area_patterns:
                match = re.search(pattern, content, re.I)
                if match:
                    return match.group(1).strip()
                    
            return "unknown"
            
        except Exception as e:
            self.logger.error(f"Error extracting area: {e}")
            return "unknown"
            
    async def _find_related_maps(
        self,
        url: str,
        soup: BeautifulSoup
    ) -> List[str]:
        """Find related map links"""
        related = []
        try:
            # Find links that look like maps
            for link in soup.find_all('a', href=True):
                href = link.get('href')
                if not href:
                    continue
                    
                full_url = urljoin(url, href)
                if any(re.search(pattern, full_url, re.I) 
                      for pattern in self.map_patterns):
                    related.append(full_url)
                    
        except Exception as e:
            self.logger.error(f"Error finding related maps: {e}")
            
        return related
        
    def _extract_features(self, soup: BeautifulSoup) -> Dict:
        """Extract special features from map page"""
        features = {}
        try:
            # Look for interactive elements
            if soup.find_all(['iframe', 'canvas']):
                features['interactive'] = True
                
            # Check for download options
            if soup.find_all('a', href=re.compile(r'\.(pdf|jpg|png)$')):
                features['downloadable'] = True
                
            # Check for search functionality
            if soup.find_all(['input', 'form']):
                features['searchable'] = True
                
        except Exception as e:
            self.logger.error(f"Error extracting features: {e}")
            
        return features
        
    async def _find_related_links(
        self,
        url: str,
        soup: BeautifulSoup,
        state: MapNavigationState
    ):
        """Find and add related links to pending URLs"""
        try:
            # Find all links
            for link in soup.find_all('a', href=True):
                href = link.get('href')
                if not href:
                    continue
                    
                # Convert to absolute URL
                full_url = urljoin(url, href)
                parsed = urlparse(full_url)
                
                # Skip if different domain
                if parsed.netloc and parsed.netloc not in state.base_domain:
                    continue
                    
                # Skip if already visited
                if full_url in state.visited_urls:
                    continue
                    
                # Skip non-web URLs
                if not parsed.scheme in ['http', 'https']:
                    continue
                    
                # Add to pending URLs
                state.pending_urls.add(full_url)
                
        except Exception as e:
            self.logger.error(f"Error finding related links: {e}")
            
    async def analyze_map_relationships(
        self,
        maps: Dict[str, TaxMapMetadata]
    ) -> Dict:
        """Analyze relationships between discovered maps"""
        try:
            relationships = {
                'adjacent_maps': [],  # Maps that appear to be adjacent
                'hierarchical': [],   # Parent-child relationships
                'connected': []       # Maps connected by common features
            }
            
            # Find adjacent maps based on ID patterns
            map_ids = [(m.map_id, url) for url, m in maps.items()]
            map_ids.sort()
            
            for i in range(len(map_ids) - 1):
                current_id, current_url = map_ids[i]
                next_id, next_url = map_ids[i + 1]
                
                try:
                    if (int(next_id) - int(current_id)) == 1:
                        relationships['adjacent_maps'].append(
                            (current_url, next_url)
                        )
                except ValueError:
                    continue
                    
            # Find hierarchical relationships
            for url, metadata in maps.items():
                if metadata.parent_url and metadata.parent_url in maps:
                    relationships['hierarchical'].append(
                        (metadata.parent_url, url)
                    )
                    
            # Find connected maps
            for url1, m1 in maps.items():
                for url2, m2 in maps.items():
                    if url1 != url2 and m1.area == m2.area:
                        relationships['connected'].append((url1, url2))
                        
            return relationships
            
        except Exception as e:
            self.logger.error(f"Error analyzing map relationships: {e}")
            return {}
