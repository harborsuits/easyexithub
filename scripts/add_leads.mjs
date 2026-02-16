import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bgznglzzknmetzpwkbbz.supabase.co';
const supabaseKey = 'sb_publishable__EZVLNLFIn0eK-Blnr9vHg_vTGvUESH';

const supabase = createClient(supabaseUrl, supabaseKey);

async function addTestLeads() {
  try {
    console.log('🔍 Fetching market and deal stage IDs...');
    
    // Get market IDs
    const { data: markets, error: marketsError } = await supabase
      .from('markets')
      .select('id, name');
    
    if (marketsError) throw marketsError;
    
    const birminghamMarket = markets.find(m => m.name.includes('Birmingham'));
    const kansasCityMarket = markets.find(m => m.name.includes('Kansas'));
    
    console.log('✅ Markets found:');
    console.log(`   Birmingham: ${birminghamMarket?.name} (ID: ${birminghamMarket?.id})`);
    console.log(`   Kansas City: ${kansasCityMarket?.name} (ID: ${kansasCityMarket?.id})`);
    
    // Get deal stages
    const { data: stages, error: stagesError } = await supabase
      .from('deal_stages')
      .select('id, name');
    
    if (stagesError) throw stagesError;
    
    const unassignedStage = stages.find(s => s.name === 'Unassigned');
    
    console.log(`✅ Deal stage found: ${unassignedStage?.name} (ID: ${unassignedStage?.id})`);
    
    // Prepare test leads
    const testLeads = [
      {
        property_address: '1245 Oak Ridge Drive',
        city: 'Birmingham',
        state: 'AL',
        zip: '35213',
        market_id: birminghamMarket?.id,
        property_type: 'Single Family Home',
        bedrooms: 3,
        bathrooms: 2,
        asking_price: 145000,
        estimated_arv: 185000,
        repair_estimate: 25000,
        condition_notes: 'Good condition, needs minor updates, foundation solid',
        deal_stage_id: unassignedStage?.id,
        owner_name: 'Robert Williams',
        owner_phone: '205-555-0123',
        owner_email: 'robert.williams@email.com',
        lead_source: 'Direct Outreach'
      },
      {
        property_address: '8392 Westwood Lane',
        city: 'Birmingham',
        state: 'AL',
        zip: '35209',
        market_id: birminghamMarket?.id,
        property_type: 'Multi-Family (4-Plex)',
        bedrooms: 12,
        bathrooms: 8,
        asking_price: 220000,
        estimated_arv: 310000,
        repair_estimate: 55000,
        condition_notes: 'Mixed units, 2 occupied, roof needs replacement, plumbing updates needed',
        deal_stage_id: unassignedStage?.id,
        owner_name: 'Patricia Mitchell',
        owner_phone: '205-555-0456',
        owner_email: 'patricia.mitchell@email.com',
        lead_source: 'Facebook Groups'
      },
      {
        property_address: '532 Main Street',
        city: 'Kansas City',
        state: 'MO',
        zip: '64105',
        market_id: kansasCityMarket?.id,
        property_type: 'Single Family Home',
        bedrooms: 2,
        bathrooms: 1,
        asking_price: 95000,
        estimated_arv: 135000,
        repair_estimate: 22000,
        condition_notes: 'Older home, dated interior, good bones, quiet neighborhood',
        deal_stage_id: unassignedStage?.id,
        owner_name: 'James Chen',
        owner_phone: '816-555-0789',
        owner_email: 'james.chen@email.com',
        lead_source: 'Driving for Dollars'
      }
    ];
    
    console.log('\n📍 Inserting 3 test leads...');
    
    const { data, error } = await supabase
      .from('leads')
      .insert(testLeads)
      .select();

    if (error) throw error;
    
    console.log(`\n✅ Success! ${data.length} leads created:`);
    data.forEach((lead, i) => {
      const profit = lead.estimated_arv - lead.asking_price - lead.repair_estimate;
      console.log(`   ${i+1}. ${lead.property_address}, ${lead.city} - $${profit.toLocaleString()} profit`);
    });
    
    // Verify by counting all leads
    console.log('\n🔍 Verifying all leads in database...');
    const { data: allLeads, error: countError } = await supabase
      .from('leads')
      .select('id, property_address, city, asking_price, estimated_arv', { count: 'exact' });
    
    if (countError) throw countError;
    
    console.log(`✅ Total leads in database: ${allLeads.length}`);
    allLeads.forEach((lead, i) => {
      const profit = lead.estimated_arv - lead.asking_price;
      console.log(`   ${i+1}. ${lead.property_address}, ${lead.city}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

addTestLeads();
