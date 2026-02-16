"""
Advanced extractors for specialized data sources
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional, Any, Tuple
import re
from datetime import datetime
import json
from dataclasses import dataclass
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from .site_specific_extractors import BaseExtractor, ExtractedData
import pandas as pd
import numpy as np
from PIL import Image
import pytesseract
import io
import requests
from urllib.parse import urljoin, urlparse
import os

class PDFExtractor(BaseExtractor):
    """Extractor for PDF documents with advanced OCR capabilities"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        super().__init__(session, driver)
        self.tesseract_config = r'--oem 3 --psm 6'
        # Initialize PDF processing libraries
        try:
            import pdf2image
            from PyPDF2 import PdfReader
            self.pdf2image = pdf2image
            self.PdfReader = PdfReader
        except ImportError:
            self.logger.error("Missing PDF libraries. Install pdf2image and PyPDF2")
        
    async def can_handle(self, url: str) -> bool:
        return url.lower().endswith('.pdf')
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        try:
            # Download PDF
            async with self.session.get(url) as response:
                if response.status != 200:
                    return None
                    
                pdf_content = await response.read()
                
            # Convert PDF to images
            images = await self._pdf_to_images(pdf_content)
            
            # Process each image
            results = []
            for idx, image in enumerate(images):
                # Extract text via OCR
                text = pytesseract.image_to_string(
                    image,
                    config=self.tesseract_config
                )
                
                # Detect tables
                tables = await self._extract_tables(image)
                
                # Detect forms
                forms = await self._detect_forms(image)
                
                results.append({
                    'page': idx + 1,
                    'text': text,
                    'tables': tables,
                    'forms': forms
                })
                
            return ExtractedData(
                source="PDF",
                data_type="document",
                content=results,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting PDF data: {e}")
            return None
            
    async def _pdf_to_images(self, pdf_content: bytes) -> List[Image.Image]:
        """Convert PDF content to a list of PIL Images
        
        Args:
            pdf_content: Raw PDF file content as bytes
            
        Returns:
            List of PIL Image objects, one per page
        """
        images = []
        try:
            # Save PDF content to a temporary file
            temp_file = "temp_pdf.pdf"
            with open(temp_file, "wb") as f:
                f.write(pdf_content)
            
            # Count pages in the PDF
            reader = self.PdfReader(temp_file)
            total_pages = len(reader.pages)
            
            # Convert PDF pages to images
            images = self.pdf2image.convert_from_path(
                temp_file,
                dpi=300,  # Higher DPI for better OCR
                fmt="ppm"
            )
            
            # Clean up temporary file
            if os.path.exists(temp_file):
                os.remove(temp_file)
                
            self.logger.info(f"Converted {total_pages} PDF pages to images")
            
        except Exception as e:
            self.logger.error(f"Error converting PDF to images: {e}")
            
        return images
        
    async def _extract_tables(self, image) -> List[Dict]:
        """Extract tables from image using advanced detection"""
        tables = []
        try:
            # Convert to grayscale
            gray = image.convert('L')
            
            # Use pytesseract to detect table structure
            custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz|-.,$% "'
            data = pytesseract.image_to_data(
                gray,
                config=custom_config,
                output_type=pytesseract.Output.DICT
            )
            
            # Analyze text positions to detect table structures
            tables = self._analyze_table_structure(data)
            
        except Exception as e:
            self.logger.error(f"Error extracting tables: {e}")
            
        return tables
        
    def _analyze_table_structure(self, ocr_data: Dict) -> List[Dict]:
        """Analyze OCR data to identify table structures
        
        Args:
            ocr_data: OCR data dictionary from pytesseract
            
        Returns:
            List of detected tables with their structure and content
        """
        tables = []
        try:
            # Extract text, bounding boxes, and confidence levels
            words = ocr_data['text']
            left = ocr_data['left']
            top = ocr_data['top']
            width = ocr_data['width']
            height = ocr_data['height']
            conf = ocr_data['conf']
            
            # Filter out low-confidence and empty strings
            valid_indices = []
            for i, (word, confidence) in enumerate(zip(words, conf)):
                if confidence > 0 and word.strip():
                    valid_indices.append(i)
            
            if not valid_indices:
                return []
            
            # Identify potential table rows by analyzing vertical positions
            y_positions = [top[i] for i in valid_indices]
            row_clusters = self._cluster_rows(y_positions)
            
            # If we have enough rows, start forming a table
            if len(row_clusters) > 2:  # At least 3 rows (header + 2 data rows)
                # Identify columns by analyzing horizontal alignment
                columns = self._identify_columns(valid_indices, left, width, row_clusters)
                
                # Form table with extracted cells
                table_data = self._extract_table_content(valid_indices, words, row_clusters, columns, left)
                
                tables.append({
                    'rows': len(row_clusters),
                    'columns': len(columns),
                    'data': table_data
                })
                
        except Exception as e:
            self.logger.error(f"Error analyzing table structure: {e}")
            
        return tables
    
    def _cluster_rows(self, y_positions: List[int], threshold: int = 10) -> List[List[int]]:
        """Group y-positions into row clusters
        
        Args:
            y_positions: List of y-coordinates of text elements
            threshold: Maximum vertical distance for elements in the same row
            
        Returns:
            List of row clusters, each containing indices of elements in that row
        """
        if not y_positions:
            return []
            
        # Sort positions by y-coordinate
        sorted_indices = sorted(range(len(y_positions)), key=lambda i: y_positions[i])
        sorted_y = [y_positions[i] for i in sorted_indices]
        
        # Cluster into rows
        rows = [[sorted_indices[0]]]
        current_row = 0
        
        for i in range(1, len(sorted_indices)):
            if sorted_y[i] - sorted_y[i-1] <= threshold:
                # Same row
                rows[current_row].append(sorted_indices[i])
            else:
                # New row
                rows.append([sorted_indices[i]])
                current_row += 1
                
        return rows
    
    def _identify_columns(self, valid_indices: List[int], left: List[int], width: List[int], 
                           row_clusters: List[List[int]], tolerance: int = 20) -> List[int]:
        """Identify table columns based on horizontal alignment
        
        Args:
            valid_indices: Indices of valid text elements
            left: Left positions of all text elements
            width: Widths of all text elements
            row_clusters: Row clusters from _cluster_rows
            tolerance: Horizontal position tolerance for column alignment
            
        Returns:
            List of column x-positions (left edges)
        """
        # Get all x-positions
        x_positions = []
        for row in row_clusters:
            for idx in row:
                element_idx = valid_indices[idx]
                x_positions.append(left[element_idx])
        
        # Find column boundaries through clustering
        column_positions = []
        if x_positions:
            # Sort positions
            x_positions.sort()
            
            # Initialize with the first position
            column_positions = [x_positions[0]]
            
            # Add other positions that are not too close to existing ones
            for pos in x_positions[1:]:
                if all(abs(pos - col) > tolerance for col in column_positions):
                    column_positions.append(pos)
        
        # Sort column positions from left to right
        column_positions.sort()
        return column_positions
    
    def _extract_table_content(self, valid_indices: List[int], words: List[str],
                                row_clusters: List[List[int]], columns: List[int], left: List[int]) -> List[List[str]]:
        """Extract table content organized into rows and columns
        
        Args:
            valid_indices: Indices of valid text elements
            words: Text of all elements
            row_clusters: Row clusters from _cluster_rows
            columns: Column positions from _identify_columns
            left: Left positions of all text elements
            
        Returns:
            2D array of table cell contents
        """
        table_data = []
        
        # Initialize empty table
        for _ in range(len(row_clusters)):
            table_data.append([''] * len(columns))
        
        # Fill in table cells
        for row_idx, row_cluster in enumerate(row_clusters):
            for idx in row_cluster:
                element_idx = valid_indices[idx]
                word = words[element_idx]
                
                # Determine which column this word belongs to
                word_pos = left[element_idx]
                col_idx = 0
                
                # Find the nearest column
                min_distance = float('inf')
                for i, col_pos in enumerate(columns):
                    distance = abs(word_pos - col_pos)
                    if distance < min_distance:
                        min_distance = distance
                        col_idx = i
                
                # Add word to the corresponding cell
                table_data[row_idx][col_idx] += f" {word}".strip()
        
        return table_data
            
    async def _detect_forms(self, image) -> List[Dict]:
        """Detect form fields in an image
        
        Args:
            image: PIL Image object
            
        Returns:
            List of detected form fields with their positions and types
        """
        forms = []
        try:
            # Convert to grayscale
            gray = image.convert('L')
            
            # Use OCR to detect text that might be form labels
            custom_config = r'--oem 3 --psm 6'
            data = pytesseract.image_to_data(
                gray,
                config=custom_config,
                output_type=pytesseract.Output.DICT
            )
            
            # Keywords that suggest form fields
            form_field_keywords = [
                'name', 'address', 'city', 'state', 'zip', 'phone', 'email',
                'date', 'signature', 'sign', 'print', 'number', 'amount', 'total',
                'payment', 'credit', 'check', 'account', 'id', 'ssn', 'social'
            ]
            
            # Look for form field labels
            for i, text in enumerate(data['text']):
                text_lower = text.lower()
                
                # Check if text matches known form field patterns
                if any(keyword in text_lower for keyword in form_field_keywords):
                    # This might be a form field label
                    forms.append({
                        'type': 'text_field',  # Default assumption
                        'label': text,
                        'position': {
                            'x': data['left'][i],
                            'y': data['top'][i],
                            'width': data['width'][i],
                            'height': data['height'][i]
                        }
                    })
                    
                    # Determine field type based on label
                    if 'date' in text_lower:
                        forms[-1]['type'] = 'date_field'
                    elif 'check' in text_lower or 'select' in text_lower:
                        forms[-1]['type'] = 'checkbox'
                    elif 'signature' in text_lower or 'sign' in text_lower:
                        forms[-1]['type'] = 'signature_field'
            
        except Exception as e:
            self.logger.error(f"Error detecting forms: {e}")
            
        return forms

class ZillowExtractor(BaseExtractor):
    """Extractor for Zillow property data"""
    
    async def can_handle(self, url: str) -> bool:
        return 'zillow.com' in url
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'property_info': {},
            'price_history': [],
            'tax_history': [],
            'schools': [],
            'neighborhood': {}
        }
        
        try:
            if self.driver:
                # Wait for dynamic content
                WebDriverWait(self.driver, 10).until(
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, "[data-testid='home-details-summary']")
                    )
                )
                
                # Extract property details
                data['property_info'] = await self._extract_property_info()
                
                # Extract price history
                data['price_history'] = await self._extract_price_history()
                
                # Extract tax history
                data['tax_history'] = await self._extract_tax_history()
                
                # Extract school information
                data['schools'] = await self._extract_schools()
                
                # Extract neighborhood data
                data['neighborhood'] = await self._extract_neighborhood()
                
            return ExtractedData(
                source="Zillow",
                data_type="property_details",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting Zillow data: {e}")
            return None
            
    async def _extract_property_info(self) -> Dict:
        """Extract detailed property information"""
        info = {}
        try:
            # Basic details
            summary = self.driver.find_element(
                By.CSS_SELECTOR,
                "[data-testid='home-details-summary']"
            )
            info['summary'] = summary.text
            
            # Facts and features
            facts = self.driver.find_elements(
                By.CSS_SELECTOR,
                "[data-testid='facts-list'] > li"
            )
            for fact in facts:
                label = fact.find_element(By.CSS_SELECTOR, ".fact-label").text
                value = fact.find_element(By.CSS_SELECTOR, ".fact-value").text
                info[label.lower().replace(' ', '_')] = value
                
        except Exception as e:
            self.logger.error(f"Error extracting property info: {e}")
            
        return info

class RealtyTracExtractor(BaseExtractor):
    """Extractor for RealtyTrac foreclosure data"""
    
    async def can_handle(self, url: str) -> bool:
        return 'realtytrac.com' in url
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'property_info': {},
            'foreclosure_status': {},
            'auction_details': {},
            'tax_info': {},
            'market_stats': {}
        }
        
        try:
            if self.driver:
                # Extract property information
                data['property_info'] = await self._extract_property_details()
                
                # Extract foreclosure status
                data['foreclosure_status'] = await self._extract_foreclosure_status()
                
                # Extract auction details if available
                data['auction_details'] = await self._extract_auction_details()
                
                # Extract tax information
                data['tax_info'] = await self._extract_tax_info()
                
                # Extract market statistics
                data['market_stats'] = await self._extract_market_stats()
                
            return ExtractedData(
                source="RealtyTrac",
                data_type="foreclosure_details",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting RealtyTrac data: {e}")
            return None

class RedfinExtractor(BaseExtractor):
    """Extractor for Redfin property data"""
    
    async def can_handle(self, url: str) -> bool:
        return 'redfin.com' in url
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        data = {
            'property_info': {},
            'price_insights': {},
            'property_history': [],
            'schools': [],
            'walk_score': {},
            'climate_risk': {}
        }
        
        try:
            if self.driver:
                # Extract property details
                data['property_info'] = await self._extract_property_details()
                
                # Extract price insights
                data['price_insights'] = await self._extract_price_insights()
                
                # Extract property history
                data['property_history'] = await self._extract_property_history()
                
                # Extract school information
                data['schools'] = await self._extract_schools()
                
                # Extract walk score
                data['walk_score'] = await self._extract_walk_score()
                
                # Extract climate risk data
                data['climate_risk'] = await self._extract_climate_risk()
                
            return ExtractedData(
                source="Redfin",
                data_type="property_details",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting Redfin data: {e}")
            return None

class TownExtractor(BaseExtractor):
    """Enhanced extractor for town/city websites"""
    
    def __init__(self, session: aiohttp.ClientSession, driver=None):
        super().__init__(session, driver)
        self.town_patterns = {
            'bath': {
                'domain': 'cityofbath.com',
                'patterns': {
                    'property': r'/assessor|/property',
                    'permits': r'/permits|/codes',
                    'planning': r'/planning|/zoning',
                    'meetings': r'/meetings|/agenda',
                    'documents': r'/documents|/records'
                }
            },
            'topsham': {
                'domain': 'topshammaine.com',
                'patterns': {
                    'property': r'/assessing|/property',
                    'permits': r'/codes|/permits',
                    'planning': r'/planning|/development',
                    'meetings': r'/meetings|/calendar',
                    'documents': r'/documents|/forms'
                }
            },
            'harpswell': {
                'domain': 'harpswell.maine.gov',
                'patterns': {
                    'property': r'/assessing|/property',
                    'permits': r'/codes|/permits',
                    'planning': r'/planning|/development',
                    'meetings': r'/meetings|/calendar',
                    'documents': r'/documents|/forms'
                }
            },
            'freeport': {
                'domain': 'freeportmaine.com',
                'patterns': {
                    'property': r'/assessor|/property',
                    'permits': r'/permits|/codes',
                    'planning': r'/planning|/zoning',
                    'meetings': r'/meetings|/agenda',
                    'documents': r'/documents|/records'
                }
            }
        }
        
    async def can_handle(self, url: str) -> bool:
        return any(
            pattern['domain'] in url 
            for pattern in self.town_patterns.values()
        )
        
    async def extract(self, url: str, soup: BeautifulSoup) -> ExtractedData:
        # Identify town
        town = next(
            (name for name, pattern in self.town_patterns.items()
             if pattern['domain'] in url),
            None
        )
        
        if not town:
            return None
            
        # Determine content type
        patterns = self.town_patterns[town]['patterns']
        content_type = next(
            (ctype for ctype, pattern in patterns.items()
             if re.search(pattern, url)),
            'general'
        )
        
        # Extract based on content type
        if content_type == 'property':
            return await self._extract_property_data(url, soup, town)
        elif content_type == 'permits':
            return await self._extract_permit_data(url, soup, town)
        elif content_type == 'planning':
            return await self._extract_planning_data(url, soup, town)
        elif content_type == 'meetings':
            return await self._extract_meeting_data(url, soup, town)
        elif content_type == 'documents':
            return await self._extract_document_data(url, soup, town)
        else:
            return await self._extract_general_data(url, soup, town)
            
    async def _extract_property_data(
        self,
        url: str,
        soup: BeautifulSoup,
        town: str
    ) -> ExtractedData:
        """Extract property-related data"""
        data = {
            'assessments': [],
            'tax_maps': [],
            'property_cards': [],
            'recent_sales': []
        }
        
        try:
            if self.driver:
                # Extract assessment data
                assessment_elements = self.driver.find_elements(
                    By.CSS_SELECTOR,
                    "[class*='assessment'], [class*='property']"
                )
                for element in assessment_elements:
                    assessment = {
                        'title': element.get_attribute('title'),
                        'link': element.get_attribute('href'),
                        'description': element.text
                    }
                    data['assessments'].append(assessment)
                    
                # Extract tax maps
                map_elements = self.driver.find_elements(
                    By.CSS_SELECTOR,
                    "a[href*='map'], a[href*='gis']"
                )
                for element in map_elements:
                    map_data = {
                        'title': element.get_attribute('title'),
                        'link': element.get_attribute('href'),
                        'type': 'pdf' if '.pdf' in element.get_attribute('href') else 'web'
                    }
                    data['tax_maps'].append(map_data)
                    
                # Extract property cards
                card_elements = self.driver.find_elements(
                    By.CSS_SELECTOR,
                    "a[href*='card'], a[href*='property-record']"
                )
                for element in card_elements:
                    card = {
                        'title': element.get_attribute('title'),
                        'link': element.get_attribute('href'),
                        'date': element.get_attribute('data-date')
                    }
                    data['property_cards'].append(card)
                    
                # Extract recent sales
                sales_elements = self.driver.find_elements(
                    By.CSS_SELECTOR,
                    "[class*='sales'], [class*='transfer']"
                )
                for element in sales_elements:
                    sale = {
                        'date': element.get_attribute('data-date'),
                        'price': element.get_attribute('data-price'),
                        'address': element.get_attribute('data-address'),
                        'type': element.get_attribute('data-type')
                    }
                    data['recent_sales'].append(sale)
                    
            return ExtractedData(
                source=f"{town.title()}Gov",
                data_type="property_data",
                content=data,
                metadata={'url': url}
            )
            
        except Exception as e:
            self.logger.error(f"Error extracting property data: {e}")
            return None
