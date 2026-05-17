-- SQL Script for SERQI Supabase Setup
-- Paste this into your Supabase SQL Editor

-- 1. Create Teachers table
CREATE TABLE teachers (
  uid UUID PRIMARY KEY REFERENCES auth.users(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'TEACHER' CHECK (role IN ('ADMIN', 'TEACHER'))
);

-- 2. Create Students table
CREATE TABLE students (
  ID_MURID TEXT PRIMARY KEY,
  NAMA_MURID TEXT NOT NULL,
  KELAS TEXT NOT NULL,
  TAHAP INTEGER NOT NULL,
  EMAIL TEXT,
  STATUS_MURID TEXT DEFAULT 'AKTIF' CHECK (STATUS_MURID IN ('AKTIF', 'TIDAK_AKTIF'))
);

-- 3. Create Records table
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  studentId TEXT REFERENCES students(ID_MURID),
  studentName TEXT,
  className TEXT,
  readingType TEXT,
  readingStatus TEXT,
  page TEXT,
  juzuk INTEGER,
  isKhatam BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  recordedBy UUID REFERENCES auth.users(id),
  teacherName TEXT
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;

-- 5. Create Policies

-- Teachers: Anyone authenticated can read, but only themselves can update their profile
CREATE POLICY "Teachers can view all teachers" ON teachers FOR SELECT USING (true);
CREATE POLICY "Teachers can update own profile" ON teachers FOR UPDATE USING (auth.uid() = uid);
CREATE POLICY "Teachers can insert own profile" ON teachers FOR INSERT WITH CHECK (auth.uid() = uid);

-- Students: Anyone authenticated can read/write (simplified for this app)
CREATE POLICY "Allow all authenticated for students" ON students FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow public read for students (for parent mode)" ON students FOR SELECT USING (true);

-- Records: Anyone authenticated can read/write
CREATE POLICY "Allow all authenticated for records" ON records FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow public read for records (for parent mode)" ON records FOR SELECT USING (true);

-- 6. Real-time Setup
ALTER PUBLICATION supabase_realtime ADD TABLE students, records;
