"""
Collector for utility data (water, electric, gas)
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import requests
import pandas as pd
import numpy as np

from .base_collector import BaseCollector
from ..models.property_models import UtilityRecord
from ..utils.retry import retry_with_backoff

class UtilityCollector(BaseCollector):
    """
    Collects utility data from various sources:
    - Brunswick & Topsham Water District
    - Central Maine Power
    - Maine Natural Gas
    """
    
    def __init__(self, config: Dict):
        super().__init__(config)
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Configure utility sources
        self.sources = {
            'water': {
                'url': config.get('water_url', 'https://btwater.org/usage'),
                'auth': config.get('water_auth'),
                'type': 'api'
            },
            'electric': {
                'url': config.get('electric_url', 'https://cmpco.com/api/usage'),
                'auth': config.get('electric_auth'),
                'type': 'api'
            },
            'gas': {
                'url': config.get('gas_url', 'https://mainenaturalgas.com/api/usage'),
                'auth': config.get('gas_auth'),
                'type': 'api'
            }
        }
        
        # Initialize sessions
        self.sessions = {
            utility: requests.Session() for utility in self.sources
        }

    def collect(self, 
                address: str = None, 
                parcel_id: str = None, 
                account_numbers: Dict[str, str] = None,
                start_date: datetime = None,
                end_date: datetime = None) -> Dict:
        """
        Collect utility data for a property
        Can search by address, parcel ID, or specific account numbers
        """
        try:
            results = {}
            errors = []
            
            # Default to last 12 months if no date range specified
            if not start_date:
                start_date = datetime.now() - timedelta(days=365)
            if not end_date:
                end_date = datetime.now()
            
            # Collect from each utility
            for utility, source in self.sources.items():
                try:
                    # Get account number if provided
                    account = account_numbers.get(utility) if account_numbers else None
                    
                    # Collect data
                    if source['type'] == 'api':
                        data = self._collect_from_api(
                            utility, source, address, parcel_id, account,
                            start_date, end_date
                        )
                    else:
                        data = self._collect_from_web(
                            utility, source, address, parcel_id, account,
                            start_date, end_date
                        )
                        
                    if data.get('success'):
                        results[utility] = data.get('records', [])
                    else:
                        errors.append({
                            'utility': utility,
                            'error': data.get('error')
                        })
                        
                except Exception as e:
                    errors.append({
                        'utility': utility,
                        'error': str(e)
                    })
            
            return {
                'success': len(results) > 0,
                'results': results,
                'errors': errors,
                'address': address,
                'parcel_id': parcel_id,
                'date_range': {
                    'start': start_date.isoformat(),
                    'end': end_date.isoformat()
                }
            }
            
        except Exception as e:
            self.logger.error(f"Error collecting utility data: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }

    @retry_with_backoff(max_retries=3)
    def _collect_from_api(self, 
                         utility: str,
                         source: Dict,
                         address: str = None,
                         parcel_id: str = None,
                         account: str = None,
                         start_date: datetime = None,
                         end_date: datetime = None) -> Dict:
        """Collect utility data from API"""
        try:
            # Build request parameters
            params = {
                'start_date': start_date.strftime('%Y-%m-%d'),
                'end_date': end_date.strftime('%Y-%m-%d')
            }
            
            if account:
                params['account'] = account
            elif address:
                params['address'] = address
            elif parcel_id:
                params['parcel_id'] = parcel_id
            
            # Make API request
            response = self.sessions[utility].get(
                source['url'],
                params=params,
                headers={'Authorization': f"Bearer {source['auth']}"}
                if source.get('auth') else {}
            )
            
            if response.status_code != 200:
                return {
                    'success': False,
                    'error': f"API error: {response.status_code}"
                }
            
            data = response.json()
            
            # Parse and standardize records
            records = []
            for record in data.get('usage', []):
                parsed = self._parse_utility_record(
                    utility, record, account or data.get('account_number')
                )
                if parsed:
                    records.append(parsed)
            
            return {
                'success': True,
                'records': records
            }
            
        except Exception as e:
            self.logger.error(f"API collection failed for {utility}: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _collect_from_web(self,
                         utility: str,
                         source: Dict,
                         address: str = None,
                         parcel_id: str = None,
                         account: str = None,
                         start_date: datetime = None,
                         end_date: datetime = None) -> Dict:
        """Collect utility data by web scraping"""
        try:
            # Get usage page
            response = self.sessions[utility].get(source['url'])
            
            # Parse data from HTML
            df = pd.read_html(response.text)[0]  # Assumes first table has usage data
            
            # Clean and standardize data
            records = []
            for _, row in df.iterrows():
                record = self._parse_utility_dataframe_row(utility, row, account)
                if record:
                    # Check if record is within date range
                    record_date = datetime.strptime(record['reading_date'], '%Y-%m-%d')
                    if start_date <= record_date <= end_date:
                        records.append(record)
            
            return {
                'success': True,
                'records': records
            }
            
        except Exception as e:
            self.logger.error(f"Web collection failed for {utility}: {str(e)}")
            return {'success': False, 'error': str(e)}

    def _parse_utility_record(self, utility: str, record: Dict, account_number: str) -> Optional[Dict]:
        """Parse utility record into standardized format"""
        try:
            # Get units based on utility type
            units = {
                'water': 'gallons',
                'electric': 'kwh',
                'gas': 'therms'
            }.get(utility)
            
            return {
                'utility_type': utility,
                'account_number': account_number,
                'service_status': record.get('status', 'active'),
                'usage': float(record.get('usage', 0)),
                'units': units,
                'reading_date': record.get('date'),
                'amount_due': float(record.get('amount', 0)),
                'payment_status': record.get('payment_status', 'unknown'),
                'last_payment_date': record.get('last_payment_date')
            }
            
        except Exception as e:
            self.logger.error(f"Error parsing utility record: {str(e)}")
            return None

    def _parse_utility_dataframe_row(self, utility: str, row: pd.Series, account_number: str) -> Optional[Dict]:
        """Parse utility data from dataframe row"""
        try:
            # Get units based on utility type
            units = {
                'water': 'gallons',
                'electric': 'kwh',
                'gas': 'therms'
            }.get(utility)
            
            return {
                'utility_type': utility,
                'account_number': account_number,
                'service_status': 'active',  # Usually not in table
                'usage': float(row.get('Usage', 0)),
                'units': units,
                'reading_date': row.get('Date'),
                'amount_due': float(row.get('Amount', 0)),
                'payment_status': 'unknown',  # Usually not in table
                'last_payment_date': None  # Usually not in table
            }
            
        except Exception as e:
            self.logger.error(f"Error parsing dataframe row: {str(e)}")
            return None

    def analyze_usage(self, records: List[Dict]) -> Dict:
        """
        Analyze utility usage patterns
        Returns insights about usage trends
        """
        try:
            if not records:
                return {}
            
            # Convert to dataframe for analysis
            df = pd.DataFrame(records)
            df['reading_date'] = pd.to_datetime(df['reading_date'])
            df = df.sort_values('reading_date')
            
            # Calculate basic statistics
            stats = {
                'total_usage': df['usage'].sum(),
                'average_usage': df['usage'].mean(),
                'max_usage': df['usage'].max(),
                'min_usage': df['usage'].min(),
                'std_dev': df['usage'].std()
            }
            
            # Detect seasonal patterns
            df['month'] = df['reading_date'].dt.month
            monthly_avg = df.groupby('month')['usage'].mean()
            
            # Detect trends
            trend = np.polyfit(range(len(df)), df['usage'], 1)
            
            return {
                'statistics': stats,
                'seasonal_pattern': monthly_avg.to_dict(),
                'trend': {
                    'slope': trend[0],  # Positive means increasing usage
                    'direction': 'increasing' if trend[0] > 0 else 'decreasing'
                }
            }
            
        except Exception as e:
            self.logger.error(f"Error analyzing usage: {str(e)}")
            return {}
