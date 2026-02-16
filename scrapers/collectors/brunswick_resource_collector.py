"""
Specialized collector for Brunswick's official property and tax resources
"""
import aiohttp
import asyncio
from bs4 import BeautifulSoup
import logging
from typing import Dict, List, Optional
import pandas as pd
import PyPDF2
import io
import re
from datetime import datetime

class BrunswickResourceCollector:
    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.cache_dir = config.get('cache_dir', 'cache')
        self.session = None
        
        # Core resource URLs
        self.urls = {
            'commitment_books': {
                'real_estate': 'https://www.brunswickme.gov/DocumentCenter/View/9924/2024-Real-Estate-Commitment-Book',
                'personal_property': 'https://www.brunswickme.gov/DocumentCenter/View/9923/2024-Personal-Property-Commitment-Book'
            },
            'tax_maps': {
                'index': 'https://www.brunswickme.gov/DocumentCenter/View/1259/Index-Map',
                'maps': [f'https://www.brunswickme.gov/DocumentCenter/View/{1259 + i}/Map-{i}' for i in range(1, 30)]
            },
            'property_search': {
                'cards': 'https://gis.vgsi.com/brunswickme/Default.aspx',
                'deeds': 'https://i2k.uslandrecords.com/ME/Cumberland/D/Default.aspx',
                'gis': 'https://experience.arcgis.com/experience/d25390b67f374b7986ccabb1554ecfca'
            },
            'sales_books': {
                '2023_2024': 'https://www.brunswickme.gov/581/Revaluation',
                '2024_2025': 'https://www.brunswickme.gov/581/Revaluation'
            },
            'tax_bills': {
                'real_estate': {
                    '2024': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/164',
                    '2023': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/151',
                    '2022': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/143',
                    '2021': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/134',
                    '2020': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/119'
                },
                'personal_property': {
                    '2024': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/165',
                    '2023': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/152',
                    '2022': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/144',
                    '2021': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/135',
                    '2020': 'https://www.brunswickme.gov/ArchiveCenter/ViewFile/Item/120'
                }
            }
        }
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def get_commitment_data(self, year: int = 2024) -> Dict:
        """Get data from commitment books"""
        data = {
            'real_estate': [],
            'personal_property': []
        }
        
        try:
            # Get real estate commitments
            real_estate_data = await self._extract_pdf_data(
                self.urls['commitment_books']['real_estate']
            )
            if real_estate_data:
                data['real_estate'] = real_estate_data
                
            # Get personal property commitments
            personal_property_data = await self._extract_pdf_data(
                self.urls['commitment_books']['personal_property']
            )
            if personal_property_data:
                data['personal_property'] = personal_property_data
                
        except Exception as e:
            self.logger.error(f"Error getting commitment data: {e}")
            
        return data
        
    async def get_tax_map_data(self, map_numbers: Optional[List[int]] = None) -> Dict:
        """Get tax map data for specified map numbers"""
        data = {
            'index': None,
            'maps': {}
        }
        
        try:
            # Get index map
            index_data = await self._extract_pdf_data(self.urls['tax_maps']['index'])
            if index_data:
                data['index'] = index_data
                
            # Get specific maps
            if map_numbers:
                for map_num in map_numbers:
                    if 1 <= map_num <= 29:
                        map_data = await self._extract_pdf_data(
                            self.urls['tax_maps']['maps'][map_num - 1]
                        )
                        if map_data:
                            data['maps'][map_num] = map_data
                            
        except Exception as e:
            self.logger.error(f"Error getting tax map data: {e}")
            
        return data
        
    async def get_property_data(self, property_id: str) -> Dict:
        """Get property data from various sources"""
        data = {
            'card': None,
            'deed': None,
            'gis': None
        }
        
        try:
            # Get property card
            card_data = await self._scrape_property_card(property_id)
            if card_data:
                data['card'] = card_data
                
            # Get deed information
            deed_data = await self._scrape_deed_info(property_id)
            if deed_data:
                data['deed'] = deed_data
                
            # Get GIS data
            gis_data = await self._scrape_gis_data(property_id)
            if gis_data:
                data['gis'] = gis_data
                
        except Exception as e:
            self.logger.error(f"Error getting property data: {e}")
            
        return data
        
    async def get_sales_data(self, year: int = 2024) -> List[Dict]:
        """Get sales data from sales books"""
        sales = []
        
        try:
            # Determine which sales book to use
            if year == 2024:
                url = self.urls['sales_books']['2024_2025']
            else:
                url = self.urls['sales_books']['2023_2024']
                
            sales_data = await self._extract_pdf_data(url)
            if sales_data:
                sales = self._parse_sales_data(sales_data)
                
        except Exception as e:
            self.logger.error(f"Error getting sales data: {e}")
            
        return sales
        
    async def get_tax_bill_data(
        self,
        year: int = 2024,
        bill_type: str = 'real_estate'
    ) -> List[Dict]:
        """Get tax bill data"""
        bills = []
        
        try:
            # Get URL for specified year and type
            url = self.urls['tax_bills'][bill_type].get(str(year))
            if url:
                bill_data = await self._extract_pdf_data(url)
                if bill_data:
                    bills = self._parse_tax_bill_data(bill_data)
                    
        except Exception as e:
            self.logger.error(f"Error getting tax bill data: {e}")
            
        return bills
        
    async def _extract_pdf_data(self, url: str) -> Optional[str]:
        """Extract text from PDF URL"""
        try:
            async with self.session.get(url) as response:
                if response.status == 200:
                    pdf_content = await response.read()
                    pdf_file = io.BytesIO(pdf_content)
                    
                    reader = PyPDF2.PdfReader(pdf_file)
                    text = ""
                    for page in reader.pages:
                        text += page.extract_text()
                        
                    return text
                    
        except Exception as e:
            self.logger.error(f"Error extracting PDF data: {e}")
            
        return None
        
    async def _scrape_property_card(self, property_id: str) -> Optional[Dict]:
        """Scrape property card data from Vision Government Solutions"""
        try:
            url = f"{self.urls['property_search']['cards']}?pid={property_id}"
            async with self.session.get(url) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    data = {}
                    
                    # Extract property details
                    details = soup.find('div', {'id': 'MainContent_lblGeneral'})
                    if details:
                        data['details'] = self._parse_property_details(details)
                        
                    # Extract assessment info
                    assessment = soup.find('div', {'id': 'MainContent_lblAssess'})
                    if assessment:
                        data['assessment'] = self._parse_assessment(assessment)
                        
                    return data
                    
        except Exception as e:
            self.logger.error(f"Error scraping property card: {e}")
            
        return None
        
    def _parse_property_details(self, element: BeautifulSoup) -> Dict:
        """Parse property details from Vision Government Solutions"""
        details = {}
        try:
            # Extract property information
            for row in element.find_all('tr'):
                label = row.find('td', {'class': 'DataletLabel'})
                value = row.find('td', {'class': 'DataletData'})
                if label and value:
                    key = label.text.strip().lower().replace(' ', '_')
                    details[key] = value.text.strip()
        except Exception as e:
            self.logger.error(f"Error parsing property details: {e}")
        return details
        
    def _parse_assessment(self, element: BeautifulSoup) -> Dict:
        """Parse assessment data from Vision Government Solutions"""
        assessment = {}
        try:
            # Extract assessment values
            for row in element.find_all('tr'):
                label = row.find('td', {'class': 'DataletLabel'})
                value = row.find('td', {'class': 'DataletData'})
                if label and value:
                    key = label.text.strip().lower().replace(' ', '_')
                    # Convert currency strings to numbers
                    val_text = value.text.strip()
                    if '$' in val_text:
                        val_text = val_text.replace('$', '').replace(',', '')
                        assessment[key] = float(val_text)
                    else:
                        assessment[key] = val_text
        except Exception as e:
            self.logger.error(f"Error parsing assessment: {e}")
        return assessment
