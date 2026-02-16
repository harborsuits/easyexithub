#!/usr/bin/env python3
"""
Multi-Query Buyer Scraper - Demo Version
=========================================
Shows what the real scraper will do:
1. Run 30+ search queries
2. Find companies appearing in multiple searches
3. Score by frequency (activity indicator)
4. Deduplicate and merge data
5. Output CSV ready for Supabase

This demo shows the expected output with realistic Maine companies.
"""

import csv
import json
from datetime import datetime
from typing import List, Dict

# Simulated results from running all 30+ search queries
# In real scraper: 30 queries × 5 results each = 150 raw results
# After deduplication: 25-40 unique companies

DEMO_COMPANIES = [
    # HIGH ACTIVITY - Found in 7+ searches (very active buyers)
    {
        'company_name': 'Maine Home Buyers LLC',
        'phone': '207-555-0101',
        'email': 'info@mainehomebuyers.com',
        'website': 'mainehomebuyers.com',
        'website_count': 1,
        'search_frequency': 8,
        'activity_level': 'High',
        'cash_ready': True,
        'queries_found': 'we buy houses Maine | cash home buyers Maine | we buy houses Portland Maine | real estate investors Maine | buy houses for cash Maine | buy rental properties Maine | home investors Maine | Maine house buyers',
    },
    {
        'company_name': 'Cash for Houses Maine',
        'phone': '207-555-0102',
        'email': 'deals@cashformaine.com',
        'website': 'cashforhousesmaine.com',
        'website_count': 1,
        'search_frequency': 7,
        'activity_level': 'High',
        'cash_ready': True,
        'queries_found': 'we buy houses Maine | cash home buyers Maine | sell my house cash Maine | we buy houses Brunswick Maine | buy distressed houses Maine | sell house fast Maine | real estate investors Maine',
    },
    {
        'company_name': 'Portland Property Investors',
        'phone': '207-555-0103',
        'email': 'contact@portlandpropertyinvestors.com',
        'website': 'portlandpropertyinvestors.com',
        'website_count': 1,
        'search_frequency': 6,
        'activity_level': 'High',
        'cash_ready': True,
        'queries_found': 'we buy houses Portland Maine | real estate investors Maine | buy investment properties Maine | home investors Maine | Maine house buyers | cash buyers Cumberland County Maine',
    },
    {
        'company_name': 'Midcoast Home Solutions',
        'phone': '207-555-0104',
        'email': 'info@midcoasthomesolutions.com',
        'website': 'midcoasthomesolutions.com',
        'website_count': 1,
        'search_frequency': 6,
        'activity_level': 'High',
        'cash_ready': True,
        'queries_found': 'we buy houses Brunswick Maine | we buy houses Bath Maine | cash buyers Sagadahoc County Maine | home buyers Sagadahoc County Maine | real estate investors Maine | buy investment properties Maine',
    },
    {
        'company_name': 'Maine Real Estate Investors',
        'phone': '207-555-0105',
        'email': 'hello@mainerealestateinvestors.com',
        'website': 'mainerealestateinvestors.com',
        'website_count': 1,
        'search_frequency': 6,
        'activity_level': 'High',
        'cash_ready': True,
        'queries_found': 'real estate investors Maine | home investors Maine | buy rental properties Maine | buy investment properties Maine | Maine house buyers | buy distressed houses Maine',
    },
    
    # MEDIUM ACTIVITY - Found in 3-6 searches (active buyers)
    {
        'company_name': 'Bangor Cash Home Buyers',
        'phone': '207-555-0106',
        'email': 'deals@bangorcashhomes.com',
        'website': 'bangorcashhomes.com',
        'website_count': 1,
        'search_frequency': 5,
        'activity_level': 'Medium',
        'cash_ready': True,
        'queries_found': 'we buy houses Bangor Maine | cash home buyers Maine | real estate investors Penobscot County Maine | buy distressed houses Maine | Maine house buyers',
    },
    {
        'company_name': 'Quick House Sale Maine',
        'phone': '207-555-0107',
        'email': 'info@quickhousesalemaine.com',
        'website': 'quickhousesalemaine.com',
        'website_count': 1,
        'search_frequency': 5,
        'activity_level': 'Medium',
        'cash_ready': True,
        'queries_found': 'sell house fast Maine | sell my house cash Maine | we buy houses Maine | cash home buyers Maine | home investors Maine',
    },
    {
        'company_name': 'Augusta Property Group',
        'phone': '207-555-0108',
        'email': 'contact@augustapropertygroup.com',
        'website': 'augustapropertygroup.com',
        'website_count': 1,
        'search_frequency': 4,
        'activity_level': 'Medium',
        'cash_ready': True,
        'queries_found': 'we buy houses Augusta Maine | real estate investors Kennebec County Maine | buy investment properties Maine | Maine house buyers',
    },
    {
        'company_name': 'Southern Maine House Buyers',
        'phone': '207-555-0109',
        'email': 'deals@southernmainehousebuyers.com',
        'website': 'southernmainehousebuyers.com',
        'website_count': 1,
        'search_frequency': 4,
        'activity_level': 'Medium',
        'cash_ready': True,
        'queries_found': 'property buyers York County Maine | we buy houses Portland Maine | buy distressed houses Maine | cash home buyers Maine',
    },
    {
        'company_name': 'Maine Wholesale Properties',
        'phone': '207-555-0110',
        'email': 'info@mainewholesaleproperties.com',
        'website': 'mainewholesaleproperties.com',
        'website_count': 1,
        'search_frequency': 4,
        'activity_level': 'Medium',
        'cash_ready': True,
        'queries_found': 'real estate wholesalers Maine | buy investment properties Maine | house flipping companies Maine | Maine property investors',
    },
    {
        'company_name': 'Lewiston Investment Group',
        'phone': '207-555-0111',
        'email': 'contact@lewistoninvestmentgroup.com',
        'website': 'lewistoninvestmentgroup.com',
        'website_count': 1,
        'search_frequency': 3,
        'activity_level': 'Medium',
        'cash_ready': True,
        'queries_found': 'we buy houses Lewiston Maine | real estate investors Maine | buy rental properties Maine',
    },
    {
        'company_name': 'Rockland Cash Buyers',
        'phone': '207-555-0112',
        'email': 'deals@rocklandcashbuyers.com',
        'website': 'rocklandcashbuyers.com',
        'website_count': 1,
        'search_frequency': 3,
        'activity_level': 'Medium',
        'cash_ready': True,
        'queries_found': 'we buy houses Rockland Maine | cash buyers Cumberland County Maine | home investors Maine',
    },
    
    # ADDITIONAL COMPANIES - Lower activity but still buyers
    {
        'company_name': 'Maine Property Solutions',
        'phone': '207-555-0113',
        'email': 'info@mainepropertysolutions.com',
        'website': 'mainepropertysolutions.com',
        'website_count': 1,
        'search_frequency': 2,
        'activity_level': 'Low',
        'cash_ready': True,
        'queries_found': 'buy distressed houses Maine | real estate investors Maine',
    },
    {
        'company_name': 'Northern Maine Investors',
        'phone': '207-555-0114',
        'email': 'contact@northernmaineinvestors.com',
        'website': 'northernmaineinvestors.com',
        'website_count': 1,
        'search_frequency': 2,
        'activity_level': 'Low',
        'cash_ready': True,
        'queries_found': 'real estate investors Maine | buy investment properties Maine',
    },
    {
        'company_name': 'Land Buyers Maine',
        'phone': '207-555-0115',
        'email': 'deals@landbuyersmaine.com',
        'website': 'landbuyersmaine.com',
        'website_count': 1,
        'search_frequency': 2,
        'activity_level': 'Low',
        'cash_ready': True,
        'queries_found': 'buy land Maine cash | buy investment properties Maine',
    },
]


def save_to_csv(companies: List[Dict], filename: str = 'maine_buyer_companies_multiquery.csv') -> str:
    """Save companies to CSV."""
    filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
    
    import os
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    with open(filepath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=companies[0].keys())
        writer.writeheader()
        writer.writerows(companies)
    
    print(f"✅ Saved {len(companies)} companies to {filepath}")
    return filepath


def save_to_json(companies: List[Dict], filename: str = 'maine_buyer_companies_multiquery.json') -> str:
    """Save companies to JSON."""
    filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
    
    import os
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    data = {
        'metadata': {
            'total_companies': len(companies),
            'scraped_date': datetime.now().isoformat(),
            'source': 'Multi-Query Google Search (Demo)',
            'queries_run': 30,
            'activity_breakdown': {
                'high': len([c for c in companies if c['activity_level'] == 'High']),
                'medium': len([c for c in companies if c['activity_level'] == 'Medium']),
                'low': len([c for c in companies if c['activity_level'] == 'Low']),
            }
        },
        'companies': companies,
    }
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    
    print(f"✅ Saved {len(companies)} companies to {filepath}")
    return filepath


def print_summary(companies: List[Dict]):
    """Print summary."""
    print("\n" + "="*80)
    print("📊 MULTI-QUERY SCRAPER - DEMO OUTPUT")
    print("="*80)
    
    high = [c for c in companies if c['activity_level'] == 'High']
    medium = [c for c in companies if c['activity_level'] == 'Medium']
    low = [c for c in companies if c['activity_level'] == 'Low']
    
    print(f"\nTotal unique companies found: {len(companies)}")
    print(f"  High activity (5+ searches): {len(high)}")
    print(f"  Medium activity (3-4 searches): {len(medium)}")
    print(f"  Low activity (2 searches): {len(low)}")
    
    print("\n🔥 TOP 5 MOST ACTIVE BUYERS:")
    print("-" * 80)
    for i, company in enumerate(companies[:5], 1):
        print(f"\n{i}. {company['company_name']}")
        print(f"   Found in {company['search_frequency']} searches (very active)")
        print(f"   Phone: {company['phone']}")
        print(f"   Email: {company['email']}")
        print(f"   Website: {company['website']}")
        print(f"   Queries: {company['queries_found'].split(' | ')[0]}... (+{len(company['queries_found'].split(' | '))-1} more)")
    
    print("\n" + "="*80)
    print("KEY INSIGHT: Companies appearing in 5-8 searches are HIGHLY ACTIVE buyers")
    print("             They match multiple buyer personas (geographic, property type, etc)")
    print("             = Very high confidence these are real, active buyer operations")
    print("="*80)


def main():
    """Run demo."""
    print("MULTI-QUERY BUYER SCRAPER - DEMO")
    print("=" * 80)
    print("\nThis demo shows what the real scraper will produce:")
    print("✓ 30 different search queries run")
    print("✓ 150+ raw results collected")
    print("✓ 15 unique companies found (after deduplication)")
    print("✓ Activity scores calculated (5-8 searches = highly active)")
    print("✓ Sorted by reliability (most-searched = most active buyers)")
    print("\n" + "=" * 80 + "\n")
    
    # Save and print
    csv_path = save_to_csv(DEMO_COMPANIES)
    json_path = save_to_json(DEMO_COMPANIES)
    print_summary(DEMO_COMPANIES)
    
    print(f"\nCSV ready for Supabase: {csv_path}")
    print(f"JSON for review: {json_path}")
    print("\n✅ This format is what real scraper will produce")
    print("✅ Ready to import to buyers table")


if __name__ == '__main__':
    main()
