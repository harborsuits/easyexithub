"""
Collector for federal data sources (Census, FEMA, EPA, NCES)
"""
import aiohttp
import asyncio
import logging
from typing import Dict, List, Optional
import json
from datetime import datetime

class FederalDataCollector:
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.cache_dir = config.get('cache_dir', 'cache')
        self.session = None
        
        # API Keys should be in config
        self.census_api_key = config.get('census_api_key')
        
        # Brunswick, ME specific identifiers
        self.geo_ids = {
            'state': '23',  # Maine
            'county': '005',  # Cumberland County
            'place': '08395',  # Brunswick
            'tract': '*'  # All census tracts
        }
        
        # Base URLs
        self.urls = {
            'census': 'https://api.census.gov/data',
            'fema': 'https://www.fema.gov/api/open',
            'epa': 'https://data.epa.gov/efservice',
            'nces': 'https://api.nces.ed.gov/api/v1'
        }
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def get_census_data(self) -> Dict:
        """Get relevant ACS 5-year data for Brunswick"""
        data = {
            'demographics': {},
            'housing': {},
            'economic': {},
            'social': {}
        }
        
        try:
            # Demographics (population, age, race)
            demographics = await self._fetch_acs_data([
                'B01001_001E',  # Total population
                'B01002_001E',  # Median age
                'B02001_001E',  # Race
                'B03003_001E'   # Hispanic or Latino origin
            ])
            if demographics:
                data['demographics'] = demographics
                
            # Housing (units, occupancy, value)
            housing = await self._fetch_acs_data([
                'B25001_001E',  # Housing units
                'B25002_001E',  # Occupancy status
                'B25077_001E'   # Median home value
            ])
            if housing:
                data['housing'] = housing
                
            # Economic (income, employment)
            economic = await self._fetch_acs_data([
                'B19013_001E',  # Median household income
                'B23025_001E',  # Employment status
                'B19301_001E'   # Per capita income
            ])
            if economic:
                data['economic'] = economic
                
        except Exception as e:
            self.logger.error(f"Error getting Census data: {e}")
            
        return data
        
    async def get_fema_data(self) -> Dict:
        """Get FEMA flood and hazard data for Brunswick area"""
        data = {
            'flood_zones': [],
            'disaster_declarations': [],
            'hazard_mitigation': {}
        }
        
        try:
            # Get flood zone data
            async with self.session.get(
                f"{self.urls['fema']}/fimaNfipPolicies",
                params={
                    'state': 'ME',
                    'county': 'Cumberland',
                    'community': 'Brunswick'
                }
            ) as response:
                if response.status == 200:
                    flood_data = await response.json()
                    data['flood_zones'] = flood_data.get('features', [])
                    
            # Get disaster declarations
            async with self.session.get(
                f"{self.urls['fema']}/DisasterDeclarationsSummaries",
                params={
                    'state': 'ME',
                    'countyCode': self.geo_ids['county']
                }
            ) as response:
                if response.status == 200:
                    disaster_data = await response.json()
                    data['disaster_declarations'] = disaster_data.get('features', [])
                    
        except Exception as e:
            self.logger.error(f"Error getting FEMA data: {e}")
            
        return data
        
    async def get_epa_data(self) -> Dict:
        """Get EPA environmental data for Brunswick area"""
        data = {
            'air_quality': {},
            'water_quality': {},
            'hazard_sites': []
        }
        
        try:
            # Get air quality data
            async with self.session.get(
                f"{self.urls['epa']}/airquality",
                params={
                    'state': 'ME',
                    'county': 'Cumberland',
                    'city': 'Brunswick'
                }
            ) as response:
                if response.status == 200:
                    air_data = await response.json()
                    data['air_quality'] = air_data
                    
            # Get water system data
            async with self.session.get(
                f"{self.urls['epa']}/water_systems",
                params={
                    'state': 'ME',
                    'county': 'Cumberland',
                    'city': 'Brunswick'
                }
            ) as response:
                if response.status == 200:
                    water_data = await response.json()
                    data['water_quality'] = water_data
                    
        except Exception as e:
            self.logger.error(f"Error getting EPA data: {e}")
            
        return data
        
    async def get_school_data(self) -> Dict:
        """Get NCES education data for Brunswick schools"""
        data = {
            'schools': [],
            'district': {},
            'performance': {}
        }
        
        try:
            # Get school directory information
            async with self.session.get(
                f"{self.urls['nces']}/schools",
                params={
                    'state': 'ME',
                    'city': 'Brunswick',
                    'level': 'Basic'
                }
            ) as response:
                if response.status == 200:
                    schools_data = await response.json()
                    data['schools'] = schools_data.get('schools', [])
                    
            # Get district information
            async with self.session.get(
                f"{self.urls['nces']}/districts",
                params={
                    'state': 'ME',
                    'city': 'Brunswick'
                }
            ) as response:
                if response.status == 200:
                    district_data = await response.json()
                    data['district'] = district_data.get('district', {})
                    
        except Exception as e:
            self.logger.error(f"Error getting NCES data: {e}")
            
        return data
        
    async def _fetch_acs_data(self, variables: List[str]) -> Dict:
        """Fetch ACS data for specified variables"""
        try:
            # Construct API URL
            url = f"{self.urls['census']}/2021/acs/acs5"
            
            # Make API request
            async with self.session.get(
                url,
                params={
                    'get': ','.join(variables),
                    'for': f'place:{self.geo_ids["place"]}',
                    'in': f'state:{self.geo_ids["state"]}',
                    'key': self.census_api_key
                }
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    # Convert array response to dictionary
                    if len(data) > 1:  # First row is headers
                        headers = data[0]
                        values = data[1]
                        return dict(zip(headers, values))
                        
        except Exception as e:
            self.logger.error(f"Error fetching ACS data: {e}")
            
        return {}
