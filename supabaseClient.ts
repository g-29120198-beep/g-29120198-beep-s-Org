import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Sanitize URL in case user pasted the PostgREST endpoint instead of the project URL
const sanitizedUrl = supabaseUrl?.replace(/\/rest\/v1\/?$/, '');

// Check if variables exist to avoid crashing
export const isSupabaseConfigured = !!(sanitizedUrl && supabaseAnonKey);

export const supabase = createClient(
  sanitizedUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);
