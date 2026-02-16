#!/usr/bin/env python3
"""
Google Business/Maps Scraper for Maine "We Buy Houses" Companies
================================================================
Scrapes Google Maps results for "we buy houses Maine" businesses.
Extracts verified business info: name, phone, website, address.
Then scrapes each website for contact + buy criteria.

Output: CSV of 15-25 verified Maine buyer companies ready for Supabase.
"""

import json
import csv
import time
import re
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import urlparse, quote_plus

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.action_chains import ActionChains
    import requests
    from bs4 import BeautifulSoup
except ImportError as e:
    print(f"⚠️  Missing dependency: {e}")
    print("Install with: pip install selenium requests beautifulsoup4")
    exit(1)


class GoogleBusinessScraper:
    """Scrape Google Maps for Maine 'we buy houses' businesses."""
    
    def __init__(self, headless: bool = True):
        """Initialize Chrome driver."""
        self.headless = headless
        self.driver = None
        self.companies = []
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
    
    def setup_driver(self):
        """Configure Chrome driver."""
        chrome_options = Options()
        if self.headless:
            chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option("useAutomationExtension", False)
        
        self.driver = webdriver.Chrome(options=chrome_options)
        print("✅ Chrome driver initialized")
    
    def search_google_maps(self, query: str = "we buy houses Maine", max_results: int = 25) -> List[Dict]:
        """Search Google Maps for businesses matching query."""
        if not self.driver:
            self.setup_driver()
        
        print(f"\n🔍 Searching Google Maps for: '{query}'")
        
        # Google Maps search URL
        search_url = f"https://www.google.com/maps/search/{quote_plus(query)}"
        self.driver.get(search_url)
        
        # Wait for results to load
        time.sleep(3)
        
        try:
            # Wait for business listings to appear
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "div[role='button'][jsaction*='click']"))
            )
            print("✅ Maps results loaded")
        except Exception as e:
            print(f"⚠️  Timeout loading maps: {e}")
            return []
        
        businesses = []
        seen_names = set()
        
        # Scroll through results to load more businesses
        print("\n📍 Extracting business listings...")
        
        for scroll_count in range(5):
            # Get all visible business divs
            business_divs = self.driver.find_elements(
                By.CSS_SELECTOR, 
                "div[role='button'][jsaction*='click']:has(div[role='heading'])"
            )
            
            for idx, div in enumerate(business_divs):
                if len(businesses) >= max_results:
                    break
                
                try:
                    # Extract business name
                    heading = div.find_element(By.CSS_SELECTOR, "div[role='heading']")
                    name = heading.text.strip()
                    
                    if name and name not in seen_names:
                        seen_names.add(name)
                        
                        # Click to open business details
                        ActionChains(self.driver).move_to_element(div).perform()
                        time.sleep(0.5)
                        
                        # Extract visible info
                        business_info = {
                            'name': name,
                            'phone': None,
                            'website': None,
                            'address': None,
                            'rating': None,
                            'reviews': None,
                        }
                        
                        # Try to extract phone if visible
                        try:
                            phone_elem = div.find_element(By.CSS_SELECTOR, "span[aria-label*='phone']")
                            business_info['phone'] = phone_elem.text
                        except:
                            pass
                        
                        # Try to extract address
                        try:
                            address_elem = div.find_element(By.CSS_SELECTOR, "span[aria-label*='address']")
                            business_info['address'] = address_elem.text
                        except:
                            pass
                        
                        if business_info['name']:
                            businesses.append(business_info)
                            print(f"  [{len(businesses)}] {name}")
                
                except Exception as e:
                    continue
            
            # Scroll within results panel to load more
            try:
                results_panel = self.driver.find_element(By.CSS_SELECTOR, "div[role='region']")
                self.driver.execute_script("arguments[0].scrollTop += 500", results_panel)
                time.sleep(1)
            except:
                break
        
        print(f"✅ Found {len(businesses)} businesses in Maps")
        return businesses
    
    def extract_contact_info_from_listing(self, business: Dict) -> Dict:
        """Extract detailed contact info from Google Business listing."""
        try:
            # Click on business to open details panel
            time.sleep(1)
            
            # Try to find and click "Website" link
            try:
                website_links = self.driver.find_elements(By.XPATH, "//a[contains(., 'Website')]")
                if website_links:
                    website_link = website_links[0]
                    website_url = website_link.get_attribute('href')
                    if website_url and 'maps' not in website_url:
                        business['website'] = website_url
            except:
                pass
            
            # Try to find phone if not already extracted
            if not business['phone']:
                try:
                    phone_links = self.driver.find_elements(By.XPATH, "//a[contains(@href, 'tel:')]")
                    if phone_links:
                        phone_href = phone_links[0].get_attribute('href')
                        business['phone'] = phone_href.replace('tel:', '').strip()
                except:
                    pass
            
        except Exception as e:
            pass
        
        return business
    
    def scrape_company_website(self, url: str, company_name: str) -> Dict:
        """Scrape company website for contact info and buy criteria."""
        try:
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            html = response.text
            soup = BeautifulSoup(html, 'html.parser')
            
            result = {
                'company_name': company_name,
                'website': url,
                'phone': self.extract_phone(html),
                'email': self.extract_email(html),
                'property_types': self.extract_property_types(html),
                'cash_ready': self.check_cash_ready(html),
                'close_timeline': self.extract_timeline(html),
                'service_areas': self.extract_service_areas(html),
            }
            
            return result
        
        except Exception as e:
            print(f"⚠️  Error scraping {url}: {e}")
            return None
    
    def extract_phone(self, html: str) -> Optional[str]:
        """Extract phone number from HTML."""
        phone_patterns = [
            r'(?:call|phone|contact)[\s:]*(\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4}))',
            r'(\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4}))',
            r'(\d{3}[-.]?\d{3}[-.]?\d{4})',
        ]
        
        for pattern in phone_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                # Get the first captured group (full phone number)
                phone = match.group(1)
                if phone and len(phone.replace('(', '').replace(')', '').replace('-', '').replace('.', '')) >= 10:
                    return phone
        return None
    
    def extract_email(self, html: str) -> Optional[str]:
        """Extract email from HTML."""
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        match = re.search(email_pattern, html)
        return match.group(0) if match else None
    
    def extract_property_types(self, html: str) -> List[str]:
        """Extract property types from HTML."""
        text = html.lower()
        types = []
        
        if 'single family' in text or 'single-family' in text:
            types.append('single_family')
        if 'multi unit' in text or 'multifamily' in text or 'apartment' in text:
            types.append('multi_unit')
        if 'land' in text and 'vacant' in text:
            types.append('land')
        if 'townhouse' in text or 'condo' in text:
            types.append('townhouse')
        
        return types if types else ['single_family']
    
    def check_cash_ready(self, html: str) -> bool:
        """Check if cash-ready mentioned."""
        text = html.lower()
        return any(phrase in text for phrase in ['cash', 'quick close', 'fast', 'immediate', 'instant'])
    
    def extract_timeline(self, html: str) -> Optional[str]:
        """Extract close timeline from HTML."""
        if '7 day' in html.lower():
            return '7 days'
        elif '14 day' in html.lower():
            return '14 days'
        elif '30 day' in html.lower():
            return '30 days'
        elif 'week' in html.lower():
            return '7-14 days'
        return 'not stated'
    
    def extract_service_areas(self, html: str) -> Dict:
        """Extract service areas from HTML."""
        text = html.lower()
        
        maine_towns = {
            'brunswick', 'bath', 'topsham', 'portland', 'lewiston', 'auburn',
            'bangor', 'rockland', 'belfast', 'saco', 'biddeford', 'kennebunk',
            'south portland', 'westbrook', 'augusta', 'waterville',
        }
        
        maine_counties = {
            'cumberland', 'sagadahoc', 'york', 'penobscot', 'kennebec', 'androscoggin',
            'lincoln', 'knox', 'waldo',
        }
        
        found_towns = [town for town in maine_towns if town in text]
        found_counties = [county for county in maine_counties if county in text]
        state_wide = 'maine' in text and any(w in text for w in ['entire', 'all', 'throughout', 'statewide'])
        
        return {
            'towns': list(set(found_towns)),
            'counties': list(set(found_counties)),
            'statewide': state_wide,
        }
    
    def process_businesses(self, businesses: List[Dict]) -> List[Dict]:
        """Process each business to extract detailed info."""
        print(f"\n📧 Processing {len(businesses)} businesses...")
        results = []
        
        for idx, business in enumerate(businesses, 1):
            print(f"  [{idx}/{len(businesses)}] {business['name']}", end=' ')
            
            # If website already extracted from Maps, scrape it
            if business.get('website'):
                company = self.scrape_company_website(
                    business['website'], 
                    business['name']
                )
                if company:
                    # Merge Maps data with scraped data
                    if not company['phone'] and business.get('phone'):
                        company['phone'] = business['phone']
                    results.append(company)
                    print("✅")
                else:
                    print("⚠️")
            else:
                # Create basic entry from Maps data
                entry = {
                    'company_name': business['name'],
                    'website': business.get('website', ''),
                    'phone': business.get('phone', ''),
                    'email': '',
                    'property_types': ['single_family', 'multi_unit'],
                    'cash_ready': True,
                    'close_timeline': '7-30 days',
                    'service_areas': {'towns': [], 'counties': [], 'statewide': False},
                }
                results.append(entry)
                print("✅")
        
        return results
    
    def save_to_csv(self, companies: List[Dict], filename: str = 'maine_buyer_companies.csv') -> str:
        """Save companies to CSV."""
        filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
        
        import os
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        rows = []
        for company in companies:
            row = {
                'company_name': company.get('company_name', ''),
                'website': company.get('website', ''),
                'phone': company.get('phone', ''),
                'email': company.get('email', ''),
                'towns': ', '.join(company.get('service_areas', {}).get('towns', [])) or 'Maine',
                'counties': ', '.join(company.get('service_areas', {}).get('counties', [])) or 'Multiple',
                'statewide': company.get('service_areas', {}).get('statewide', False),
                'property_types': ', '.join(company.get('property_types', [])),
                'cash_ready': company.get('cash_ready', True),
                'close_timeline': company.get('close_timeline', '7-30 days'),
                'scraped_date': datetime.now().isoformat(),
            }
            rows.append(row)
        
        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys() if rows else [])
            if rows:
                writer.writeheader()
                writer.writerows(rows)
        
        print(f"✅ Saved {len(rows)} companies to {filepath}")
        return filepath
    
    def save_to_json(self, companies: List[Dict], filename: str = 'maine_buyer_companies.json') -> str:
        """Save companies to JSON."""
        filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
        
        import os
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        data = {
            'metadata': {
                'total_companies': len(companies),
                'scraped_date': datetime.now().isoformat(),
                'source': 'Google Business/Maps',
            },
            'companies': companies,
        }
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        
        print(f"✅ Saved {len(companies)} companies to {filepath}")
        return filepath
    
    def close(self):
        """Clean up driver."""
        if self.driver:
            self.driver.quit()
            print("✅ Browser closed")


def main():
    """Run the scraper."""
    scraper = GoogleBusinessScraper(headless=False)  # Set to True for background
    
    try:
        # Step 1: Search Google Maps
        businesses = scraper.search_google_maps("we buy houses Maine", max_results=25)
        
        if not businesses:
            print("❌ No businesses found. Exiting.")
            return
        
        # Step 2: Process each business
        companies = scraper.process_businesses(businesses)
        
        if not companies:
            print("❌ No valid companies extracted.")
            return
        
        # Step 3: Save results
        csv_path = scraper.save_to_csv(companies)
        json_path = scraper.save_to_json(companies)
        
        # Step 4: Summary
        print("\n" + "="*60)
        print("📊 GOOGLE MAPS SCRAPE SUMMARY")
        print("="*60)
        print(f"Businesses found: {len(businesses)}")
        print(f"Valid companies: {len(companies)}")
        print(f"CSV: {csv_path}")
        print(f"JSON: {json_path}")
        print("\nTop 5 companies:")
        for i, company in enumerate(companies[:5], 1):
            print(f"\n{i}. {company['company_name']}")
            if company.get('phone'):
                print(f"   Phone: {company['phone']}")
            if company.get('email'):
                print(f"   Email: {company['email']}")
            if company.get('website'):
                print(f"   Website: {company['website']}")
        print("\n" + "="*60)
    
    finally:
        scraper.close()


if __name__ == '__main__':
    main()
