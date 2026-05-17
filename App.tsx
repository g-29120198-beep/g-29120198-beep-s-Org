
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  BarChart3 as BarChartIcon, 
  FileText as FileTextIcon, 
  Database as DatabaseIcon, 
  Sparkles as SparkleIcon,
  Loader2,
  TriangleAlert,
  AlertCircle,
  LogIn,
  Mail,
  Lock,
  UserPlus
} from 'lucide-react';
import Header from './components/Header';
import ProgressForm from './components/ProgressForm';
import Dashboard from './components/Dashboard';
import Reports from './components/Reports';
import DataManagement from './components/DataManagement';
import { ReadingRecord, Student, CloudConfig, ClassOption } from './types';
import { useSupabase } from './SupabaseContext';

type Tab = 'input' | 'dashboard' | 'reports' | 'data';

const SCHOOL_LOGO_URL = "https://iili.io/fQdElMx.png";

export const forceId = (id: any) => id ? String(id).trim().replace(/[^\w]/g, '').toUpperCase() : "";
export const normalizeString = (str: any) => str ? String(str).trim().replace(/\s+/g, ' ').toUpperCase() : "";

// Utility function for robust fetch with retries (Exponential Backoff)
const fetchWithRetry = async (url: string, options: RequestInit = {}, retries = 3, backoff = 1000): Promise<Response> => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, backoff * Math.pow(2, i)));
    }
  }
  throw new Error("Fetch failed after retries");
};

const App: React.FC = () => {
  const { 
    user, loading, login, loginByEmail, signUpByEmail, logout, 
    students: fbStudents, records: fbRecords, 
    addRecord, addStudent: fbAddStudent, updateStudent: fbUpdateStudent,
    isSyncing: fbIsSyncing, error: fbError,
    isConfigValid
  } = useSupabase();

  const [activeTab, setActiveTab] = useState<Tab>('input');
  const [authMode, setAuthMode] = useState<'options' | 'login' | 'signup'>('options');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  // Existing local state for GAS compatibility/migration
  const [records, setRecords] = useState<ReadingRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  // Update records/students from Firebase if available
  useEffect(() => {
    if (fbStudents.length > 0) setStudents(fbStudents);
  }, [fbStudents]);

  useEffect(() => {
    if (fbRecords.length > 0) setRecords(fbRecords);
  }, [fbRecords]);

  const STORAGE_KEY_STUDENTS = 'serqi_stds_v20';
  const STORAGE_KEY_RECORDS = 'serqi_recs_v20';
  const STORAGE_KEY_CONFIG = 'serqi_conf_v20';

  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('serqi_dark_mode');
      return saved ? JSON.parse(saved) : false;
    } catch (e) { return false; }
  });

  const [cloudConfig, setCloudConfig] = useState<CloudConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      return saved ? JSON.parse(saved) : { isEnabled: false, projectUrl: '', apiKey: '', lastSync: null };
    } catch (e) { return { isEnabled: false, projectUrl: '', apiKey: '', lastSync: null }; }
  });

  // FETCH SEMUA DATA DARI CLOUD (LOAD CLOUD AS MASTER)
  const fetchCloudData = useCallback(async (silent = false) => {
    if (!cloudConfig.projectUrl) return;
    if (!silent) setIsSyncing(true);
    setSyncError(null);

    try {
      const baseUrl = cloudConfig.projectUrl.split('?')[0];
      const res = await fetchWithRetry(`${baseUrl}?action=fetch&v=${Date.now()}`);
      
      const cloudData = await res.json();
      
      // Clean Murid Data
      const formattedStds = (cloudData.students || []).map((s: any) => ({
        ID_MURID: forceId(s.ID_MURID),
        NAMA_MURID: normalizeString(s.NAMA_MURID),
        KELAS: normalizeString(s.KELAS),
        TAHAP: parseInt(s.TAHAP || 1),
        STATUS_MURID: s.STATUS_MURID || 'AKTIF'
      }));

      // Clean Rekod Data
      const formattedRecs = (cloudData.records || []).map((r: any) => ({
        id: r.ID_REKOD || `REC-${r.TARIKH}-${r.ID_MURID}`,
        studentId: forceId(r.ID_MURID),
        readingType: r.JENIS,
        readingStatus: r.STATUS,
        page: String(r.MUKA_SURAT),
        juzuk: r.JUZUK ? parseInt(r.JUZUK) : undefined,
        isKhatam: r.KHATAM === "YA",
        timestamp: r.TARIKH,
        studentName: formattedStds.find((s: Student) => s.ID_MURID === forceId(r.ID_MURID))?.NAMA_MURID || "MURID",
        className: formattedStds.find((s: Student) => s.ID_MURID === forceId(r.ID_MURID))?.KELAS || "-"
      })).sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));

      setStudents(formattedStds);
      setRecords(formattedRecs);
      setCloudConfig(prev => ({ ...prev, lastSync: new Date().toISOString() }));
      
      // Update local cache as backup
      localStorage.setItem(STORAGE_KEY_STUDENTS, JSON.stringify(formattedStds));
      localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(formattedRecs));
    } catch (e) {
      setSyncError("Cloud Sync Gagal. Sila periksa URL WebApp GAS.");
      // If error, try to load from local as fallback
      const savedStds = localStorage.getItem(STORAGE_KEY_STUDENTS);
      const savedRecs = localStorage.getItem(STORAGE_KEY_RECORDS);
      if (savedStds) setStudents(JSON.parse(savedStds));
      if (savedRecs) setRecords(JSON.parse(savedRecs));
    } finally {
      setIsSyncing(false);
    }
  }, [cloudConfig.projectUrl]);

  // AWALAN: Load dari cloud sebaik sahaja App bermula
  useEffect(() => {
    if (cloudConfig.projectUrl) {
      fetchCloudData();
    }
  }, []);

  // SAVE REKOD KE CLOUD (POST) - ID FORMAT R000001
  const saveRecordCloud = async (recordData: Omit<ReadingRecord, 'id' | 'timestamp'>) => {
    if (user) {
      await addRecord(recordData);
      return;
    }

    if (!cloudConfig.projectUrl) {
      alert("Sila tetapkan URL WebApp di tab CLOUD terlebih dahulu.");
      return;
    }

    setIsSyncing(true);
    try {
      const now = new Date();
      const ts = now.toISOString();
      const idRekod = 'R' + now.getTime().toString(); 
      
      const fullRecord = {
        ...recordData,
        id: idRekod,
        timestamp: ts
      };

      const baseUrl = cloudConfig.projectUrl.split('?')[0];
      await fetchWithRetry(baseUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveRecord', data: fullRecord })
      });
      
      await fetchCloudData(true);
    } catch (e) {
      setSyncError("Gagal simpan rekod ke Cloud.");
    } finally {
      setIsSyncing(false);
    }
  };

  // SAVE MURID KE CLOUD (POST) - ID FORMAT M0001
  const saveStudentCloud = async (student: Student) => {
    if (user) {
      await fbUpdateStudent(student);
      return;
    }

    if (!cloudConfig.projectUrl) {
      alert("Sila tetapkan URL WebApp di tab CLOUD.");
      return;
    }

    setIsSyncing(true);
    try {
      const baseUrl = cloudConfig.projectUrl.split('?')[0];
      await fetchWithRetry(baseUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveStudent', data: student })
      });
      await fetchCloudData(true);
    } catch (e) {
      setSyncError("Gagal kemaskini murid di Cloud.");
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => { localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cloudConfig)); }, [cloudConfig]);
  useEffect(() => { localStorage.setItem('serqi_dark_mode', JSON.stringify(isDarkMode)); }, [isDarkMode]);

  const activeStudents = useMemo(() => students.filter(s => s.STATUS_MURID === 'AKTIF'), [students]);

  const availableClasses = useMemo(() => {
    const classesMap = new Map<string, ClassOption>();
    activeStudents.forEach(s => {
      const name = normalizeString(s.KELAS);
      if (name && !classesMap.has(name)) {
        classesMap.set(name, { id: name.replace(/\s+/g, '-'), name, grade: s.TAHAP });
      }
    });
    return Array.from(classesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStudents]);

  const [parentMode, setParentMode] = useState(false);
  const [parentSearchId, setParentSearchId] = useState('');
  const [foundStudent, setFoundStudent] = useState<Student | null>(null);
  const [studentHistory, setStudentHistory] = useState<ReadingRecord[]>([]);

  const handleParentSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const emailSearch = parentSearchId.trim().toLowerCase();
    const std = students.find(s => s.EMAIL?.toLowerCase() === emailSearch);
    if (std) {
      setFoundStudent(std);
      const history = records.filter(r => r.studentId === std.ID_MURID).sort((a,b) => b.timestamp.localeCompare(a.timestamp));
      setStudentHistory(history);
    } else {
      alert("Emel DELIMa tidak ditemui. Sila pastikan emel betul.");
      setFoundStudent(null);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await loginByEmail(email, password);
    setIsSubmitting(false);
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await signUpByEmail(email, password, name);
    setIsSubmitting(false);
    setAuthMode('login');
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDarkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-indigo-600" size={48} />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sila Tunggu...</p>
        </div>
      </div>
    );
  }

  if (!user && !parentMode) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-6 ${isDarkMode ? 'bg-slate-950' : 'bg-slate-50'}`}>
        <div className={`max-w-md w-full p-12 rounded-[3.5rem] shadow-2xl space-y-8 text-center animate-in zoom-in duration-500 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
           <div className={`w-32 h-32 mx-auto rounded-[2.5rem] p-4 flex items-center justify-center shadow-inner mb-6 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
             <img src={SCHOOL_LOGO_URL} className="w-full h-full object-contain" />
           </div>
           <h2 className={`text-2xl font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>SERQI</h2>
           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 leading-relaxed">
             Sistem E-Rekod Al-Quran & Iqra Pintar. <br/> Sila log masuk dengan emel guru.
           </p>
           
           {!isConfigValid && (
             <div className="p-6 mb-6 bg-amber-50 border-2 border-amber-100 rounded-[2.5rem] flex items-start gap-4 text-left animate-in fade-in slide-in-from-top duration-500">
               <AlertCircle size={20} className="text-amber-500 shrink-0 mt-0.5" />
               <div>
                 <p className="text-[10px] font-black text-amber-700 uppercase tracking-tight">Menunggu Konfigurasi Supabase</p>
                 <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wider opacity-80 leading-relaxed mt-1">
                   Sila masukkan <b>VITE_SUPABASE_URL</b> dan <b>VITE_SUPABASE_ANON_KEY</b> di tetapan (Settings) AI Studio atau hubungi pembangun.
                 </p>
               </div>
             </div>
           )}
           
           {authMode === 'options' ? (
             <div className="space-y-4">
               <button 
                 onClick={login} 
                 disabled={!isConfigValid}
                 className={`w-full py-6 rounded-3xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95 group ${!isConfigValid ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none border-2 border-slate-100' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
               >
                 {isConfigValid ? <LogIn size={20} className="group-hover:translate-x-1 transition-transform" /> : <Loader2 size={18} className="animate-spin text-slate-400" />}
                 {isConfigValid ? "LOG MASUK GURU (GOOGLE)" : "MENUNGGU SUPABASE..."}
               </button>

               <div className="grid grid-cols-2 gap-4">
                 <button 
                   onClick={() => setAuthMode('login')}
                   disabled={!isConfigValid}
                   className={`py-6 rounded-3xl font-black text-[9px] uppercase tracking-[0.15em] border transition-all active:scale-95 flex flex-col items-center justify-center gap-2 ${!isConfigValid ? 'border-slate-100 text-slate-200 cursor-not-allowed' : (isDarkMode ? 'border-slate-800 text-slate-400 hover:bg-slate-800' : 'border-slate-100 text-slate-400 hover:bg-slate-50')}`}
                 >
                   <Mail size={18} /> <span>LOG MASUK EMEL</span>
                 </button>
                 
                 <button 
                   onClick={() => setAuthMode('signup')}
                   disabled={!isConfigValid}
                   className={`py-6 rounded-3xl font-black text-[9px] uppercase tracking-[0.15em] border transition-all active:scale-95 flex flex-col items-center justify-center gap-2 ${!isConfigValid ? 'border-slate-100 text-slate-200 cursor-not-allowed' : (isDarkMode ? 'border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/10' : 'border-indigo-50 text-indigo-600 hover:bg-indigo-50')}`}
                 >
                   <UserPlus size={18} /> <span>DAFTAR AKAUN</span>
                 </button>
               </div>
               
               <button onClick={() => setParentMode(true)} className={`w-full py-6 rounded-3xl font-black text-[10px] uppercase tracking-[0.2em] border-2 transition-all active:scale-95 flex items-center justify-center gap-3 ${isDarkMode ? 'border-slate-800 text-slate-400 hover:bg-slate-800' : 'border-slate-100 text-slate-500 hover:bg-slate-50'}`}>
                  SEMAKAN IBU BAPA
               </button>
             </div>
           ) : authMode === 'login' ? (
             <form onSubmit={handleEmailLogin} className="space-y-4 text-left">
               <div className="space-y-4">
                 <div className="relative">
                   <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                   <input 
                     type="email" 
                     placeholder="EMEL GURU"
                     required
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     className={`w-full py-4 pl-12 pr-4 rounded-2xl text-[10px] font-bold border-2 outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 focus:border-indigo-500'}`}
                   />
                 </div>
                 <div className="relative">
                   <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                   <input 
                     type="password" 
                     placeholder="KATA LALUAN"
                     required
                     value={password}
                     onChange={(e) => setPassword(e.target.value)}
                     className={`w-full py-4 pl-12 pr-4 rounded-2xl text-[10px] font-bold border-2 outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 focus:border-indigo-500'}`}
                   />
                 </div>
               </div>
               <button 
                 type="submit"
                 disabled={isSubmitting}
                 className="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-lg hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2"
               >
                 {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                 MASUK
               </button>
               <div className="flex justify-between items-center px-2">
                 <button type="button" onClick={() => setAuthMode('signup')} className="text-[9px] font-black text-indigo-500 uppercase tracking-widest hover:underline">DAFTAR GURU BARU</button>
                 <button type="button" onClick={() => setAuthMode('options')} className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:underline">KEMBALI</button>
               </div>
             </form>
           ) : (
             <form onSubmit={handleEmailSignUp} className="space-y-4 text-left">
               <div className="space-y-4">
                 <div className="relative">
                   <UserPlus size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                   <input 
                     type="text" 
                     placeholder="NAMA PENUH GURU"
                     required
                     value={name}
                     onChange={(e) => setName(e.target.value)}
                     className={`w-full py-4 pl-12 pr-4 rounded-2xl text-[10px] font-bold border-2 outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 focus:border-indigo-500'}`}
                   />
                 </div>
                 <div className="relative">
                   <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                   <input 
                     type="email" 
                     placeholder="EMEL DELIMA GURU"
                     required
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     className={`w-full py-4 pl-12 pr-4 rounded-2xl text-[10px] font-bold border-2 outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 focus:border-indigo-500'}`}
                   />
                 </div>
                 <div className="relative">
                   <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                   <input 
                     type="password" 
                     placeholder="KATA LALUAN"
                     required
                     value={password}
                     onChange={(e) => setPassword(e.target.value)}
                     className={`w-full py-4 pl-12 pr-4 rounded-2xl text-[10px] font-bold border-2 outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 focus:border-indigo-500'}`}
                   />
                 </div>
               </div>
               <button 
                 type="submit"
                 disabled={isSubmitting}
                 className="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-lg hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2"
               >
                 {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                 DAFTAR AKAUN
               </button>
               <div className="text-center">
                 <button type="button" onClick={() => setAuthMode('login')} className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:underline">DAH ADA AKAUN? LOG MASUK</button>
               </div>
             </form>
           )}

           <div className="pt-8 border-t border-slate-100/10 mt-8">
              <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest opacity-50 mb-4 tracking-[0.5em]">SK BUKIT RAMBAI © 2024</p>
              
              <div className="px-6 py-4 rounded-2xl bg-slate-50/5 text-left">
                <p className={`text-[8px] font-black uppercase tracking-widest mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Status Sistem:</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${isConfigValid ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span className={`text-[8px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                      Konfigurasi: {isConfigValid ? 'Sedia' : 'Ralat'}
                    </span>
                  </div>
                </div>
              </div>
           </div>
        </div>
      </div>
    );
  }

  if (parentMode && !user) {
    return (
      <div className={`min-h-screen flex flex-col p-6 ${isDarkMode ? 'bg-slate-950' : 'bg-[#f8fafc]'} transition-colors`}>
         <div className="max-w-4xl mx-auto w-full space-y-6">
            <button onClick={() => setParentMode(false)} className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-800'}`}>
              ← KEMBALI KE LAMAN UTAMA
            </button>

            <div className={`p-8 md:p-12 rounded-[3.5rem] shadow-2xl transition-all ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
               <div className="flex flex-col md:flex-row items-center gap-8 mb-10">
                  <div className={`w-24 h-24 rounded-[2rem] p-3 shadow-inner shrink-0 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                    <img src={SCHOOL_LOGO_URL} className="w-full h-full object-contain" />
                  </div>
                  <div className="text-center md:text-left">
                    <h2 className={`text-2xl font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Modul Semakan Ibu Bapa</h2>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Pantau kemajuan bacaan Al-Quran & Iqra anak anda secara masa-nyata.</p>
                  </div>
               </div>

               <form onSubmit={handleParentSearch} className="relative mb-12">
                  <input 
                    type="text" 
                    value={parentSearchId}
                    onChange={(e) => setParentSearchId(e.target.value)}
                    placeholder="MASUKKAN EMEL DELIMA ANAK (CONTOH: m-12345678@moe-dl.edu.my)"
                    className={`w-full p-8 pr-32 rounded-3xl font-black text-sm uppercase outline-none border-2 transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 text-slate-900 focus:border-emerald-500'}`}
                  />
                  <button type="submit" className="absolute right-3 top-3 bottom-3 px-8 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 active:scale-95 transition-all">
                    SEMAK
                  </button>
               </form>

               {foundStudent ? (
                 <div className="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
                    <div className={`p-6 rounded-[2.5rem] border-2 ${isDarkMode ? 'bg-slate-800/50 border-indigo-500/20' : 'bg-emerald-50/50 border-emerald-100'}`}>
                       <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center font-black text-indigo-600 shadow-sm">{foundStudent.ID_MURID.slice(-4)}</div>
                          <div>
                             <h4 className={`text-lg font-black uppercase ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{foundStudent.NAMA_MURID}</h4>
                             <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{foundStudent.KELAS} | TAHAP {foundStudent.TAHAP}</p>
                          </div>
                       </div>
                    </div>

                    <div className="space-y-4">
                       <h5 className={`text-[10px] font-black uppercase tracking-[0.2em] px-2 ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>Sejarah Bacaan Terkini</h5>
                       <div className="space-y-3">
                          {studentHistory.length > 0 ? studentHistory.map(rec => (
                            <div key={rec.id} className={`p-5 rounded-3xl border flex items-center justify-between gap-4 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                               <div className="flex items-center gap-4">
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-slate-700 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                                    <SparkleIcon size={18} />
                                  </div>
                                  <div>
                                     <p className={`text-[11px] font-black uppercase ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{rec.readingType} - MS {rec.page}</p>
                                     <div className="flex items-center gap-3 mt-1">
                                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest shrink-0">{new Date(rec.timestamp).toLocaleDateString('ms-MY')}</span>
                                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase ${rec.readingStatus === 'LANCAR' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>{rec.readingStatus}</span>
                                     </div>
                                  </div>
                               </div>
                               <p className="text-[9px] font-bold text-slate-400 uppercase italic opacity-50">Disedia oleh: {rec.teacherName || 'Guru'}</p>
                            </div>
                          )) : (
                            <div className="py-20 text-center opacity-40">
                               <p className="text-[10px] font-black uppercase tracking-widest">Tiada rekod bacaan ditemui</p>
                            </div>
                          )}
                       </div>
                    </div>
                 </div>
               ) : (
                 <div className="py-20 text-center animate-in fade-in duration-700">
                    <SparkleIcon size={48} className="mx-auto text-slate-200 mb-6" />
                    <p className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>Sila masukkan emel DELIMa murid untuk melihat sejarah bacaan</p>
                 </div>
               )}
            </div>
         </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col md:flex-row h-screen w-full ${isDarkMode ? 'dark bg-slate-950' : 'bg-[#f8fafc]'} overflow-hidden transition-colors duration-300`}>
      <aside className={`hidden md:flex flex-col md:w-60 lg:w-72 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-900 border-slate-800'} text-white p-6 lg:p-8 border-r shrink-0 transition-all duration-300`}>
        <div className="mb-10 lg:mb-14 text-center px-2 lg:px-4">
          <div className="w-14 h-14 lg:w-16 lg:h-16 bg-white rounded-2xl mx-auto mb-4 p-2 shadow-xl flex items-center justify-center overflow-hidden">
            <img src={SCHOOL_LOGO_URL} alt="Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-lg lg:text-xl font-black text-white uppercase tracking-[0.2em]">SERQI</h1>
          <p className="text-[7px] lg:text-[8px] font-bold text-slate-500 uppercase tracking-[0.1em] mt-2 leading-relaxed opacity-80">
            MEREKOD DAN MENGANALISIS DATA QURAN IQRA SECARA PINTAR
          </p>
        </div>
        <nav className="flex-1 space-y-1.5 lg:space-y-2">
          {[
            { id: 'input', icon: SparkleIcon, label: 'Input', color: 'emerald' },
            { id: 'dashboard', icon: BarChartIcon, label: 'Analisis', color: 'indigo' },
            { id: 'reports', icon: FileTextIcon, label: 'Laporan', color: 'sky' },
            { id: 'data', icon: DatabaseIcon, label: 'Cloud', color: 'slate' }
          ].map((item) => (
            <button key={item.id} onClick={() => setActiveTab(item.id as Tab)} className={`w-full flex items-center space-x-3 lg:space-x-4 px-4 lg:px-6 py-3.5 lg:py-4 rounded-2xl transition-all ${activeTab === item.id ? `bg-${item.color}-600 text-white shadow-lg` : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <item.icon className="w-4 h-4 lg:w-5 lg:h-5" />
              <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <Header 
          activeTab={activeTab} 
          isCloudEnabled={!!cloudConfig.projectUrl} 
          isSyncing={isSyncing} 
          logoUrl={SCHOOL_LOGO_URL} 
          lastSync={cloudConfig.lastSync} 
          onManualSync={() => fetchCloudData()} 
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        />
        
        {syncError && (
          <div className="bg-rose-600 text-white px-6 py-2 flex items-center justify-between text-[9px] font-black uppercase tracking-widest animate-in slide-in-from-top">
            <div className="flex items-center gap-2"><TriangleAlert size={14} /> {syncError}</div>
            <button onClick={() => setSyncError(null)} className="p-2 opacity-50 hover:opacity-100">X</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 md:px-6 lg:px-10 py-6 md:py-8 custom-scrollbar pb-32 md:pb-8">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'input' && (
              <ProgressForm 
                onSave={saveRecordCloud} 
                getLatestRecord={(id) => records.find(r => forceId(r.studentId) === forceId(id))} 
                students={activeStudents} 
                allRecords={records} 
                availableClasses={availableClasses} 
              />
            )}
            {activeTab === 'dashboard' && <Dashboard records={records} students={activeStudents} isDarkMode={isDarkMode} logoUrl={SCHOOL_LOGO_URL} />}
            {activeTab === 'reports' && <Reports records={records} students={students} availableClasses={availableClasses} logoUrl={SCHOOL_LOGO_URL} />}
            {activeTab === 'data' && (
              <DataManagement 
                students={students} 
                records={records} 
                cloudConfig={cloudConfig} 
                onUpdateStudents={setStudents} 
                onUpdateCloudConfig={(c) => setCloudConfig(c)} 
                onSyncPull={() => fetchCloudData()} 
                onSyncPush={() => fetchCloudData()} // Re-sync manually
                onClearData={() => { if(confirm("PERHATIAN: Ini akan memadam semua data cache pada peranti ini. Teruskan?")) { localStorage.clear(); window.location.reload(); } }} 
                onDeleteStudent={(id) => {
                  const student = students.find(s => forceId(s.ID_MURID) === forceId(id));
                  if (student) saveStudentCloud({ ...student, STATUS_MURID: 'TIDAK_AKTIF' });
                }} 
                onRestoreStudent={(id) => {
                  const student = students.find(s => forceId(s.ID_MURID) === forceId(id));
                  if (student) saveStudentCloud({ ...student, STATUS_MURID: 'AKTIF' });
                }}
                onHardDeleteStudent={(id) => {
                  // Sesuai arahan: DILARANG DELETE ROW. Jadi hard delete tetap set ke TIDAK_AKTIF
                  const student = students.find(s => forceId(s.ID_MURID) === forceId(id));
                  if (student) saveStudentCloud({ ...student, STATUS_MURID: 'TIDAK_AKTIF' });
                }}
                onAddStudent={(s) => {
                   // Jana ID_MURID Format M0001
                   let maxIdNum = 0;
                   students.forEach(st => { 
                     const match = st.ID_MURID.match(/M(\d+)/);
                     if (match) {
                       const num = parseInt(match[1]);
                       if (num > maxIdNum) maxIdNum = num;
                     }
                   });
                   const newId = `M${(maxIdNum + 1).toString().padStart(4, '0')}`;
                   saveStudentCloud({ ...s, ID_MURID: newId, STATUS_MURID: 'AKTIF' });
                }} 
                availableClasses={availableClasses} 
                isSyncing={isSyncing} 
                onUpdateRecords={setRecords}
              />
            )}
          </div>
        </div>

        <div className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-sm z-50">
          <nav className="bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] px-4 py-3 flex justify-between items-center shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            {[
              { id: 'input', icon: SparkleIcon, label: 'INPUT', activeColor: 'bg-emerald-500' },
              { id: 'dashboard', icon: BarChartIcon, label: 'ANALISIS', activeColor: 'bg-indigo-500' },
              { id: 'reports', icon: FileTextIcon, label: 'LAPORAN', activeColor: 'bg-sky-500' },
              { id: 'data', icon: DatabaseIcon, label: 'CLOUD', activeColor: 'bg-slate-700' }
            ].map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button 
                  key={item.id} 
                  onClick={() => setActiveTab(item.id as Tab)} 
                  className={`relative flex flex-col items-center gap-1.5 transition-all duration-300 px-3 py-2 rounded-2xl ${isActive ? `${item.activeColor} text-white shadow-lg scale-110` : 'text-slate-500'}`}
                >
                  <item.icon size={isActive ? 20 : 18} strokeWidth={isActive ? 2.5 : 2} />
                  <span className={`text-[7px] font-black tracking-[0.15em] transition-opacity ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </main>
    </div>
  );
};

export default App;
