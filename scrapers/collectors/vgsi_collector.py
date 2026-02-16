"""
VGSI-specific collector for property data from Vision Government Solutions

This collector is designed to retrieve property data from Vision Government Solutions (VGSI) websites
used by many municipalities in New England for property assessment information.
"""
import logging
import time
import random
import json
import os
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any, Set
import pandas as pd
import traceback

# Selenium imports - used for web scraping
SELENIUM_AVAILABLE = False
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException, NoSuchElementException, StaleElementReferenceException
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager
    from selenium.webdriver.chrome.options import Options
    SELENIUM_AVAILABLE = True
except ImportError:
    logging.warning("Selenium not available. Install with: pip install -r requirements-vgsi.txt")

from .base_collector import BaseCollector

class VGSICollector(BaseCollector):
    """Collects property data from VGSI websites across multiple New England towns"""
    
    def __init__(self, town: str = "brunswick", state: str = "me"):
        """
        Initialize the VGSI collector for a specific town
        
        Args:
            town: Town/city name (lowercase)
            state: State abbreviation (lowercase, e.g., 'me' for Maine)
        """
        super().__init__()
        
        # Set up town-specific configuration
        self.town = town.lower()
        self.state = state.lower()
        self.base_url = f'https://gis.vgsi.com/{self.town}{self.state}/Default.aspx'
        
        # Track dependency status
        self.selenium_available = SELENIUM_AVAILABLE
        
        # Set up paths
        self.base_path = Path(__file__).parent.parent.parent
        self.cache_dir = self.base_path / 'data' / 'cache' / 'vgsi' / f"{self.town}_{self.state}"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Sample data path
        self.sample_data_path = self.base_path / 'data' / 'sample_data' / 'vgsi'
        self.sample_data_path.mkdir(parents=True, exist_ok=True)
        
        # Checkpoint file for resuming interrupted collections
        self.checkpoint_file = self.cache_dir / "collection_checkpoint.json"
        
        # Metrics tracking
        self.metrics = {
            'start_time': None,
            'end_time': None,
            'total_streets': 0,
            'processed_streets': 0,
            'total_properties': 0,
            'collected_properties': 0,
            'errors': [],
            'skipped_streets': [],
            'skipped_properties': [],
            'status': 'not_started'  # not_started, in_progress, completed, failed
        }
        
        # Collection state
        self.collected_properties = set()
        self.processed_streets = set()
        self.driver = None
        self.wait = None
        
        # Log dependency status
        if not self.selenium_available:
            self.logger.warning(
                "Selenium not available. Using sample data mode. "
                "Install dependencies with: pip install -r requirements-vgsi.txt"
            )
        else:
            self.setup_driver()
        
    def setup_driver(self):
        """Setup Selenium WebDriver with Chrome"""
        if not self.selenium_available:
            self.logger.warning("Cannot setup WebDriver - Selenium not available")
            return
            
        try:
            chrome_options = Options()
            chrome_options.add_argument('--headless')  # Run in headless mode
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            
            # Add additional options to avoid detection
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_argument('--disable-infobars')
            chrome_options.add_experimental_option('excludeSwitches', ['enable-automation'])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            
            # Add user agent
            chrome_options.add_argument('user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            
            # Execute CDP commands to avoid detection
            self.driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
                'source': '''
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    })
                '''
            })
            
            self.wait = WebDriverWait(self.driver, 15)  # Increased timeout
            self.logger.info("WebDriver setup successful")
        except Exception as e:
            self.logger.error(f"Failed to setup WebDriver: {str(e)}")
            self.driver = None
            self.wait = None
            
    def collect(self, max_properties: int = 100) -> Dict:
        """
        Collect property data from VGSI
        
        Args:
            max_properties: Maximum number of properties to collect
            
        Returns:
            Dictionary containing collected property data
        """
        # Check if dependencies are available
        if not self.selenium_available or not self.driver:
            self.logger.warning("Selenium not available, returning sample data")
            return self._get_sample_data()
            
        # Initialize results container
        data = {
            'properties': [],
            'metadata': {
                'source': f'VGSI {self.town.capitalize()}, {self.state.upper()}',
                'timestamp': datetime.now().isoformat(),
                'total_collected': 0,
                'max_properties': max_properties,
                'using_sample_data': False
            }
        }
        
        # Check for cached data first
        cache_file = self.cache_dir / f"{self.town}_{self.state}_properties.json"
        if cache_file.exists():
            try:
                with open(cache_file, 'r') as f:
                    cached_data = json.load(f)
                
                # If we already have more properties than requested, just return the cached data
                if len(cached_data.get('properties', [])) >= max_properties:
                    self.logger.info(f"Using cached data with {len(cached_data['properties'])} properties")
                    cached_data['metadata']['cache_used'] = True
                    cached_data['metadata']['cache_time'] = cached_data['metadata'].get('timestamp')
                    cached_data['metadata']['timestamp'] = datetime.now().isoformat()
                    return cached_data
                
                # Otherwise, use the cached data as a starting point
                data = cached_data
                self.collected_properties = set(p.get('parcel_id') for p in data['properties'])
                self.logger.info(f"Starting with {len(data['properties'])} properties from cache")
            except Exception as e:
                self.logger.error(f"Error loading cached data: {str(e)}")
        
        # Load checkpoint if available
        if self.checkpoint_file.exists():
            try:
                with open(self.checkpoint_file, 'r') as f:
                    checkpoint = json.load(f)
                    
                self.metrics = checkpoint.get('metrics', self.metrics)
                self.processed_streets = set(checkpoint.get('processed_streets', []))
                self.collected_properties = set(checkpoint.get('collected_properties', []))
                
                # Update the status to in_progress
                self.metrics['status'] = 'in_progress'
                
                self.logger.info(f"Resuming from checkpoint: {len(self.processed_streets)} streets processed, {len(self.collected_properties)} properties collected")
            except Exception as e:
                self.logger.error(f"Error loading checkpoint: {str(e)}")
        
        # Start metrics tracking if not already started
        if not self.metrics['start_time']:
            self.metrics['start_time'] = datetime.now().isoformat()
            self.metrics['status'] = 'in_progress'
        
        try:
            # Navigate to the site and accept terms
            self.driver.get(self.base_url)
            self._accept_terms()
            
            # Start with street search
            properties = self._collect_by_street(max_properties - len(data['properties']))
            
            # Add new properties to the results
            for property_data in properties:
                if property_data.get('parcel_id') not in self.collected_properties:
                    data['properties'].append(property_data)
                    self.collected_properties.add(property_data.get('parcel_id'))
            
            # Update metadata
            data['metadata']['total_collected'] = len(data['properties'])
            data['metadata']['collection_completed'] = datetime.now().isoformat()
            
            # Update metrics
            self.metrics['end_time'] = datetime.now().isoformat()
            self.metrics['total_properties'] = len(self.collected_properties)
            self.metrics['collected_properties'] = len(data['properties'])
            self.metrics['status'] = 'completed'
            
            # Save the data to cache
            self._save_to_cache(data)
            
            # Save final metrics
            self._save_metrics()
            
            # Clean up checkpoint file if collection was successful
            if self.checkpoint_file.exists():
                os.remove(self.checkpoint_file)
                self.logger.info("Removed checkpoint file after successful collection")
            
            return data
            
        except Exception as e:
            self.logger.error(f"Error collecting VGSI data: {str(e)}")
            self.logger.error(traceback.format_exc())
            
            # Update metrics
            self.metrics['end_time'] = datetime.now().isoformat()
            self.metrics['status'] = 'failed'
            self.metrics['errors'].append({
                'time': datetime.now().isoformat(),
                'error': str(e),
                'traceback': traceback.format_exc()
            })
            
            # Save checkpoint for resuming later
            self._save_checkpoint()
            
            # Save partial data if we have any
            if data['properties']:
                data['metadata']['partial_collection'] = True
                data['metadata']['error'] = str(e)
                self._save_to_cache(data)
                return data
            else:
                return self._get_sample_data()
        finally:
            self.cleanup()
            
    def _accept_terms(self):
        """Accept terms and conditions if present"""
        try:
            accept_button = self.wait.until(
                EC.element_to_be_clickable((By.ID, "btnAccept"))
            )
            accept_button.click()
            time.sleep(2)  # Wait for page to load
        except TimeoutException:
            self.logger.info("No terms acceptance needed")
            
    def _collect_by_street(self, max_properties: int) -> List[Dict]:
        """Collect properties by searching street by street"""
        properties = []
        try:
            # Navigate to search page with delay
            time.sleep(2)
            
            # Click street search with retry
            for attempt in range(3):
                try:
                    street_search = self.wait.until(
                        EC.element_to_be_clickable((By.ID, "btnStreetSearch"))
                    )
                    street_search.click()
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    time.sleep(2)
            
            # Get list of streets with retry
            for attempt in range(3):
                try:
                    street_select = self.wait.until(
                        EC.presence_of_element_located((By.ID, "ddlStreet"))
                    )
                    streets = [option.text for option in street_select.find_elements(By.TAG_NAME, "option")]
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    time.sleep(2)
            
            # Update metrics with total streets
            self.metrics['total_streets'] = len(streets) - 1  # Skip first empty option
            
            # Process streets with random delays
            for street in streets[1:]:  # Skip first empty option
                if street in self.processed_streets:
                    self.logger.info(f"Skipping already processed street: {street}")
                    continue
                    
                if len(properties) >= max_properties:
                    self.logger.info(f"Reached maximum properties limit ({max_properties})")
                    break
                
                # Add random delay between streets
                time.sleep(2 + random.random() * 2)
                
                try:
                    street_properties = self._collect_street_properties(street)
                    if street_properties:
                        properties.extend(street_properties)
                        self.logger.info(f"Collected {len(properties)} properties so far")
                    
                    # Mark this street as processed
                    self.processed_streets.add(street)
                    
                    # Update metrics
                    self.metrics['processed_streets'] = len(self.processed_streets)
                    
                    # Save checkpoint after each street
                    self._save_checkpoint()
                    
                except Exception as e:
                    self.logger.error(f"Error collecting street {street}: {str(e)}")
                    self.metrics['skipped_streets'].append({
                        'street': street,
                        'error': str(e),
                        'time': datetime.now().isoformat()
                    })
                    
                    # If this is a timeout error, refresh the session
                    if 'timeout' in str(e).lower():
                        self.logger.info("Attempting to refresh session...")
                        self.refresh_session()
                
        except Exception as e:
            self.logger.error(f"Error in street collection: {str(e)}")
            self.metrics['errors'].append({
                'time': datetime.now().isoformat(),
                'error': str(e),
                'location': 'street_collection',
                'traceback': traceback.format_exc()
            })
            
            if 'timeout' in str(e).lower():
                self.logger.info("Attempting to refresh session...")
                self.refresh_session()
            
        return properties
        
    def _collect_street_properties(self, street: str) -> List[Dict]:
        """Collect all properties for a given street"""
        properties = []
        try:
            # Select street
            street_select = self.wait.until(
                EC.presence_of_element_located((By.ID, "ddlStreet"))
            )
            street_select.send_keys(street)
            
            # Click search
            search_button = self.wait.until(
                EC.element_to_be_clickable((By.ID, "btnSearch"))
            )
            search_button.click()
            
            # Get property links
            property_links = self.wait.until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "a[href*='Parcel.aspx']"))
            )
            
            self.logger.info(f"Found {len(property_links)} properties on {street}")
            
            for link in property_links:
                try:
                    property_url = link.get_attribute('href')
                    
                    # Check if we've already processed this property
                    parcel_id = self._extract_parcel_id_from_url(property_url)
                    if parcel_id and parcel_id in self.collected_properties:
                        self.logger.debug(f"Skipping already collected property: {parcel_id}")
                        continue
                    
                    # Add small delay between properties
                    time.sleep(0.5 + random.random())
                    
                    property_data = self._collect_property_details(property_url)
                    if property_data:
                        properties.append(property_data)
                        # Add to collected properties set
                        if property_data.get('parcel_id'):
                            self.collected_properties.add(property_data['parcel_id'])
                    
                except Exception as e:
                    self.logger.error(f"Error collecting property on {street}: {str(e)}")
                    self.metrics['skipped_properties'].append({
                        'street': street,
                        'url': link.get_attribute('href') if hasattr(link, 'get_attribute') else "unknown",
                        'error': str(e),
                        'time': datetime.now().isoformat()
                    })
                    
        except Exception as e:
            self.logger.error(f"Error collecting street {street}: {str(e)}")
            self.metrics['errors'].append({
                'time': datetime.now().isoformat(),
                'error': str(e),
                'location': 'street_properties',
                'street': street,
                'traceback': traceback.format_exc()
            })
            
        return properties
        
    def _collect_property_details(self, property_url: str) -> Optional[Dict]:
        """Collect details for a specific property"""
        try:
            self.driver.get(property_url)
            time.sleep(1)  # Wait for page load
            
            # Extract basic property details
            basic_details = {
                'parcel_id': self._safe_get_text("lblParcelID"),
                'location': self._safe_get_text("lblLocation"),
                'owner': self._safe_get_text("lblOwner"),
                'assessment': self._safe_get_text("lblTotal"),
                'land_area': self._safe_get_text("lblLandArea"),
                'property_type': self._safe_get_text("lblUseCode"),
                'year_built': self._safe_get_text("lblYearBuilt"),
                'url': property_url
            }
            
            # Extract additional details from other sections
            building_details = self._extract_building_details()
            land_details = self._extract_land_details()
            sales_history = self._extract_sales_history()
            
            # Combine all details
            property_data = {
                **basic_details,
                'building': building_details,
                'land': land_details,
                'sales_history': sales_history,
                'last_updated': datetime.now().isoformat()
            }
            
            return property_data
            
        except Exception as e:
            self.logger.error(f"Error collecting property details from {property_url}: {str(e)}")
            self.metrics['errors'].append({
                'time': datetime.now().isoformat(),
                'error': str(e),
                'location': 'property_details',
                'url': property_url,
                'traceback': traceback.format_exc()
            })
            return None
            
    def _extract_building_details(self) -> Dict:
        """Extract building details from the property page"""
        try:
            # Look for building details section
            details = {}
            
            # Try to find building card elements
            building_elements = self.driver.find_elements(By.CSS_SELECTOR, "div.card")
            for element in building_elements:
                title = element.find_element(By.CSS_SELECTOR, "div.card-header").text
                if "BUILDING" in title.upper():
                    # Extract details from this card
                    rows = element.find_elements(By.CSS_SELECTOR, "tr")
                    for row in rows:
                        cells = row.find_elements(By.CSS_SELECTOR, "td")
                        if len(cells) >= 2:
                            key = cells[0].text.strip().lower().replace(' ', '_')
                            value = cells[1].text.strip()
                            if key and value:
                                details[key] = value
            
            return details
            
        except Exception as e:
            self.logger.error(f"Error extracting building details: {str(e)}")
            return {}
            
    def _extract_land_details(self) -> Dict:
        """Extract land details from the property page"""
        try:
            # Look for land details section
            details = {}
            
            # Try to find land card elements
            land_elements = self.driver.find_elements(By.CSS_SELECTOR, "div.card")
            for element in land_elements:
                title = element.find_element(By.CSS_SELECTOR, "div.card-header").text
                if "LAND" in title.upper():
                    # Extract details from this card
                    rows = element.find_elements(By.CSS_SELECTOR, "tr")
                    for row in rows:
                        cells = row.find_elements(By.CSS_SELECTOR, "td")
                        if len(cells) >= 2:
                            key = cells[0].text.strip().lower().replace(' ', '_')
                            value = cells[1].text.strip()
                            if key and value:
                                details[key] = value
            
            return details
            
        except Exception as e:
            self.logger.error(f"Error extracting land details: {str(e)}")
            return {}
            
    def _extract_sales_history(self) -> List[Dict]:
        """Extract sales history from the property page"""
        try:
            sales = []
            
            # Try to find sales history table
            sales_elements = self.driver.find_elements(By.CSS_SELECTOR, "div.card")
            for element in sales_elements:
                title = element.find_element(By.CSS_SELECTOR, "div.card-header").text
                if "SALES" in title.upper():
                    # Extract rows from this card
                    rows = element.find_elements(By.CSS_SELECTOR, "tr")
                    
                    # Get headers
                    headers = []
                    header_cells = rows[0].find_elements(By.CSS_SELECTOR, "th") if rows else []
                    for cell in header_cells:
                        headers.append(cell.text.strip().lower().replace(' ', '_'))
                    
                    # Get data rows
                    for row in rows[1:]:
                        cells = row.find_elements(By.CSS_SELECTOR, "td")
                        if len(cells) == len(headers):
                            sale = {}
                            for i, cell in enumerate(cells):
                                sale[headers[i]] = cell.text.strip()
                            sales.append(sale)
            
            return sales
            
        except Exception as e:
            self.logger.error(f"Error extracting sales history: {str(e)}")
            return []
            
    def _safe_get_text(self, element_id: str) -> str:
        """Safely get text from an element"""
        try:
            element = self.driver.find_element(By.ID, element_id)
            return element.text.strip()
        except NoSuchElementException:
            return ""
            
    def _extract_parcel_id_from_url(self, url: str) -> Optional[str]:
        """Extract parcel ID from URL if possible"""
        try:
            if 'PID=' in url:
                return url.split('PID=')[1].split('&')[0]
            return None
        except Exception:
            return None
            
    def refresh_session(self):
        """Refresh the browser session when encountering issues"""
        try:
            self.logger.info("Refreshing browser session...")
            self.cleanup()
            time.sleep(5)  # Wait before starting new session
            self.setup_driver()
            self.driver.get(self.base_url)
            time.sleep(2)
            self._accept_terms()
        except Exception as e:
            self.logger.error(f"Error refreshing session: {str(e)}")
    
    def cleanup(self):
        """Clean up resources"""
        if self.driver:
            try:
                self.driver.quit()
                self.driver = None
                self.wait = None
            except Exception as e:
                self.logger.error(f"Error closing WebDriver: {str(e)}")
                
    def _save_to_cache(self, data: Dict) -> None:
        """Save data to cache file"""
        try:
            cache_file = self.cache_dir / f"{self.town}_{self.state}_properties.json"
            with open(cache_file, 'w') as f:
                json.dump(data, f, indent=2, default=str)
            self.logger.info(f"Saved {len(data['properties'])} properties to cache: {cache_file}")
        except Exception as e:
            self.logger.error(f"Error saving to cache: {str(e)}")
            
    def _save_checkpoint(self) -> None:
        """Save checkpoint for resuming interrupted collection"""
        try:
            checkpoint = {
                'metrics': self.metrics,
                'processed_streets': list(self.processed_streets),
                'collected_properties': list(self.collected_properties),
                'timestamp': datetime.now().isoformat()
            }
            with open(self.checkpoint_file, 'w') as f:
                json.dump(checkpoint, f, indent=2, default=str)
            self.logger.debug("Saved collection checkpoint")
        except Exception as e:
            self.logger.error(f"Error saving checkpoint: {str(e)}")
            
    def _save_metrics(self) -> None:
        """Save collection metrics to a file"""
        try:
            metrics_file = self.cache_dir / f"{self.town}_{self.state}_metrics.json"
            with open(metrics_file, 'w') as f:
                json.dump(self.metrics, f, indent=2, default=str)
            self.logger.info(f"Saved collection metrics to {metrics_file}")
        except Exception as e:
            self.logger.error(f"Error saving metrics: {str(e)}")
            
    def _get_sample_data(self) -> Dict[str, Any]:
        """
        Get sample property data when dependencies are not available or errors occur
        
        Returns:
            Dictionary with sample property data
        """
        self.logger.info(f"Using sample data for {self.town}, {self.state}")
        
        # Try to load town-specific sample data
        sample_file = self.sample_data_path / f"{self.town}_{self.state}_sample.json"
        
        # If town-specific sample doesn't exist, use generic sample
        if not sample_file.exists():
            sample_file = self.sample_data_path / "generic_vgsi_sample.json"
        
        # If no sample files exist, return generated sample data
        if not sample_file.exists():
            return self._generate_sample_data()
        
        # Load sample data from file
        try:
            with open(sample_file, 'r') as f:
                sample_data = json.load(f)
                
            self.logger.info(f"Loaded sample data from {sample_file}")
            
            # Update metadata
            sample_data['metadata'] = {
                'source': f'VGSI {self.town.capitalize()}, {self.state.upper()} (SAMPLE)',
                'timestamp': datetime.now().isoformat(),
                'using_sample_data': True,
                'sample_source': str(sample_file)
            }
            
            return sample_data
            
        except Exception as e:
            self.logger.error(f"Error loading sample data: {str(e)}")
            return self._generate_sample_data()
    
    def _generate_sample_data(self) -> Dict[str, Any]:
        """Generate sample property data programmatically"""
        self.logger.info(f"Generating sample data for {self.town}, {self.state}")
        
        # Create generic sample data with basic structure
        streets = [
            "MAIN ST", "OAK AVE", "PINE ST", "MAPLE DR", "WASHINGTON ST",
            "FRANKLIN ST", "CHURCH ST", "SCHOOL ST", "PARK AVE", "ELM ST"
        ]
        
        sample_data = {
            'properties': [],
            'metadata': {
                'source': f'VGSI {self.town.capitalize()}, {self.state.upper()} (SAMPLE)',
                'timestamp': datetime.now().isoformat(),
                'using_sample_data': True,
                'sample_source': 'programmatically_generated'
            }
        }
        
        # Generate sample properties (20 properties)
        for i in range(1, 21):
            street = random.choice(streets)
            house_number = random.randint(1, 999)
            year_built = random.randint(1900, 2020)
            
            property_data = {
                'parcel_id': f"SAMPLE-{i:03d}",
                'location': f"{house_number} {street}",
                'owner': f"SAMPLE OWNER {i}",
                'assessment': f"${random.randint(150000, 750000):,}",
                'land_area': f"{random.randint(5000, 30000):,} sq ft",
                'property_type': random.choice(["SINGLE FAMILY", "MULTI-FAMILY", "COMMERCIAL", "VACANT LAND"]),
                'year_built': str(year_built),
                'url': f"https://gis.vgsi.com/{self.town}{self.state}/Parcel.aspx?PID=SAMPLE-{i:03d}",
                'building': {
                    'style': random.choice(["COLONIAL", "CAPE", "RANCH", "CONTEMPORARY"]),
                    'living_area': f"{random.randint(1000, 3500):,} sq ft",
                    'bedrooms': str(random.randint(2, 5)),
                    'bathrooms': str(random.randint(1, 4)),
                    'stories': random.choice(["1", "1.5", "2", "2.5"])
                },
                'land': {
                    'zone': random.choice(["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL", "RURAL"]),
                    'frontage': f"{random.randint(50, 200):,} ft",
                    'depth': f"{random.randint(100, 500):,} ft"
                },
                'sales_history': [
                    {
                        'sale_date': f"{random.randint(1, 12)}/{random.randint(1, 28)}/{random.randint(2010, 2023)}",
                        'price': f"${random.randint(100000, 700000):,}",
                        'grantor': f"PREVIOUS OWNER {i}-1",
                        'grantee': f"SAMPLE OWNER {i}"
                    }
                ],
                'last_updated': datetime.now().isoformat()
            }
            
            # Add older sales history for some properties
            if random.random() > 0.5:
                property_data['sales_history'].append({
                    'sale_date': f"{random.randint(1, 12)}/{random.randint(1, 28)}/{random.randint(2000, 2009)}",
                    'price': f"${random.randint(80000, 400000):,}",
                    'grantor': f"PREVIOUS OWNER {i}-2",
                    'grantee': f"PREVIOUS OWNER {i}-1"
                })
            
            sample_data['properties'].append(property_data)
        
        # Create sample data directory if it doesn't exist
        self.sample_data_path.mkdir(parents=True, exist_ok=True)
        
        # Save the generated sample for future use
        try:
            sample_file = self.sample_data_path / f"{self.town}_{self.state}_sample.json"
            with open(sample_file, 'w') as f:
                json.dump(sample_data, f, indent=2)
            self.logger.info(f"Saved generated sample data to {sample_file}")
        except Exception as e:
            self.logger.warning(f"Could not save generated sample data: {str(e)}")
        
        return sample_data
        
    def __del__(self):
        """Destructor to ensure cleanup"""
        self.cleanup()
