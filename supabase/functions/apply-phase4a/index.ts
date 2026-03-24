import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }

  try {
    // Execute the ALTER TABLE statements
    const statements = [
      `ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS handoff_priority text DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS handoff_trigger_phrase text,
        ADD COLUMN IF NOT EXISTS handoff_trigger_source text,
        ADD COLUMN IF NOT EXISTS handoff_requested_at timestamptz,
        ADD COLUMN IF NOT EXISTS handoff_assigned_to text,
        ADD COLUMN IF NOT EXISTS handoff_completed_at timestamptz;`,
      
      `CREATE INDEX IF NOT EXISTS idx_leads_handoff_status_pending 
        ON leads(handoff_status, handoff_requested_at DESC) 
        WHERE handoff_status = 'pending';`,
      
      `CREATE INDEX IF NOT EXISTS idx_leads_handoff_priority 
        ON leads(handoff_priority, handoff_requested_at DESC) 
        WHERE handoff_priority != 'none';`,
    ];

    // Since Supabase doesn't have direct SQL execution via RPC,
    // we'll need to use the raw PostgreSQL connection
    // For now, return instructions
    return new Response(
      JSON.stringify({
        status: "Function ready for deployment",
        statements_to_execute: statements,
        next_step: "Deploy function and call POST endpoint",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
