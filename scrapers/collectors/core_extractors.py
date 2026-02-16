"""
Core extractors for essential property and business data
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional
from datetime import datetime
from .site_specific_extractors import BaseExtractor, ExtractedData
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class CoreBusinessExtractor(BaseExtractor):
    """Basic business information extractor"""
    
    async def can_handle(self, url: str) -> bool:
        return 'brunswickme.gov' in url and '/business' in url
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'business_name': None,
            'address': None,
            'owner': None,
            'property_use': None
        }
        
        try:
            if self.driver:
                # Basic business details
                business_element = self.driver.find_element(
                    By.CSS_SELECTOR,
                    "[class*='business-details']"
                )
                if business_element:
                    data['business_name'] = business_element.get_attribute('data-name')
                    data['address'] = business_element.get_attribute('data-address')
                    data['owner'] = business_element.get_attribute('data-owner')
                    data['property_use'] = business_element.get_attribute('data-use')
                    
            return ExtractedData(
                source="Brunswick",
                data_type="basic_business",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting basic business data: {e}")
            return None

class CorePropertyExtractor(BaseExtractor):
    """Essential property information extractor"""
    
    async def can_handle(self, url: str) -> bool:
        return ('brunswickme.gov' in url and 
                any(x in url for x in ['/property', '/assessment', '/tax-maps']))
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'address': None,
            'owner': None,
            'assessment': None,
            'tax_map': None,
            'last_sale': None
        }
        
        try:
            if self.driver:
                # Property details
                details = self.driver.find_element(
                    By.CSS_SELECTOR,
                    "[class*='property-details']"
                )
                if details:
                    data['address'] = details.get_attribute('data-address')
                    data['owner'] = details.get_attribute('data-owner')
                    data['assessment'] = details.get_attribute('data-assessment')
                    data['tax_map'] = details.get_attribute('data-map')
                    data['last_sale'] = {
                        'date': details.get_attribute('data-sale-date'),
                        'price': details.get_attribute('data-sale-price')
                    }
                    
            return ExtractedData(
                source="Brunswick",
                data_type="basic_property",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting basic property data: {e}")
            return None

class CoreMunicipalExtractor(BaseExtractor):
    """Basic municipal data extractor"""
    
    async def can_handle(self, url: str) -> bool:
        return 'brunswickme.gov' in url
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'zoning': None,
            'property_type': None,
            'last_updated': None
        }
        
        try:
            if self.driver:
                # Zoning information
                zoning = self.driver.find_element(
                    By.CSS_SELECTOR,
                    "[class*='zoning']"
                )
                if zoning:
                    data['zoning'] = zoning.get_attribute('data-zone')
                    data['property_type'] = zoning.get_attribute('data-type')
                    data['last_updated'] = zoning.get_attribute('data-updated')
                    
            return ExtractedData(
                source="Brunswick",
                data_type="basic_municipal",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting basic municipal data: {e}")
            return None
