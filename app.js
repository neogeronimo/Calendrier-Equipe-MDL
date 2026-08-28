import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let currentSession = null;
let currentProfile = null;

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function formatDateTime(value) {
  const d = new Date(value);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

async function loadProfile() {
  const userId = currentSession?.user?.id;
  if (!userId) throw new Error('Session utilisateur absente.');

  // Le profil courant passe par une RPC SECURITY DEFINER dédiée.
  // Cela évite de dépendre d'une lecture directe de public.profiles depuis le navigateur.
  const { data, error } = await supabase.rpc('get_my_profile');

  if (error) {
    const sessionRole = currentSession?.user?.role || 'inconnu';
    throw new Error(`Chargement du profil impossible : ${error.message} (rôle session : ${sessionRole})`);
  }

  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile) throw new Error(`Aucun profil trouvé pour l’utilisateur ${currentSession.user.email || userId}.`);
  if (profile.id !== userId) throw new Error('Le profil retourné ne correspond pas à la session connectée.');
  if (profile.is_active === false) throw new Error('Ce compte est désactivé.');
  return profile;
}

function setLoginBusy(isBusy) {
  const button = document.querySelector('#loginForm button[type="submit"]');
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? 'Connexion…' : 'Se connecter';
}

function showLoginError(message) {
  const box = $('loginError');
  box.textContent = message;
  box.hidden = false;
}


async function loadAgenda() {
  const list = $('agendaList');
  list.innerHTML = '<div class="empty">Chargement…</div>';
  const { data, error } = await supabase
    .from('events')
    .select('id,title,description,location,starts_at,ends_at,status,owner_id')
    .gte('ends_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(40);

  if (error) {
    list.innerHTML = `<div class="empty">Impossible de charger l’agenda : ${escapeHtml(error.message)}</div>`;
    return;
  }
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
}

async function loadAdmin() {
  if (currentProfile?.role !== 'administrateur') return;
  const [{ data: groups, error: groupsError }, { data: users, error: usersError }] = await Promise.all([
    supabase.from('groups').select('*').order('name'),
    supabase.rpc('admin_list_profiles')
  ]);

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

  document.querySelectorAll('[data-role-user]').forEach(select => {
    select.addEventListener('change', async (e) => {
      const id = e.target.dataset.roleUser;
      const role = e.target.value;
      const { error } = await supabase.rpc('admin_update_user_role', { target_user_id: id, new_role: role });
      if (error) {
        showToast('Erreur : ' + error.message);
        await loadAdmin();
      } else {
        showToast('Rôle mis à jour');
      }
    });
  });
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
}

function showApp() {
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

async function bootstrap() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    currentSession = session;
    if (!session) { showLogin(); return; }

    currentProfile = await loadProfile();
    showApp();
    await loadAgenda();
    if (currentProfile?.role === 'administrateur') await loadAdmin();
  } catch (e) {
    console.error('Erreur au démarrage :', e);
    showLogin();
    showLoginError('Connexion détectée, mais le profil ne peut pas être chargé : ' + (e?.message || e));
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').hidden = true;
  setLoginBusy(true);

  try {
    const email = $('email').value.trim();
    const password = $('password').value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data?.session) throw new Error('Supabase a accepté les identifiants mais n’a renvoyé aucune session.');

    currentSession = data.session;
    currentProfile = await loadProfile();
    showApp();
    await loadAgenda();
    if (currentProfile?.role === 'administrateur') await loadAdmin();
  } catch (e) {
    console.error('Erreur de connexion :', e);
    showLogin();
    showLoginError(e?.message || String(e));
  } finally {
    setLoginBusy(false);
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentSession = null;
  currentProfile = null;
  showLogin();
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
    showToast('Erreur : ' + error.message);
    return;
  }
  $('groupDialog').close();
  showToast('Groupe créé');
  await loadAdmin();
});

supabase.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  if (!session) showLogin();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

bootstrap();
