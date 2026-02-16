"""
Collector for Brunswick Commitment Book data
"""
import logging
import tempfile
import requests
import re
import datetime
from pathlib import Path
from typing import Dict, List, Optional
import pandas as pd
import PyPDF2
from .base_collector import BaseCollector
from ..utils.data_manager import DataManager

class CommitmentBookCollector(BaseCollector):
    def __init__(self):
        super().__init__()
        self.data_manager = DataManager()
        self.commitment_book_url = "https://www.brunswickme.gov/DocumentCenter/View/9924/2024-Real-Estate-Commitment-Book"
        
        # Initialize data quality tracking
        self._seen_accounts = set()
        self.quality_metrics = {
            'total_properties': 0,
            'properties_with_errors': 0,
            'properties_with_warnings': 0,
            'extraction_success': {
                'values': 0,
                'details': 0,
                'location': 0
            },
            'validation_issues': {
                'missing_fields': 0,
                'value_mismatches': 0,
                'invalid_formats': 0,
                'unusual_values': 0,
                'duplicates': 0
            }
        }
        
        # Precompile regex patterns for performance
        self.patterns = {
            'account_number': re.compile(r'^(\d+)\s'),
            'owner_name': re.compile(r'^\d+\s+([A-Z\s&,.]+)(?=\s+\d)'),
            'address': re.compile(r'([^,]+),\s*([A-Z]{2})\s+([0-9]{5})'),
            'land_value': re.compile(r'Land\s+([0-9,]+)'),
            'building_value': re.compile(r'Building\s+([0-9,]+)'),
            'total_value': re.compile(r'Total\s+([0-9,]+)'),
            'tax_amount': re.compile(r'Tax Amount:\s*\$?([0-9,.]+)'),
            'map_lot': re.compile(r'([A-Z][0-9]+)-([0-9]+)-([0-9]+)-([0-9]+)')
        }
        
        # Initialize caching
        self._property_cache = {}
        self._stats_cache = {}
        
        # Performance monitoring
        self.performance_metrics = {
            'total_processing_time': 0,
            'extraction_times': [],
            'validation_times': [],
            'cache_hits': 0,
            'cache_misses': 0
        }
        
    def collect(self) -> Dict:
        """Collect and parse commitment book data"""
        data = {
            'properties': [],
            'metadata': {
                'source': 'Brunswick Commitment Book 2024',
                'timestamp': pd.Timestamp.now().isoformat()
            }
        }
        
        try:
            # Download and store commitment book
            pdf_info = self._download_commitment_book()
            if not pdf_info:
                return data
                
            # Parse PDF content
            properties = self._parse_commitment_book(pdf_info['path'])
            if properties:
                data['properties'] = properties
                data['metadata']['total_properties'] = len(properties)
                
            return data
            
        except Exception as e:
            self.logger.error(f"Error collecting commitment book data: {str(e)}")
            return data
            
    def _download_commitment_book(self) -> Optional[Dict]:
        """Download commitment book PDF"""
        try:
            # Check if we already have the file
            existing_files = self.data_manager.list_files('raw', 'commitment_books')
            for file_info in existing_files:
                if self.commitment_book_url in file_info.get('metadata', {}).get('source_url', ''):
                    self.logger.info("Using existing commitment book file")
                    return file_info
            
            # Download new file
            self.logger.info("Downloading commitment book...")
            response = requests.get(self.commitment_book_url)
            response.raise_for_status()
            
            # Save to temporary file first
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_file:
                temp_file.write(response.content)
                temp_path = temp_file.name
            
            # Add to data manager
            file_info = self.data_manager.add_file(
                temp_path,
                'raw',
                'commitment_books',
                metadata={
                    'source_url': self.commitment_book_url,
                    'year': '2024'
                }
            )
            
            # Clean up temp file
            Path(temp_path).unlink()
            return file_info
            
        except Exception as e:
            self.logger.error(f"Error downloading commitment book: {str(e)}")
            return None
            
    def _parse_commitment_book(self, pdf_path: str) -> List[Dict]:
        """Parse commitment book PDF into structured data"""
        properties = []
        try:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                
                # Skip first page (usually header/intro)
                for page_num in range(1, len(pdf_reader.pages)):
                    page = pdf_reader.pages[page_num]
                    text = page.extract_text()
                    
                    # Process page text into property records
                    properties.extend(self._process_page_text(text))
                    
            return properties
            
        except Exception as e:
            self.logger.error(f"Error parsing commitment book: {str(e)}")
            return properties
            
    def _process_page_text(self, text: str) -> List[Dict]:
        """Process text from a page into property records"""
        properties = []
        try:
            # Split into lines and process
            lines = text.split('\n')
            current_property = None
            property_text_buffer = []
            line_number = 0
            
            for line in lines:
                line_number += 1
                line = line.strip()
                if not line:
                    continue
                
                try:
                    # Check for new property record
                    if self._is_new_property_record(line):
                        # Process previous property if exists
                        if current_property:
                            try:
                                # Combine all lines into one string
                                full_text = ' '.join(property_text_buffer)
                                current_property['raw_text'] = full_text
                                
                                # Extract all values
                                self._extract_values(current_property, full_text)
                                self._extract_details(current_property, full_text)
                                self._extract_location(current_property, full_text)
                                
                                # Validate property data
                                validation_errors = self._validate_property_data(current_property)
                                if validation_errors:
                                    current_property['validation_warnings'] = validation_errors
                                    self.logger.warning(f"Validation issues for property {current_property.get('account_number', 'unknown')}: {validation_errors}")
                                
                                properties.append(current_property.copy())
                            except Exception as e:
                                self.logger.error(f"Error processing property {current_property.get('account_number', 'unknown')}: {str(e)}")
                                current_property['processing_error'] = str(e)
                                properties.append(current_property.copy())
                        
                        # Start new property
                        current_property = self._parse_property_line(line)
                        current_property['line_number'] = line_number
                        property_text_buffer = [line]
                    else:
                        property_text_buffer.append(line)
                except Exception as e:
                    self.logger.error(f"Error processing line {line_number}: {str(e)}\nLine content: {line}")
            
            # Process last property
            if current_property:
                try:
                    # Combine all lines into one string
                    full_text = ' '.join(property_text_buffer)
                    current_property['raw_text'] = full_text
                    
                    # Extract all values
                    self._extract_values(current_property, full_text)
                    self._extract_details(current_property, full_text)
                    self._extract_location(current_property, full_text)
                    
                    # Validate property data
                    validation_errors = self._validate_property_data(current_property)
                    if validation_errors:
                        current_property['validation_warnings'] = validation_errors
                        self.logger.warning(f"Validation issues for property {current_property.get('account_number', 'unknown')}: {validation_errors}")
                    
                    properties.append(current_property)
                except Exception as e:
                    self.logger.error(f"Error processing last property {current_property.get('account_number', 'unknown')}: {str(e)}")
                    current_property['processing_error'] = str(e)
                    properties.append(current_property)
            
            # Log collection statistics
            total_properties = len(properties)
            properties_with_errors = sum(1 for p in properties if 'processing_error' in p)
            properties_with_warnings = sum(1 for p in properties if 'validation_warnings' in p)
            self.logger.info(f"Processed {total_properties} properties. "
                            f"Errors: {properties_with_errors}, "
                            f"Warnings: {properties_with_warnings}")
            
            return properties
            
        except Exception as e:
            self.logger.error(f"Error processing page text: {str(e)}")
            return properties
            
    def _process_property_buffer(self, property_dict: Dict, text_buffer: List[str]):
        """Process all lines related to a property"""
        try:
            full_text = ' '.join(text_buffer)
            
            # Extract location
            location_match = re.search(r'(?i)LOCATION[:;]\s*([^\n]+)', full_text)
            if location_match:
                property_dict['location'] = location_match.group(1).strip()
            
            # Extract assessment values
            assessment_match = re.search(r'(?i)ASSESSMENT[:;]\s*\$([\.\d,]+)', full_text)
            if assessment_match:
                value = assessment_match.group(1).replace(',', '')
                property_dict['assessment'] = float(value)
            
            # Extract land area
            land_match = re.search(r'(?i)LAND\s+AREA[:;]\s*([\d,\.]+)\s*(AC|SQ\s*FT)?', full_text)
            if land_match:
                area = float(land_match.group(1).replace(',', ''))
                unit = land_match.group(2) if land_match.group(2) else 'AC'
                property_dict['land_area'] = area
                property_dict['land_unit'] = unit
            
            # Extract building info
            building_match = re.search(r'(?i)BUILDING[:;]\s*([^\n]+)', full_text)
            if building_match:
                property_dict['building_info'] = building_match.group(1).strip()
            
            # Extract year built
            year_match = re.search(r'(?i)YEAR\s+BUILT[:;]\s*(\d{4})', full_text)
            if year_match:
                property_dict['year_built'] = int(year_match.group(1))
            
            # Extract zoning
            zoning_match = re.search(r'(?i)ZONE[:;]\s*([^\n]+)', full_text)
            if zoning_match:
                property_dict['zoning'] = zoning_match.group(1).strip()
            
            # Store raw text for verification
            property_dict['raw_text'] = full_text
            
        except Exception as e:
            self.logger.warning(f"Error processing property buffer: {str(e)}")
            
    def _is_new_property_record(self, line: str) -> bool:
        """Determine if line starts a new property record"""
        # Check for lines that start with an account number followed by owner info
        # Examples:
        # "107 COLUMBIA AVE LLC"
        # "2410006 33210/0106 06/15/2016"
        if not line.strip() or not line[0].isdigit():
            return False
            
        # Make sure it's not just a value line
        # Example: "113,000 Building" (this is a continuation line)
        parts = line.split()
        if len(parts) >= 2:
            first_part = parts[0].replace(',', '')
            if first_part.isdigit() and 'Building' in line:
                return False
                
        return True
        
    def _parse_property_line(self, line: str) -> Dict:
        """Parse main property line into structured data"""
        try:
            # First try to match account number and deed info
            # Example: "2410006 33210/0106 06/15/2016"
            deed_match = re.match(r'^(\d+)\s+(\d{5}/\d{4})\s+(\d{2}/\d{2}/\d{4})', line)
            if deed_match:
                return {
                    'account_number': deed_match.group(1),
                    'deed_book_page': deed_match.group(2),
                    'deed_date': deed_match.group(3),
                    'raw_line': line
                }
            
            # Try to match account number and owner info
            # Example: "107 COLUMBIA AVE LLC"
            owner_match = re.match(r'^(\d+)\s+(.+?)(?:\s+([^,]+,[^,]+\d{5}))?$', line)
            if owner_match:
                result = {
                    'account_number': owner_match.group(1),
                    'owner_name': owner_match.group(2).strip(),
                    'raw_line': line
                }
                if owner_match.group(3):
                    result['mailing_address'] = owner_match.group(3).strip()
                return result
            
            # Fallback to simple splitting for account number
            parts = line.split()
            if parts and parts[0].isdigit():
                return {
                    'account_number': parts[0],
                    'raw_line': line
                }
            
            return {'raw_line': line}
            
        except Exception as e:
            self.logger.warning(f"Error parsing property line: {str(e)}")
            return {'raw_line': line}
            
    def _extract_location(self, property_dict: Dict, text: str):
        """Extract address and location information"""
        success = False
        try:
            # Full address with state and zip
            address_match = re.search(r'([^,]+),\s*([A-Z]{2})\s+([0-9]{5})', text)
            if address_match:
                property_dict['street_address'] = address_match.group(1).strip()
                property_dict['state'] = address_match.group(2)
                property_dict['zip_code'] = address_match.group(3)
                success = True
        except Exception as e:
            self.logger.error(f"Error extracting location: {str(e)}")
        finally:
            if success:
                self.quality_metrics['extraction_success']['location'] += 1
        
        # Property location (might be different from mailing address)
        location_match = re.search(r'Location[:]?\s+([^\n]+)', text, re.IGNORECASE)
        if location_match:
            property_dict['location'] = location_match.group(1).strip()

    def _extract_details(self, property_dict: Dict, text: str):
        """Extract property details like square footage, deed info, and map/lot"""
        success = False
        try:
            # Square footage
            sqft_match = re.search(r'([0-9]+)\s*(?:Sq\s*Ft|SF)', text, re.IGNORECASE)
            if sqft_match:
                property_dict['square_feet'] = int(sqft_match.group(1))
                success = True
                
            # Deed information
            deed_match = re.search(r'([0-9]{5}/[0-9]{4})\s+([0-9]{2}/[0-9]{2}/[0-9]{4})', text)
            if deed_match:
                property_dict['deed_book_page'] = deed_match.group(1)
                property_dict['deed_date'] = deed_match.group(2)
            
            # Map/Lot information
            map_lot_match = re.search(r'([A-Z0-9]+)-([0-9]+)-([0-9]+)-([0-9]+)', text)
            if map_lot_match:
                property_dict['map'] = map_lot_match.group(1)
                property_dict['lot'] = map_lot_match.group(2)
                property_dict['sublot'] = map_lot_match.group(3)
                property_dict['unit'] = map_lot_match.group(4)
                
        except Exception as e:
            self.logger.error(f"Error extracting property details: {e}")

    def _validate_property_data(self, property_dict: Dict) -> List[str]:
        """Validate property data for consistency and completeness"""
        warnings = []
        
        # Check required fields
        required_fields = ['account_number', 'owner_name', 'location']
        for field in required_fields:
            if field not in property_dict:
                warnings.append(f"Missing required field: {field}")
                self.quality_metrics['validation_issues']['missing_fields'] += 1
                
        # Validate owner name format
        if 'owner_name' in property_dict:
            owner_name = property_dict['owner_name']
            # Check for business suffixes
            business_suffixes = ['LLC', 'INC', 'CORP', 'LTD', 'LP', 'LLP']
            has_suffix = any(suffix in owner_name.upper() for suffix in business_suffixes)
            
            if has_suffix and not re.match(r'^[A-Z0-9\s&,.-]+$', owner_name):
                warnings.append(f"Invalid business name format: {owner_name}")
                self.quality_metrics['validation_issues']['invalid_formats'] += 1
            elif not has_suffix and not re.match(r'^[A-Z\s,.-]+$', owner_name):
                warnings.append(f"Invalid individual name format: {owner_name}")
                self.quality_metrics['validation_issues']['invalid_formats'] += 1
                
        # Validate address format
        if 'street_address' in property_dict:
            addr = property_dict['street_address']
            # Basic USPS format validation
            if not re.match(r'^\d+\s+[A-Z0-9\s]+(?:ST|AVE|RD|BLVD|LN|DR|WAY|CT|CIR)$', addr.upper()):
                warnings.append(f"Non-standard address format: {addr}")
                self.quality_metrics['validation_issues']['invalid_formats'] += 1
        
        # Validate monetary values
        try:
            land_value = property_dict.get('land_value', 0)
            building_value = property_dict.get('building_value', 0)
            total_value = property_dict.get('total_value', 0)
            net_value = property_dict.get('net_value', 0)
            exemption = property_dict.get('exemption', 0)
            deferment = property_dict.get('deferment', 0)
            tax_amount = property_dict.get('tax_amount', 0)
            inst1 = property_dict.get('installment_1', 0)
            inst2 = property_dict.get('installment_2', 0)
            
            # Check if total matches sum of parts
            if land_value and building_value and total_value:
                expected_total = land_value + building_value
                if abs(expected_total - total_value) > 1:  # Allow $1 rounding difference
                    warnings.append(f"Total value ({total_value}) does not match sum of land ({land_value}) and building ({building_value})")
                    self.quality_metrics['validation_issues']['value_mismatches'] += 1
            
            # Check for reasonable value ranges
            if land_value and land_value < 100:
                warnings.append(f"Unusually low land value: {land_value}")
                self.quality_metrics['validation_issues']['unusual_values'] += 1
            if building_value and building_value < 1000:
                warnings.append(f"Unusually low building value: {building_value}")
                self.quality_metrics['validation_issues']['unusual_values'] += 1
            if total_value and total_value > 10000000:
                warnings.append(f"Unusually high total value: {total_value}")
                self.quality_metrics['validation_issues']['unusual_values'] += 1
            
            # Validate tax amount
            if tax_amount and total_value:
                tax_rate = (tax_amount / total_value) * 100
                if tax_rate < 0.1 or tax_rate > 10:
                    warnings.append(f"Unusual tax rate: {tax_rate:.2f}%")
            
            # Validate net value calculation
            if total_value and net_value:
                expected_net = total_value - exemption - deferment
                if abs(expected_net - net_value) > 1:  # Allow $1 rounding difference
                    warnings.append(f"Net value ({net_value}) does not match total ({total_value}) minus exemptions ({exemption}) and deferments ({deferment})")
            
            # Validate installments
            if tax_amount and (inst1 or inst2):
                expected_installment = tax_amount / 2
                if inst1 and abs(inst1 - expected_installment) > 0.01:  # Allow 1¢ rounding
                    warnings.append(f"Installment 1 ({inst1}) is not half of tax amount ({tax_amount})")
                if inst2 and abs(inst2 - expected_installment) > 0.01:  # Allow 1¢ rounding
                    warnings.append(f"Installment 2 ({inst2}) is not half of tax amount ({tax_amount})")
            
            # Check for negative values and cross-property validation
            for field, value in [
                ('land_value', land_value),
                ('building_value', building_value),
                ('total_value', total_value),
                ('net_value', net_value),
                ('tax_amount', tax_amount),
                ('installment_1', inst1),
                ('installment_2', inst2)
            ]:
                if value < 0:
                    warnings.append(f"Negative value in {field}: {value}")
                    
            # Cross-property validation (if we have historical data)
            if hasattr(self, '_property_stats'):
                map_area = property_dict.get('map', '')
                if map_area in self._property_stats:
                    stats = self._property_stats[map_area]
                    
                    # Check if values are within 3 standard deviations
                    if land_value:
                        z_score = (land_value - stats['land_mean']) / stats['land_std']
                        if abs(z_score) > 3:
                            warnings.append(f"Land value ({land_value}) unusually different from area average ({stats['land_mean']:.0f})")
                            self.quality_metrics['validation_issues']['unusual_values'] += 1
                    
                    if building_value:
                        z_score = (building_value - stats['building_mean']) / stats['building_std']
                        if abs(z_score) > 3:
                            warnings.append(f"Building value ({building_value}) unusually different from area average ({stats['building_mean']:.0f})")
                            self.quality_metrics['validation_issues']['unusual_values'] += 1
                    
        except Exception as e:
            warnings.append(f"Error validating monetary values: {str(e)}")
        
        # Validate map/lot format
        if 'map' in property_dict:
            if not re.match(r'^[A-Z][0-9]+$', property_dict['map']):
                warnings.append(f"Invalid map format: {property_dict['map']}")
                self.quality_metrics['validation_issues']['invalid_formats'] += 1
            
        # Validate date formats
        if 'deed_date' in property_dict:
            try:
                datetime.datetime.strptime(property_dict['deed_date'], '%m/%d/%Y')
            except ValueError:
                warnings.append(f"Invalid deed date format: {property_dict['deed_date']}")
        
        # Validate square footage
        sqft = property_dict.get('square_feet', 0)
        if sqft:
            if sqft < 100:
                warnings.append(f"Unusually small square footage: {sqft}")
            elif sqft > 100000:
                warnings.append(f"Unusually large square footage: {sqft}")
        
        # Check for duplicate account numbers (requires class-level tracking)
        if hasattr(self, '_seen_accounts'):
            account = property_dict.get('account_number')
            if account:
                if account in self._seen_accounts:
                    warnings.append(f"Duplicate account number: {account}")
                    self.quality_metrics['validation_issues']['duplicates'] += 1
                else:
                    self._seen_accounts.add(account)
        
        return warnings
    
    def _extract_values(self, property_dict: Dict, text: str):
        """Extract monetary values and other numeric data from property text"""
        success = False
        start_time = datetime.datetime.now()
        
        try:
            # Check cache first
            cache_key = hash(text)
            if cache_key in self._property_cache:
                self.performance_metrics['cache_hits'] += 1
                cached_values = self._property_cache[cache_key]
                property_dict.update(cached_values)
                return
                
            self.performance_metrics['cache_misses'] += 1
            extracted_values = {}
            
            # Use precompiled patterns
            for field, pattern in self.patterns.items():
                match = pattern.search(text)
                if match:
                    value = match.group(1).replace(',', '')
                    if field in ['land_value', 'building_value', 'total_value']:
                        extracted_values[field] = int(value)
                    elif field == 'tax_amount':
                        extracted_values[field] = float(value)
                    else:
                        extracted_values[field] = value
                    success = True
            
            # Update property dict and cache
            property_dict.update(extracted_values)
            self._property_cache[cache_key] = extracted_values
            
        except Exception as e:
            self.logger.error(f"Error extracting values: {str(e)}")
        finally:
            # Track performance
            elapsed = (datetime.datetime.now() - start_time).total_seconds()
            self.performance_metrics['extraction_times'].append(elapsed)
        
        # Additional value extraction with specific patterns
        try:
            # Land value - look for pattern: digits followed by 'Land'
            land_match = re.search(r'Land\s+([0-9,]+)', text)
            if land_match:
                property_dict['land_value'] = int(land_match.group(1).replace(',', ''))
            
            # Building value - look for pattern: digits followed by 'Building'
            building_match = re.search(r'([0-9,]+)\s+Building', text)
            if building_match:
                property_dict['building_value'] = int(building_match.group(1).replace(',', ''))
            
            # Total value - look for pattern: 'Total Value' followed by digits
            total_match = re.search(r'Total Value\s+([0-9,]+)', text)
            if total_match:
                property_dict['total_value'] = int(total_match.group(1).replace(',', ''))
            
            # Tax amount - look for pattern: 'REAL ESTAT' followed by amount
            tax_match = re.search(r'REAL ESTAT\s+([0-9,.]+)', text)
            if tax_match:
                property_dict['tax_amount'] = float(tax_match.group(1).replace(',', ''))
            
            # Installment amounts
            inst1_match = re.search(r'INSTALLMENT 1\s+([0-9,.]+)', text)
            if inst1_match:
                property_dict['installment_1'] = float(inst1_match.group(1).replace(',', ''))
            
            inst2_match = re.search(r'INSTALLMENT 2\s+([0-9,.]+)', text)
            if inst2_match:
                property_dict['installment_2'] = float(inst2_match.group(1).replace(',', ''))
            
            # Map/lot - look for pattern like U08-039-000-000
            map_lot_match = re.search(r'([A-Z][0-9]+)-([0-9]+)-([0-9]+)-([0-9]+)', text)
            if map_lot_match:
                property_dict['map'] = map_lot_match.group(1)
                property_dict['lot'] = map_lot_match.group(2)
                property_dict['sublot'] = map_lot_match.group(3)
                property_dict['unit'] = map_lot_match.group(4)
                # Add full map/lot for convenience
                property_dict['map_lot'] = f"{map_lot_match.group(1)}-{map_lot_match.group(2)}-{map_lot_match.group(3)}-{map_lot_match.group(4)}"
            
            # Net value after exemptions
            net_match = re.search(r'Net Value\s+([0-9,]+)', text)
            if net_match:
                property_dict['net_value'] = int(net_match.group(1).replace(',', ''))
            
            # Exemption amount
            exemption_match = re.search(r'Exemption\s+([0-9,]+)', text)
            if exemption_match:
                property_dict['exemption'] = int(exemption_match.group(1).replace(',', ''))
            
            # Deferment amount
            deferment_match = re.search(r'Deferment\s+([0-9,]+)', text)
            if deferment_match:
                property_dict['deferment'] = int(deferment_match.group(1).replace(',', ''))
            
        except Exception as e:
            self.logger.error(f"Error extracting values for property {property_dict.get('account_number', 'unknown')}: {str(e)}")
            property_dict['value_extraction_error'] = str(e)

    def _update_property_info(self, property_dict: Dict, line: str):
        """Update property dictionary with additional information from line"""
        # This needs to be customized based on actual PDF format
        try:
            line = line.strip()
            # Example: Look for specific patterns
            if 'LOCATION:' in line.upper():
                property_dict['location'] = line.split(':', 1)[1].strip()
            elif 'ASSESSMENT:' in line.upper():
                property_dict['assessment'] = line.split(':', 1)[1].strip()
            # Add more patterns as needed
        except Exception:
            pass
