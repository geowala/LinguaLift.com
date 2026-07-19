-- ============================================
-- LinguaLift Problems Table Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Drop existing table if rebuilding (careful in production!)
-- DROP TABLE IF EXISTS problems;

CREATE TABLE IF NOT EXISTS problems (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    mode text NOT NULL CHECK (mode IN ('matching', 'translation_table', 'multi_task', 'text')),
    type text NOT NULL DEFAULT 'adapted' CHECK (type IN ('adapted', 'original')),
    title text NOT NULL,
    contest text NOT NULL,
    label text,
    year int2 NOT NULL,
    topic text NOT NULL,
    difficulty int2 NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
    source_name text,
    source_url text,
    prompt text NOT NULL,
    hint text,
    solution text,
    answer_key jsonb,
    matching jsonb,
    datasets jsonb DEFAULT '[]'::jsonb,
    translation_tables jsonb,
    tasks jsonb,
    acceptable_answers jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_problems_contest ON problems(contest);
CREATE INDEX IF NOT EXISTS idx_problems_topic ON problems(topic);
CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_problems_year ON problems(year);
CREATE INDEX IF NOT EXISTS idx_problems_mode ON problems(mode);
CREATE INDEX IF NOT EXISTS idx_problems_type ON problems(type);

-- Enable Row Level Security
ALTER TABLE problems ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read problems (public access)
CREATE POLICY "Allow public read access" ON problems
    FOR SELECT USING (true);

-- Policy: Only authenticated users can insert (you'll restrict further in app logic)
CREATE POLICY "Allow authenticated insert" ON problems
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy: Only authenticated users can update
CREATE POLICY "Allow authenticated update" ON problems
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Policy: Only authenticated users can delete
CREATE POLICY "Allow authenticated delete" ON problems
    FOR DELETE USING (auth.role() = 'authenticated');

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_problems_updated_at
    BEFORE UPDATE ON problems
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Optional: Create a user_profiles table for admin roles
-- ============================================

CREATE TABLE IF NOT EXISTS user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    display_name text,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

-- Function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, role, display_name)
    VALUES (NEW.id, 'user', COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- Set yourself as admin (run after you sign up)
-- Replace 'your-user-uuid-here' with your actual auth user ID
-- ============================================
-- UPDATE user_profiles SET role = 'admin' WHERE id = 'your-user-uuid-here';
