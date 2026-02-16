"""
Collector for Brunswick business licenses and additional property details
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional
import re
from datetime import datetime
import json
from pathlib import Path

class BrunswickLicenseCollector:
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.cache_dir = config.get('cache_dir', 'cache')
        self.session = None
        
        # Source URLs
        self.urls = {
            'licenses': {
                'main': 'https://www.brunswickme.gov/290/Business-Licenses',
                'clerk': 'https://www.brunswickme.gov/276/Town-Clerk'
            },
            'property': {
                'assessment': 'https://gis.vgsi.com/brunswickme/',
                'deeds': 'https://me.uslandrecords.com/ME/Cumberland/'
            },
            'environmental': {
                'base_plan': 'https://brunswicklanding.us/wp-content/uploads/2023/10/Section_4_Part_2_Existing_Conditions_Assessment.pdf'
            }
        }
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def get_business_licenses(self, business_name: Optional[str] = None) -> List[Dict]:
        """Get business license information"""
        licenses = []
        try:
            # Scrape license types and requirements
            async with self.session.get(self.urls['licenses']['main']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Extract license information
                    license_divs = soup.find_all('div', class_=re.compile(r'license'))
                    for div in license_divs:
                        license_info = {
                            'type': self._safe_extract(div, '.license-type'),
                            'requirements': self._safe_extract(div, '.requirements'),
                            'fee': self._safe_extract(div, '.fee'),
                            'duration': self._safe_extract(div, '.duration')
                        }
                        licenses.append(license_info)
                        
            # If business name provided, try to get specific license info
            if business_name:
                clerk_licenses = await self._get_clerk_records(business_name)
                licenses.extend(clerk_licenses)
                
        except Exception as e:
            self.logger.error(f"Error getting business licenses: {e}")
            
        return licenses
        
    async def get_property_history(self, property_id: str) -> Dict:
        """Get detailed property history"""
        history = {
            'assessments': [],
            'owners': [],
            'features': {},
            'environmental': None
        }
        
        try:
            # Get assessment history
            async with self.session.get(
                f"{self.urls['property']['assessment']}/ParcelDetail/{property_id}"
            ) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Extract assessment history
                    history['assessments'] = self._parse_assessment_history(soup)
                    
                    # Extract property features
                    history['features'] = self._parse_property_features(soup)
                    
            # Get ownership history from deeds
            history['owners'] = await self._get_ownership_history(property_id)
            
            # Get environmental data if available
            history['environmental'] = await self._get_environmental_data(property_id)
            
        except Exception as e:
            self.logger.error(f"Error getting property history: {e}")
            
        return history
        
    async def get_code_violations(self, property_id: str) -> List[Dict]:
        """Get code violation history"""
        violations = []
        try:
            async with self.session.get(
                'https://www.brunswickme.gov/150/Code-Enforcement'
            ) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Extract violation information
                    violation_divs = soup.find_all('div', class_=re.compile(r'violation'))
                    for div in violation_divs:
                        violation = {
                            'date': self._safe_extract(div, '.violation-date'),
                            'type': self._safe_extract(div, '.violation-type'),
                            'status': self._safe_extract(div, '.violation-status'),
                            'resolution': self._safe_extract(div, '.resolution')
                        }
                        violations.append(violation)
                        
        except Exception as e:
            self.logger.error(f"Error getting code violations: {e}")
            
        return violations
        
    async def _get_clerk_records(self, business_name: str) -> List[Dict]:
        """Get business records from Town Clerk"""
        records = []
        try:
            async with self.session.get(self.urls['licenses']['clerk']) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Extract business records
                    record_divs = soup.find_all('div', class_=re.compile(r'business-record'))
                    for div in record_divs:
                        if business_name.lower() in div.text.lower():
                            record = {
                                'license_number': self._safe_extract(div, '.license-number'),
                                'issue_date': self._safe_extract(div, '.issue-date'),
                                'expiration_date': self._safe_extract(div, '.expiration-date'),
                                'status': self._safe_extract(div, '.status')
                            }
                            records.append(record)
                            
        except Exception as e:
            self.logger.error(f"Error getting clerk records: {e}")
            
        return records
        
    async def _get_ownership_history(self, property_id: str) -> List[Dict]:
        """Get property ownership history"""
        owners = []
        try:
            # Note: This might require authentication or direct API access
            async with self.session.get(
                f"{self.urls['property']['deeds']}/search/{property_id}"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    for record in data.get('records', []):
                        owner = {
                            'name': record.get('grantor'),
                            'transfer_date': record.get('date'),
                            'deed_type': record.get('type'),
                            'book_page': f"{record.get('book')}/{record.get('page')}"
                        }
                        owners.append(owner)
                        
        except Exception as e:
            self.logger.error(f"Error getting ownership history: {e}")
            
        return owners
        
    async def _get_environmental_data(self, property_id: str) -> Optional[Dict]:
        """Get environmental assessment data"""
        try:
            # This would typically parse the PDF or access a specific API
            # For now, we'll return a placeholder
            return {
                'assessment_date': None,
                'environmental_conditions': [],
                'recommendations': []
            }
        except Exception as e:
            self.logger.error(f"Error getting environmental data: {e}")
            return None
            
    def _parse_assessment_history(self, soup: BeautifulSoup) -> List[Dict]:
        """Parse assessment history from property page"""
        history = []
        try:
            assessment_table = soup.find('table', class_=re.compile(r'assessment-history'))
            if assessment_table:
                rows = assessment_table.find_all('tr')
                for row in rows[1:]:  # Skip header
                    cells = row.find_all('td')
                    if len(cells) >= 3:
                        assessment = {
                            'year': cells[0].text.strip(),
                            'value': cells[1].text.strip(),
                            'reason': cells[2].text.strip()
                        }
                        history.append(assessment)
        except Exception as e:
            self.logger.error(f"Error parsing assessment history: {e}")
            
        return history
        
    def _parse_property_features(self, soup: BeautifulSoup) -> Dict:
        """Parse detailed property features"""
        features = {}
        try:
            feature_div = soup.find('div', class_=re.compile(r'property-features'))
            if feature_div:
                # Extract building information
                features['building'] = {
                    'year_built': self._safe_extract(feature_div, '.year-built'),
                    'square_feet': self._safe_extract(feature_div, '.square-feet'),
                    'bedrooms': self._safe_extract(feature_div, '.bedrooms'),
                    'bathrooms': self._safe_extract(feature_div, '.bathrooms')
                }
                
                # Extract land information
                features['land'] = {
                    'acreage': self._safe_extract(feature_div, '.acreage'),
                    'zoning': self._safe_extract(feature_div, '.zoning'),
                    'frontage': self._safe_extract(feature_div, '.frontage')
                }
                
        except Exception as e:
            self.logger.error(f"Error parsing property features: {e}")
            
        return features
        
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
