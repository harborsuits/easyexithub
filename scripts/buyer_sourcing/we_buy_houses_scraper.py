#!/usr/bin/env python3
"""
We Buy Houses Company Scraper
==============================
Scrapes "we buy houses Maine" Google results for active buyer companies.
Extracts: company name, phone, email, website, service areas, buy criteria.

Output: CSV file ready for Supabase import.
"""

import json
import csv
import time
import re
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import urlparse

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    import requests
    from bs4 import BeautifulSoup
except ImportError as e:
    print(f"⚠️  Missing dependency: {e}")
    print("Install with: pip install selenium requests beautifulsoup4")
    exit(1)


class WeBuyHousesScraper:
    """Scrape Maine 'we buy houses' companies from Google search results."""
    
    def __init__(self, headless: bool = True):
        """Initialize Chrome driver for scraping."""
        self.headless = headless
        self.driver = None
        self.search_results = []
        self.companies = []
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
    
    def setup_driver(self):
        """Configure and start Chrome driver."""
        chrome_options = Options()
        if self.headless:
            chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        
        self.driver = webdriver.Chrome(options=chrome_options)
        print("✅ Chrome driver initialized")
    
    def get_seed_companies(self) -> List[str]:
        """Fallback seed list of known Maine 'we buy houses' companies."""
        return [
            "https://www.mainepropertybuyers.com",
            "https://www.mainecashhomebuyers.com",
            "https://www.webuyhousesmaine.com",
            "https://www.mainequickcash.com",
            "https://www.fastcashformaine.com",
            "https://www.mainehomebuyers.org",
            "https://www.buyhousesmaine.com",
            "https://www.rapidcashhomes.com",
            "https://www.mainequicksale.com",
            "https://www.cashformainehomes.com",
            "https://www.mainefastcash.com",
            "https://www.instantcashformaine.com",
            "https://www.sellmyhousefastmaine.com",
            "https://www.mainehousebuyers.net",
            "https://www.buymainehomes.com",
            "https://www.maine-home-buyers.com",
            "https://www.mainewholsalers.com",
            "https://www.mainerealestateinvestors.com",
        ]
    
    def search_google(self, query: str = "we buy houses Maine", max_results: int = 30) -> List[str]:
        """Search Google for 'we buy houses Maine' and extract company URLs."""
        if not self.driver:
            self.setup_driver()
        
        print(f"\n🔍 Searching Google for: '{query}'")
        
        try:
            # Add delays and headers to appear more human-like
            import time
            self.driver.get(f"https://www.google.com/search?q={query.replace(' ', '+')}")
            time.sleep(3)
            
            # Wait for search results to load
            WebDriverWait(self.driver, 15).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "a[href*='http']"))
            )
            time.sleep(2)
            
            # Extract URLs from search results
            links = self.driver.find_elements(By.CSS_SELECTOR, "a[href*='http']")
            urls = []
            
            for link in links:
                try:
                    href = link.get_attribute('href')
                    if href and 'google' not in href and len(href) > 10:
                        # Clean up Google redirect URLs
                        if href.startswith('/url?q='):
                            clean_url = href.split('/url?q=')[1].split('&')[0]
                            if clean_url not in urls and clean_url.startswith('http'):
                                urls.append(clean_url)
                        elif href.startswith('http'):
                            urls.append(href)
                except:
                    continue
            
            # Remove duplicates and limit
            urls = list(dict.fromkeys(urls))[:max_results]
            
            if urls:
                print(f"✅ Found {len(urls)} URLs from Google search")
                return urls
            else:
                print(f"⚠️  Google search blocked or no results. Using seed company list.")
                return self.get_seed_companies()
        
        except Exception as e:
            print(f"⚠️  Google search failed ({e}). Falling back to seed company list.")
            return self.get_seed_companies()
    
    def extract_phone(self, html: str) -> Optional[str]:
        """Extract phone number from HTML."""
        phone_patterns = [
            r'(?:call|phone|contact)[\s:]*(\d{3}[-.]?\d{3}[-.]?\d{4})',
            r'(\d{3}[-.]?\d{3}[-.]?\d{4})',
            r'(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})',
        ]
        
        for pattern in phone_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                return match.group(1)
        return None
    
    def extract_email(self, html: str) -> Optional[str]:
        """Extract email from HTML."""
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        match = re.search(email_pattern, html)
        return match.group(0) if match else None
    
    def extract_service_areas(self, html: str) -> Dict:
        """Extract service areas (counties/towns) from HTML."""
        soup = BeautifulSoup(html, 'html.parser')
        text = soup.get_text().lower()
        
        maine_towns = {
            'brunswick': 'Brunswick', 'bath': 'Bath', 'topsham': 'Topsham',
            'portland': 'Portland', 'lewiston': 'Lewiston', 'auburn': 'Auburn',
            'bangor': 'Bangor', 'rockland': 'Rockland', 'belfast': 'Belfast',
            'saco': 'Saco', 'biddeford': 'Biddeford', 'kennebunk': 'Kennebunk',
            'south portland': 'South Portland', 'westbrook': 'Westbrook',
        }
        
        maine_counties = {
            'cumberland': 'Cumberland', 'sagadahoc': 'Sagadahoc', 'york': 'York',
            'penobscot': 'Penobscot', 'kennebec': 'Kennebec', 'androscoggin': 'Androscoggin',
        }
        
        found_towns = [town for town_key, town in maine_towns.items() if town_key in text]
        found_counties = [county for county_key, county in maine_counties.items() if county_key in text]
        
        return {
            'towns': found_towns,
            'counties': found_counties,
            'state_wide': 'maine' in text and ('entire' in text or 'all' in text or 'statewide' in text)
        }
    
    def extract_buy_criteria(self, html: str) -> Dict:
        """Extract stated buy criteria from HTML."""
        soup = BeautifulSoup(html, 'html.parser')
        text = soup.get_text().lower()
        
        criteria = {
            'property_types': [],
            'condition': 'any',
            'cash_ready': 'cash' in text or 'quick' in text or 'fast' in text,
            'close_timeline': None,
        }
        
        # Property types
        if 'single family' in text or 'single-family' in text:
            criteria['property_types'].append('single_family')
        if 'multi unit' in text or 'multifamily' in text or 'apartment' in text:
            criteria['property_types'].append('multi_unit')
        if 'land' in text and 'vacant' in text:
            criteria['property_types'].append('land')
        if 'townhouse' in text or 'condo' in text:
            criteria['property_types'].append('townhouse')
        
        # Condition
        if 'any condition' in text or 'as-is' in text:
            criteria['condition'] = 'any'
        elif 'good condition' in text or 'renovated' in text:
            criteria['condition'] = 'good'
        
        # Timeline
        if '7 day' in text:
            criteria['close_timeline'] = '7 days'
        elif '14 day' in text:
            criteria['close_timeline'] = '14 days'
        elif '30 day' in text:
            criteria['close_timeline'] = '30 days'
        elif 'week' in text:
            criteria['close_timeline'] = '7-30 days'
        
        return criteria
    
    def scrape_company_website(self, url: str) -> Optional[Dict]:
        """Scrape individual company website for details."""
        try:
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            html = response.text
            
            # Extract domain as company identifier
            domain = urlparse(url).netloc.replace('www.', '')
            
            # Parse company name from domain or title
            soup = BeautifulSoup(html, 'html.parser')
            title = soup.find('title')
            company_name = title.string.split('|')[0].strip() if title else domain
            
            company = {
                'company_name': company_name,
                'website': url,
                'phone': self.extract_phone(html),
                'email': self.extract_email(html),
                'service_areas': self.extract_service_areas(html),
                'buy_criteria': self.extract_buy_criteria(html),
                'source': 'Google Search',
                'scraped_date': datetime.now().isoformat(),
            }
            
            return company if company['phone'] or company['email'] else None
        
        except Exception as e:
            print(f"⚠️  Error scraping {url}: {e}")
            return None
    
    def scrape_all_companies(self, urls: List[str]) -> List[Dict]:
        """Scrape all company websites and extract data."""
        print(f"\n📊 Scraping {len(urls)} company websites...")
        companies = []
        
        for idx, url in enumerate(urls, 1):
            print(f"  [{idx}/{len(urls)}] Scraping {url[:50]}...")
            company = self.scrape_company_website(url)
            
            if company:
                companies.append(company)
                print(f"    ✅ Extracted: {company['company_name']}")
            else:
                print(f"    ❌ No valid data extracted")
            
            time.sleep(1)  # Be respectful to servers
        
        self.companies = companies
        print(f"\n✅ Successfully scraped {len(companies)} companies")
        return companies
    
    def validate_companies(self) -> List[Dict]:
        """Filter companies with valid contact info."""
        valid = [c for c in self.companies if c['phone'] or c['email']]
        print(f"\n✓ Validated: {len(valid)}/{len(self.companies)} companies have contact info")
        return valid
    
    def save_to_csv(self, filename: str = 'maine_buyer_companies.csv') -> str:
        """Save companies to CSV file."""
        if not self.companies:
            print("❌ No companies to save")
            return None
        
        filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
        
        # Create directory if needed
        import os
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        # Flatten JSON for CSV
        rows = []
        for company in self.companies:
            row = {
                'company_name': company['company_name'],
                'website': company['website'],
                'phone': company['phone'] or '',
                'email': company['email'] or '',
                'towns': ', '.join(company['service_areas']['towns']),
                'counties': ', '.join(company['service_areas']['counties']),
                'statewide': company['service_areas']['state_wide'],
                'property_types': ', '.join(company['buy_criteria']['property_types']),
                'cash_ready': company['buy_criteria']['cash_ready'],
                'close_timeline': company['buy_criteria']['close_timeline'] or 'not stated',
                'scraped_date': company['scraped_date'],
            }
            rows.append(row)
        
        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        
        print(f"✅ Saved {len(rows)} companies to {filepath}")
        return filepath
    
    def save_to_json(self, filename: str = 'maine_buyer_companies.json') -> str:
        """Save companies to JSON file."""
        filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
        
        import os
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(self.companies, f, indent=2)
        
        print(f"✅ Saved {len(self.companies)} companies to {filepath}")
        return filepath
    
    def close(self):
        """Clean up browser driver."""
        if self.driver:
            self.driver.quit()
            print("✅ Browser closed")


def main():
    """Run the scraper."""
    scraper = WeBuyHousesScraper(headless=True)
    
    try:
        # Step 1: Search Google for company URLs
        urls = scraper.search_google("we buy houses Maine", max_results=30)
        
        if not urls:
            print("❌ No URLs found. Exiting.")
            return
        
        # Step 2: Scrape each company website
        scraper.scrape_all_companies(urls)
        
        # Step 3: Validate results
        valid_companies = scraper.validate_companies()
        
        if not valid_companies:
            print("❌ No valid companies with contact info found.")
            return
        
        # Step 4: Save results
        csv_path = scraper.save_to_csv()
        json_path = scraper.save_to_json()
        
        # Step 5: Print summary
        print("\n" + "="*60)
        print("📊 SCRAPE SUMMARY")
        print("="*60)
        print(f"Total companies found: {len(scraper.companies)}")
        print(f"Valid (with contact): {len(valid_companies)}")
        print(f"CSV output: {csv_path}")
        print(f"JSON output: {json_path}")
        print("\nTop 3 companies:")
        for i, company in enumerate(valid_companies[:3], 1):
            print(f"\n{i}. {company['company_name']}")
            print(f"   Website: {company['website']}")
            print(f"   Phone: {company['phone'] or 'N/A'}")
            print(f"   Email: {company['email'] or 'N/A'}")
            if company['service_areas']['towns']:
                print(f"   Towns: {', '.join(company['service_areas']['towns'])}")
            if company['buy_criteria']['property_types']:
                print(f"   Types: {', '.join(company['buy_criteria']['property_types'])}")
    
    finally:
        scraper.close()


if __name__ == '__main__':
    main()
