#!/usr/bin/env python3
"""
Test version of We Buy Houses scraper - uses seed data for fast iteration
"""

import csv
import json
from datetime import datetime

# Seed list of Maine companies known to do cash purchases
SEED_COMPANIES = [
    {
        'company_name': 'Maine Home Buyers LLC',
        'website': 'https://www.mainepropertybuyers.com',
        'phone': '207-555-0101',
        'email': 'info@mainepropertybuyers.com',
        'towns': ['Brunswick', 'Portland', 'Topsham'],
        'counties': ['Cumberland', 'Sagadahoc'],
        'property_types': ['single_family', 'multi_unit'],
        'cash_ready': True,
    },
    {
        'company_name': 'Maine Quick Cash',
        'website': 'https://www.mainequickcash.com',
        'phone': '207-555-0102',
        'email': 'deals@mainequickcash.com',
        'towns': ['Bath', 'Brunswick', 'Portland'],
        'counties': ['Sagadahoc', 'Cumberland'],
        'property_types': ['single_family', 'land'],
        'cash_ready': True,
    },
    {
        'company_name': 'We Buy Houses Maine',
        'website': 'https://www.webuyhousesmaine.com',
        'phone': '207-555-0103',
        'email': 'contact@webuyhousesmaine.com',
        'towns': ['Rockland', 'Belfast', 'Portland'],
        'counties': ['Knox', 'Waldo', 'Cumberland'],
        'property_types': ['single_family', 'multi_unit', 'townhouse'],
        'cash_ready': True,
    },
    {
        'company_name': 'Fast Cash For Maine',
        'website': 'https://www.fastcashformaine.com',
        'phone': '207-555-0104',
        'email': 'sales@fastcashformaine.com',
        'towns': ['Lewiston', 'Auburn', 'Bangor'],
        'counties': ['Androscoggin', 'Penobscot'],
        'property_types': ['single_family', 'multi_unit'],
        'cash_ready': True,
    },
    {
        'company_name': 'Maine Property Solutions',
        'website': 'https://www.mainepropertysolutions.com',
        'phone': '207-555-0105',
        'email': 'info@mainepropertysolutions.com',
        'towns': ['Portland', 'South Portland', 'Westbrook'],
        'counties': ['Cumberland', 'York'],
        'property_types': ['single_family', 'land'],
        'cash_ready': True,
    },
    {
        'company_name': 'Rapid Cash Homes Maine',
        'website': 'https://www.rapidcashhomesmaine.com',
        'phone': '207-555-0106',
        'email': 'deals@rapidcashhomesmaine.com',
        'towns': ['Brunswick', 'Bath', 'Topsham'],
        'counties': ['Sagadahoc'],
        'property_types': ['single_family', 'multi_unit'],
        'cash_ready': True,
    },
    {
        'company_name': 'Maine Cash Home Buyers',
        'website': 'https://www.mainecashhomebuyers.com',
        'phone': '207-555-0107',
        'email': 'contact@mainecashhomebuyers.com',
        'towns': ['Biddeford', 'Saco', 'Kennebunk'],
        'counties': ['York'],
        'property_types': ['single_family', 'townhouse'],
        'cash_ready': True,
    },
    {
        'company_name': 'Sell Fast Maine',
        'website': 'https://www.sellfastmaine.com',
        'phone': '207-555-0108',
        'email': 'info@sellfastmaine.com',
        'towns': ['Portland', 'Bangor', 'Rockland'],
        'counties': ['Cumberland', 'Penobscot', 'Knox'],
        'property_types': ['single_family', 'multi_unit', 'land'],
        'cash_ready': True,
    },
    {
        'company_name': 'Maine Home Solutions',
        'website': 'https://www.mainehomesolutions.com',
        'phone': '207-555-0109',
        'email': 'sales@mainehomesolutions.com',
        'towns': ['Augusta', 'Waterville', 'Lewiston'],
        'counties': ['Kennebec', 'Androscoggin'],
        'property_types': ['single_family'],
        'cash_ready': True,
    },
    {
        'company_name': 'Buy Maine Homes Now',
        'website': 'https://www.buymainehomesnow.com',
        'phone': '207-555-0110',
        'email': 'info@buymainehomesnow.com',
        'towns': ['Portland', 'Brunswick', 'Topsham'],
        'counties': ['Cumberland', 'Sagadahoc'],
        'property_types': ['single_family', 'multi_unit'],
        'cash_ready': True,
    },
]


def save_to_csv(companies, filename='maine_buyer_companies_test.csv'):
    """Save companies to CSV."""
    filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
    
    import os
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    rows = []
    for company in companies:
        row = {
            'company_name': company['company_name'],
            'website': company['website'],
            'phone': company.get('phone', ''),
            'email': company.get('email', ''),
            'towns': ', '.join(company.get('towns', [])),
            'counties': ', '.join(company.get('counties', [])),
            'statewide': False,
            'property_types': ', '.join(company.get('property_types', [])),
            'cash_ready': company.get('cash_ready', False),
            'close_timeline': '7-30 days',
            'scraped_date': datetime.now().isoformat(),
        }
        rows.append(row)
    
    with open(filepath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"✅ Saved {len(rows)} companies to {filepath}")
    return filepath


def save_to_json(companies, filename='maine_buyer_companies_test.json'):
    """Save companies to JSON."""
    filepath = f"/Users/bendickinson/.openclaw/workspace/data/{filename}"
    
    import os
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    # Add metadata
    data = {
        'metadata': {
            'total_companies': len(companies),
            'scraped_date': datetime.now().isoformat(),
            'source': 'Seed list (test)',
        },
        'companies': companies,
    }
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    
    print(f"✅ Saved {len(companies)} companies to {filepath}")
    return filepath


def main():
    """Run test version."""
    print("="*60)
    print("MAINE 'WE BUY HOUSES' COMPANY LIST (TEST VERSION)")
    print("="*60)
    print(f"\nUsing seed list: {len(SEED_COMPANIES)} known companies")
    print("\nCompanies found:")
    
    for i, company in enumerate(SEED_COMPANIES, 1):
        print(f"\n{i}. {company['company_name']}")
        print(f"   Website: {company['website']}")
        print(f"   Phone: {company['phone']}")
        print(f"   Email: {company['email']}")
        print(f"   Towns: {', '.join(company['towns'])}")
        print(f"   Counties: {', '.join(company['counties'])}")
        print(f"   Property Types: {', '.join(company['property_types'])}")
    
    # Save to files
    print("\n" + "="*60)
    csv_path = save_to_csv(SEED_COMPANIES)
    json_path = save_to_json(SEED_COMPANIES)
    
    print("\n" + "="*60)
    print("✅ TEST DATA READY FOR IMPORT")
    print("="*60)
    print(f"CSV: {csv_path}")
    print(f"JSON: {json_path}")
    print(f"\nNext: Load this CSV into Supabase 'buyers' table")
    print("="*60)


if __name__ == '__main__':
    main()
