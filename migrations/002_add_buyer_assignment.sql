-- Add buyer assignment column to leads table
ALTER TABLE leads ADD COLUMN assigned_buyer_id INTEGER REFERENCES buyers(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN assignment_date TIMESTAMP WITH TIME ZONE;
