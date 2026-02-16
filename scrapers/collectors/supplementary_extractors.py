"""
Supplementary extractors for additional data sources
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
import json
from dataclasses import dataclass
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from .site_specific_extractors import BaseExtractor, ExtractedData

class BusinessExtractor(BaseExtractor):
    """Extractor for business-related information"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        super().__init__(session, driver)
        self.sources = {
            'maine.gov': {
                'licenses': '/business-licensing',
                'corporations': '/corporation-search',
                'taxes': '/business-tax'
            },
            'brunswickme.gov': {
                'permits': '/business-permits',
                'zoning': '/business-zones',
                'directory': '/business-directory'
            },
            'mainebiz.biz': {
                'news': '/business-news',
                'directory': '/business-directory'
            }
        }
        
    async def can_handle(self, url: str) -> bool:
        return any(domain in url for domain in self.sources.keys())
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'business_info': {},
            'licenses': [],
            'permits': [],
            'tax_records': [],
            'zoning': {},
            'history': []
        }
        
        try:
            if self.driver:
                # Extract business licenses
                data['licenses'] = await self._extract_licenses()
                
                # Extract permits
                data['permits'] = await self._extract_permits()
                
                # Extract tax records
                data['tax_records'] = await self._extract_tax_records()
                
                # Extract zoning information
                data['zoning'] = await self._extract_zoning()
                
                # Extract business history
                data['history'] = await self._extract_business_history()
                
            return ExtractedData(
                source="Business",
                data_type="business_details",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting business data: {e}")
            return None

class RegulatoryExtractor(BaseExtractor):
    """Extractor for legal and regulatory information"""
    
    async def can_handle(self, url: str) -> bool:
        regulatory_domains = [
            'maine.gov/dep',
            'brunswickme.gov/codes',
            'mainelegislature.org'
        ]
        return any(domain in url for domain in regulatory_domains)
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'violations': [],
            'compliance': {},
            'preservation': {},
            'restrictions': [],
            'permits': []
        }
        
        try:
            if self.driver:
                # Extract code violations
                data['violations'] = await self._extract_violations()
                
                # Extract compliance history
                data['compliance'] = await self._extract_compliance()
                
                # Extract preservation requirements
                data['preservation'] = await self._extract_preservation()
                
                # Extract property restrictions
                data['restrictions'] = await self._extract_restrictions()
                
            return ExtractedData(
                source="Regulatory",
                data_type="compliance_data",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting regulatory data: {e}")
            return None

class InfrastructureExtractor(BaseExtractor):
    """Extractor for infrastructure information"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        super().__init__(session, driver)
        self.utility_providers = {
            'water': ['brunswickmaine.org/water'],
            'power': ['cmpco.com'],
            'internet': ['spectrum.com', 'consolidated.com']
        }
        
    async def can_handle(self, url: str) -> bool:
        return any(
            provider in url 
            for providers in self.utility_providers.values() 
            for provider in providers
        )
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'utilities': {},
            'transportation': {},
            'maintenance': [],
            'future_plans': [],
            'service_areas': {}
        }
        
        try:
            if self.driver:
                # Extract utility information
                data['utilities'] = await self._extract_utilities()
                
                # Extract transportation data
                data['transportation'] = await self._extract_transportation()
                
                # Extract maintenance schedules
                data['maintenance'] = await self._extract_maintenance()
                
                # Extract future infrastructure plans
                data['future_plans'] = await self._extract_future_plans()
                
                # Extract service area information
                data['service_areas'] = await self._extract_service_areas()
                
            return ExtractedData(
                source="Infrastructure",
                data_type="infrastructure_data",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting infrastructure data: {e}")
            return None

class DemographicExtractor(BaseExtractor):
    """Enhanced extractor for demographic information"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        super().__init__(session, driver)
        self.data_sources = {
            'census.gov': {
                'income': '/income',
                'employment': '/employment',
                'population': '/population'
            },
            'bls.gov': {
                'employment': '/employment',
                'wages': '/wages',
                'industries': '/industries'
            },
            'maine.gov': {
                'demographics': '/demographics',
                'economy': '/economy'
            }
        }
        
    async def can_handle(self, url: str) -> bool:
        return any(domain in url for domain in self.data_sources.keys())
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'income': {},
            'employment': {},
            'population': {},
            'migration': {},
            'consumer_data': {}
        }
        
        try:
            if self.driver:
                # Extract income distribution
                data['income'] = await self._extract_income_data()
                
                # Extract employment trends
                data['employment'] = await self._extract_employment_data()
                
                # Extract population data
                data['population'] = await self._extract_population_data()
                
                # Extract migration patterns
                data['migration'] = await self._extract_migration_data()
                
                # Extract consumer behavior
                data['consumer_data'] = await self._extract_consumer_data()
                
            return ExtractedData(
                source="Demographics",
                data_type="demographic_data",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting demographic data: {e}")
            return None

class DevelopmentExtractor(BaseExtractor):
    """Extractor for development plans and projects"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        super().__init__(session, driver)
        self.planning_sources = {
            'brunswickme.gov': {
                'planning': '/planning',
                'development': '/development',
                'projects': '/projects'
            },
            'maine.gov': {
                'development': '/development',
                'planning': '/planning'
            }
        }
        
    async def can_handle(self, url: str) -> bool:
        return any(domain in url for domain in self.planning_sources.keys())
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'construction': [],
            'zoning_changes': [],
            'public_works': [],
            'economic_dev': {},
            'urban_renewal': []
        }
        
        try:
            if self.driver:
                # Extract construction projects
                data['construction'] = await self._extract_construction()
                
                # Extract zoning changes
                data['zoning_changes'] = await self._extract_zoning_changes()
                
                # Extract public works projects
                data['public_works'] = await self._extract_public_works()
                
                # Extract economic development
                data['economic_dev'] = await self._extract_economic_dev()
                
                # Extract urban renewal plans
                data['urban_renewal'] = await self._extract_urban_renewal()
                
            return ExtractedData(
                source="Development",
                data_type="development_plans",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting development data: {e}")
            return None
            
    async def _extract_construction(self) -> List[Dict]:
        """Extract information about construction projects"""
        projects = []
        try:
            elements = self.driver.find_elements(
                By.CSS_SELECTOR,
                "[class*='project'], [class*='construction']"
            )
            for element in elements:
                project = {
                    'name': element.get_attribute('data-name'),
                    'status': element.get_attribute('data-status'),
                    'start_date': element.get_attribute('data-start'),
                    'end_date': element.get_attribute('data-end'),
                    'description': element.text,
                    'location': element.get_attribute('data-location'),
                    'type': element.get_attribute('data-type'),
                    'value': element.get_attribute('data-value')
                }
                projects.append(project)
                
        except Exception as e:
            self.logger.error(f"Error extracting construction data: {e}")
            
        return projects
