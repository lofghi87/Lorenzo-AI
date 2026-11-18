import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { LockKeyhole, ShieldCheck, UploadCloud, Film, Share2, Trash2, LogOut, Eye, EyeOff, Copy, Check, X, Play, Clock3, HardDrive, LoaderCircle, KeyRound, Mail, ArrowUpRight, AlertCircle, Pencil, Maximize2, Download, UserRound, Activity, Smartphone, FolderPlus, ArrowDownWideNarrow } from 'lucide-react';
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

function createVideoPoster(blob) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(blob);
    let finished = false;
    const timeout = window.setTimeout(() => finish(''), 5000);
    function finish(result) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    }
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
        finish('');
        return;
      }
      try { video.currentTime = Math.min(0.2, video.duration / 3); }
      catch { finish(''); }
    }, { once: true });
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 480 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return finish('');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.68));
      } catch { finish(''); }
    }, { once: true });
    video.addEventListener('error', () => finish(''), { once: true });
    video.src = objectUrl;
    video.load();
  });
}

function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  const platform = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    ? 'iPad'
    : /iPhone|iPod/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Dispositivo Android'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'PC Windows'
    : /Linux/.test(ua) ? 'Computer Linux'
    : 'Questo dispositivo';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return platform + ' · ' + browser;
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
  const [thumbnails, setThumbnails] = useState({});
  const [folders, setFolders] = useState(['Generale']);
  const [activeFolder, setActiveFolder] = useState('Tutte');
  const [sortMode, setSortMode] = useState('newest');
  const [encryptionFilter, setEncryptionFilter] = useState('all');
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountName, setAccountName] = useState(session?.user?.user_metadata?.display_name || '');
  const [accountEmail, setAccountEmail] = useState('');
  const [newAccountPassword, setNewAccountPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [activity, setActivity] = useState([]);
  const [shares, setShares] = useState([]);
  const [folderCreateBusy, setFolderCreateBusy] = useState(false);
  const videoElementRef = useRef(null);

  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/vault-sw.js', { scope: '/' }).catch(error => {
        console.warn('Service worker Vault non disponibile:', error);
      });
    }
  }, []);

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
    const { data: metadataRows, error: metadataError } = await supabase
      .from('vault_video_meta')
      .select('storage_path,folder_name')
      .eq('user_id', session.user.id);
    if (metadataError) {
      setError('Non riesco a caricare le cartelle: ' + metadataError.message);
      setLoadingVideos(false);
      return;
    }
    const folderByPath = new Map((metadataRows || []).map(row => [row.storage_path, row.folder_name]));
    const withUrls = entries.map(item => {
      const path = session.user.id + '/' + item.name;
      return { ...item, path, folder: folderByPath.get(path) || 'Generale', encrypted: item.name.endsWith('.vlt'), displayName: getDisplayName(item.name), size: item.metadata?.size || 0, mime: item.name.endsWith('.vlt') ? getOriginalVideoMime(item.name) : (item.metadata?.mimetype || '') };
    });
    setVideos(withUrls);
    setLoadingVideos(false);
  }, [session, vaultKey]);

  useEffect(() => {
    if (session && vaultKey) loadVideos();
    else setVideos([]);
  }, [session, vaultKey, loadVideos]);

  useEffect(() => {
    if (session?.user?.id) {
      setAccountName(session.user.user_metadata?.display_name || '');
      setAccountEmail(session.user.email || '');
      loadSecurityData();
    } else {
      setShares([]);
      setActivity([]);
      setFolders(['Generale']);
    }
  }, [session?.user?.id]);

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
        const { data: signInData, error: signError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signError) throw signError;
        if (signInData.user?.id) await logActivity(signInData.user.id, 'login', null, getDeviceLabel());
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
    try { setVaultKey(await deriveVaultKey(vaultPassphrase, session.user.id)); setVaultPassphrase(''); await logActivity(session.user.id, 'vault_unlocked', null, 'Cassaforte sbloccata da questo dispositivo'); }
    catch { setError('Non riesco a sbloccare la cassaforte.'); }
    finally { setUnlockBusy(false); }
  }

  async function changeVaultPassphrase(event) {
    event.preventDefault();
    if (!vaultKey || !session?.user?.id) return;
    if (newVaultPassphrase.length < 12) { setError('La nuova frase deve contenere almeno 12 caratteri.'); return; }
    if (newVaultPassphrase !== newVaultPassphraseConfirm) { setError('Le due nuove frasi non coincidono.'); return; }
    if (newVaultPassphrase === vaultPassphrase) { setError('Scegli una frase diversa da quella attuale.'); return; }
    if (!window.confirm('Vault creerà copie cifrate con la nuova frase, verificherà tutti i file e solo dopo eliminerà gli originali. Per sicurezza, i link temporanei attivi verranno revocati. Tieni aperta la pagina fino al termine. Vuoi continuare?')) return;

    setRotationBusy(true);
    setRotationProgress('Preparazione della nuova chiave…');
    setError('');
    const stagedPaths = [];
    try {
      setRotationProgress('Revoca dei link temporanei…');
      const { data: activeShares, error: activeSharesError } = await supabase.from('vault_shares').select('id,storage_path').eq('user_id', session.user.id).is('revoked_at', null);
      if (activeSharesError) throw new Error('Non riesco a controllare i link temporanei: ' + activeSharesError.message);
      if (activeShares?.length) {
        const { error: removeSharesError } = await supabase.storage.from(BUCKET).remove(activeShares.map(share => share.storage_path));
        if (removeSharesError) throw new Error('Non riesco a revocare i link temporanei: ' + removeSharesError.message);
        const { error: markSharesError } = await supabase.from('vault_shares').update({ revoked_at: new Date().toISOString() }).in('id', activeShares.map(share => share.id));
        if (markSharesError) console.warn('Copie dei link rimosse, ma alcuni record non sono stati aggiornati:', markSharesError.message);
      }
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
        await logActivity(session.user.id, 'vault_passphrase_changed', null, 'Frase segreta aggiornata: link temporanei revocati');
        await loadSecurityData();
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
        await logActivity(session.user.id, 'vault_passphrase_changed', null, 'Frase segreta aggiornata: video ricifrati e link temporanei revocati');
        await loadSecurityData();
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
    await supabase.auth.signOut({ scope: 'local' });
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
        const { error: metaError } = await supabase.from('vault_video_meta').upsert(
          { user_id: session.user.id, storage_path: path, folder_name: 'Generale', updated_at: new Date().toISOString() },
          { onConflict: 'user_id,storage_path' }
        );
        if (metaError) console.warn('Video caricato, ma cartella non salvata:', metaError.message);
        await logActivity(session.user.id, 'video_uploaded', file.name, 'Video caricato e cifrato sul dispositivo');
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
      createVideoPoster(decrypted).then(poster => { if (poster) setThumbnails(current => ({ ...current, [item.path]: poster })); }).catch(() => {});
      await logActivity(session.user.id, 'video_opened', item.displayName || getDisplayName(item.name), 'Video aperto nella libreria privata');
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
    const { error: metaError } = await supabase.from('vault_video_meta').update({ storage_path: newPath, updated_at: new Date().toISOString() }).eq('user_id', session.user.id).eq('storage_path', renameItem.path);
    if (metaError) setError('Video rinominato, ma cartella non aggiornata: ' + metaError.message);
    const { error: sharesMoveError } = await supabase.from('vault_shares').update({ original_path: newPath, file_name: clean + extension }).eq('user_id', session.user.id).eq('original_path', renameItem.path).is('revoked_at', null);
    if (sharesMoveError) setError('Video rinominato, ma non ho aggiornato il collegamento dei link già creati: ' + sharesMoveError.message);
    await logActivity(session.user.id, 'video_renamed', clean, 'Video rinominato');
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
    if (!shareItem || !session?.user?.id) return;
    setShareBusy(true);
    setError('');
    let sharePath = '';
    let shareRecordId = '';
    try {
      const shareId = crypto.randomUUID();
      const safeName = (shareItem.displayName || getDisplayName(shareItem.name)).normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-90) || 'video';
      sharePath = session.user.id + '/_shares/' + shareId + '/' + safeName + (shareItem.encrypted ? '.vlt' : '');
      const { error: copyError } = await supabase.storage.from(BUCKET).copy(shareItem.path, sharePath);
      if (copyError) throw copyError;
      const expiresAt = new Date(Date.now() + SHARE_SECONDS * 1000).toISOString();
      const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(sharePath, SHARE_SECONDS, { download: false });
      if (signError) throw signError;
      const { data: shareRecord, error: recordError } = await supabase.from('vault_shares').insert({
        user_id: session.user.id, original_path: shareItem.path, storage_path: sharePath,
        file_name: shareItem.displayName || getDisplayName(shareItem.name), expires_at: expiresAt
      }).select('id').single();
      if (recordError) throw recordError;
      shareRecordId = shareRecord?.id || '';
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
      await logActivity(session.user.id, 'share_created', shareItem.displayName || getDisplayName(shareItem.name), 'Creato link temporaneo con copia separata revocabile');
      await loadSecurityData();
    } catch (e) {
      if (shareRecordId) await supabase.from('vault_shares').delete().eq('id', shareRecordId).eq('user_id', session.user.id);
      if (sharePath) await supabase.storage.from(BUCKET).remove([sharePath]);
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
    if (!window.confirm('Vuoi eliminare definitivamente questo video? Verranno rimossi anche i link temporanei ancora attivi associati al file.')) return;
    const { data: linkedShares, error: sharesError } = await supabase.from('vault_shares').select('id,storage_path').eq('user_id', session.user.id).eq('original_path', item.path).is('revoked_at', null);
    if (sharesError) { setError('Non riesco a verificare i link attivi: ' + sharesError.message); return; }
    if (linkedShares?.length) {
      const { error: shareDeleteError } = await supabase.storage.from(BUCKET).remove(linkedShares.map(row => row.storage_path));
      if (shareDeleteError) { setError('Non riesco a revocare tutti i link collegati: ' + shareDeleteError.message); return; }
      await supabase.from('vault_shares').update({ revoked_at: new Date().toISOString() }).in('id', linkedShares.map(row => row.id));
    }
    const { error: deleteError } = await supabase.storage.from(BUCKET).remove([item.path]);
    if (deleteError) setError(deleteError.message);
    else {
      await supabase.from('vault_video_meta').delete().eq('user_id', session.user.id).eq('storage_path', item.path);
      await logActivity(session.user.id, 'video_deleted', item.displayName || getDisplayName(item.name), 'Video eliminato dalla libreria');
      setVideos(current => current.filter(v => v.id !== item.id));
      if (shareItem?.id === item.id) {
        setShareItem(null);
        setShareUrl('');
      }
      await loadSecurityData();
    }
  }

  async function logActivity(userId, eventType, itemName = null, details = null) {
    if (!userId) return;
    const { error: activityError } = await supabase.from('vault_activity').insert({ user_id: userId, event_type: eventType, item_name: itemName, details });
    if (activityError) console.warn('Registro attività non aggiornato:', activityError.message);
  }

  async function loadSecurityData() {
    if (!session?.user?.id) return;
    setSecurityLoading(true);
    const [shareResult, activityResult, folderResult] = await Promise.all([
      supabase.from('vault_shares').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('vault_activity').select('id,event_type,item_name,details,created_at').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('vault_video_folders').select('name').eq('user_id', session.user.id).order('name')
    ]);
    if (shareResult.error || activityResult.error || folderResult.error) {
      setError('Non riesco a caricare il centro sicurezza: ' + (shareResult.error || activityResult.error || folderResult.error).message);
    } else {
      let shareRows = shareResult.data || [];
      const expiredPending = shareRows.filter(row => !row.revoked_at && new Date(row.expires_at).getTime() <= Date.now());
      if (expiredPending.length) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(expiredPending.map(row => row.storage_path));
        if (!cleanupError) {
          const { error: markError } = await supabase.from('vault_shares').update({ revoked_at: new Date().toISOString() }).in('id', expiredPending.map(row => row.id));
          if (!markError) shareRows = shareRows.map(row => expiredPending.some(expired => expired.id === row.id) ? { ...row, revoked_at: new Date().toISOString() } : row);
        } else {
          console.warn('Pulizia automatica dei link scaduti non riuscita:', cleanupError.message);
        }
      }
      setShares(shareRows);
      setActivity(activityResult.data || []);
      setFolders(['Generale', ...new Set((folderResult.data || []).map(row => row.name).filter(name => name !== 'Generale'))]);
    }
    setSecurityLoading(false);
  }

  async function revokeShare(share) {
    if (!window.confirm('Revocare questo link? Vault rimuoverà la copia temporanea condivisa. Chi ha già scaricato il video o ne ha conservato una copia non può essere disconnesso da remoto.')) return;
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([share.storage_path]);
    if (removeError) { setError('Non riesco a rimuovere la copia condivisa: ' + removeError.message); return; }
    const { error: updateError } = await supabase.from('vault_shares').update({ revoked_at: new Date().toISOString() }).eq('id', share.id).eq('user_id', session.user.id);
    if (updateError) setError('Copia condivisa rimossa, ma registro non aggiornato: ' + updateError.message);
    await logActivity(session.user.id, 'share_revoked', share.file_name, 'Link temporaneo revocato e copia condivisa rimossa');
    await loadSecurityData();
    setMessage('Link revocato: la copia temporanea è stata rimossa. Le copie già scaricate non possono essere richiamate.');
  }

  async function createFolder() {
    const value = window.prompt('Nome della nuova cartella (massimo 40 caratteri):');
    if (value === null) return;
    const name = value.trim().replace(/[\/\\]/g, '-').slice(0, 40);
    if (!name) { setError('Inserisci un nome di cartella valido.'); return; }
    if (name.toLocaleLowerCase('it') === 'tutte') { setError('Il nome “Tutte” è riservato al filtro della libreria.'); return; }
    if (folders.some(folder => folder.toLowerCase() === name.toLowerCase())) { setError('Esiste già una cartella con questo nome.'); return; }
    setFolderCreateBusy(true);
    const { error: folderError } = await supabase.from('vault_video_folders').insert({ user_id: session.user.id, name });
    setFolderCreateBusy(false);
    if (folderError) { setError('Non riesco a creare la cartella: ' + folderError.message); return; }
    setFolders(current => [...current, name].sort((a, b) => a.localeCompare(b, 'it')));
    await logActivity(session.user.id, 'folder_created', name, 'Nuova cartella creata');
    setActiveFolder(name);
  }

  async function moveToFolder(item, folderName) {
    const { error: folderError } = await supabase.from('vault_video_meta').upsert({
      user_id: session.user.id, storage_path: item.path, folder_name: folderName, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,storage_path' });
    if (folderError) { setError('Non riesco a spostare il video: ' + folderError.message); return; }
    setVideos(current => current.map(video => video.id === item.id ? { ...video, folder: folderName } : video));
    await logActivity(session.user.id, 'video_moved', item.displayName || getDisplayName(item.name), 'Spostato nella cartella ' + folderName);
  }

  async function saveAccountName() {
    const displayName = accountName.trim().slice(0, 60);
    setAccountBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ data: { ...(session.user.user_metadata || {}), display_name: displayName } });
    setAccountBusy(false);
    if (updateError) { setError('Non riesco a salvare il nome: ' + updateError.message); return; }
    setMessage('Nome profilo aggiornato.');
  }

  async function requestAccountEmailChange() {
    const nextEmail = accountEmail.trim().toLowerCase();
    if (!nextEmail || nextEmail === (session.user.email || '').toLowerCase()) { setError('Inserisci un indirizzo email diverso da quello attuale.'); return; }
    setAccountBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ email: nextEmail });
    setAccountBusy(false);
    if (updateError) { setError('Non riesco a richiedere il cambio email: ' + updateError.message); return; }
    await logActivity(session.user.id, 'email_change_requested', nextEmail, 'Richiesta di cambio email inviata');
    setMessage('Richiesta inviata. Controlla la posta e conferma il cambio secondo le istruzioni ricevute.');
  }

  async function updateAccountPassword() {
    if (newAccountPassword.length < 8) { setError('La nuova password deve contenere almeno 8 caratteri.'); return; }
    setAccountBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newAccountPassword });
    setAccountBusy(false);
    if (updateError) { setError('Non riesco ad aggiornare la password: ' + updateError.message); return; }
    setNewAccountPassword('');
    await logActivity(session.user.id, 'password_changed', null, 'Password account aggiornata');
    setMessage('Password aggiornata.');
  }

  async function signOutOtherSessions() {
    if (!window.confirm('Disconnettere tutti gli altri dispositivi che usano questo account? Questa sessione resterà attiva.')) return;
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
    if (signOutError) { setError('Non riesco a chiudere le altre sessioni: ' + signOutError.message); return; }
    await logActivity(session.user.id, 'other_sessions_signed_out', null, 'Richiesta revoca delle altre sessioni');
    setMessage('Richiesta completata: le altre sessioni sono state revocate. I token di accesso già emessi possono restare validi fino alla loro scadenza.');
    await loadSecurityData();
  }

  const visibleVideos = useMemo(() => {
    const filtered = videos.filter(video =>
      (video.displayName || video.name).toLowerCase().includes(search.toLowerCase()) &&
      (activeFolder === 'Tutte' || (video.folder || 'Generale') === activeFolder) &&
      (encryptionFilter === 'all' || (encryptionFilter === 'encrypted' ? video.encrypted : !video.encrypted))
    );
    return filtered.sort((a, b) => {
      if (sortMode === 'name') return (a.displayName || a.name).localeCompare(b.displayName || b.name, 'it');
      if (sortMode === 'size') return (b.size || 0) - (a.size || 0);
      const delta = new Date(a.created_at || 0) - new Date(b.created_at || 0);
      return sortMode === 'oldest' ? delta : -delta;
    });
  }, [videos, search, activeFolder, encryptionFilter, sortMode]);
  const securityAlerts = shares.filter(share => !share.revoked_at && new Date(share.expires_at).getTime() <= Date.now() + 15 * 60 * 1000);
  const totalBytes = videos.reduce((sum, item) => sum + item.size, 0);
  const formatSize = bytes => bytes < 1024 * 1024 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  const formatDate = value => value ? new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  if (incomingShare) return (
    <main className="auth-page incoming-share-page">
      <div className="auth-top"><div className="brand"><div className="brand-icon"><img src="/vault-logo.svg" alt=""/></div><span>VAULT</span></div><span className="top-note"><Clock3 size={14}/> LINK TEMPORANEO</span></div>
      <section className="auth-layout" style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="auth-card incoming-share-card">
          <div className="card-lock"><ShieldCheck size={22}/></div>
          <div className="section-kicker">VIDEO CONDIVISO IN MODO SICURO</div>
          <h2>{incomingShare.name}</h2>
          {incomingShareLoading && <div className="incoming-share-status"><LoaderCircle className="spin" size={20}/> Sto preparando il video…</div>}
          {incomingShareError && <div className="notice error"><AlertCircle size={16}/>{incomingShareError}</div>}
          {incomingShareVideoUrl && <div className="recipient-video-wrap"><video src={incomingShareVideoUrl} controls playsInline style={{ width: '100%', maxHeight: '55vh', marginTop: 18, background: '#000', borderRadius: 10 }} /><div className="vault-watermark">VAULT · CONTENUTO RISERVATO</div></div>}
          {incomingShareVideoUrl && <div className="notice error capture-warning"><ShieldCheck size={16}/> Se questo video viene registrato, Vault lo verrà a sapere. Non registrare né redistribuire questo contenuto.</div>}
          <p className="share-expiry-copy">Questo link temporaneo scade dopo 60 minuti.</p>
        </div>
      </section>
    </main>
  );

  if (!authReady) return <div className="boot"><div className="vault-mark"><LockKeyhole size={25}/></div><LoaderCircle className="spin" size={20}/></div>;

  if (!session) return (
    <main className="auth-page">
      <div className="auth-glow" />
      <div className="auth-top"><div className="brand"><div className="brand-icon"><img src="/vault-logo.svg" alt=""/></div><span>VAULT</span></div><span className="top-note"><ShieldCheck size={14}/> Spazio privato</span></div>
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
    <main className="auth-page"><div className="auth-glow"/><div className="auth-top"><div className="brand"><div className="brand-icon"><img src="/vault-logo.svg" alt=""/></div><span>VAULT</span></div><button className="text-btn" onClick={handleLogout}>Esci</button></div><section className="auth-layout" style={{display:'flex',justifyContent:'center'}}><div className="auth-card" style={{width:'min(100%,440px)'}}><div className="card-lock"><KeyRound size={22}/></div><h2>Sblocca la cifratura</h2><p className="card-sub">Inserisci la tua frase segreta Vault. Non viene inviata né salvata sui server. Usa la stessa frase su ogni dispositivo.</p><form onSubmit={unlockVault}><label>Frase segreta (almeno 12 caratteri)</label><div className="input-wrap"><KeyRound size={17}/><input type={showVaultPassphrase ? 'text' : 'password'} value={vaultPassphrase} onChange={e => setVaultPassphrase(e.target.value)} autoComplete="off" minLength={12} required placeholder="La tua frase segreta"/><button className="eye-btn" type="button" onClick={() => setShowVaultPassphrase(v => !v)} aria-label="Mostra frase segreta">{showVaultPassphrase ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><button className="primary-btn auth-submit" disabled={unlockBusy}>{unlockBusy ? <LoaderCircle className="spin" size={18}/> : 'Sblocca Vault'}</button></form>{error && <div className="notice error"><AlertCircle size={16}/>{error}</div>}<div className="auth-foot"><ShieldCheck size={13}/> Se dimentichi la frase segreta, i video cifrati non si possono recuperare.</div></div></section></main>
  );

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="brand"><div className="brand-icon"><img src="/vault-logo.svg" alt=""/></div><span>VAULT</span></div>
        <div className="header-right"><span className="secure-pill"><span className="pulse-dot"/> ARCHIVIO PROTETTO</span><div className="user-chip" title={session.user.email}>{(session.user.user_metadata?.display_name || session.user.email || 'V').slice(0,1).toUpperCase()}</div><button className="icon-btn" onClick={() => {setAccountName(session.user.user_metadata?.display_name || '');setAccountEmail(session.user.email || '');setError('');setMessage('');setAccountOpen(true);}} title="Profilo account" aria-label="Profilo account"><UserRound size={18}/></button><button className="icon-btn" onClick={() => {setError('');setMessage('');setSecurityOpen(true);loadSecurityData();}} title="Centro sicurezza" aria-label="Centro sicurezza"><ShieldCheck size={18}/></button><button className="icon-btn" onClick={() => {setSettingsOpen(true);setError('');setMessage('');}} title="Frase di cifratura" aria-label="Frase di cifratura"><KeyRound size={18}/></button><button className="icon-btn" onClick={handleLogout} title="Esci" aria-label="Esci"><LogOut size={18}/></button></div>
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
        <div className="library-head"><div><div className="section-kicker">IL TUO ARCHIVIO</div><h2>I miei video <span>{visibleVideos.length}/{videos.length}</span></h2></div><div className="library-tools"><div className="search-box"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca un video…" aria-label="Cerca un video"/></div><select className="library-select" value={activeFolder} onChange={e => setActiveFolder(e.target.value)} aria-label="Filtra per cartella"><option value="Tutte">Tutte le cartelle</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select><select className="library-select" value={sortMode} onChange={e => setSortMode(e.target.value)} aria-label="Ordina video"><option value="newest">Più recenti</option><option value="oldest">Meno recenti</option><option value="name">Nome A–Z</option><option value="size">Dimensione</option></select><select className="library-select" value={encryptionFilter} onChange={e => setEncryptionFilter(e.target.value)} aria-label="Filtra cifratura"><option value="all">Tutti i file</option><option value="encrypted">Solo cifrati</option><option value="legacy">Non cifrati</option></select><button className="folder-add-btn" type="button" onClick={createFolder} disabled={folderCreateBusy}><FolderPlus size={15}/> Nuova cartella</button></div></div>
        {loadingVideos ? <div className="empty-state"><LoaderCircle className="spin" size={24}/><p>Sto aprendo la cassaforte…</p></div> : visibleVideos.length === 0 ? (
          <div className="empty-state"><div className="empty-icon"><Film size={27}/></div><h3>{videos.length ? 'Nessun risultato' : 'La tua cassaforte è vuota'}</h3><p>{videos.length ? 'Prova con un altro nome.' : 'Carica il tuo primo video: resterà privato finché non deciderai di condividerlo.'}</p>{!videos.length && <label className="secondary-btn"><UploadCloud size={17}/> Seleziona video<input type="file" accept="video/*" multiple hidden onChange={handleUpload}/></label>}</div>
        ) : (
          <div className="video-grid">{visibleVideos.map(item => (
            <article className="video-card" key={item.id}>
              <button className="video-preview encrypted-preview" style={thumbnails[item.path] ? { backgroundImage: 'linear-gradient(#0002,#0002),url("' + thumbnails[item.path] + '")', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} disabled={openingVideoId !== null} onClick={() => item.encrypted ? openEncryptedVideo(item) : setError('Questo è un vecchio video non cifrato. Scaricalo e ricaricalo dopo la modifica per proteggerlo.') }>{thumbnails[item.path] ? <span className="thumb-play"><Play size={24} fill="currentColor"/></span> : <div className="video-placeholder">{openingVideoId === item.id ? <><LoaderCircle className="spin" size={32}/><span>APERTURA IN CORSO…</span></> : <><LockKeyhole size={32}/><span>{item.encrypted ? 'CIFRATO' : 'NON CIFRATO'}</span></>}</div>}<span className="private-tag"><LockKeyhole size={11}/> {item.encrypted ? 'AES-256' : 'VECCHIO FILE'}</span></button>
              <div className="video-info"><h3 title={item.displayName}>{item.displayName}</h3><div className="video-meta"><span><Clock3 size={13}/>{formatDate(item.created_at)}</span><span>{formatSize(item.size)}</span></div><label className="folder-row"><FolderPlus size={13}/><select className="video-folder-select" value={item.folder || 'Generale'} onChange={e => moveToFolder(item, e.target.value)} aria-label={'Cartella per ' + item.displayName}>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select></label><div className="video-actions"><button className="share-btn" disabled={openingVideoId !== null} onClick={() => createShare(item)}><Share2 size={14}/> Condividi</button>{item.encrypted && <button className="delete-btn" onClick={() => beginRename(item)} title="Modifica nome"><Pencil size={16}/></button>}<button className="delete-btn" onClick={() => deleteVideo(item)} title="Elimina video"><Trash2 size={16}/></button></div></div>
            </article>
          ))}</div>
        )}
      </section>
      <footer className="dash-footer"><span><ShieldCheck size={14}/> I nuovi caricamenti sono cifrati prima di arrivare a Supabase.</span><span>VAULT · CLIENT-SIDE ENCRYPTION</span></footer>
      {message && <div className="notice success dashboard-notice"><Check size={16}/>{message}<button onClick={() => setMessage('')}><X size={15}/></button></div>}
      {accountOpen && <div className="modal-backdrop" onClick={() => !accountBusy && setAccountOpen(false)}><div className="share-modal account-modal" onClick={e => e.stopPropagation()}><button className="modal-close" type="button" onClick={() => !accountBusy && setAccountOpen(false)}><X size={18}/></button><div className="modal-icon"><UserRound size={21}/></div><div className="section-kicker">IL TUO ACCOUNT</div><h2>Profilo e credenziali</h2><p>Gestisci i dati dell’account. La frase segreta Vault resta separata dalla password.</p><div className="account-field"><label>Email attuale</label><div className="account-current">{session.user.email}</div></div><label>Nome visualizzato</label><div className="input-wrap"><UserRound size={17}/><input value={accountName} onChange={e => setAccountName(e.target.value)} maxLength={60} placeholder="Nome profilo"/></div><button className="primary-btn copy-btn" type="button" disabled={accountBusy} onClick={saveAccountName}>{accountBusy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Salva nome</button><div className="account-divider"/><label>Nuovo indirizzo email</label><div className="input-wrap"><Mail size={17}/><input type="email" value={accountEmail} onChange={e => setAccountEmail(e.target.value)} autoComplete="email" placeholder="nuova@email.com"/></div><button className="secondary-share-btn" type="button" disabled={accountBusy} onClick={requestAccountEmailChange}>Richiedi cambio email</button><p className="card-sub account-hint">Il cambio potrebbe richiedere la conferma tramite email.</p><div className="account-divider"/><label>Nuova password dell’account</label><div className="input-wrap"><KeyRound size={17}/><input type="password" value={newAccountPassword} onChange={e => setNewAccountPassword(e.target.value)} minLength={8} autoComplete="new-password" placeholder="Almeno 8 caratteri"/></div><button className="secondary-share-btn" type="button" disabled={accountBusy || newAccountPassword.length < 8} onClick={updateAccountPassword}>Aggiorna password</button>{error && <div className="notice error"><AlertCircle size={16}/>{error}</div>}{message && <div className="notice success"><Check size={16}/>{message}</div>}</div></div>}
      {securityOpen && <div className="modal-backdrop" onClick={() => setSecurityOpen(false)}><div className="share-modal security-modal" onClick={e => e.stopPropagation()}><button className="modal-close" type="button" onClick={() => setSecurityOpen(false)}><X size={18}/></button><div className="modal-icon"><ShieldCheck size={21}/></div><div className="section-kicker">CONTROLLO E PROTEZIONE</div><h2>Centro sicurezza</h2><p>Gestisci i link temporanei e controlla le attività recenti del tuo account.</p><div className="security-device"><Smartphone size={18}/><div><b>Sessione corrente</b><span>{getDeviceLabel()}</span></div><span className="current-device-pill">ATTIVA</span></div><div className="security-section-head"><h3>Sessioni riconosciute</h3><span className="account-hint">Dagli accessi recenti</span></div><div className="security-list">{activity.filter(entry => entry.event_type === 'login').slice(0,5).map(entry => <div className="security-row" key={entry.id}><div className="security-row-main"><b>{entry.details || 'Accesso registrato'}</b><span>{new Date(entry.created_at).toLocaleString('it-IT')}</span></div></div>)}</div><p className="account-hint">Questa è la cronologia degli accessi registrati da Vault, non l’elenco live delle sessioni aperte.</p><button className="secondary-share-btn" type="button" onClick={signOutOtherSessions}>Disconnetti gli altri dispositivi</button><p className="account-hint">Supabase consente di revocare le altre sessioni, ma non fornisce a questa app l’elenco dettagliato dei dispositivi. I token di accesso già emessi possono restare validi fino alla scadenza.</p><div className="account-divider"/><div className="security-section-head"><h3>Avvisi</h3><span className="account-hint">{securityAlerts.length} da controllare</span></div>{securityAlerts.length ? <div className="security-list">{securityAlerts.map(share => { const expired = new Date(share.expires_at).getTime() <= Date.now(); return <div className="security-row" key={'alert-'+share.id}><div className="security-row-main"><b>{share.file_name}</b><span>{expired ? 'Link scaduto: la copia sarà rimossa' : 'Link in scadenza entro 15 minuti'}</span></div><span className="current-device-pill">{expired ? 'SCADUTO' : 'IN SCADENZA'}</span></div>; })}</div> : <div className="security-empty">Nessun link in scadenza nei prossimi 15 minuti.</div>}<div className="account-divider"/><div className="security-section-head"><h3>Link temporanei</h3><button className="text-btn" type="button" onClick={loadSecurityData}>Aggiorna</button></div>{error && <div className="notice error"><AlertCircle size={16}/>{error}</div>}{message && <div className="notice success"><Check size={16}/>{message}</div>}{securityLoading ? <div className="incoming-share-status"><LoaderCircle className="spin" size={17}/> Caricamento…</div> : shares.length === 0 ? <div className="security-empty">Non hai ancora creato link temporanei.</div> : <div className="security-list">{shares.map(share => { const expired = new Date(share.expires_at).getTime() <= Date.now(); const revoked = Boolean(share.revoked_at); return <div className="security-row" key={share.id}><div className="security-row-main"><b>{share.file_name}</b><span>{revoked ? (expired ? 'Scaduto e ripulito' : 'Revocato') : expired ? 'Scaduto' : 'Attivo'} · scade {new Date(share.expires_at).toLocaleString('it-IT')}</span></div>{!revoked && <button className="revoke-btn" type="button" onClick={() => revokeShare(share)}>{expired ? 'Pulisci' : 'Revoca'}</button>}</div>; })}</div>}<div className="account-divider"/><div className="security-section-head"><h3>Attività recenti</h3><span className="account-hint">Ultime 40 azioni</span></div><p className="account-hint">Registro applicativo: annota le operazioni eseguite da Vault, ma non è un registro forense indipendente o non modificabile.</p>{activity.length === 0 ? <div className="security-empty">Le attività appariranno qui.</div> : <div className="security-list activity-list">{activity.map(entry => <div className="activity-row" key={entry.id}><div><b>{{login:'Accesso',video_uploaded:'Video caricato',video_opened:'Video aperto',video_renamed:'Video rinominato',video_deleted:'Video eliminato',share_created:'Link creato',share_revoked:'Link revocato',password_changed:'Password aggiornata',email_change_requested:'Cambio email richiesto',other_sessions_signed_out:'Altre sessioni revocate',vault_unlocked:'Cassaforte sbloccata',folder_created:'Cartella creata',video_moved:'Video spostato'}[entry.event_type] || 'Attività'}</b><span>{entry.item_name || entry.details || '—'}</span></div><time>{new Date(entry.created_at).toLocaleString('it-IT')}</time></div>)}</div>}</div></div>}
      {settingsOpen && <div className="modal-backdrop" onClick={() => !rotationBusy && setSettingsOpen(false)}><div className="share-modal settings-modal" onClick={e => e.stopPropagation()}><button className="modal-close" disabled={rotationBusy} onClick={() => setSettingsOpen(false)}><X size={18}/></button><div className="modal-icon"><KeyRound size={21}/></div><div className="section-kicker">IMPOSTAZIONI DI SICUREZZA</div><h2>Modifica frase segreta</h2><p>Vault ricifrerà tutti i video con la nuova frase. Le frasi vengono elaborate solo sul dispositivo e non vengono inviate ai server.</p><form onSubmit={changeVaultPassphrase}><label>Nuova frase segreta</label><div className="input-wrap"><KeyRound size={17}/><input type={showNewVaultPassphrase ? 'text' : 'password'} value={newVaultPassphrase} onChange={e => setNewVaultPassphrase(e.target.value)} minLength={12} autoComplete="new-password" required placeholder="Almeno 12 caratteri"/><button className="eye-btn" type="button" onClick={() => setShowNewVaultPassphrase(v => !v)} aria-label="Mostra nuova frase">{showNewVaultPassphrase ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><label>Conferma nuova frase</label><div className="input-wrap"><KeyRound size={17}/><input type={showNewVaultPassphraseConfirm ? 'text' : 'password'} value={newVaultPassphraseConfirm} onChange={e => setNewVaultPassphraseConfirm(e.target.value)} minLength={12} autoComplete="new-password" required placeholder="Ripeti la nuova frase"/><button className="eye-btn" type="button" onClick={() => setShowNewVaultPassphraseConfirm(v => !v)} aria-label="Mostra conferma nuova frase">{showNewVaultPassphraseConfirm ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><p className="card-sub settings-warning">Non chiudere la pagina durante la procedura. Gli originali vengono eliminati solo dopo la verifica di tutte le nuove copie.</p><button className="primary-btn copy-btn" disabled={rotationBusy}>{rotationBusy ? <><LoaderCircle className="spin" size={17}/> Aggiornamento in corso…</> : <><ShieldCheck size={17}/> Ricifra e aggiorna la frase</>}</button></form>{rotationProgress && <div className="incoming-share-status"><LoaderCircle className="spin" size={17}/>{rotationProgress}</div>}</div></div>}
      {previewUrl && <div className="modal-backdrop" onClick={() => {URL.revokeObjectURL(previewUrl);setPreviewUrl('');setPreviewName('');}}><div className="share-modal video-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => {URL.revokeObjectURL(previewUrl);setPreviewUrl('');setPreviewName('');}}><X size={18}/></button><div className="section-kicker">DECIFRATO SOLO IN MEMORIA</div><h2>{previewName}</h2><div className="video-player-wrap"><video ref={videoElementRef} src={previewUrl} controls autoPlay playsInline style={{width:'100%',maxHeight:'60vh',marginTop:16,background:'#000'}}/><button className="fullscreen-btn" onClick={requestVideoFullscreen}><Maximize2 size={17}/> Schermo intero</button></div></div></div>}
      {renameItem && <div className="modal-backdrop" onClick={() => !renameBusy && setRenameItem(null)}><div className="share-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => !renameBusy && setRenameItem(null)}><X size={18}/></button><div className="modal-icon"><Pencil size={21}/></div><div className="section-kicker">MODIFICA VIDEO</div><h2>Rinomina video</h2><p>Modifica il nome con cui compare nella tua libreria. Il contenuto cifrato non viene modificato.</p><form onSubmit={saveRename}><input className="rename-input" value={renameValue} onChange={e => setRenameValue(e.target.value)} maxLength={100} autoFocus placeholder="Nome del video"/><button className="primary-btn copy-btn" disabled={renameBusy}>{renameBusy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} Salva nome</button></form></div></div>}
      {shareItem && <div className="modal-backdrop" onClick={() => {setShareItem(null);setShareUrl('');setCopyFile(null);}}><div className="share-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => {setShareItem(null);setShareUrl('');setCopyFile(null);}}><X size={18}/></button><div className="modal-icon"><Share2 size={21}/></div><div className="section-kicker">CONDIVISIONE SICURA</div><h2>Condividi questo video</h2><p>Scegli se inviare un link temporaneo oppure una copia del file, che resterà sul dispositivo di chi la riceve.</p><div className="share-file"><Film size={17}/><span>{shareItem.displayName || getDisplayName(shareItem.name)}</span></div><button className="secondary-share-btn" disabled={shareBusy} onClick={createTemporaryLink}>{shareBusy && !copyFile ? <LoaderCircle className="spin" size={16}/> : <Clock3 size={16}/>} Crea link valido 1 ora</button>{shareUrl && <><div className="share-link">{shareUrl}</div><button className="primary-btn copy-btn" onClick={copyShare}>{copied ? <><Check size={17}/> Link copiato</> : <><Copy size={17}/> Copia link</>}</button></>}<div className="share-divider">OPPURE</div><button className="primary-btn copy-btn" disabled={shareBusy} onClick={copyFile ? sendPreparedCopy : prepareCopy}>{shareBusy ? <><LoaderCircle className="spin" size={17}/> Preparo la copia…</> : copyFile ? <><Share2 size={17}/> Invia la copia</> : <><Download size={17}/> Prepara una copia da inviare</>}</button><div className="expiry-note"><ShieldCheck size={14}/> La copia inviata non dipende da Vault e non scade. Il link invece dura 60 minuti.</div></div></div>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
