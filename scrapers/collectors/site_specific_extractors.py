"""
Site-specific data extractors for common property and government websites
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional, Any
import re
from datetime import datetime
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

@dataclass
class ExtractedData:
    """Container for extracted data"""
    source: str
    data_type: str
    content: Any
    metadata: Dict
    timestamp: datetime = datetime.utcnow()

class BaseExtractor(ABC):
    """Base class for site-specific extractors"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        self.session = session
        self.driver = driver
        self.logger = logging.getLogger(__name__)
        
    @abstractmethod
    async def can_handle(self, url: str) -> bool:
        """Check if this extractor can handle the given URL"""
        pass
        
    @abstractmethod
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        """Extract data from the page"""
        pass

class VisionGovExtractor(BaseExtractor):
    """Extractor for Vision Government Solutions websites"""
    
    async def can_handle(self, url: str) -> bool:
        return 'vgsi.com' in url
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'property_info': {},
            'assessment': {},
            'sales': [],
            'building_info': {},
            'land_info': {}
        }
        
        try:
            # Property Information
            prop_info = soup.find('div', {'id': 'MainContent_lblGeneral'})
            if prop_info:
                data['property_info'] = self._extract_property_info(prop_info)
                
            # Assessment Information
            assess_info = soup.find('div', {'id': 'MainContent_lblAssess'})
            if assess_info:
                data['assessment'] = self._extract_assessment(assess_info)
                
            # Sales History
            sales_table = soup.find('table', {'id': 'MainContent_grdSales'})
            if sales_table:
                data['sales'] = self._extract_sales_history(sales_table)
                
            # Building Information
            building = soup.find('div', {'id': 'MainContent_lblBldg'})
            if building:
                data['building_info'] = self._extract_building_info(building)
                
            # Land Information
            land = soup.find('div', {'id': 'MainContent_lblLand'})
            if land:
                data['land_info'] = self._extract_land_info(land)
                
            return ExtractedData(
                source="VisionGov",
                data_type="property_details",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting Vision Gov data: {e}")
            return None
            
    def _extract_property_info(self, element) -> Dict:
        info = {}
        try:
            # Extract property details
            labels = element.find_all('td', {'class': 'DataletLabel'})
            values = element.find_all('td', {'class': 'DataletData'})
            
            for label, value in zip(labels, values):
                key = label.text.strip().lower().replace(' ', '_')
                info[key] = value.text.strip()
                
        except Exception as e:
            self.logger.error(f"Error extracting property info: {e}")
            
        return info

class MaineGovExtractor(BaseExtractor):
    """Extractor for Maine.gov websites"""
    
    async def can_handle(self, url: str) -> bool:
        return 'maine.gov' in url
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        if 'doe.maine.gov' in url:
            return await self._extract_education_data(url, soup)
        elif 'maine.gov/realestate' in url:
            return await self._extract_real_estate_data(url, soup)
        else:
            return await self._extract_general_data(url, soup)
            
    async def _extract_education_data(
        self,
        url: str,
        soup: BeautifulSoup
    ) -> ExtractedData:
        data = {
            'school_info': {},
            'performance_metrics': {},
            'enrollment': {},
            'staff': {}
        }
        
        try:
            # School Information
            school_info = soup.find('div', {'class': 'school-info'})
            if school_info:
                data['school_info'] = self._extract_school_details(school_info)
                
            # Performance Metrics
            metrics = soup.find('div', {'class': 'performance-metrics'})
            if metrics:
                data['performance_metrics'] = self._extract_performance(metrics)
                
            return ExtractedData(
                source="MaineGov",
                data_type="education_data",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting education data: {e}")
            return None

class MunicipalityExtractor(BaseExtractor):
    """Extractor for municipality websites"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        super().__init__(session, driver)
        self.municipality_patterns = {
            'brunswick': {
                'domain': 'brunswickme.gov',
                'tax_maps': r'/maps?|/gis|/tax-maps',
                'property': r'/property|/assessor|/real-estate',
                'permits': r'/permits|/building|/planning'
            },
            'portland': {
                'domain': 'portlandmaine.gov',
                'tax_maps': r'/tax-maps|/gis',
                'property': r'/assessor|/property',
                'permits': r'/permits|/inspections'
            }
            # Add more municipalities as needed
        }
        
    async def can_handle(self, url: str) -> bool:
        return any(
            pattern['domain'] in url 
            for pattern in self.municipality_patterns.values()
        )
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        # Identify municipality
        municipality = next(
            (name for name, pattern in self.municipality_patterns.items()
             if pattern['domain'] in url),
            None
        )
        
        if not municipality:
            return None
            
        # Determine content type
        patterns = self.municipality_patterns[municipality]
        content_type = next(
            (ctype for ctype, pattern in patterns.items()
             if re.search(pattern, url)),
            'general'
        )
        
        # Extract based on content type
        if content_type == 'tax_maps':
            return await self._extract_tax_maps(url, soup, municipality)
        elif content_type == 'property':
            return await self._extract_property_data(url, soup, municipality)
        elif content_type == 'permits':
            return await self._extract_permit_data(url, soup, municipality)
        else:
            return await self._extract_general_municipal(url, soup, municipality)
            
    async def _extract_tax_maps(
        self,
        url: str,
        soup: BeautifulSoup,
        municipality: str
    ) -> ExtractedData:
        data = {
            'maps': [],
            'layers': [],
            'metadata': {}
        }
        
        try:
            # Find map viewer
            map_viewer = soup.find(
                'div',
                {'class': lambda x: x and any(
                    term in x.lower()
                    for term in ['map', 'arcgis', 'gis-viewer']
                )}
            )
            
            if map_viewer:
                # Extract map configuration
                if 'arcgis' in str(map_viewer).lower():
                    data.update(await self._extract_arcgis_config(map_viewer))
                    
            # Find map links
            map_links = soup.find_all(
                'a',
                href=re.compile(r'\.(pdf|jpg|png)$')
            )
            for link in map_links:
                data['maps'].append({
                    'title': link.text.strip(),
                    'url': link['href'],
                    'type': link['href'].split('.')[-1]
                })
                
            return ExtractedData(
                source=f"{municipality.title()}Gov",
                data_type="tax_maps",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting tax maps: {e}")
            return None
            
    async def _extract_arcgis_config(self, element) -> Dict:
        """Extract ArcGIS configuration"""
        config = {
            'layers': [],
            'basemaps': [],
            'tools': []
        }
        
        try:
            # Look for configuration in scripts
            scripts = element.find_all('script')
            for script in scripts:
                script_text = script.string if script.string else ''
                
                # Look for layer definitions
                layer_match = re.search(
                    r'layers:\s*(\[.*?\])',
                    script_text,
                    re.DOTALL
                )
                if layer_match:
                    try:
                        layers = json.loads(layer_match.group(1))
                        config['layers'] = layers
                    except json.JSONDecodeError:
                        pass
                        
                # Look for basemap definitions
                basemap_match = re.search(
                    r'basemaps?:\s*(\[.*?\])',
                    script_text,
                    re.DOTALL
                )
                if basemap_match:
                    try:
                        basemaps = json.loads(basemap_match.group(1))
                        config['basemaps'] = basemaps
                    except json.JSONDecodeError:
                        pass
                        
        except Exception as e:
            self.logger.error(f"Error extracting ArcGIS config: {e}")
            
        return config

class AssessorExtractor(BaseExtractor):
    """Extractor for various assessor websites"""
    
    async def can_handle(self, url: str) -> bool:
        assessor_domains = [
            'vgsi.com',
            'patriotproperties.com',
            'municipalonlinepayments.com'
        ]
        return any(domain in url for domain in assessor_domains)
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        # Determine assessor system
        if 'vgsi.com' in url:
            return await self._extract_vgsi(url, soup)
        elif 'patriotproperties.com' in url:
            return await self._extract_patriot(url, soup)
        elif 'municipalonlinepayments.com' in url:
            return await self._extract_municipal_online(url, soup)
        return None
        
    async def _extract_vgsi(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        """Extract from Vision Government Solutions"""
        data = {
            'parcel': {},
            'owner': {},
            'assessment': {},
            'building': {},
            'land': {},
            'sales': []
        }
        
        try:
            if self.driver:
                # Wait for data to load
                WebDriverWait(self.driver, 10).until(
                    EC.presence_of_element_located(
                        (By.ID, "MainContent_lblGeneral")
                    )
                )
                # Update soup with rendered content
                soup = BeautifulSoup(self.driver.page_source, 'html.parser')
                
            # Extract parcel data
            parcel_div = soup.find('div', {'id': 'MainContent_lblGeneral'})
            if parcel_div:
                data['parcel'] = self._extract_vgsi_section(parcel_div)
                
            # Extract assessment data
            assessment_div = soup.find('div', {'id': 'MainContent_lblAssess'})
            if assessment_div:
                data['assessment'] = self._extract_vgsi_section(assessment_div)
                
            return ExtractedData(
                source="VGSI",
                data_type="property_assessment",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting VGSI data: {e}")
            return None
            
    def _extract_vgsi_section(self, section) -> Dict:
        """Extract data from a VGSI section"""
        data = {}
        try:
            rows = section.find_all('tr')
            for row in rows:
                label_cell = row.find('td', {'class': 'DataletLabel'})
                data_cell = row.find('td', {'class': 'DataletData'})
                if label_cell and data_cell:
                    key = label_cell.text.strip().lower().replace(' ', '_')
                    value = data_cell.text.strip()
                    data[key] = value
        except Exception as e:
            self.logger.error(f"Error extracting VGSI section: {e}")
        return data

class GISExtractor(BaseExtractor):
    """Extractor for GIS websites"""
    
    async def can_handle(self, url: str) -> bool:
        gis_patterns = [
            r'arcgis\.com',
            r'/gis/',
            r'gisweb',
            r'mapgeo\.com',
            r'mappingsupport\.com'
        ]
        return any(re.search(pattern, url) for pattern in gis_patterns)
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'map_data': {},
            'layers': [],
            'features': [],
            'metadata': {}
        }
        
        try:
            # Handle ArcGIS Online
            if 'arcgis.com' in url:
                return await self._extract_arcgis_online(url, soup)
                
            # Handle MapGeo
            if 'mapgeo.com' in url:
                return await self._extract_mapgeo(url, soup)
                
            # Handle general GIS viewers
            map_element = soup.find(
                ['div', 'iframe'],
                {'class': lambda x: x and 'map' in x.lower()}
            )
            
            if map_element:
                # Extract map configuration
                config = await self._extract_map_config(map_element)
                data['map_data'] = config
                
                # Extract layer information
                layers = await self._extract_layers(map_element)
                data['layers'] = layers
                
                # Extract feature data
                features = await self._extract_features(map_element)
                data['features'] = features
                
            return ExtractedData(
                source="GIS",
                data_type="map_data",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting GIS data: {e}")
            return None
            
    async def _extract_arcgis_online(
        self,
        url: str,
        soup: BeautifulSoup
    ) -> ExtractedData:
        """Extract from ArcGIS Online"""
        data = {
            'webmap': {},
            'layers': [],
            'features': []
        }
        
        try:
            if self.driver:
                # Wait for map to load
                WebDriverWait(self.driver, 10).until(
                    EC.presence_of_element_located(
                        (By.CLASS_NAME, "esri-view-surface")
                    )
                )
                
                # Extract webmap ID
                webmap_match = re.search(r'webmap=([a-f0-9]+)', url)
                if webmap_match:
                    webmap_id = webmap_match.group(1)
                    # Fetch webmap data
                    async with self.session.get(
                        f"https://www.arcgis.com/sharing/rest/content/items/{webmap_id}",
                        params={'f': 'json'}
                    ) as response:
                        if response.status == 200:
                            data['webmap'] = await response.json()
                            
                # Extract layer information
                layer_elements = self.driver.find_elements(
                    By.CLASS_NAME,
                    "esri-layer-list__item"
                )
                for element in layer_elements:
                    layer = {
                        'title': element.get_attribute('aria-label'),
                        'visible': element.get_attribute('aria-checked') == 'true'
                    }
                    data['layers'].append(layer)
                    
            return ExtractedData(
                source="ArcGISOnline",
                data_type="webmap",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting ArcGIS Online data: {e}")
            return None
            
    async def _extract_mapgeo(
        self,
        url: str,
        soup: BeautifulSoup
    ) -> ExtractedData:
        """Extract from MapGeo"""
        data = {
            'map_config': {},
            'layers': [],
            'features': []
        }
        
        try:
            if self.driver:
                # Wait for map to load
                WebDriverWait(self.driver, 10).until(
                    EC.presence_of_element_located(
                        (By.CLASS_NAME, "mapboxgl-map")
                    )
                )
                
                # Extract configuration
                scripts = soup.find_all('script')
                for script in scripts:
                    script_text = script.string if script.string else ''
                    config_match = re.search(
                        r'MapGeo\.config\s*=\s*({.*?});',
                        script_text,
                        re.DOTALL
                    )
                    if config_match:
                        try:
                            config = json.loads(config_match.group(1))
                            data['map_config'] = config
                        except json.JSONDecodeError:
                            pass
                            
                # Extract layers
                layer_elements = self.driver.find_elements(
                    By.CLASS_NAME,
                    "layer-item"
                )
                for element in layer_elements:
                    layer = {
                        'name': element.get_attribute('data-layer-name'),
                        'visible': element.get_attribute('data-visible') == 'true'
                    }
                    data['layers'].append(layer)
                    
            return ExtractedData(
                source="MapGeo",
                data_type="map_data",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting MapGeo data: {e}")
            return None
