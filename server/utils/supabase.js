const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  throw new Error("Supabase environment variables not configured");
}

// Create Supabase client for database operations
const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = supabase;

