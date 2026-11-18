import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { LockKeyhole, ShieldCheck, UploadCloud, Film, Share2, Trash2, LogOut, Eye, EyeOff, Copy, Check, X, Play, Clock3, HardDrive, LoaderCircle, KeyRound, Mail, ArrowUpRight, AlertCircle, Pencil, Maximize2, Download } from 'lucide-react';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET = 'vault-videos';
const SHARE_SECONDS = 60 * 60;

function getDisplayName(name) {
  return name.replace(/^[0-9a-f-]{30,}-/i, '').replace(/\.vlt$/i, '');
}

function getOriginalVideoMime(name) {
  const match = name.replace(/\.vlt$/i, '').match(/\.([a-z0-9]+)$/i);
  const ext = match ? match[1].toLowerCase() : '';
  const types = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp' };
  return types[ext] || 'video/mp4';
}

async function deriveVaultKey(passphrase, userId) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode('VAULT-v1:' + userId), iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptVideo(file, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await file.arrayBuffer();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return new Blob([new Uint8Array([86, 76, 84, 49]), iv, cipher], { type: 'application/octet-stream' });
}

async function decryptVideo(blob, key, mime) {
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length < 32 || data[0] !== 86 || data[1] !== 76 || data[2] !== 84 || data[3] !== 49) throw new Error('Formato cifrato non riconosciuto.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(4, 16) }, key, data.slice(16));
  return new Blob([plain], { type: mime || 'video/mp4' });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function parseIncomingShare() {
  try {
    const raw = new URLSearchParams(window.location.hash.slice(1)).get('share');
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const signedUrl = new URL(payload.url);
    const storageOrigin = new URL(supabaseUrl).origin;
    if (signedUrl.origin !== storageOrigin || !signedUrl.pathname.includes('/storage/v1/object/sign/' + BUCKET + '/')) return null;
    if (!payload.key || !payload.name || !payload.mime || base64ToBytes(payload.key).length !== 32) return null;
    return payload;
  } catch { return null; }
}

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
  const [vaultKey, setVaultKey] = useState(null);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState('');
  const [showVaultPassphrase, setShowVaultPassphrase] = useState(false);
  const [showVaultPassphraseConfirm, setShowVaultPassphraseConfirm] = useState(false);
  const [showNewVaultPassphrase, setShowNewVaultPassphrase] = useState(false);
  const [showNewVaultPassphraseConfirm, setShowNewVaultPassphraseConfirm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newVaultPassphrase, setNewVaultPassphrase] = useState('');
  const [newVaultPassphraseConfirm, setNewVaultPassphraseConfirm] = useState('');
  const [rotationBusy, setRotationBusy] = useState(false);
  const [rotationProgress, setRotationProgress] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewName, setPreviewName] = useState('');
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [openingVideoId, setOpeningVideoId] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copyFile, setCopyFile] = useState(null);
  const [incomingShare] = useState(() => parseIncomingShare());
  const [incomingShareLoading, setIncomingShareLoading] = useState(false);
  const [incomingShareVideoUrl, setIncomingShareVideoUrl] = useState('');
  const [incomingShareFile, setIncomingShareFile] = useState(null);
  const [incomingShareError, setIncomingShareError] = useState('');
  const videoElementRef = useRef(null);

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

  useEffect(() => {
    if (!incomingShare) return;
    let active = true;
    let objectUrl = '';
    (async () => {
      setIncomingShareLoading(true);
      setIncomingShareError('');
      try {
        const response = await fetch(incomingShare.url);
        if (!response.ok) {
          if ([400, 401, 403, 404].includes(response.status)) throw new Error('Questo link è scaduto o il video non è più disponibile.');
          throw new Error('Non riesco a scaricare il video condiviso. Riprova tra poco.');
        }
        const encrypted = await response.blob();
        const key = await crypto.subtle.importKey('raw', base64ToBytes(incomingShare.key), { name: 'AES-GCM' }, false, ['decrypt']);
        const decrypted = await decryptVideo(encrypted, key, incomingShare.mime);
        const file = new File([decrypted], incomingShare.name, { type: incomingShare.mime });
        objectUrl = URL.createObjectURL(decrypted);
        if (active) {
          setIncomingShareFile(file);
          setIncomingShareVideoUrl(objectUrl);
        }
      } catch (e) {
        if (active) setIncomingShareError(e.message || 'Link non valido o video non disponibile.');
      } finally {
        if (active) setIncomingShareLoading(false);
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [incomingShare]);

  const loadVideos = useCallback(async () => {
    if (!session?.user?.id || !vaultKey) return;
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
    const withUrls = entries.map(item => ({ ...item, path: session.user.id + '/' + item.name, encrypted: item.name.endsWith('.vlt'), displayName: getDisplayName(item.name), size: item.metadata?.size || 0, mime: item.name.endsWith('.vlt') ? getOriginalVideoMime(item.name) : (item.metadata?.mimetype || '') }));
    setVideos(withUrls);
    setLoadingVideos(false);
  }, [session, vaultKey]);

  useEffect(() => {
    if (session && vaultKey) loadVideos();
    else setVideos([]);
  }, [session, vaultKey, loadVideos]);

  async function handleAuth(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setAuthBusy(true);
    try {
      if (mode === 'signup') {
        if (vaultPassphrase.length < 12) throw new Error('La frase segreta deve contenere almeno 12 caratteri.');
        if (vaultPassphrase !== vaultPassphraseConfirm) throw new Error('Le due frasi segrete non coincidono.');
        const { data, error: signError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (signError) throw signError;
        if (data.session && data.user?.id) {
          setVaultKey(await deriveVaultKey(vaultPassphrase, data.user.id));
          setVaultPassphrase(''); setVaultPassphraseConfirm('');
          setMessage('Account creato e cassaforte inizializzata. Conserva la frase segreta: non è recuperabile.');
        } else {
          setVaultPassphraseConfirm('');
          setMessage('Account creato. Conferma l’email, poi accedi e inserisci la stessa frase segreta: non viene conservata durante la conferma.');
        }
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

  async function unlockVault(event) {
    event.preventDefault();
    if (vaultPassphrase.length < 12) { setError('Usa una frase segreta di almeno 12 caratteri.'); return; }
    setUnlockBusy(true); setError('');
    try { setVaultKey(await deriveVaultKey(vaultPassphrase, session.user.id)); setVaultPassphrase(''); }
    catch { setError('Non riesco a sbloccare la cassaforte.'); }
    finally { setUnlockBusy(false); }
  }

  async function changeVaultPassphrase(event) {
    event.preventDefault();
    if (!vaultKey || !session?.user?.id) return;
    if (newVaultPassphrase.length < 12) { setError('La nuova frase deve contenere almeno 12 caratteri.'); return; }
    if (newVaultPassphrase !== newVaultPassphraseConfirm) { setError('Le due nuove frasi non coincidono.'); return; }
    if (newVaultPassphrase === vaultPassphrase) { setError('Scegli una frase diversa da quella attuale.'); return; }
    if (!window.confirm('Vault creerà copie cifrate con la nuova frase, verificherà ogni file e solo dopo eliminerà gli originali. Tieni aperta questa pagina fino al termine. Vuoi continuare?')) return;

    setRotationBusy(true);
    setRotationProgress('Preparazione della nuova chiave…');
    setError('');
    const stagedPaths = [];
    try {
      const newKey = await deriveVaultKey(newVaultPassphrase, session.user.id);
      const allItems = [];
      const pageSize = 100;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: listError } = await supabase.storage.from(BUCKET).list(session.user.id, {
          limit: pageSize, offset, sortBy: { column: 'created_at', order: 'asc' }
        });
        if (listError) throw listError;
        const page = (data || []).filter(item => item.name && item.id);
        allItems.push(...page);
        if (page.length < pageSize) break;
      }

      if (!allItems.length) {
        setVaultKey(newKey);
        setSettingsOpen(false);
        setMessage('Frase segreta aggiornata. La cassaforte era vuota.');
      } else {
        const oldPaths = [];
        for (let index = 0; index < allItems.length; index++) {
          const item = allItems[index];
          const oldPath = session.user.id + '/' + item.name;
          const displayName = getDisplayName(item.name);
          const mime = item.name.endsWith('.vlt') ? getOriginalVideoMime(item.name) : (item.metadata?.mimetype || 'video/mp4');
          setRotationProgress('Cifratura e verifica ' + (index + 1) + ' di ' + allItems.length + ': ' + displayName);
          const { data, error: downloadError } = await supabase.storage.from(BUCKET).download(oldPath);
          if (downloadError || !data) throw new Error('Download non riuscito per "' + displayName + '": ' + (downloadError?.message || 'file non disponibile'));
          const plain = item.name.endsWith('.vlt') ? await decryptVideo(data, vaultKey, mime) : data;
          const encrypted = await encryptVideo(plain, newKey);
          // Verifica locale dell'integrità prima di caricare la nuova copia.
          await decryptVideo(encrypted, newKey, mime);
          const safeName = displayName.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100) || 'video';
          const newPath = session.user.id + '/' + crypto.randomUUID() + '-' + safeName + '.vlt';
          const { error: uploadError } = await supabase.storage.from(BUCKET).upload(newPath, encrypted, {
            cacheControl: '0', contentType: 'application/octet-stream', upsert: false
          });
          if (uploadError) throw new Error('Caricamento della nuova copia non riuscito per "' + displayName + '": ' + uploadError.message);
          stagedPaths.push(newPath);
          // Verifica anche la copia effettivamente salvata sul server.
          const { data: savedCopy, error: verifyError } = await supabase.storage.from(BUCKET).download(newPath);
          if (verifyError || !savedCopy) throw new Error('Verifica della nuova copia non riuscita per "' + displayName + '".');
          await decryptVideo(savedCopy, newKey, mime);
          oldPaths.push(oldPath);
        }
        setRotationProgress('Tutti i video sono verificati. Sostituzione degli originali…');
        const { error: removeError } = await supabase.storage.from(BUCKET).remove(oldPaths);
        if (removeError) throw new Error('Le nuove copie sono pronte, ma non sono riuscito a completare la sostituzione degli originali: ' + removeError.message);
        setVaultKey(newKey);
        setSettingsOpen(false);
        setMessage('Frase segreta aggiornata. Tutti i video sono stati ricifrati e verificati.');
      }
      setNewVaultPassphrase('');
      setNewVaultPassphraseConfirm('');
      setVaultPassphrase('');
    } catch (e) {
      if (stagedPaths.length) {
        await supabase.storage.from(BUCKET).remove(stagedPaths);
      }
      setError('Modifica della frase non completata: ' + (e.message || 'errore sconosciuto') + ' I video originali sono stati mantenuti.');
    } finally {
      setRotationBusy(false);
      setRotationProgress('');
    }
  }

  async function handleLogout() {
    setVaultKey(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(''); setPreviewName('');
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
    if (!vaultKey) { setError('Sblocca prima la cassaforte con la tua frase segreta.'); return; }
    setUploading(true);
    setError('');
    for (const file of selected) {
      setProgressName(file.name);
      const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100) || 'video';
      const path = session.user.id + '/' + crypto.randomUUID() + '-' + safeName + '.vlt';
      try {
        const encrypted = await encryptVideo(file, vaultKey);
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, encrypted, { cacheControl: '0', contentType: 'application/octet-stream', upsert: false });
        if (uploadError) throw uploadError;
      } catch (uploadError) {
        setError('Errore durante la cifratura o il caricamento di ' + file.name + ': ' + (uploadError.message || 'errore sconosciuto'));
        break;
      }
    }
    setUploading(false);
    setProgressName('');
    await loadVideos();
  }

  async function openEncryptedVideo(item) {
    if (!vaultKey || openingVideoId) return;
    setOpeningVideoId(item.id);
    setError('');
    try {
      const result = await supabase.storage.from(BUCKET).download(item.path);
      if (result.error) throw new Error('Download non riuscito: ' + result.error.message);
      if (!result.data || typeof result.data.arrayBuffer !== 'function') throw new Error('Supabase non ha restituito un file valido.');
      const decrypted = await decryptVideo(result.data, vaultKey, item.mime);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(decrypted);
      setPreviewUrl(url);
      setPreviewName(item.displayName || getDisplayName(item.name));
    } catch (e) {
      const detail = e?.name === 'OperationError'
        ? 'La decifratura non è riuscita. Controlla di aver inserito la stessa frase segreta usata quando hai caricato il video.'
        : (e?.message || 'Errore sconosciuto durante l’apertura.');
      setError(detail);
    } finally {
      setOpeningVideoId(null);
    }
  }

  function beginRename(item) {
    setRenameItem(item);
    setRenameValue((item.displayName || getDisplayName(item.name)).replace(/\.[^.]+$/, ''));
    setError('');
  }

  async function saveRename(event) {
    event.preventDefault();
    if (!renameItem || !session?.user?.id) return;
    const clean = renameValue.trim().normalize('NFKC').replace(/[\/\\]/g, '-').replace(/[<>:"|?*]/g, '-').replace(/\s+/g, ' ').slice(0, 100);
    if (!clean) { setError('Inserisci un nome valido.'); return; }
    if (!renameItem.encrypted) { setError('Puoi rinominare solo i video cifrati.'); return; }
    const oldDisplay = renameItem.displayName || getDisplayName(renameItem.name);
    const extMatch = oldDisplay.match(/(\.[^.]+)$/);
    const extension = extMatch ? extMatch[1] : '';
    const newName = crypto.randomUUID() + '-' + clean + extension + '.vlt';
    const newPath = session.user.id + '/' + newName;
    setRenameBusy(true); setError('');
    const { error: moveError } = await supabase.storage.from(BUCKET).move(renameItem.path, newPath);
    setRenameBusy(false);
    if (moveError) { setError('Non sono riuscito a rinominare il video: ' + moveError.message); return; }
    setRenameItem(null); setRenameValue('');
    await loadVideos();
  }

  async function requestVideoFullscreen() {
    const video = videoElementRef.current;
    if (!video) return;
    try {
      if (video.requestFullscreen) await video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } catch { setError('Schermo intero non disponibile in questo browser.'); }
  }

  function createShare(item) {
    setError('');
    setShareItem(item);
    setShareUrl('');
    setCopied(false);
    setCopyFile(null);
    setShareBusy(false);
  }

  async function createTemporaryLink() {
    if (!shareItem) return;
    setShareBusy(true);
    setError('');
    try {
      const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(shareItem.path, SHARE_SECONDS, { download: false });
      if (signError) throw signError;
      let url = data.signedUrl;
      if (shareItem.encrypted) {
        if (!vaultKey) throw new Error('Sblocca nuovamente Vault per creare il link.');
        const rawKey = await crypto.subtle.exportKey('raw', vaultKey);
        const payload = {
          url,
          key: bytesToBase64(new Uint8Array(rawKey)),
          mime: shareItem.mime || 'video/mp4',
          name: shareItem.displayName || getDisplayName(shareItem.name)
        };
        url = window.location.origin + window.location.pathname + '#share=' + encodeURIComponent(JSON.stringify(payload));
      }
      setShareUrl(url);
    } catch (e) {
      setError('Non sono riuscito a creare il link: ' + (e.message || 'errore sconosciuto'));
    } finally {
      setShareBusy(false);
    }
  }

  async function prepareCopy() {
    if (!shareItem) return;
    setShareBusy(true);
    setError('');
    try {
      const { data, error: downloadError } = await supabase.storage.from(BUCKET).download(shareItem.path);
      if (downloadError) throw downloadError;
      const content = shareItem.encrypted ? await decryptVideo(data, vaultKey, shareItem.mime) : data;
      const filename = shareItem.displayName || getDisplayName(shareItem.name);
      setCopyFile(new File([content], filename, { type: shareItem.mime || content.type || 'video/mp4' }));
    } catch (e) {
      setError('Non sono riuscito a preparare la copia: ' + (e.message || 'errore sconosciuto'));
    } finally {
      setShareBusy(false);
    }
  }

  async function shareFileToDevice(file) {
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: file.name });
      return;
    }
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function sendPreparedCopy() {
    if (!copyFile) return;
    try {
      await shareFileToDevice(copyFile);
    } catch (e) {
      if (e.name !== 'AbortError') setError('Non è stato possibile condividere la copia: ' + (e.message || 'errore sconosciuto'));
    }
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

  const visibleVideos = useMemo(() => videos.filter(v => (v.displayName || v.name).toLowerCase().includes(search.toLowerCase())), [videos, search]);
  const totalBytes = videos.reduce((sum, item) => sum + item.size, 0);
  const formatSize = bytes => bytes < 1024 * 1024 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  const formatDate = value => value ? new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  if (incomingShare) return (
    <main className="auth-page incoming-share-page">
      <div className="auth-top"><div className="brand"><div className="brand-icon"><LockKeyhole size={19}/></div><span>VAULT</span></div><span className="top-note"><Clock3 size={14}/> LINK TEMPORANEO</span></div>
      <section className="auth-layout" style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="auth-card incoming-share-card">
          <div className="card-lock"><ShieldCheck size={22}/></div>
          <div className="section-kicker">VIDEO CONDIVISO IN MODO SICURO</div>
          <h2>{incomingShare.name}</h2>
          {incomingShareLoading && <div className="incoming-share-status"><LoaderCircle className="spin" size={20}/> Sto preparando il video…</div>}
          {incomingShareError && <div className="notice error"><AlertCircle size={16}/>{incomingShareError}</div>}
          {incomingShareVideoUrl && <div className="recipient-video-wrap"><video src={incomingShareVideoUrl} controls playsInline style={{ width: '100%', maxHeight: '55vh', marginTop: 18, background: '#000', borderRadius: 10 }} /><div className="vault-watermark">VAULT · CONTENUTO RISERVATO</div></div>}
          {incomingShareVideoUrl && <div className="notice error capture-warning"><ShieldCheck size={16}/> Contenuto riservato: non registrare, acquisire o redistribuire questo video. Il link è temporaneo e la condivisione è destinata esclusivamente al destinatario.</div>}
          <p className="share-expiry-copy">Questo link temporaneo scade dopo 60 minuti.</p>
        </div>
      </section>
    </main>
  );

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
            {mode === 'signup' && <><label>Frase segreta di cifratura</label><div className="input-wrap"><KeyRound size={17}/><input type={showVaultPassphrase ? 'text' : 'password'} value={vaultPassphrase} onChange={e => setVaultPassphrase(e.target.value)} placeholder="Almeno 12 caratteri" minLength={12} autoComplete="new-password" required/><button className="eye-btn" type="button" onClick={() => setShowVaultPassphrase(v => !v)} aria-label="Mostra frase segreta">{showVaultPassphrase ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><label>Conferma frase segreta</label><div className="input-wrap"><KeyRound size={17}/><input type={showVaultPassphraseConfirm ? 'text' : 'password'} value={vaultPassphraseConfirm} onChange={e => setVaultPassphraseConfirm(e.target.value)} placeholder="Ripeti la frase segreta" minLength={12} autoComplete="new-password" required/><button className="eye-btn" type="button" onClick={() => setShowVaultPassphraseConfirm(v => !v)} aria-label="Mostra conferma frase">{showVaultPassphraseConfirm ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><p className="card-sub">Questa frase cifra i video. È diversa dalla password dell’account e non può essere recuperata se la dimentichi.</p></>}
            <button className="primary-btn auth-submit" disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={18}/> : <>{mode === 'login' ? 'Entra nella cassaforte' : 'Crea account'} <ArrowUpRight size={17}/></>}</button>
          </form>
          {mode === 'login' && <button className="text-btn forgot" onClick={handleReset}>Hai dimenticato la password?</button>}
          <div className="auth-switch">{mode === 'login' ? 'Non hai ancora un account?' : 'Hai già un account?'} <button onClick={() => {setMode(mode === 'login' ? 'signup' : 'login');setError('');setMessage('');setVaultPassphrase('');setVaultPassphraseConfirm('');}}>{mode === 'login' ? 'Registrati' : 'Accedi'}</button></div>
          {error && <div className="notice error"><AlertCircle size={16}/>{error}</div>}
          {message && <div className="notice success"><Check size={16}/>{message}</div>}
          <div className="auth-foot"><LockKeyhole size={13}/> Le tue credenziali non vengono mostrate né condivise.</div>
        </div>
      </section>
      <footer className="page-foot">VAULT <span>·</span> PRIVATE VIDEO STORAGE</footer>
    </main>
  );

  if (!vaultKey) return (
    <main className="auth-page"><div className="auth-glow"/><div className="auth-top"><div className="brand"><div className="brand-icon"><LockKeyhole size={19}/></div><span>VAULT</span></div><button className="text-btn" onClick={handleLogout}>Esci</button></div><section className="auth-layout" style={{display:'flex',justifyContent:'center'}}><div className="auth-card" style={{width:'min(100%,440px)'}}><div className="card-lock"><KeyRound size={22}/></div><h2>Sblocca la cifratura</h2><p className="card-sub">Inserisci la tua frase segreta Vault. Non viene inviata né salvata sui server. Usa la stessa frase su ogni dispositivo.</p><form onSubmit={unlockVault}><label>Frase segreta (almeno 12 caratteri)</label><div className="input-wrap"><KeyRound size={17}/><input type={showVaultPassphrase ? 'text' : 'password'} value={vaultPassphrase} onChange={e => setVaultPassphrase(e.target.value)} autoComplete="off" minLength={12} required placeholder="La tua frase segreta"/><button className="eye-btn" type="button" onClick={() => setShowVaultPassphrase(v => !v)} aria-label="Mostra frase segreta">{showVaultPassphrase ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><button className="primary-btn auth-submit" disabled={unlockBusy}>{unlockBusy ? <LoaderCircle className="spin" size={18}/> : 'Sblocca Vault'}</button></form>{error && <div className="notice error"><AlertCircle size={16}/>{error}</div>}<div className="auth-foot"><ShieldCheck size={13}/> Se dimentichi la frase segreta, i video cifrati non si possono recuperare.</div></div></section></main>
  );

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="brand"><div className="brand-icon"><LockKeyhole size={19}/></div><span>VAULT</span></div>
        <div className="header-right"><span className="secure-pill"><span className="pulse-dot"/> ARCHIVIO PROTETTO</span><div className="user-chip">{session.user.email?.slice(0,1).toUpperCase()}</div><button className="icon-btn" onClick={() => {setSettingsOpen(true);setError('');setMessage('');}} title="Impostazioni"><KeyRound size={18}/></button><button className="icon-btn" onClick={handleLogout} title="Esci"><LogOut size={18}/></button></div>
      </header>
      <section className="welcome">
        <div><div className="eyebrow"><span className="pulse-dot"/> IL TUO SPAZIO PERSONALE</div><h1>La tua <span>cassaforte.</span></h1><p>I nuovi video vengono cifrati sul dispositivo prima del caricamento.</p></div>
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
              <button className="video-preview encrypted-preview" disabled={openingVideoId !== null} onClick={() => item.encrypted ? openEncryptedVideo(item) : setError('Questo è un vecchio video non cifrato. Scaricalo e ricaricalo dopo la modifica per proteggerlo.') }><div className="video-placeholder">{openingVideoId === item.id ? <><LoaderCircle className="spin" size={32}/><span>APERTURA IN CORSO…</span></> : <><LockKeyhole size={32}/><span>{item.encrypted ? 'CIFRATO' : 'NON CIFRATO'}</span></>}</div><span className="private-tag"><LockKeyhole size={11}/> {item.encrypted ? 'AES-256' : 'VECCHIO FILE'}</span></button>
              <div className="video-info"><h3 title={item.displayName}>{item.displayName}</h3><div className="video-meta"><span><Clock3 size={13}/>{formatDate(item.created_at)}</span><span>{formatSize(item.size)}</span></div><div className="video-actions"><button className="share-btn" disabled={openingVideoId !== null} onClick={() => createShare(item)}><Share2 size={14}/> Condividi</button>{item.encrypted && <button className="delete-btn" onClick={() => beginRename(item)} title="Modifica nome"><Pencil size={16}/></button>}<button className="delete-btn" onClick={() => deleteVideo(item)} title="Elimina video"><Trash2 size={16}/></button></div></div>
            </article>
          ))}</div>
        )}
      </section>
      <footer className="dash-footer"><span><ShieldCheck size={14}/> I nuovi caricamenti sono cifrati prima di arrivare a Supabase.</span><span>VAULT · CLIENT-SIDE ENCRYPTION</span></footer>
      {message && <div className="notice success dashboard-notice"><Check size={16}/>{message}<button onClick={() => setMessage('')}><X size={15}/></button></div>}
      {settingsOpen && <div className="modal-backdrop" onClick={() => !rotationBusy && setSettingsOpen(false)}><div className="share-modal settings-modal" onClick={e => e.stopPropagation()}><button className="modal-close" disabled={rotationBusy} onClick={() => setSettingsOpen(false)}><X size={18}/></button><div className="modal-icon"><KeyRound size={21}/></div><div className="section-kicker">IMPOSTAZIONI DI SICUREZZA</div><h2>Modifica frase segreta</h2><p>Vault ricifrerà tutti i video con la nuova frase. Le frasi vengono elaborate solo sul dispositivo e non vengono inviate ai server.</p><form onSubmit={changeVaultPassphrase}><label>Nuova frase segreta</label><div className="input-wrap"><KeyRound size={17}/><input type={showNewVaultPassphrase ? 'text' : 'password'} value={newVaultPassphrase} onChange={e => setNewVaultPassphrase(e.target.value)} minLength={12} autoComplete="new-password" required placeholder="Almeno 12 caratteri"/><button className="eye-btn" type="button" onClick={() => setShowNewVaultPassphrase(v => !v)} aria-label="Mostra nuova frase">{showNewVaultPassphrase ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><label>Conferma nuova frase</label><div className="input-wrap"><KeyRound size={17}/><input type={showNewVaultPassphraseConfirm ? 'text' : 'password'} value={newVaultPassphraseConfirm} onChange={e => setNewVaultPassphraseConfirm(e.target.value)} minLength={12} autoComplete="new-password" required placeholder="Ripeti la nuova frase"/><button className="eye-btn" type="button" onClick={() => setShowNewVaultPassphraseConfirm(v => !v)} aria-label="Mostra conferma nuova frase">{showNewVaultPassphraseConfirm ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><p className="card-sub settings-warning">Non chiudere la pagina durante la procedura. Gli originali vengono eliminati solo dopo la verifica di tutte le nuove copie.</p><button className="primary-btn copy-btn" disabled={rotationBusy}>{rotationBusy ? <><LoaderCircle className="spin" size={17}/> Aggiornamento in corso…</> : <><ShieldCheck size={17}/> Ricifra e aggiorna la frase</>}</button></form>{rotationProgress && <div className="incoming-share-status"><LoaderCircle className="spin" size={17}/>{rotationProgress}</div>}</div></div>}
      {previewUrl && <div className="modal-backdrop" onClick={() => {URL.revokeObjectURL(previewUrl);setPreviewUrl('');setPreviewName('');}}><div className="share-modal video-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => {URL.revokeObjectURL(previewUrl);setPreviewUrl('');setPreviewName('');}}><X size={18}/></button><div className="section-kicker">DECIFRATO SOLO IN MEMORIA</div><h2>{previewName}</h2><div className="video-player-wrap"><video ref={videoElementRef} src={previewUrl} controls autoPlay playsInline style={{width:'100%',maxHeight:'60vh',marginTop:16,background:'#000'}}/><button className="fullscreen-btn" onClick={requestVideoFullscreen}><Maximize2 size={17}/> Schermo intero</button></div></div></div>}
      {renameItem && <div className="modal-backdrop" onClick={() => !renameBusy && setRenameItem(null)}><div className="share-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => !renameBusy && setRenameItem(null)}><X size={18}/></button><div className="modal-icon"><Pencil size={21}/></div><div className="section-kicker">MODIFICA VIDEO</div><h2>Rinomina video</h2><p>Modifica il nome con cui compare nella tua libreria. Il contenuto cifrato non viene modificato.</p><form onSubmit={saveRename}><input className="rename-input" value={renameValue} onChange={e => setRenameValue(e.target.value)} maxLength={100} autoFocus placeholder="Nome del video"/><button className="primary-btn copy-btn" disabled={renameBusy}>{renameBusy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} Salva nome</button></form></div></div>}
      {shareItem && <div className="modal-backdrop" onClick={() => {setShareItem(null);setShareUrl('');setCopyFile(null);}}><div className="share-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => {setShareItem(null);setShareUrl('');setCopyFile(null);}}><X size={18}/></button><div className="modal-icon"><Share2 size={21}/></div><div className="section-kicker">CONDIVISIONE SICURA</div><h2>Condividi questo video</h2><p>Scegli se inviare un link temporaneo oppure una copia del file, che resterà sul dispositivo di chi la riceve.</p><div className="share-file"><Film size={17}/><span>{shareItem.displayName || getDisplayName(shareItem.name)}</span></div><button className="secondary-share-btn" disabled={shareBusy} onClick={createTemporaryLink}>{shareBusy && !copyFile ? <LoaderCircle className="spin" size={16}/> : <Clock3 size={16}/>} Crea link valido 1 ora</button>{shareUrl && <><div className="share-link">{shareUrl}</div><button className="primary-btn copy-btn" onClick={copyShare}>{copied ? <><Check size={17}/> Link copiato</> : <><Copy size={17}/> Copia link</>}</button></>}<div className="share-divider">OPPURE</div><button className="primary-btn copy-btn" disabled={shareBusy} onClick={copyFile ? sendPreparedCopy : prepareCopy}>{shareBusy ? <><LoaderCircle className="spin" size={17}/> Preparo la copia…</> : copyFile ? <><Share2 size={17}/> Invia la copia</> : <><Download size={17}/> Prepara una copia da inviare</>}</button><div className="expiry-note"><ShieldCheck size={14}/> La copia inviata non dipende da Vault e non scade. Il link invece dura 60 minuti.</div></div></div>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
