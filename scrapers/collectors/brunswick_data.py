"""
Enhanced Brunswick-specific data collectors
"""
import logging
from typing import Dict, List, Optional
from datetime import datetime
import requests
from bs4 import BeautifulSoup
import pandas as pd
from pathlib import Path

class BrunswickDataCollector:
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.base_urls = {
            'assessor': 'https://gis.brunswickme.org/assessor',
            'permits': 'https://brunswickme.org/permits',
            'clerk': 'https://brunswickme.org/clerk',
            'planning': 'https://brunswickme.org/planning'
        }
        
    def collect_all(self) -> Dict:
        """Collect all Brunswick-specific data"""
        try:
            self.logger.info("Collecting all Brunswick data")
            
            metadata = {
                'collection_date': datetime.now().isoformat(),
                'source': 'Brunswick Municipal Data'
            }
            
            collected_data = {
                'assessments': self.collect_assessments(),
                'permits': self.collect_permits(),
                'violations': self.collect_violations(),
                'zoning_appeals': self.collect_zoning_appeals(),
                'business_licenses': self.collect_business_licenses(),
                'utility_data': self.collect_utility_data(),
                'planning_board': self.collect_planning_board(),
                'historic_district': self.collect_historic_district()
            }
            
            return {
                'success': True,
                'data': collected_data,
                'metadata': metadata
            }
            
        except Exception as e:
            self.logger.error(f"Error collecting Brunswick data: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'metadata': metadata
            }

    def collect_assessments(self) -> List[Dict]:
        """Collect detailed assessment data"""
        try:
            # Brunswick uses Vision Government Solutions
            url = f"{self.base_urls['assessor']}/search"
            
            # Example search parameters
            params = {
                'type': 'address',
                'value': '',
                'year': datetime.now().year
            }
            
            # Collect and parse assessment data
            response = requests.get(url, params=params)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            results = []
            for row in soup.find_all('tr', class_='assessment-row'):
                assessment = self._parse_assessment_row(row)
                if assessment:
                    results.append(assessment)
            
            return results
            
        except Exception as e:
            self.logger.error(f"Error collecting assessments: {str(e)}")
            return []

    def collect_permits(self) -> List[Dict]:
        """Collect building and other permit data"""
        try:
            url = f"{self.base_urls['permits']}/search"
            
            # Last 12 months of permits
            params = {
                'start_date': (datetime.now() - pd.DateOffset(months=12)).strftime('%Y-%m-%d'),
                'end_date': datetime.now().strftime('%Y-%m-%d')
            }
            
            response = requests.get(url, params=params)
            return self._parse_permit_data(response.json())
            
        except Exception as e:
            self.logger.error(f"Error collecting permits: {str(e)}")
            return []

    def collect_violations(self) -> List[Dict]:
        """Collect code violations and complaints"""
        try:
            url = f"{self.base_urls['planning']}/violations"
            
            response = requests.get(url)
            return self._parse_violation_data(response.json())
            
        except Exception as e:
            self.logger.error(f"Error collecting violations: {str(e)}")
            return []

    def collect_zoning_appeals(self) -> List[Dict]:
        """Collect zoning board of appeals data"""
        try:
            url = f"{self.base_urls['planning']}/appeals"
            
            response = requests.get(url)
            return self._parse_appeals_data(response.json())
            
        except Exception as e:
            self.logger.error(f"Error collecting appeals: {str(e)}")
            return []

    def collect_business_licenses(self) -> List[Dict]:
        """Collect business license data"""
        try:
            url = f"{self.base_urls['clerk']}/business-licenses"
            
            response = requests.get(url)
            return self._parse_license_data(response.json())
            
        except Exception as e:
            self.logger.error(f"Error collecting licenses: {str(e)}")
            return []

    def collect_utility_data(self) -> List[Dict]:
        """Collect utility usage and account data"""
        try:
            # Brunswick & Topsham Water District
            url = f"{self.base_urls['assessor']}/utilities"
            
            response = requests.get(url)
            return self._parse_utility_data(response.json())
            
        except Exception as e:
            self.logger.error(f"Error collecting utility data: {str(e)}")
            return []

    def collect_planning_board(self) -> List[Dict]:
        """Collect planning board decisions and applications"""
        try:
            url = f"{self.base_urls['planning']}/board"
            
            response = requests.get(url)
            return self._parse_planning_data(response.json())
            
        except Exception as e:
            self.logger.error(f"Error collecting planning data: {str(e)}")
            return []

    def collect_historic_district(self) -> List[Dict]:
        """Collect historic district properties and regulations"""
        try:
            url = f"{self.base_urls['planning']}/historic"
            
            response = requests.get(url)
            return self._parse_historic_data(response.json())
            
        except Exception as e:
            self.logger.error(f"Error collecting historic data: {str(e)}")
            return []

    def _parse_assessment_row(self, row) -> Optional[Dict]:
        """Parse assessment data from table row"""
        try:
            cells = row.find_all('td')
            if len(cells) < 6:
                return None
                
            return {
                'parcel_id': cells[0].text.strip(),
                'address': cells[1].text.strip(),
                'owner_name': cells[2].text.strip(),
                'land_value': self._parse_currency(cells[3].text),
                'building_value': self._parse_currency(cells[4].text),
                'total_value': self._parse_currency(cells[5].text),
                'assessment_year': datetime.now().year
            }
            
        except Exception as e:
            self.logger.error(f"Error parsing assessment row: {str(e)}")
            return None

    def _parse_permit_data(self, data: Dict) -> List[Dict]:
        """Parse permit data from API response"""
        try:
            permits = []
            for item in data.get('permits', []):
                permit = {
                    'permit_number': item.get('permitNumber'),
                    'type': item.get('permitType'),
                    'status': item.get('status'),
                    'issue_date': item.get('issueDate'),
                    'expiration_date': item.get('expirationDate'),
                    'address': item.get('propertyAddress'),
                    'description': item.get('workDescription'),
                    'estimated_cost': self._parse_currency(item.get('estimatedCost')),
                    'contractor': item.get('contractorName')
                }
                permits.append(permit)
            return permits
            
        except Exception as e:
            self.logger.error(f"Error parsing permit data: {str(e)}")
            return []

    def _parse_violation_data(self, data: Dict) -> List[Dict]:
        """Parse code violation data"""
        try:
            violations = []
            for item in data.get('violations', []):
                violation = {
                    'case_number': item.get('caseNumber'),
                    'type': item.get('violationType'),
                    'status': item.get('status'),
                    'open_date': item.get('openDate'),
                    'close_date': item.get('closeDate'),
                    'address': item.get('propertyAddress'),
                    'description': item.get('description')
                }
                violations.append(violation)
            return violations
            
        except Exception as e:
            self.logger.error(f"Error parsing violation data: {str(e)}")
            return []

    def _parse_currency(self, value: str) -> float:
        """Parse currency string to float"""
        try:
            if not value:
                return 0.0
            return float(value.replace('$', '').replace(',', ''))
        except:
            return 0.0
