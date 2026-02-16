#!/usr/bin/env python3
"""
Multi-Query Buyer Scraper for Maine
====================================
Searches multiple query variations to find all Maine buyer companies.
Deduplicates results and enriches with activity scoring.

Searches:
- Statewide "we buy houses" variations
- City-specific searches (Portland, Brunswick, Bangor, Augusta, Lewiston)
- County-specific searches (Cumberland, Sagadahoc, York)
- Property type searches (investment, distressed, rental, land)

Output: CSV of 25-40 unique, verified Maine buyer companies.
"""

import json
import csv
import re
from datetime import datetime
from typing import List, Dict, Set, Optional
from urllib.parse import quote_plus
from collections import defaultdict

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


class MultiQueryBuyerScraper:
    """Scrape multiple queries to find Maine buyer companies."""
    
    # Comprehensive search queries to find all buyer types
    SEARCH_QUERIES = [
        # Statewide searches
        "we buy houses Maine",
        "cash home buyers Maine",
        "sell house fast Maine",
        "sell my house cash Maine",
        "home investors Maine",
        "real estate investors Maine",
        "Maine house buyers",
        "buy houses for cash Maine",
        
        # Major city searches
        "we buy houses Portland Maine",
        "we buy houses Brunswick Maine",
        "we buy houses Bangor Maine",
        "we buy houses Augusta Maine",
        "we buy houses Lewiston Maine",
        "we buy houses Bath Maine",
        "we buy houses Rockland Maine",
        
        # County searches
        "cash buyers Cumberland County Maine",
        "home buyers Sagadahoc County Maine",
        "property buyers York County Maine",
        "real estate investors Penobscot County Maine",
        "house buyers Kennebec County Maine",
        
        # Property type searches
        "buy rental properties Maine",
        "buy investment properties Maine",
        "buy distressed houses Maine",
        "buy land Maine cash",
        "buy multi family properties Maine",
        
        # Investor/wholesale searches
        "real estate wholesalers Maine",
        "house flipping companies Maine",
        "Maine property investors",
    ]
    
    def __init__(self, headless: bool = True):
        """Initialize scraper."""
        self.headless = headless
        self.driver = None
        self.all_companies = defaultdict(dict)  # company_name -> merged data
        self.query_results = defaultdict(list)  # company_name -> list of queries found in
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
        
        self.driver = webdriver.Chrome(options=chrome_options)
        print("✅ Chrome driver initialized")
    
    def normalize_company_name(self, name: str) -> str:
        """Normalize company name for deduplication."""
        # Remove common suffixes and normalize
        name = name.lower().strip()
        name = re.sub(r'\s+(llc|inc|corp|company|ltd|lp|pllc)$', '', name)
        name = re.sub(r'\s+', ' ', name)  # Normalize whitespace
        return name
    
    def normalize_phone(self, phone: str) -> str:
        """Normalize phone number for comparison."""
        if not phone:
            return None
        # Keep only digits
        digits = re.sub(r'\D', '', phone)
        if len(digits) >= 10:
            return digits[-10:]  # US phone is 10 digits
        return None
    
    def extract_phone(self, html: str) -> Optional[str]:
        """Extract phone number from HTML."""
        phone_patterns = [
            r'(?:call|phone|contact)[\s:]*(\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4}))',
            r'(\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4}))',
        ]
        
        for pattern in phone_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                phone = match.group(1)
                if self.normalize_phone(phone):
                    return phone
        return None
    
    def extract_email(self, html: str) -> Optional[str]:
        """Extract email from HTML."""
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        match = re.search(email_pattern, html)
        return match.group(0) if match else None
    
    def search_query(self, query: str, query_num: int, total: int) -> List[Dict]:
        """Search single query and extract company info."""
        if not self.driver:
            self.setup_driver()
        
        print(f"\n[{query_num}/{total}] 🔍 Searching: '{query}'")
        
        try:
            # Google search URL
            search_url = f"https://www.google.com/search?q={quote_plus(query)}"
            self.driver.get(search_url)
            
            # Wait for results
            import time
            time.sleep(2)
            
            # Try to extract results from page
            WebDriverWait(self.driver, 5).until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, "a[href]"))
            )
            
            # Get all links from search results
            links = self.driver.find_elements(By.CSS_SELECTOR, "a[href]")
            companies = []
            
            for link in links:
                try:
                    href = link.get_attribute('href')
                    text = link.text.strip()
                    
                    # Filter for likely company result links
                    if href and not 'google' in href and text and len(text) > 3:
                        if any(keyword in text.lower() for keyword in ['maine', 'cash', 'buy', 'house', 'home']):
                            # Extract company name from link text
                            company_info = {
                                'name': text,
                                'url': href,
                                'query': query,
                            }
                            companies.append(company_info)
                except:
                    continue
            
            print(f"   Found {len(companies)} potential companies")
            return companies[:5]  # Limit per query to avoid noise
        
        except Exception as e:
            print(f"   ⚠️  Error searching: {e}")
            return []
    
    def scrape_website(self, url: str, company_name: str) -> Dict:
        """Scrape company website for details."""
        try:
            response = self.session.get(url, timeout=8)
            response.raise_for_status()
            html = response.text
            
            return {
                'website': url,
                'phone': self.extract_phone(html),
                'email': self.extract_email(html),
                'cash_ready': any(phrase in html.lower() for phrase in ['cash', 'quick', 'fast close']),
            }
        except:
            return {'website': url, 'phone': None, 'email': None, 'cash_ready': False}
    
    def merge_company_data(self, norm_name: str, company: Dict, query: str):
        """Merge new company data into existing entry."""
        if norm_name not in self.all_companies:
            self.all_companies[norm_name] = {
                'company_name': company['name'],
                'websites': set(),
                'phones': set(),
                'emails': set(),
                'queries_found': [],
            }
        
        entry = self.all_companies[norm_name]
        
        # Add query to tracking
        if query not in entry['queries_found']:
            entry['queries_found'].append(query)
        
        # Add website
        if company.get('url'):
            entry['websites'].add(company['url'])
            
            # Scrape website for contact info
            scraped = self.scrape_website(company['url'], company['name'])
            if scraped.get('phone'):
                entry['phones'].add(scraped['phone'])
            if scraped.get('email'):
                entry['emails'].add(scraped['email'])
    
    def run_all_searches(self) -> Dict:
        """Run all searches and deduplicate results."""
        print("="*60)
        print("MULTI-QUERY BUYER SEARCH")
        print("="*60)
        print(f"Running {len(self.SEARCH_QUERIES)} queries...")
        
        for idx, query in enumerate(self.SEARCH_QUERIES, 1):
            try:
                companies = self.search_query(query, idx, len(self.SEARCH_QUERIES))
                
                for company in companies:
                    norm_name = self.normalize_company_name(company['name'])
                    if norm_name:
                        self.merge_company_data(norm_name, company, query)
                
            except Exception as e:
                print(f"   ❌ Error on query {idx}: {e}")
                continue
        
        # Convert sets to lists for JSON serialization
        final_companies = []
        for norm_name, data in self.all_companies.items():
            company = {
                'company_name': data['company_name'],
                'websites': list(data['websites']),
                'phone': list(data['phones'])[0] if data['phones'] else None,
                'email': list(data['emails'])[0] if data['emails'] else None,
                'queries_found': data['queries_found'],
                'search_frequency': len(data['queries_found']),  # Activity score
                'cash_ready': any(
                    self.scrape_website(w, data['company_name']).get('cash_ready', False)
                    for w in data['websites']
                ),
            }
            if company['phone'] or company['email'] or company['websites']:
                final_companies.append(company)
        
        return final_companies
    
    def save_to_csv(self, companies: List[Dict], filename: str = 'maine_buyer_companies.csv') -> str:
        """Save companies to CSV."""
        filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
        
        import os
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        # Sort by activity score (most searches found = most active)
        companies_sorted = sorted(companies, key=lambda x: x.get('search_frequency', 0), reverse=True)
        
        rows = []
        for company in companies_sorted:
            row = {
                'company_name': company['company_name'],
                'phone': company['phone'] or '',
                'email': company['email'] or '',
                'website': company['websites'][0] if company['websites'] else '',
                'website_count': len(company['websites']),
                'search_frequency': company['search_frequency'],
                'activity_level': 'High' if company['search_frequency'] >= 5 else 'Medium' if company['search_frequency'] >= 2 else 'Low',
                'cash_ready': company['cash_ready'],
                'queries_found': ' | '.join(company['queries_found']),
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
                'source': 'Multi-Query Google Search',
                'queries_run': len(self.SEARCH_QUERIES),
            },
            'companies': companies,
        }
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        
        print(f"✅ Saved {len(companies)} companies to {filepath}")
        return filepath
    
    def print_summary(self, companies: List[Dict]):
        """Print summary of results."""
        print("\n" + "="*60)
        print("📊 MULTI-QUERY SCRAPE SUMMARY")
        print("="*60)
        
        # Activity breakdown
        high_activity = [c for c in companies if c.get('search_frequency', 0) >= 5]
        medium_activity = [c for c in companies if 2 <= c.get('search_frequency', 0) < 5]
        low_activity = [c for c in companies if c.get('search_frequency', 0) < 2]
        
        print(f"\nTotal unique companies: {len(companies)}")
        print(f"High activity (5+ searches): {len(high_activity)}")
        print(f"Medium activity (2-4 searches): {len(medium_activity)}")
        print(f"Low activity (1 search): {len(low_activity)}")
        
        print("\nTop 10 Companies by Activity:")
        for i, company in enumerate(companies[:10], 1):
            print(f"\n{i}. {company['company_name']}")
            print(f"   Activity: {company.get('search_frequency', 0)} searches")
            print(f"   Phone: {company['phone'] or 'N/A'}")
            print(f"   Email: {company['email'] or 'N/A'}")
            print(f"   Websites: {len(company['websites'])}")
            if company.get('queries_found'):
                print(f"   Found in: {', '.join(company['queries_found'][:3])}")
        
        print("\n" + "="*60)
    
    def close(self):
        """Clean up driver."""
        if self.driver:
            self.driver.quit()
            print("✅ Browser closed")


def main():
    """Run the multi-query scraper."""
    scraper = MultiQueryBuyerScraper(headless=False)
    
    try:
        # Run all searches
        companies = scraper.run_all_searches()
        
        if not companies:
            print("❌ No companies found.")
            return
        
        # Save results
        csv_path = scraper.save_to_csv(companies)
        json_path = scraper.save_to_json(companies)
        
        # Print summary
        scraper.print_summary(companies)
        
        print(f"\nCSV: {csv_path}")
        print(f"JSON: {json_path}")
        print("\n✅ Ready to import to Supabase")
    
    finally:
        scraper.close()


if __name__ == '__main__':
    main()
