"""
Collector for building permits and code violations
Handles both permits and violations since they often come from the same system
"""
import logging
from datetime import datetime
from typing import Dict, List, Optional
import requests
from bs4 import BeautifulSoup
import pandas as pd

from .base_collector import BaseCollector
from ..models.property_models import Permit, Violation
from ..utils.retry import retry_with_backoff
from ..utils.address_matcher import AddressMatcher

class PermitCollector(BaseCollector):
    """
    Collects building permits and code violations
    Supports multiple collection methods:
    1. Direct API access
    2. PDF scraping
    3. Excel/CSV file processing
    4. Web scraping
    """
    
    def __init__(self, config: Dict):
        super().__init__(config)
        self.base_url = config.get('permit_url', 'https://www.brunswickme.org/permits')
        self.logger = logging.getLogger(self.__class__.__name__)
        self.session = requests.Session()
        self.address_matcher = AddressMatcher()
        
        # Configure data sources
        self.sources = {
            'permits': self._configure_source(config.get('permit_source', {})),
            'violations': self._configure_source(config.get('violation_source', {}))
        }

    def collect_permits(self, address: str = None, parcel_id: str = None) -> Dict:
        """
        Collect permit data for a specific property
        Can search by address or parcel ID
        """
        try:
            source = self.sources['permits']
            if source['type'] == 'api':
                return self._collect_from_api(source, 'permit', address, parcel_id)
            elif source['type'] == 'pdf':
                return self._collect_from_pdf(source, 'permit', address, parcel_id)
            elif source['type'] == 'excel':
                return self._collect_from_excel(source, 'permit', address, parcel_id)
            elif source['type'] == 'web':
                return self._collect_from_web(source, 'permit', address, parcel_id)
            else:
                raise ValueError(f"Unsupported source type: {source['type']}")
                
        except Exception as e:
            self.logger.error(f"Error collecting permits: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'address': address,
                'parcel_id': parcel_id
            }

    def collect_violations(self, address: str = None, parcel_id: str = None) -> Dict:
        """
        Collect violation data for a specific property
        Can search by address or parcel ID
        """
        try:
            source = self.sources['violations']
            if source['type'] == 'api':
                return self._collect_from_api(source, 'violation', address, parcel_id)
            elif source['type'] == 'pdf':
                return self._collect_from_pdf(source, 'violation', address, parcel_id)
            elif source['type'] == 'excel':
                return self._collect_from_excel(source, 'violation', address, parcel_id)
            elif source['type'] == 'web':
                return self._collect_from_web(source, 'violation', address, parcel_id)
            else:
                raise ValueError(f"Unsupported source type: {source['type']}")
                
        except Exception as e:
            self.logger.error(f"Error collecting violations: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'address': address,
                'parcel_id': parcel_id
            }

    @retry_with_backoff(max_retries=3)
    def _collect_from_api(self, source: Dict, data_type: str, address: str = None, parcel_id: str = None) -> Dict:
        """Collect data from REST API"""
        try:
            # Build search parameters
            params = {}
            if address:
                params['address'] = address
            if parcel_id:
                params['parcel_id'] = parcel_id
                
            # Make API request
            response = self.session.get(
                source['url'],
                params=params,
                headers=source.get('headers', {})
            )
            
            if response.status_code != 200:
                return {'success': False, 'error': 'API error'}
                
            data = response.json()
            
            # Parse based on type
            if data_type == 'permit':
                return {
                    'success': True,
                    'permits': self._parse_permit_data(data)
                }
            else:
                return {
                    'success': True,
                    'violations': self._parse_violation_data(data)
                }
                
        except Exception as e:
            self.logger.error(f"API collection failed: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _collect_from_pdf(self, source: Dict, data_type: str, address: str = None, parcel_id: str = None) -> Dict:
        """Collect data from PDF documents"""
        try:
            import pdfplumber  # Import here to avoid dependency if not needed
            
            # Download PDF
            response = self.session.get(source['url'])
            
            with pdfplumber.load(response.content) as pdf:
                text = ""
                for page in pdf.pages:
                    text += page.extract_text()
            
            # Find relevant sections
            if address:
                relevant_text = self._extract_address_section(text, address)
            else:
                relevant_text = self._extract_parcel_section(text, parcel_id)
            
            # Parse based on type
            if data_type == 'permit':
                return {
                    'success': True,
                    'permits': self._parse_permit_text(relevant_text)
                }
            else:
                return {
                    'success': True,
                    'violations': self._parse_violation_text(relevant_text)
                }
                
        except Exception as e:
            self.logger.error(f"PDF collection failed: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _collect_from_excel(self, source: Dict, data_type: str, address: str = None, parcel_id: str = None) -> Dict:
        """Collect data from Excel/CSV files"""
        try:
            # Download file
            response = self.session.get(source['url'])
            
            # Read into pandas
            if source['url'].endswith('.csv'):
                df = pd.read_csv(response.content)
            else:
                df = pd.read_excel(response.content)
            
            # Filter relevant rows
            if address:
                df = df[df['address'].apply(lambda x: self.address_matcher.matches(x, address))]
            if parcel_id:
                df = df[df['parcel_id'] == parcel_id]
            
            # Parse based on type
            if data_type == 'permit':
                return {
                    'success': True,
                    'permits': self._parse_permit_dataframe(df)
                }
            else:
                return {
                    'success': True,
                    'violations': self._parse_violation_dataframe(df)
                }
                
        except Exception as e:
            self.logger.error(f"Excel collection failed: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _collect_from_web(self, source: Dict, data_type: str, address: str = None, parcel_id: str = None) -> Dict:
        """Collect data by web scraping"""
        try:
            # Get search page
            response = self.session.get(source['url'])
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Find and fill search form
            form = soup.find('form')
            if address:
                data = {'address': address}
            else:
                data = {'parcel_id': parcel_id}
            
            # Submit search
            response = self.session.post(
                source['url'],
                data=data
            )
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Parse based on type
            if data_type == 'permit':
                return {
                    'success': True,
                    'permits': self._parse_permit_html(soup)
                }
            else:
                return {
                    'success': True,
                    'violations': self._parse_violation_html(soup)
                }
                
        except Exception as e:
            self.logger.error(f"Web collection failed: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _parse_permit_data(self, data: Dict) -> List[Dict]:
        """Parse permit data from API response"""
        permits = []
        for item in data.get('permits', []):
            permit = {
                'permit_type': item.get('type'),
                'permit_number': item.get('number'),
                'description': item.get('description'),
                'status': item.get('status'),
                'issue_date': self._parse_date(item.get('issueDate')),
                'expiration_date': self._parse_date(item.get('expirationDate')),
                'completed_date': self._parse_date(item.get('completedDate')),
                'contractor': item.get('contractor'),
                'estimated_cost': item.get('estimatedCost'),
                'final_cost': item.get('finalCost')
            }
            permits.append(permit)
        return permits

    def _parse_violation_data(self, data: Dict) -> List[Dict]:
        """Parse violation data from API response"""
        violations = []
        for item in data.get('violations', []):
            violation = {
                'violation_type': item.get('type'),
                'description': item.get('description'),
                'status': item.get('status'),
                'severity': item.get('severity'),
                'reported_date': self._parse_date(item.get('reportedDate')),
                'inspection_date': self._parse_date(item.get('inspectionDate')),
                'resolution_date': self._parse_date(item.get('resolutionDate')),
                'resolution_description': item.get('resolutionDescription'),
                'fines': item.get('fines'),
                'paid': item.get('paid', False)
            }
            violations.append(violation)
        return violations

    def _configure_source(self, config: Dict) -> Dict:
        """Configure a data source from config"""
        return {
            'type': config.get('type', 'web'),
            'url': config.get('url'),
            'headers': config.get('headers', {}),
            'auth': config.get('auth', None)
        }

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """Safely parse date string"""
        if not date_str:
            return None
        try:
            return datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return None
