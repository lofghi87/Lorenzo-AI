import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { LockKeyhole, ShieldCheck, UploadCloud, Film, Share2, Trash2, LogOut, Eye, EyeOff, Copy, Check, X, Play, Clock3, HardDrive, LoaderCircle, KeyRound, Mail, ArrowUpRight, AlertCircle } from 'lucide-react';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET = 'vault-videos';
const SHARE_SECONDS = 60 * 60;

function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progressName, setProgressName] = useState('');
  const [shareItem, setShareItem] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadVideos = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoadingVideos(true);
    setError('');
    const { data, error: listError } = await supabase.storage.from(BUCKET).list(session.user.id, {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' }
    });
    if (listError) {
      setError(listError.message);
      setVideos([]);
      setLoadingVideos(false);
      return;
    }
    const entries = (data || []).filter(item => item.name && item.id);
    const withUrls = await Promise.all(entries.map(async item => {
      const path = session.user.id + '/' + item.name;
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 15 * 60);
      return { ...item, path, previewUrl: signed?.signedUrl || '', size: item.metadata?.size || 0, mime: item.metadata?.mimetype || '' };
    }));
    setVideos(withUrls);
    setLoadingVideos(false);
  }, [session]);

  useEffect(() => {
    if (session) loadVideos();
    else setVideos([]);
  }, [session, loadVideos]);

  async function handleAuth(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setAuthBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: signError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (signError) throw signError;
        if (data.session) setMessage('Account creato. La cassaforte è pronta.');
        else setMessage('Controlla la tua email e conferma la registrazione per entrare.');
      } else {
        const { error: signError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signError) throw signError;
      }
    } catch (e) {
      setError(e.message || 'Non è stato possibile completare l’accesso.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleReset() {
    if (!email.trim()) {
      setError('Inserisci prima la tua email.');
      return;
    }
    setError('');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (resetError) setError(resetError.message);
    else setMessage('Se l’indirizzo è registrato, riceverai un’email per reimpostare la password.');
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setShareItem(null);
    setShareUrl('');
  }

  async function handleUpload(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selected.length || !session?.user?.id) return;
    const invalid = selected.find(file => !file.type.startsWith('video/'));
    if (invalid) {
      setError('Puoi caricare soltanto file video.');
      return;
    }
    setUploading(true);
    setError('');
    for (const file of selected) {
      setProgressName(file.name);
      const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100) || 'video';
      const path = session.user.id + '/' + crypto.randomUUID() + '-' + safeName;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '60',
        contentType: file.type,
        upsert: false
      });
      if (uploadError) {
        setError('Errore durante il caricamento di ' + file.name + ': ' + uploadError.message);
        break;
      }
    }
    setUploading(false);
    setProgressName('');
    await loadVideos();
  }

  async function createShare(item) {
    setError('');
    setShareItem(item);
    setShareUrl('');
    setCopied(false);
    const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(item.path, SHARE_SECONDS, { download: false });
    if (signError) {
      setError(signError.message);
      setShareItem(null);
      return;
    }
    setShareUrl(data.signedUrl);
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Copia automatica non disponibile: seleziona e copia il link.');
    }
  }

  async function deleteVideo(item) {
    if (!window.confirm('Vuoi eliminare definitivamente questo video? I link di condivisione già creati per questo file smetteranno di funzionare dopo la propagazione della rimozione.')) return;
    const { error: deleteError } = await supabase.storage.from(BUCKET).remove([item.path]);
    if (deleteError) setError(deleteError.message);
    else {
      setVideos(current => current.filter(v => v.id !== item.id));
      if (shareItem?.id === item.id) {
        setShareItem(null);
        setShareUrl('');
      }
    }
  }

  const visibleVideos = useMemo(() => videos.filter(v => v.name.toLowerCase().includes(search.toLowerCase())), [videos, search]);
  const totalBytes = videos.reduce((sum, item) => sum + item.size, 0);
  const formatSize = bytes => bytes < 1024 * 1024 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  const formatDate = value => value ? new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  if (!authReady) return <div className="boot"><div className="vault-mark"><LockKeyhole size={25}/></div><LoaderCircle className="spin" size={20}/></div>;

  if (!session) return (
    <main className="auth-page">
      <div className="auth-glow" />
      <div className="auth-top"><div className="brand"><div className="brand-icon"><LockKeyhole size={19}/></div><span>VAULT</span></div><span className="top-note"><ShieldCheck size={14}/> Spazio privato</span></div>
      <section className="auth-layout">
        <div className="auth-copy">
          <div className="eyebrow"><span className="pulse-dot"/> LA TUA AREA RISERVATA</div>
          <h1>I tuoi ricordi.<br/><span>Al sicuro.</span></h1>
          <p>Una cassaforte digitale privata per conservare i tuoi video e condividerli solo quando lo decidi tu.</p>
          <div className="trust-line"><ShieldCheck size={17}/><span>Archivio privato · Accesso protetto · Link temporanei</span></div>
        </div>
        <div className="auth-card">
          <div className="card-lock"><LockKeyhole size={22}/></div>
          <h2>{mode === 'login' ? 'Bentornato' : 'Crea la tua cassaforte'}</h2>
          <p className="card-sub">{mode === 'login' ? 'Accedi al tuo spazio personale.' : 'Registra il tuo account personale.'}</p>
          <form onSubmit={handleAuth}>
            <label>Email</label>
            <div className="input-wrap"><Mail size={17}/><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@email.com" autoComplete="email" required /></div>
            <label>Password</label>
            <div className="input-wrap"><KeyRound size={17}/><input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Almeno 8 caratteri" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required/><button className="eye-btn" type="button" onClick={() => setShowPassword(v => !v)} aria-label="Mostra password">{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
            <button className="primary-btn auth-submit" disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={18}/> : <>{mode === 'login' ? 'Entra nella cassaforte' : 'Crea account'} <ArrowUpRight size={17}/></>}</button>
          </form>
          {mode === 'login' && <button className="text-btn forgot" onClick={handleReset}>Hai dimenticato la password?</button>}
          <div className="auth-switch">{mode === 'login' ? 'Non hai ancora un account?' : 'Hai già un account?'} <button onClick={() => {setMode(mode === 'login' ? 'signup' : 'login');setError('');setMessage('');}}>{mode === 'login' ? 'Registrati' : 'Accedi'}</button></div>
          {error && <div className="notice error"><AlertCircle size={16}/>{error}</div>}
          {message && <div className="notice success"><Check size={16}/>{message}</div>}
          <div className="auth-foot"><LockKeyhole size={13}/> Le tue credenziali non vengono mostrate né condivise.</div>
        </div>
      </section>
      <footer className="page-foot">VAULT <span>·</span> PRIVATE VIDEO STORAGE</footer>
    </main>
  );

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="brand"><div className="brand-icon"><LockKeyhole size={19}/></div><span>VAULT</span></div>
        <div className="header-right"><span className="secure-pill"><span className="pulse-dot"/> ARCHIVIO PROTETTO</span><div className="user-chip">{session.user.email?.slice(0,1).toUpperCase()}</div><button className="icon-btn" onClick={handleLogout} title="Esci"><LogOut size={18}/></button></div>
      </header>
      <section className="welcome">
        <div><div className="eyebrow"><span className="pulse-dot"/> IL TUO SPAZIO PERSONALE</div><h1>La tua <span>cassaforte.</span></h1><p>Qui i tuoi video sono visibili soltanto dal tuo account.</p></div>
        <label className="upload-btn"><UploadCloud size={18}/> Carica video<input type="file" accept="video/*" multiple hidden onChange={handleUpload}/></label>
      </section>
      <section className="stats">
        <div className="stat-card"><div className="stat-icon"><Film size={18}/></div><div><strong>{videos.length}</strong><span>Video archiviati</span></div></div>
        <div className="stat-card"><div className="stat-icon"><HardDrive size={18}/></div><div><strong>{formatSize(totalBytes)}</strong><span>Spazio utilizzato</span></div></div>
        <div className="stat-card"><div className="stat-icon"><ShieldCheck size={18}/></div><div><strong>Privato</strong><span>Accesso personale</span></div></div>
      </section>
      {uploading && <div className="upload-progress"><LoaderCircle className="spin" size={17}/><div><b>Caricamento in corso</b><span>{progressName}</span></div></div>}
      {error && <div className="notice error dashboard-notice"><AlertCircle size={16}/>{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
      <section className="library">
        <div className="library-head"><div><div className="section-kicker">IL TUO ARCHIVIO</div><h2>I miei video <span>{videos.length}</span></h2></div><div className="search-box"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca un video…"/></div></div>
        {loadingVideos ? <div className="empty-state"><LoaderCircle className="spin" size={24}/><p>Sto aprendo la cassaforte…</p></div> : visibleVideos.length === 0 ? (
          <div className="empty-state"><div className="empty-icon"><Film size={27}/></div><h3>{videos.length ? 'Nessun risultato' : 'La tua cassaforte è vuota'}</h3><p>{videos.length ? 'Prova con un altro nome.' : 'Carica il tuo primo video: resterà privato finché non deciderai di condividerlo.'}</p>{!videos.length && <label className="secondary-btn"><UploadCloud size={17}/> Seleziona video<input type="file" accept="video/*" multiple hidden onChange={handleUpload}/></label>}</div>
        ) : (
          <div className="video-grid">{visibleVideos.map(item => (
            <article className="video-card" key={item.id}>
              <div className="video-preview">{item.previewUrl ? <video src={item.previewUrl} preload="metadata" controls playsInline /> : <div className="video-placeholder"><Film size={32}/></div>}<span className="private-tag"><LockKeyhole size={11}/> PRIVATO</span></div>
              <div className="video-info"><h3 title={item.name}>{item.name.replace(/^[0-9a-f-]{30,}-/i,'')}</h3><div className="video-meta"><span><Clock3 size={13}/>{formatDate(item.created_at)}</span><span>{formatSize(item.size)}</span></div><div className="video-actions"><button className="share-btn" onClick={() => createShare(item)}><Share2 size={15}/> Condividi</button><button className="delete-btn" onClick={() => deleteVideo(item)} title="Elimina video"><Trash2 size={16}/></button></div></div>
            </article>
          ))}</div>
        )}
      </section>
      <footer className="dash-footer"><span><ShieldCheck size={14}/> I tuoi file sono conservati in un archivio privato.</span><span>VAULT · PRIVATE VIDEO STORAGE</span></footer>
      {shareItem && <div className="modal-backdrop" onClick={() => {setShareItem(null);setShareUrl('');}}><div className="share-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => {setShareItem(null);setShareUrl('');}}><X size={18}/></button><div className="modal-icon"><Share2 size={21}/></div><div className="section-kicker">CONDIVISIONE SICURA</div><h2>Condividi questo video</h2><p>Chi riceve il link potrà vedere il video senza accedere al tuo account. Il link scade automaticamente dopo un'ora.</p><div className="share-file"><Film size={17}/><span>{shareItem.name.replace(/^[0-9a-f-]{30,}-/i,'')}</span></div><div className="share-link">{shareUrl || 'Creo il link sicuro…'}</div><button className="primary-btn copy-btn" disabled={!shareUrl} onClick={copyShare}>{copied ? <><Check size={17}/> Link copiato</> : <><Copy size={17}/> Copia link</>}</button><div className="expiry-note"><Clock3 size={14}/> Link valido per 60 minuti. Può essere inoltrato da chi lo riceve.</div></div></div>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
