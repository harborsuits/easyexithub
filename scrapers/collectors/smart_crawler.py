"""
Smart Crawler - Intelligent web crawler with advanced detection and data extraction
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional, Set, Tuple, Any
import re
from urllib.parse import urljoin, urlparse, parse_qs
import json
from dataclasses import dataclass, field
from datetime import datetime
import hashlib
import os
import pickle
import networkx as nx
import matplotlib.pyplot as plt
from PIL import Image
import io
import pytesseract
import pandas as pd
import numpy as np
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

@dataclass
class PageFeatures:
    """Features detected on a webpage"""
    has_tables: bool = False
    has_forms: bool = False
    has_maps: bool = False
    has_downloads: bool = False
    has_search: bool = False
    has_pagination: bool = False
    has_api_endpoints: bool = False
    interactive_elements: List[str] = field(default_factory=list)
    data_sources: List[str] = field(default_factory=list)
    frameworks_detected: List[str] = field(default_factory=list)

@dataclass
class PageData:
    """Data extracted from a webpage"""
    url: str
    title: str
    content_type: str
    features: PageFeatures
    extracted_data: Dict[str, Any]
    related_pages: List[str]
    timestamp: datetime
    metadata: Dict[str, Any] = field(default_factory=dict)

class DataExtractor:
    """Extracts structured data from various sources"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        
    async def extract_table_data(self, soup: BeautifulSoup) -> List[Dict]:
        """Extract data from HTML tables"""
        tables = []
        for table in soup.find_all('table'):
            try:
                # Convert table to pandas DataFrame
                df = pd.read_html(str(table))[0]
                tables.append(df.to_dict('records'))
            except Exception as e:
                self.logger.error(f"Error extracting table data: {e}")
        return tables
        
    async def extract_form_data(self, soup: BeautifulSoup) -> Dict:
        """Extract form structure and fields"""
        forms = []
        for form in soup.find_all('form'):
            form_data = {
                'action': form.get('action'),
                'method': form.get('method', 'get'),
                'fields': []
            }
            
            for input_field in form.find_all(['input', 'select', 'textarea']):
                field = {
                    'type': input_field.get('type', 'text'),
                    'name': input_field.get('name'),
                    'id': input_field.get('id'),
                    'required': input_field.has_attr('required')
                }
                form_data['fields'].append(field)
                
            forms.append(form_data)
        return forms
        
    async def extract_map_data(self, soup: BeautifulSoup, url: str) -> Dict:
        """Extract data from map elements"""
        maps = []
        
        # ArcGIS detection
        arcgis_elements = soup.find_all(
            'div',
            {'class': lambda x: x and 'arcgis' in x.lower()}
        )
        if arcgis_elements:
            maps.append({
                'type': 'arcgis',
                'elements': len(arcgis_elements)
            })
            
        # Google Maps detection
        if 'maps.google.com' in str(soup) or 'google.com/maps' in str(soup):
            maps.append({
                'type': 'google_maps',
                'embed': soup.find('iframe', {'src': re.compile(r'google.com/maps')}) is not None
            })
            
        # Leaflet detection
        if soup.find_all('div', {'class': 'leaflet-container'}):
            maps.append({
                'type': 'leaflet',
                'elements': len(soup.find_all('div', {'class': 'leaflet-container'}))
            })
            
        return maps
        
    async def extract_api_endpoints(self, soup: BeautifulSoup, url: str) -> List[str]:
        """Extract potential API endpoints"""
        endpoints = []
        
        # Look for API references in scripts
        scripts = soup.find_all('script')
        for script in scripts:
            script_text = script.string if script.string else ''
            # Look for API URL patterns
            api_patterns = [
                r'api/[\w/]+',
                r'v\d+/[\w/]+',
                r'rest/[\w/]+',
                r'graphql'
            ]
            for pattern in api_patterns:
                matches = re.findall(pattern, script_text)
                endpoints.extend(matches)
                
        return list(set(endpoints))
        
    async def extract_text_with_ocr(self, image_url: str) -> str:
        """Extract text from images using OCR"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(image_url) as response:
                    if response.status == 200:
                        image_data = await response.read()
                        image = Image.open(io.BytesIO(image_data))
                        return pytesseract.image_to_string(image)
        except Exception as e:
            self.logger.error(f"Error performing OCR: {e}")
        return ""

class FrameworkDetector:
    """Detects web frameworks and technologies used"""
    
    def __init__(self):
        self.frameworks = {
            'react': [
                'react.development.js',
                'react.production.min.js',
                '_reactjs_'
            ],
            'angular': [
                'ng-app',
                'angular.js',
                'ng-controller'
            ],
            'vue': [
                'vue.js',
                'v-bind',
                'v-model'
            ],
            'jquery': [
                'jquery.js',
                'jquery.min.js'
            ],
            'bootstrap': [
                'bootstrap.css',
                'bootstrap.min.css'
            ]
        }
        
    def detect(self, soup: BeautifulSoup) -> List[str]:
        """Detect frameworks used in the page"""
        detected = []
        page_text = str(soup)
        
        for framework, patterns in self.frameworks.items():
            if any(pattern in page_text for pattern in patterns):
                detected.append(framework)
                
        return detected

class SmartCrawler:
    """Intelligent web crawler with advanced detection and data extraction"""
    
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.cache_dir = config.get('cache_dir', 'cache/crawler')
        self.state_file = os.path.join(self.cache_dir, 'crawler_state.pkl')
        self.max_depth = config.get('max_depth', 5)
        self.max_pages = config.get('max_pages', 1000)
        self.session = None
        self.data_extractor = DataExtractor()
        self.framework_detector = FrameworkDetector()
        self.graph = nx.DiGraph()
        os.makedirs(self.cache_dir, exist_ok=True)
        
        # Initialize specialized extractors
        self.specialized_extractors = [
            VisionGovExtractor(None),  # Session will be set in __aenter__
            MaineGovExtractor(None),
            MunicipalityExtractor(None),
            AssessorExtractor(None),
            GISExtractor(None)
        ]
        
        # Initialize headless browser if needed
        if config.get('use_selenium', False):
            chrome_options = Options()
            chrome_options.add_argument('--headless')
            chrome_options.add_argument('--disable-gpu')
            self.driver = webdriver.Chrome(options=chrome_options)
        else:
            self.driver = None
            
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        
        # Update sessions for specialized extractors
        for extractor in self.specialized_extractors:
            extractor.session = self.session
            if self.driver:
                extractor.driver = self.driver
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
        if self.driver:
            self.driver.quit()
            
    async def crawl(self, start_url: str) -> Dict[str, PageData]:
        """
        Crawl website starting from given URL
        
        Args:
            start_url: Initial URL to start crawling from
            
        Returns:
            Dictionary of discovered pages and their data
        """
        try:
            visited_urls = set()
            pending_urls = {start_url}
            pages_data = {}
            
            parsed = urlparse(start_url)
            base_domain = f"{parsed.scheme}://{parsed.netloc}"
            
            depth = 0
            while pending_urls and depth < self.max_depth:
                current_urls = pending_urls.copy()
                pending_urls.clear()
                
                # Process current batch of URLs
                tasks = [
                    self._process_url(url, base_domain)
                    for url in current_urls
                    if url not in visited_urls
                ]
                
                if tasks:
                    results = await asyncio.gather(*tasks)
                    for url, page_data in results:
                        if page_data:
                            pages_data[url] = page_data
                            visited_urls.add(url)
                            # Add new URLs to pending
                            pending_urls.update(
                                url for url in page_data.related_pages
                                if url not in visited_urls
                            )
                            
                depth += 1
                
                if len(pages_data) >= self.max_pages:
                    self.logger.info(f"Reached max pages limit: {self.max_pages}")
                    break
                    
            # Build relationship graph
            self._build_graph(pages_data)
            
            return pages_data
            
        except Exception as e:
            self.logger.error(f"Error during crawl: {e}")
            raise
            
    async def _process_url(
        self,
        url: str,
        base_domain: str
    ) -> Tuple[str, Optional[PageData]]:
        """Process a single URL"""
        try:
            # Check if URL is from same domain
            if not url.startswith(base_domain):
                return url, None
                
            # Fetch page content
            if self.driver and self.config.get('use_selenium', False):
                page_content = await self._fetch_with_selenium(url)
            else:
                async with self.session.get(url) as response:
                    if response.status != 200:
                        return url, None
                    page_content = await response.text()
                    
            soup = BeautifulSoup(page_content, 'html.parser')
            
            # Detect page features
            features = await self._detect_features(soup, url)
            
            # Extract data based on features
            extracted_data = await self._extract_data(soup, url, features)
            
            # Find related pages
            related_pages = await self._find_related_pages(soup, url, base_domain)
            
            # Create page data
            page_data = PageData(
                url=url,
                title=soup.title.string if soup.title else "",
                content_type=self._detect_content_type(soup),
                features=features,
                extracted_data=extracted_data,
                related_pages=related_pages,
                timestamp=datetime.utcnow()
            )
            
            return url, page_data
            
        except Exception as e:
            self.logger.error(f"Error processing URL {url}: {e}")
            return url, None
            
    async def _fetch_with_selenium(self, url: str) -> str:
        """Fetch page content using Selenium for JavaScript rendering"""
        try:
            self.driver.get(url)
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            return self.driver.page_source
        except Exception as e:
            self.logger.error(f"Error fetching with Selenium: {e}")
            return ""
            
    async def _detect_features(
        self,
        soup: BeautifulSoup,
        url: str
    ) -> PageFeatures:
        """Detect features present on the page"""
        features = PageFeatures()
        
        # Detect tables
        features.has_tables = bool(soup.find_all('table'))
        
        # Detect forms
        features.has_forms = bool(soup.find_all('form'))
        
        # Detect maps
        maps_detected = await self.data_extractor.extract_map_data(soup, url)
        features.has_maps = bool(maps_detected)
        
        # Detect downloads
        features.has_downloads = bool(
            soup.find_all('a', href=re.compile(r'\.(pdf|doc|csv|xlsx?|zip)$'))
        )
        
        # Detect search functionality
        features.has_search = bool(
            soup.find_all('input', {'type': 'search'}) or
            soup.find_all('form', {'role': 'search'})
        )
        
        # Detect pagination
        features.has_pagination = bool(
            soup.find_all('div', {'class': re.compile(r'pagination|pager')})
        )
        
        # Detect API endpoints
        api_endpoints = await self.data_extractor.extract_api_endpoints(soup, url)
        features.has_api_endpoints = bool(api_endpoints)
        
        # Detect interactive elements
        features.interactive_elements = [
            elem.name for elem in soup.find_all(['button', 'select', 'input'])
        ]
        
        # Detect frameworks
        features.frameworks_detected = self.framework_detector.detect(soup)
        
        return features
        
    async def _extract_data(
        self,
        soup: BeautifulSoup,
        url: str,
        features: PageFeatures
    ) -> Dict:
        """Extract data based on detected features"""
        data = {}
        
        # Extract table data
        if features.has_tables:
            data['tables'] = await self.data_extractor.extract_table_data(soup)
            
        # Extract form data
        if features.has_forms:
            data['forms'] = await self.data_extractor.extract_form_data(soup)
            
        # Extract map data
        if features.has_maps:
            data['maps'] = await self.data_extractor.extract_map_data(soup, url)
            
        # Extract API endpoints
        if features.has_api_endpoints:
            data['api_endpoints'] = await self.data_extractor.extract_api_endpoints(
                soup,
                url
            )
            
        # Extract text from images
        images = soup.find_all('img')
        if images:
            data['image_text'] = {}
            for img in images[:5]:  # Limit to first 5 images
                if 'src' in img.attrs:
                    img_url = urljoin(url, img['src'])
                    text = await self.data_extractor.extract_text_with_ocr(img_url)
                    if text:
                        data['image_text'][img_url] = text
                        
        return data
        
    async def _find_related_pages(
        self,
        soup: BeautifulSoup,
        url: str,
        base_domain: str
    ) -> List[str]:
        """Find related pages from the current page"""
        related = []
        
        for link in soup.find_all('a', href=True):
            href = link.get('href')
            if not href:
                continue
                
            full_url = urljoin(url, href)
            parsed = urlparse(full_url)
            
            # Skip if different domain
            if parsed.netloc and parsed.netloc not in base_domain:
                continue
                
            # Skip non-web URLs
            if not parsed.scheme in ['http', 'https']:
                continue
                
            related.append(full_url)
            
        return related
        
    def _detect_content_type(self, soup: BeautifulSoup) -> str:
        """Detect the type of content on the page"""
        # Check for common page types
        if soup.find('article'):
            return 'article'
        elif soup.find('form'):
            return 'form'
        elif soup.find('table'):
            return 'data'
        elif soup.find('div', {'class': re.compile(r'map|arcgis')}):
            return 'map'
        else:
            return 'general'
            
    def _build_graph(self, pages_data: Dict[str, PageData]):
        """Build a graph of page relationships"""
        for url, data in pages_data.items():
            self.graph.add_node(
                url,
                title=data.title,
                content_type=data.content_type
            )
            for related in data.related_pages:
                if related in pages_data:
                    self.graph.add_edge(url, related)
                    
    def visualize_graph(self, output_file: str = 'site_graph.png'):
        """Visualize the page relationship graph"""
        plt.figure(figsize=(12, 8))
        pos = nx.spring_layout(self.graph)
        
        # Draw nodes
        nx.draw_networkx_nodes(
            self.graph,
            pos,
            node_color='lightblue',
            node_size=500
        )
        
        # Draw edges
        nx.draw_networkx_edges(
            self.graph,
            pos,
            edge_color='gray',
            arrows=True
        )
        
        # Add labels
        labels = nx.get_node_attributes(self.graph, 'title')
        nx.draw_networkx_labels(self.graph, pos, labels)
        
        plt.title("Website Structure Graph")
        plt.axis('off')
        plt.savefig(output_file)
        plt.close()
        
    def export_data(self, output_dir: str):
        """Export collected data to various formats"""
        os.makedirs(output_dir, exist_ok=True)
        
        # Export graph
        self.visualize_graph(os.path.join(output_dir, 'site_graph.png'))
        
        # Export node and edge lists
        nx.write_edgelist(
            self.graph,
            os.path.join(output_dir, 'edges.csv'),
            delimiter=','
        )
        
        # Export node attributes
        with open(os.path.join(output_dir, 'nodes.json'), 'w') as f:
            json.dump(
                dict(self.graph.nodes(data=True)),
                f,
                indent=2
            )
