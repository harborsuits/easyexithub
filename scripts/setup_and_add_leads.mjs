import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bgznglzzknmetzpwkbbz.supabase.co';
const supabaseKey = 'sb_publishable__EZVLNLFIn0eK-Blnr9vHg_vTGvUESH';

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupAndAddLeads() {
  try {
    console.log('🔨 Phase 1: Creating missing markets...\n');
    
    // Check if Birmingham and Kansas City markets exist
    const { data: allMarkets } = await supabase
      .from('markets')
      .select('id, name');
    
    console.log('Current markets:');
    allMarkets.forEach(m => console.log(`  - ${m.name} (ID: ${m.id})`));
    
    let birminghamId, kcId;
    
    const bhamMarket = allMarkets.find(m => m.name.includes('Birmingham'));
    const kcMarket = allMarkets.find(m => m.name.includes('Kansas'));
    
    if (!bhamMarket) {
      console.log('\n➕ Creating Birmingham, AL market...');
      const { data: newBham } = await supabase
        .from('markets')
        .insert([{ name: 'Birmingham, AL', region: 'Alabama', is_active: true }])
        .select();
      birminghamId = newBham[0].id;
      console.log(`   ✅ Created with ID: ${birminghamId}`);
    } else {
      birminghamId = bhamMarket.id;
      console.log(`   ✅ Already exists with ID: ${birminghamId}`);
    }
    
    if (!kcMarket) {
      console.log('➕ Creating Kansas City, MO market...');
      const { data: newKC } = await supabase
        .from('markets')
        .insert([{ name: 'Kansas City, MO', region: 'Missouri', is_active: true }])
        .select();
      kcId = newKC[0].id;
      console.log(`   ✅ Created with ID: ${kcId}`);
    } else {
      kcId = kcMarket.id;
      console.log(`   ✅ Already exists with ID: ${kcId}`);
    }
    
    console.log('\n🔨 Phase 2: Creating missing deal stages...\n');
    
    const { data: allStages } = await supabase
      .from('deal_stages')
      .select('id, name');
    
    console.log('Current deal stages:');
    allStages.forEach(s => console.log(`  - ${s.name} (ID: ${s.id})`));
    
    let unassignedId = allStages.find(s => s.name === 'Unassigned')?.id;
    
    if (!unassignedId) {
      console.log('\n➕ Creating Unassigned deal stage...');
      const { data: newStage } = await supabase
        .from('deal_stages')
        .insert([{ name: 'Unassigned', order_index: 0, is_terminal: false }])
        .select();
      unassignedId = newStage[0].id;
      console.log(`   ✅ Created with ID: ${unassignedId}`);
    } else {
      console.log(`   ✅ Already exists with ID: ${unassignedId}`);
    }
    
    console.log('\n🔨 Phase 3: Inserting test leads...\n');
    
    const testLeads = [
      {
        property_address: '1245 Oak Ridge Drive',
        city: 'Birmingham',
        state: 'AL',
        zip: '35213',
        market_id: birminghamId,
        property_type: 'Single Family Home',
        bedrooms: 3,
        bathrooms: 2,
        asking_price: 145000,
        estimated_arv: 185000,
        repair_estimate: 25000,
        condition_notes: 'Good condition, needs minor updates, foundation solid',
        deal_stage_id: unassignedId,
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
        market_id: birminghamId,
        property_type: 'Multi-Family (4-Plex)',
        bedrooms: 12,
        bathrooms: 8,
        asking_price: 220000,
        estimated_arv: 310000,
        repair_estimate: 55000,
        condition_notes: 'Mixed units, 2 occupied, roof needs replacement',
        deal_stage_id: unassignedId,
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
        market_id: kcId,
        property_type: 'Single Family Home',
        bedrooms: 2,
        bathrooms: 1,
        asking_price: 95000,
        estimated_arv: 135000,
        repair_estimate: 22000,
        condition_notes: 'Older home, dated interior, good bones',
        deal_stage_id: unassignedId,
        owner_name: 'James Chen',
        owner_phone: '816-555-0789',
        owner_email: 'james.chen@email.com',
        lead_source: 'Driving for Dollars'
      }
    ];

    // Note: leads table may not have all these columns
    // Insert only the columns that actually exist
    const leadInserts = testLeads.map(lead => ({
      market_id: lead.market_id,
      deal_stage_id: lead.deal_stage_id,
      owner_name: lead.owner_name,
      owner_phone: lead.owner_phone,
      owner_email: lead.owner_email,
      lead_source: lead.lead_source,
      estimated_arv: lead.estimated_arv,
      motivation_type: 'High motivated',
      status: 'active'
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('leads')
      .insert(leadInserts)
      .select();

    if (insertError) throw insertError;
    
    console.log(`✅ Successfully inserted ${inserted.length} test leads!`);
    inserted.forEach((lead, i) => {
      console.log(`   ${i+1}. Owner: ${lead.owner_name}, Market ID: ${lead.market_id}, ARV: $${lead.estimated_arv}`);
    });
    
    console.log('\n📊 Final verification...');
    const { data: allLeads } = await supabase
      .from('leads')
      .select('id, owner_name, market_id, deal_stage_id, estimated_arv');
    
    console.log(`Total leads in database: ${allLeads.length}`);
    allLeads.forEach(l => {
      const marketName = l.market_id === birminghamId ? 'Birmingham' : l.market_id === kcId ? 'Kansas City' : 'Maine';
      console.log(`   - ID ${l.id}: ${l.owner_name} (${marketName})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setupAndAddLeads();
