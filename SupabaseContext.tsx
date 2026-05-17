
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Teacher, Student, ReadingRecord } from './types';

interface SupabaseContextType {
  user: Teacher | null;
  loading: boolean;
  login: () => Promise<void>;
  loginByEmail: (email: string, password: string) => Promise<void>;
  signUpByEmail: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  students: Student[];
  records: ReadingRecord[];
  addRecord: (record: Omit<ReadingRecord, 'id' | 'timestamp'>) => Promise<void>;
  addStudent: (student: Omit<Student, 'ID_MURID' | 'STATUS_MURID'>) => Promise<void>;
  updateStudent: (student: Student) => Promise<void>;
  isSyncing: boolean;
  isConfigValid: boolean;
  error: string | null;
}

const SupabaseContext = createContext<SupabaseContextType | undefined>(undefined);

export const SupabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<ReadingRecord[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.warn("Supabase is not configured yet. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setLoading(false);
      return;
    }

    console.log("Initializing Supabase Auth...");
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log("Initial session check:", session ? "Authenticated" : "No session");
      handleAuthChange(session?.user ?? null);
    }).catch(err => {
      console.error("Supabase session error:", err);
    }).finally(() => {
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthChange(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuthChange = async (supabaseUser: any) => {
    if (supabaseUser) {
      // Check if teacher exists
      const { data: teacher, error } = await supabase
        .from('teachers')
        .select('*')
        .eq('uid', supabaseUser.id)
        .single();

      if (teacher) {
        setUser(teacher);
      } else {
        const newTeacher: Teacher = {
          uid: supabaseUser.id,
          name: supabaseUser.user_metadata?.full_name || 'Guru Baru',
          email: supabaseUser.email || '',
          role: 'TEACHER'
        };
        await supabase.from('teachers').insert([newTeacher]);
        setUser(newTeacher);
      }
    } else {
      setUser(null);
    }
  };

  // Fetch data
  useEffect(() => {
    const fetchInitialData = async () => {
      // Fetch students and records regardless of user session (Public read is allowed by RLS)
      const { data: stds } = await supabase.from('students').select('*').order('NAMA_MURID');
      const { data: recs } = await supabase.from('records').select('*').order('timestamp', { ascending: false }).limit(500);
      
      if (stds) setStudents(stds);
      if (recs) setRecords(recs);
    };

    fetchInitialData();

    // Set up real-time
    const studentsSub = supabase
      .channel('public:students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, payload => {
        if (payload.eventType === 'INSERT') {
          setStudents(prev => [...prev, payload.new as Student]);
        } else if (payload.eventType === 'UPDATE') {
          setStudents(prev => prev.map(s => s.ID_MURID === payload.new.ID_MURID ? payload.new as Student : s));
        } else if (payload.eventType === 'DELETE') {
          setStudents(prev => prev.filter(s => s.ID_MURID !== payload.old.ID_MURID));
        }
      })
      .subscribe();

    const recordsSub = supabase
      .channel('public:records')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'records' }, payload => {
        setRecords(prev => [payload.new as ReadingRecord, ...prev].slice(0, 500));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(studentsSub);
      supabase.removeChannel(recordsSub);
    };
  }, []); // Remove dependency on [user] so it loads for parents too

  const login = async () => {
    if (!isSupabaseConfigured) {
      alert("Sila masukkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY dalam fail .env anda.");
      return;
    }
    console.log("Starting Google OAuth login...");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) {
      console.error("OAuth error:", error);
      setError(error.message);
      if (error.message.includes("provider is not enabled")) {
        alert("Ralat: Google Auth tidak diaktifkan di Dashboard Supabase anda.\n\nSila aktifkan 'Google' di Authentication -> Providers, ATAU gunakan pilihan 'Log Masuk Emel' di bawah.");
      } else {
        alert("Gagal log masuk Google: " + error.message);
      }
    }
  };

  const loginByEmail = async (email: string, password: string) => {
    console.log("Attempting email login for:", email);
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("Login error:", error);
      setError(error.message);
      if (error.message.includes("Invalid login credentials")) {
        alert("Ralat Log Masuk: Emel atau kata laluan salah.\n\nSila pastikan anda telah mendaftar akaun terlebih dahulu menggunakan butang 'DAFTAR AKAUN'. Jika sudah mendaftar, pastikan emel & kata laluan adalah tepat.");
      } else if (error.message.includes("Email not confirmed")) {
        alert("Emel Belum Disahkan: Sila semak peti masuk emel anda dan klik pautan pengesahan yang dihantar oleh Supabase.");
      } else {
        alert("Gagal log masuk: " + error.message);
      }
    } else {
      console.log("Login successful:", data.user?.id);
    }
  };

  const signUpByEmail = async (email: string, password: string, name: string) => {
    console.log("Attempting sign up for:", email);
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: window.location.origin
      }
    });

    if (error) {
      console.error("Sign up error:", error);
      setError(error.message);
      alert("Gagal mendaftar: " + error.message);
    } else if (data.user) {
      console.log("Sign up successful:", data.user.id);
      
      // Manually insert into teachers table as well just in case trigger hasn't been set up
      await supabase.from('teachers').insert([{
        uid: data.user.id,
        name: name,
        email: email,
        role: 'TEACHER'
      }]);

      if (data.session) {
        alert("Pendaftaran berjaya! Anda kini telah log masuk.");
      } else {
        alert("Pendaftaran berjaya!\n\nSila SEMAK EMEL anda (" + email + ") untuk pautan pengesahan. Anda mesti klik pautan tersebut sebelum boleh log masuk buat kali pertama.");
      }
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const addRecord = async (recordData: Omit<ReadingRecord, 'id' | 'timestamp'>) => {
    if (!user) return;
    setIsSyncing(true);
    try {
      const id = 'R' + Date.now();
      const newRecord: ReadingRecord = {
        ...recordData,
        id,
        timestamp: new Date().toISOString(),
        recordedBy: user.uid,
        teacherName: user.name
      };
      const { error } = await supabase.from('records').insert([newRecord]);
      if (error) throw error;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const addStudent = async (studentData: Omit<Student, 'ID_MURID' | 'STATUS_MURID'>) => {
    setIsSyncing(true);
    try {
      let maxIdNum = 0;
      students.forEach(st => { 
        const match = st.ID_MURID.match(/M(\d+)/);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxIdNum) maxIdNum = num;
        }
      });
      const newId = `M${(maxIdNum + 1).toString().padStart(4, '0')}`;
      const newStudent: Student = {
        ...studentData,
        ID_MURID: newId,
        STATUS_MURID: 'AKTIF'
      };
      const { error } = await supabase.from('students').insert([newStudent]);
      if (error) throw error;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const updateStudent = async (student: Student) => {
    setIsSyncing(true);
    try {
      const { error } = await supabase
        .from('students')
        .update(student)
        .eq('ID_MURID', student.ID_MURID);
      if (error) throw error;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <SupabaseContext.Provider value={{ 
      user, loading, login, loginByEmail, signUpByEmail, logout, students, records, 
      addRecord, addStudent, updateStudent, isSyncing, error,
      isConfigValid: isSupabaseConfigured
    }}>
      {children}
    </SupabaseContext.Provider>
  );
};

export const useSupabase = () => {
  const context = useContext(SupabaseContext);
  if (context === undefined) {
    throw new Error('useSupabase must be used within a SupabaseProvider');
  }
  return context;
};
