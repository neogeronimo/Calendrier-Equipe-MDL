import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=013';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = (id) => document.getElementById(id);

let currentSession = null;
let currentProfile = null;

function setStatus(message) {
  const box = $('loginStatus');
  if (box) box.textContent = `Version 0.1.3 · ${message}`;
  console.log('[Calendrier MDL]', message);
}

function showLoginError(message) {
  const box = $('loginError');
  box.textContent = message;
  box.hidden = false;
}

function clearLoginError() {
  $('loginError').hidden = true;
  $('loginError').textContent = '';
}

function setLoginBusy(isBusy) {
  const button = document.querySelector('#loginForm button[type="submit"]');
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? 'Connexion…' : 'Se connecter';
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai dépassé après ${Math.round(ms/1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
}

function formatDateTime(value) {
  const d = new Date(value);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

async function clearOldPwaCache() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.warn('Nettoyage ancien cache PWA ignoré', e);
  }
}

async function loadProfileDirect(userId) {
  setStatus('authentification OK · lecture du profil…');

  const query = supabase
    .from('profiles')
    .select('id,first_name,last_name,display_name,role,is_active,has_global_scope,share_calendar,calendar_share_mode')
    .eq('id', userId)
    .maybeSingle();

  const { data, error } = await withTimeout(query, 12000, 'Lecture du profil');

  if (error) throw new Error(`Profil : ${error.message}`);
  if (!data) throw new Error(`Profil introuvable pour ${currentSession?.user?.email || userId}`);
  if (data.is_active === false) throw new Error('Ce compte est désactivé.');
  return data;
}

function showAppShell() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  const name = currentProfile?.display_name || currentProfile?.first_name || currentSession?.user?.email || 'Utilisateur';
  $('welcomeTitle').textContent = `Bonjour ${name}`;
  $('adminTab').hidden = currentProfile?.role !== 'administrateur';
  $('teamTab').hidden = !['planificateur','responsable','administrateur'].includes(currentProfile?.role);
}

function showLogin() {
  $('appView').hidden = true;
  $('loginView').hidden = false;
}

async function loadAgenda() {
  const list = $('agendaList');
  list.innerHTML = '<div class="empty">Chargement…</div>';

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('events')
        .select('id,title,description,location,starts_at,ends_at,status,owner_id')
        .gte('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(40),
      12000,
      'Chargement agenda'
    );

    if (error) throw error;
    if (!data?.length) {
      list.innerHTML = '<div class="empty">Aucun rendez-vous à venir.</div>';
      return;
    }

    list.innerHTML = data.map(ev => `
      <article class="event-card">
        <div class="when">${formatDateTime(ev.starts_at)} → ${new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date(ev.ends_at))}</div>
        <h3>${escapeHtml(ev.title)}</h3>
        ${ev.location ? `<div class="meta">📍 ${escapeHtml(ev.location)}</div>` : ''}
        ${ev.description ? `<p class="meta">${escapeHtml(ev.description)}</p>` : ''}
      </article>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty">Agenda indisponible : ${escapeHtml(e?.message || e)}</div>`;
  }
}

async function loadAdmin() {
  if (currentProfile?.role !== 'administrateur') return;

  const groupsPromise = withTimeout(
    supabase.from('groups').select('*').order('name'),
    12000,
    'Chargement groupes'
  );

  const usersPromise = withTimeout(
    supabase.rpc('admin_list_profiles'),
    12000,
    'Chargement utilisateurs'
  );

  const [{ data: groups, error: groupsError }, { data: users, error: usersError }] =
    await Promise.all([groupsPromise, usersPromise]);

  if (users && Array.isArray(users)) {
    users.sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || ''), 'fr'));
  }

  $('groupsList').innerHTML = groupsError
    ? `<div class="empty">${escapeHtml(groupsError.message)}</div>`
    : (groups?.length ? groups.map(g => `
      <div class="list-row">
        <div class="row-main"><strong>${escapeHtml(g.name)}</strong><span class="badge">${g.is_active ? 'Actif' : 'Inactif'}</span></div>
        ${g.description ? `<div class="muted">${escapeHtml(g.description)}</div>` : ''}
      </div>`).join('') : '<div class="empty">Aucun groupe.</div>');

  $('usersList').innerHTML = usersError
    ? `<div class="empty">${escapeHtml(usersError.message)}</div>`
    : (users?.length ? users.map(u => `
      <div class="list-row" data-user-id="${u.id}">
        <div class="row-main">
          <div>
            <strong>${escapeHtml(u.display_name || [u.first_name,u.last_name].filter(Boolean).join(' ') || 'Utilisateur')}</strong>
            <div class="muted">${u.has_global_scope ? 'Accès global' : 'Accès selon groupes'} · ${u.is_active ? 'Actif' : 'Inactif'}</div>
          </div>
          <select class="role-select" data-role-user="${u.id}">
            ${['technicien','planificateur','responsable','administrateur'].map(r => `<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>
      </div>`).join('') : '<div class="empty">Aucun utilisateur.</div>');
}

async function enterApplication(session) {
  currentSession = session;

  // Important: on affiche d'abord l'application, pour qu'une panne d'agenda/admin
  // ne puisse plus donner l'impression que la connexion ne fonctionne pas.
  currentProfile = await loadProfileDirect(session.user.id);
  showAppShell();
  setStatus('profil OK · application ouverte.');

  // Les données secondaires se chargent ensuite.
  loadAgenda();
  if (currentProfile?.role === 'administrateur') loadAdmin();
}

async function bootstrap() {
  await clearOldPwaCache();

  try {
    setStatus('vérification de la session…');
    const { data: { session }, error } = await withTimeout(supabase.auth.getSession(), 10000, 'Lecture session');
    if (error) throw error;

    if (!session) {
      showLogin();
      setStatus('aucune session · veuillez vous connecter.');
      return;
    }

    await enterApplication(session);
  } catch (e) {
    console.error('Erreur au démarrage :', e);
    showLogin();
    showLoginError(e?.message || String(e));
    setStatus('échec au démarrage.');
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearLoginError();
  setLoginBusy(true);

  try {
    const email = $('email').value.trim();
    const password = $('password').value;

    setStatus('envoi des identifiants à Supabase…');
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      12000,
      'Authentification'
    );

    if (error) throw error;
    if (!data?.session) throw new Error('Identifiants acceptés mais session absente.');

    setStatus(`authentification réussie pour ${data.user?.email || email}.`);
    await enterApplication(data.session);
  } catch (e) {
    console.error('Erreur de connexion :', e);
    showLogin();
    showLoginError(e?.message || String(e));
    setStatus('connexion interrompue.');
  } finally {
    setLoginBusy(false);
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentSession = null;
  currentProfile = null;
  showLogin();
  setStatus('déconnecté.');
});

$('refreshAgendaBtn').addEventListener('click', loadAgenda);
$('refreshAdminBtn').addEventListener('click', loadAdmin);

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    for (const id of ['agendaPanel','teamPanel','adminPanel']) $(id).hidden = true;
    const view = tab.dataset.view;
    $(view + 'Panel').hidden = false;
    if (view === 'admin') await loadAdmin();
  });
}

$('addGroupBtn').addEventListener('click', () => {
  $('groupName').value = '';
  $('groupDescription').value = '';
  $('groupDialog').showModal();
});

$('groupForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  const name = $('groupName').value.trim();
  const description = $('groupDescription').value.trim() || null;
  if (!name) return;

  const { error } = await supabase.from('groups').insert({ name, description, is_active: true });
  if (error) {
    alert('Erreur : ' + error.message);
    return;
  }
  $('groupDialog').close();
  await loadAdmin();
});

bootstrap();
