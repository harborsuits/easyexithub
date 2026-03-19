#!/usr/bin/env node

/**
 * qualify_existing_leads.js
 * 
 * Run auto-qualification on all existing leads in Easy Exit CRM.
 * Sets outbound_approved=true for qualified leads, false for disqualified.
 * 
 * Usage: node scripts/qualify_existing_leads.js [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load credentials
const credsPath = path.join(process.env.HOME, '.openclaw/credentials/supabase-easyexit.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const supabase = createClient(creds.project_url, creds.service_role_key);

const CORPORATE_KEYWORDS = ['LLC', 'INC', 'CORP', 'CO', 'LTD', 'COMPANY', 'LIMITED'];
const UTILITY_KEYWORDS = ['POWER', 'ELECTRIC', 'WATER', 'SEWER', 'TOWN OF', 'CITY OF', 'COUNTY OF'];
const TARGET_STATES = ['ME', 'NH'];

const isDryRun = process.argv.includes('--dry-run');

async function qualifyLead(lead, phoneMap) {
  const disqualifications = [];
  
  // Check 1: Phone number
  if (!lead.owner_phone || lead.owner_phone.length < 10) {
    disqualifications.push('no_phone');
  }
  
  // Check 2: Corporate/utility
  const ownerUpper = (lead.owner_name || '').toUpperCase();
  
  if (CORPORATE_KEYWORDS.some(kw => ownerUpper.includes(kw))) {
    disqualifications.push('corporate');
  }
  
  if (UTILITY_KEYWORDS.some(kw => ownerUpper.includes(kw))) {
    disqualifications.push('utility');
  }
  
  // Check 3: Duplicate phone (using pre-built map)
  if (lead.owner_phone && phoneMap.has(lead.owner_phone)) {
    const leadsWithPhone = phoneMap.get(lead.owner_phone);
    if (leadsWithPhone.length > 1) {
      // Keep only the first lead with this phone, disqualify others
      if (leadsWithPhone[0] !== lead.id) {
        disqualifications.push('duplicate_owner');
      }
    }
  }
  
  // Check 4: Market geography
  let propertyData = lead.property_data;
  if (typeof propertyData === 'string') {
    try {
      propertyData = JSON.parse(propertyData);
    } catch {
      propertyData = {};
    }
  }
  
  const state = propertyData?.state || propertyData?.property_state;
  if (state && !TARGET_STATES.includes(state.toUpperCase())) {
    disqualifications.push('outside_market');
  }
  
  // Decision
  return {
    leadId: lead.id,
    ownerName: lead.owner_name,
    qualified: disqualifications.length === 0,
    reasons: disqualifications
  };
}

async function main() {
  console.log(`🔍 Easy Exit Lead Qualification ${isDryRun ? '(DRY RUN)' : ''}\n`);
  
  // Fetch all leads (Supabase default limit is 1000, need to paginate)
  let allLeads = [];
  let from = 0;
  const pageSize = 1000;
  
  while (true) {
    const { data: page, error } = await supabase
      .from('leads')
      .select('id, owner_name, owner_phone, property_data, status')
      .range(from, from + pageSize - 1)
      .order('id');
    
    if (error) {
      console.error('❌ Failed to fetch leads:', error);
      process.exit(1);
    }
    
    if (!page || page.length === 0) break;
    
    allLeads = allLeads.concat(page);
    if (page.length < pageSize) break; // Last page
    from += pageSize;
  }
  
  const leads = allLeads;
  
  console.log(`📊 Processing ${leads.length} leads...\n`);
  
  // Build phone map for duplicate detection (single pass)
  const phoneMap = new Map();
  leads.forEach(lead => {
    if (lead.owner_phone) {
      if (!phoneMap.has(lead.owner_phone)) {
        phoneMap.set(lead.owner_phone, []);
      }
      phoneMap.get(lead.owner_phone).push(lead.id);
    }
  });
  
  const results = {
    qualified: 0,
    disqualified: 0,
    reasons: {}
  };
  
  const updates = [];
  
  for (const lead of leads) {
    const result = await qualifyLead(lead, phoneMap);
    
    if (result.qualified) {
      results.qualified++;
      
      if (!isDryRun) {
        updates.push({
          id: lead.id,
          status: 'qualified',
          callable: true,
          outbound_approved: true,
          exclusion_reason: null
        });
      }
    } else {
      results.disqualified++;
      
      // Track disqualification reasons
      result.reasons.forEach(reason => {
        results.reasons[reason] = (results.reasons[reason] || 0) + 1;
      });
      
      if (!isDryRun) {
        updates.push({
          id: lead.id,
          status: 'disqualified',
          callable: false,
          outbound_approved: false,
          exclusion_reason: result.reasons
        });
      }
      
      console.log(`❌ ${lead.id} | ${lead.owner_name} | ${result.reasons.join(', ')}`);
    }
  }
  
  // Apply updates in batches of 50
  if (!isDryRun && updates.length > 0) {
    console.log(`\n💾 Applying ${updates.length} updates...`);
    
    for (let i = 0; i < updates.length; i += 50) {
      const batch = updates.slice(i, i + 50);
      
      for (const update of batch) {
        const { error } = await supabase
          .from('leads')
          .update({
            status: update.status,
            callable: update.callable,
            outbound_approved: update.outbound_approved,
            exclusion_reason: update.exclusion_reason
          })
          .eq('id', update.id);
        
        if (error) {
          console.error(`⚠️  Failed to update lead ${update.id}:`, error);
        }
      }
      
      console.log(`  ✅ Batch ${Math.floor(i / 50) + 1} complete`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📈 SUMMARY\n');
  console.log(`Total Leads:       ${leads.length}`);
  console.log(`✅ Qualified:      ${results.qualified} (${Math.round(results.qualified / leads.length * 100)}%)`);
  console.log(`❌ Disqualified:   ${results.disqualified} (${Math.round(results.disqualified / leads.length * 100)}%)`);
  console.log('\nDisqualification Breakdown:');
  
  Object.entries(results.reasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count}`);
    });
  
  console.log('='.repeat(60));
  
  if (isDryRun) {
    console.log('\n⚠️  DRY RUN - No changes were made. Run without --dry-run to apply.');
  } else {
    console.log('\n✅ Qualification complete!');
  }
}

main().catch(console.error);
