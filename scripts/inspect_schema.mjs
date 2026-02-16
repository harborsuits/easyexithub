import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bgznglzzknmetzpwkbbz.supabase.co';
const supabaseKey = 'sb_publishable__EZVLNLFIn0eK-Blnr9vHg_vTGvUESH';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
  try {
    console.log('🔍 Checking available tables...\n');
    
    // Try to fetch from markets
    console.log('1. Querying markets table...');
    const { data: markets, error: marketsError } = await supabase
      .from('markets')
      .select('*')
      .limit(5);
    
    if (marketsError) {
      console.log(`   ❌ Error: ${marketsError.message}`);
    } else {
      console.log(`   ✅ Markets table exists. Found ${markets.length} records:`);
      if (markets.length > 0) {
        console.log(`      Columns: ${Object.keys(markets[0]).join(', ')}`);
        markets.forEach(m => console.log(`      - ${m.id}: ${JSON.stringify(m)}`));
      }
    }
    
    // Try to fetch from deal_stages
    console.log('\n2. Querying deal_stages table...');
    const { data: stages, error: stagesError } = await supabase
      .from('deal_stages')
      .select('*')
      .limit(5);
    
    if (stagesError) {
      console.log(`   ❌ Error: ${stagesError.message}`);
    } else {
      console.log(`   ✅ deal_stages table exists. Found ${stages.length} records:`);
      if (stages.length > 0) {
        console.log(`      Columns: ${Object.keys(stages[0]).join(', ')}`);
        stages.forEach(s => console.log(`      - ${s.id}: ${JSON.stringify(s)}`));
      }
    }
    
    // Try to fetch from leads
    console.log('\n3. Querying leads table...');
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('*')
      .limit(5);
    
    if (leadsError) {
      console.log(`   ❌ Error: ${leadsError.message}`);
    } else {
      console.log(`   ✅ leads table exists. Found ${leads.length} records:`);
      if (leads.length > 0) {
        console.log(`      Columns: ${Object.keys(leads[0]).join(', ')}`);
        leads.forEach(l => console.log(`      - ID ${l.id}: ${JSON.stringify(l)}`));
      }
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  }
}

inspectSchema();
