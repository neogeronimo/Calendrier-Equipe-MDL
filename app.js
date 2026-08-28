import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=032';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = (id) => document.getElementById(id);

let currentSession = null;
let currentProfile = null;
let profiles = [];
let groups = [];
let memberships = [];
let eventTypes = [];
let events = [];
let calendarView = 'week';
let cursorDate = startOfDay(new Date());
let currentMainView = 'agenda';
let adminProfiles = [];
let deleteTarget = null;
let archiveReadyForUserId = null;

function setStatus(message) {
  const box = $('loginStatus');
  if (box) box.textContent = `Version 0.3.2 · ${message}`;
  console.log('[Calendrier MDL]', message);
}
function showLoginError(message) { $('loginError').textContent = message; $('loginError').hidden = false; }
function clearLoginError() { $('loginError').hidden = true; $('loginError').textContent = ''; }
function setLoginBusy(isBusy) {
  const b = document.querySelector('#loginForm button[type="submit"]');
  if (!b) return; b.disabled = isBusy; b.textContent = isBusy ? 'Connexion…' : 'Se connecter';
}
function showToast(message, ms=3000) {
  const t = $('toast'); t.textContent = message; t.hidden = false;
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.hidden = true, ms);
}

async function functionErrorMessage(error) {
  if (!error) return 'Erreur inconnue';
  try {
    if (error.context && typeof error.context.json === 'function') {
      const payload = await error.context.json();
      if (payload?.error) return payload.error;
      if (payload?.message) return payload.message;
    }
  } catch {}
  return error.message || String(error);
}
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => timer = setTimeout(() => reject(new Error(`${label} : délai dépassé`)), ms));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch])); }
function pad(n) { return String(n).padStart(2,'0'); }
function startOfDay(d) { const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n) { const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d) { const x=startOfDay(d); const day=(x.getDay()+6)%7; return addDays(x,-day); }
function endOfWeek(d) { return addDays(startOfWeek(d),7); }
function startOfMonth(d) { return new Date(d.getFullYear(),d.getMonth(),1); }
function endOfMonth(d) { return new Date(d.getFullYear(),d.getMonth()+1,1); }
function sameDay(a,b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function toLocalInput(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function toDateInput(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseLocalInput(s) { return new Date(s); }
function fmtDate(d, opts={}) { return new Intl.DateTimeFormat('fr-FR', opts).format(d); }
function fmtTime(d) { return new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(d); }
function eventColor(ev) { return eventTypes.find(t=>t.id===ev.event_type_id)?.color || '#5b4fd6'; }
function profileName(p) { return p?.display_name || [p?.first_name,p?.last_name].filter(Boolean).join(' ') || 'Utilisateur'; }
function roleCanManageTeam() { return ['planificateur','responsable','administrateur'].includes(currentProfile?.role); }
function roleCanManageUsers() { return ['responsable','administrateur'].includes(currentProfile?.role); }
function isAdmin() { return currentProfile?.role === 'administrateur'; }

async function loadProfile(userId) {
  const { data, error } = await withTimeout(
    supabase.from('profiles').select('id,first_name,last_name,display_name,role,is_active,has_global_scope,share_calendar,calendar_share_mode').eq('id', userId).maybeSingle(),
    12000, 'Lecture du profil'
  );
  if (error) throw new Error(`Profil : ${error.message}`);
  if (!data) throw new Error('Profil utilisateur introuvable.');
  if (!data.is_active) throw new Error('Ce compte est désactivé.');
  return data;
}

async function loadReferenceData() {
  const [pRes,gRes,mRes,tRes] = await Promise.all([
    supabase.from('profiles').select('id,first_name,last_name,display_name,role,is_active,has_global_scope,share_calendar,calendar_share_mode').eq('is_active',true).order('display_name'),
    supabase.from('groups').select('*').eq('is_active',true).order('name'),
    supabase.from('user_groups').select('user_id,group_id,is_primary'),
    supabase.from('event_types').select('*').eq('is_active',true).order('name')
  ]);
  if (pRes.error) throw pRes.error;
  profiles = pRes.data || [];
  groups = gRes.error ? [] : (gRes.data || []);
  memberships = mRes.error ? [] : (mRes.data || []);
  eventTypes = tRes.error ? [] : (tRes.data || []);
  populateOwnerSelect();
  populateEventTypes();
  populateTeamFilters();
}

function showAppShell() {
  $('loginView').hidden = true; $('appView').hidden = false;
  const first = currentProfile?.first_name?.trim();
  $('welcomeTitle').textContent = first ? `Bonjour ${first}` : `Bonjour ${profileName(currentProfile)}`;
  $('adminTab').hidden = !roleCanManageUsers();
  $('teamTab').hidden = !roleCanManageTeam();
}
function showLogin() { $('appView').hidden = true; $('loginView').hidden = false; }

async function enterApplication(session) {
  currentSession = session;
  currentProfile = await loadProfile(session.user.id);
  showAppShell();
  await loadReferenceData();
  await loadCalendarEvents();
  renderCalendar();
  if (roleCanManageTeam()) renderTeamUsers();
  setStatus('application ouverte.');
}

function calendarRange() {
  if (calendarView === 'month') {
    const first=startOfMonth(cursorDate); const gridStart=startOfWeek(first); return {start:gridStart,end:addDays(gridStart,42)};
  }
  if (calendarView === 'week') return {start:startOfWeek(cursorDate), end:endOfWeek(cursorDate)};
  return {start:startOfDay(cursorDate), end:addDays(startOfDay(cursorDate),31)};
}
async function loadCalendarEvents() {
  const range = calendarRange();
  const { data, error } = await withTimeout(
    supabase.from('events').select('id,owner_id,created_by,event_type_id,title,description,location,starts_at,ends_at,all_day,status,visibility').lt('starts_at', range.end.toISOString()).gt('ends_at', range.start.toISOString()).order('starts_at'),
    12000, 'Chargement calendrier'
  );
  if (error) throw error;
  events = data || [];
}

function updateCalendarTitle() {
  if (calendarView==='month') $('calendarTitle').textContent = fmtDate(cursorDate,{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
  else if (calendarView==='week') {
    const s=startOfWeek(cursorDate), e=addDays(s,6);
    $('calendarTitle').textContent = `${fmtDate(s,{day:'2-digit',month:'short'})} – ${fmtDate(e,{day:'2-digit',month:'short',year:'numeric'})}`;
  } else $('calendarTitle').textContent = `À partir du ${fmtDate(cursorDate,{day:'2-digit',month:'long',year:'numeric'})}`;
}
function renderCalendar() {
  updateCalendarTitle();
  document.querySelectorAll('.view-btn').forEach(b=>b.classList.toggle('active',b.dataset.calView===calendarView));
  if (calendarView==='month') renderMonth(); else if (calendarView==='week') renderWeek(); else renderAgenda();
}

function renderMonth() {
  const host=$('calendarHost'); const first=startOfMonth(cursorDate); const gridStart=startOfWeek(first); const today=startOfDay(new Date());
  const names=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  let html='<div class="calendar-card"><div class="month-grid">'+names.map(n=>`<div class="month-head">${n}</div>`).join('');
  for(let i=0;i<42;i++){
    const day=addDays(gridStart,i); const dayEnd=addDays(day,1);
    const dayEvents=events.filter(ev=>new Date(ev.starts_at)<dayEnd && new Date(ev.ends_at)>day).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
    html+=`<div class="month-day ${day.getMonth()!==first.getMonth()?'other-month':''} ${sameDay(day,today)?'today':''}" data-day="${toDateInput(day)}">
      <div class="day-number">${day.getDate()}</div>`;
    dayEvents.slice(0,3).forEach(ev=>{
      html+=`<button class="mini-event ${ev.status==='cancelled'?'cancelled':''}" data-event-id="${ev.id}" style="border-left:3px solid ${escapeHtml(eventColor(ev))}">${ev.all_day?'':fmtTime(new Date(ev.starts_at))+' · '}${escapeHtml(ev.title)}</button>`;
    });
    if(dayEvents.length>3) html+=`<div class="more-events">+ ${dayEvents.length-3} autre(s)</div>`;
    html+='</div>';
  }
  html+='</div></div>'; host.innerHTML=html;
  host.querySelectorAll('[data-event-id]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openEventById(b.dataset.eventId);}));
  host.querySelectorAll('.month-day').forEach(cell=>cell.addEventListener('dblclick',()=>openNewEvent(new Date(`${cell.dataset.day}T09:00`))));
}

function renderWeek() {
  const host=$('calendarHost'); const s=startOfWeek(cursorDate); const today=startOfDay(new Date()); const startHour=8, endHour=19, totalHours=endHour-startHour;
  let html='<div class="week-wrap"><div class="week-grid"><div class="week-corner"></div>';
  for(let i=0;i<7;i++){const d=addDays(s,i); html+=`<div class="week-day-head ${sameDay(d,today)?'today':''}"><strong>${fmtDate(d,{weekday:'short'})}</strong><span>${fmtDate(d,{day:'2-digit',month:'short'})}</span></div>`;}
  html+='<div class="time-col">'; for(let h=startHour;h<endHour;h++) html+=`<div class="time-label">${pad(h)}:00</div>`; html+='</div>';
  for(let i=0;i<7;i++){
    const d=addDays(s,i), dEnd=addDays(d,1); const dayEvents=events.filter(ev=>new Date(ev.starts_at)<dEnd && new Date(ev.ends_at)>d && !ev.all_day);
    html+=`<div class="day-col" data-day="${toDateInput(d)}" data-start-hour="${startHour}">`;
    dayEvents.forEach(ev=>{
      const a=new Date(ev.starts_at), b=new Date(ev.ends_at); const clipStart=new Date(Math.max(a,d)); const clipEnd=new Date(Math.min(b,dEnd));
      const startMin=Math.max(0,(clipStart.getHours()-startHour)*60+clipStart.getMinutes()); const endMin=Math.min(totalHours*60,(clipEnd.getHours()-startHour)*60+clipEnd.getMinutes());
      if(endMin<=0||startMin>=totalHours*60) return;
      const top=(Math.max(0,startMin)/60)*54; const height=Math.max(28,((Math.min(totalHours*60,endMin)-Math.max(0,startMin))/60)*54);
      html+=`<button class="week-event ${ev.status==='cancelled'?'cancelled':''}" data-event-id="${ev.id}" style="top:${top}px;height:${height}px;border-left-color:${escapeHtml(eventColor(ev))}"><strong>${escapeHtml(ev.title)}</strong><span>${fmtTime(a)}–${fmtTime(b)}</span></button>`;
    }); html+='</div>';
  }
  html+='</div></div>'; host.innerHTML=html;
  host.querySelectorAll('[data-event-id]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openEventById(b.dataset.eventId);}));
  host.querySelectorAll('.day-col').forEach(col=>col.addEventListener('dblclick',e=>{
    if(e.target!==col) return; const rect=col.getBoundingClientRect(); const y=e.clientY-rect.top; const mins=Math.max(0,Math.min(totalHours*60,Math.round((y/54*60)/15)*15)); const d=new Date(`${col.dataset.day}T00:00`); d.setMinutes(startHour*60+mins); openNewEvent(d);
  }));
}

function renderAgenda() {
  const host=$('calendarHost'); const sorted=[...events].sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  if(!sorted.length){host.innerHTML='<div class="empty">Aucun rendez-vous sur cette période.</div>';return;}
  const byDay=new Map(); sorted.forEach(ev=>{const k=toDateInput(new Date(ev.starts_at)); if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(ev);});
  let html='<div class="agenda-list">';
  for(const [k,items] of byDay){const d=new Date(`${k}T12:00`);html+=`<div class="agenda-day"><div class="agenda-date">${fmtDate(d,{weekday:'long',day:'2-digit',month:'short'})}</div><div class="agenda-day-events">`;
    items.forEach(ev=>html+=`<button class="event-card" data-event-id="${ev.id}" style="border-left-color:${escapeHtml(eventColor(ev))}"><div class="when">${ev.all_day?'Journée entière':fmtTime(new Date(ev.starts_at))+' → '+fmtTime(new Date(ev.ends_at))}</div><h3>${escapeHtml(ev.title)}</h3>${ev.location?`<div class="meta">📍 ${escapeHtml(ev.location)}</div>`:''}${ev.status==='cancelled'?'<div class="meta">Annulé</div>':''}</button>`);
    html+='</div></div>';
  } html+='</div>';host.innerHTML=html;host.querySelectorAll('[data-event-id]').forEach(b=>b.addEventListener('click',()=>openEventById(b.dataset.eventId)));
}

function populateOwnerSelect() {
  const sel=$('eventOwner'); const manageable=roleCanManageTeam()?profiles:[currentProfile];
  sel.innerHTML=manageable.map(p=>`<option value="${p.id}">${escapeHtml(profileName(p))}</option>`).join('');
  $('ownerWrap').hidden=!roleCanManageTeam();
}
function populateEventTypes() {
  $('eventType').innerHTML='<option value="">Sans catégorie</option>'+eventTypes.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}
function openNewEvent(start=null, ownerId=null) {
  const a=start?new Date(start):new Date(); a.setSeconds(0,0); if(!start){a.setMinutes(Math.ceil(a.getMinutes()/15)*15);} const b=new Date(a.getTime()+60*60*1000);
  $('eventId').value=''; $('eventDialogTitle').textContent='Nouveau rendez-vous'; $('deleteEventBtn').hidden=true;
  $('eventOwner').value=ownerId||currentProfile.id; $('eventTitle').value=''; $('eventStart').value=toLocalInput(a); $('eventEnd').value=toLocalInput(b); $('eventType').value=''; $('eventStatus').value='confirmed'; $('eventLocation').value=''; $('eventDescription').value=''; $('eventAllDay').checked=false; $('eventFormError').hidden=true; $('eventDialog').showModal();
}
function openEventById(id) {
  const ev=events.find(x=>x.id===id); if(!ev)return;
  $('eventId').value=ev.id; $('eventDialogTitle').textContent='Modifier le rendez-vous'; $('deleteEventBtn').hidden=false; $('eventOwner').value=ev.owner_id; $('eventTitle').value=ev.title||''; $('eventStart').value=toLocalInput(new Date(ev.starts_at)); $('eventEnd').value=toLocalInput(new Date(ev.ends_at)); $('eventType').value=ev.event_type_id||''; $('eventStatus').value=ev.status||'confirmed'; $('eventLocation').value=ev.location||''; $('eventDescription').value=ev.description||''; $('eventAllDay').checked=!!ev.all_day; $('eventFormError').hidden=true; $('eventDialog').showModal();
}
async function saveEvent(e) {
  e.preventDefault(); $('eventFormError').hidden=true;
  const id=$('eventId').value||null; const starts=parseLocalInput($('eventStart').value); const ends=parseLocalInput($('eventEnd').value);
  if(!(starts instanceof Date)||isNaN(starts)||!(ends instanceof Date)||isNaN(ends)||ends<=starts){$('eventFormError').textContent='La date de fin doit être après le début.';$('eventFormError').hidden=false;return;}
  const payload={owner_id:$('eventOwner').value||currentProfile.id,created_by:currentProfile.id,event_type_id:$('eventType').value||null,title:$('eventTitle').value.trim(),description:$('eventDescription').value.trim()||null,location:$('eventLocation').value.trim()||null,starts_at:starts.toISOString(),ends_at:ends.toISOString(),all_day:$('eventAllDay').checked,status:$('eventStatus').value,visibility:'normal'};
  const req=id?supabase.from('events').update(payload).eq('id',id):supabase.from('events').insert(payload);
  const {error}=await req; if(error){$('eventFormError').textContent=error.message;$('eventFormError').hidden=false;return;}
  $('eventDialog').close(); showToast(id?'Rendez-vous modifié.':'Rendez-vous créé.'); await loadCalendarEvents(); renderCalendar();
}
async function deleteEvent() {
  const id=$('eventId').value;if(!id)return;if(!confirm('Supprimer définitivement ce rendez-vous ?'))return;
  const {error}=await supabase.from('events').delete().eq('id',id); if(error){$('eventFormError').textContent=error.message;$('eventFormError').hidden=false;return;}
  $('eventDialog').close();showToast('Rendez-vous supprimé.');await loadCalendarEvents();renderCalendar();
}

function populateTeamFilters() {
  $('teamGroupFilter').innerHTML='<option value="">Tous les groupes</option>'+groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  const now=new Date(); $('slotStartDate').value=toDateInput(now); $('slotEndDate').value=toDateInput(addDays(now,7));
}
function renderTeamUsers() {
  const groupId=$('teamGroupFilter').value; let users=profiles.filter(p=>p.role==='technicien' || p.id===currentProfile.id);
  if(groupId){const ids=new Set(memberships.filter(m=>m.group_id===groupId).map(m=>m.user_id));users=users.filter(p=>ids.has(p.id));}
  $('teamUsers').innerHTML=users.length?users.map(p=>{const gs=memberships.filter(m=>m.user_id===p.id).map(m=>groups.find(g=>g.id===m.group_id)?.name).filter(Boolean).join(', ');return `<label class="check-item"><input type="checkbox" value="${p.id}" class="team-user-check"><span><strong>${escapeHtml(profileName(p))}</strong><small>${escapeHtml(gs||p.role)}</small></span></label>`;}).join(''):'<div class="empty">Aucun technicien dans ce filtre.</div>';
}
async function searchSlots(e) {
  e.preventDefault(); const ids=[...document.querySelectorAll('.team-user-check:checked')].map(x=>x.value); if(!ids.length){showToast('Sélectionne au moins un technicien.');return;}
  const start=new Date(`${$('slotStartDate').value}T00:00:00`), end=new Date(`${$('slotEndDate').value}T23:59:59`); const duration=Number($('slotDuration').value), step=Number($('slotStep').value);
  $('slotResults').innerHTML='<div class="empty">Recherche en cours…</div>';
  const {data,error}=await supabase.rpc('find_common_slots',{target_user_ids:ids,range_start:start.toISOString(),range_end:end.toISOString(),duration_minutes:duration,slot_step_minutes:step,max_results:20});
  if(error){$('slotResults').innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;return;}
  if(!data?.length){$('slotResults').innerHTML='<div class="empty">Aucun créneau commun trouvé sur cette période.</div>';return;}
  $('slotResults').innerHTML=data.map((s,i)=>{const a=new Date(s.slot_start),b=new Date(s.slot_end);return `<div class="slot-card"><div><strong>${fmtDate(a,{weekday:'long',day:'2-digit',month:'long'})}</strong><span class="muted">${fmtTime(a)} → ${fmtTime(b)}</span></div><button class="small-btn" data-slot-index="${i}">Créer</button></div>`;}).join('');
  $('slotResults').querySelectorAll('[data-slot-index]').forEach(btn=>btn.addEventListener('click',()=>{const s=data[Number(btn.dataset.slotIndex)];const a=new Date(s.slot_start);openNewEvent(a);$('eventEnd').value=toLocalInput(new Date(s.slot_end));}));
}

async function loadAdmin() {
  if(!roleCanManageUsers()) return;

  const {data: users, error: usersError} = await supabase.rpc('manager_list_profiles');

  if(usersError){
    $('usersList').innerHTML=`<div class="error">${escapeHtml(usersError.message)}</div>`;
  } else {
    adminProfiles = users || [];
  }

  $('groupsList').innerHTML=groups.length
    ? groups.map(g=>`<div class="list-row"><div class="row-main"><strong>${escapeHtml(g.name)}</strong><span class="badge">${g.is_active?'Actif':'Inactif'}</span></div>${g.description?`<div class="muted">${escapeHtml(g.description)}</div>`:''}</div>`).join('')
    : '<div class="empty">Aucun groupe.</div>';

  if(!usersError) renderAdminUsers();
}

function renderAdminUsers() {
  if(!roleCanManageUsers()) return;
  const q=($('userSearch').value||'').trim().toLowerCase();
  const role=$('userRoleFilter').value;
  const status=$('userStatusFilter').value;

  let rows=adminProfiles.filter(u=>{
    const hay=`${profileName(u)} ${u.email||''} ${u.role||''}`.toLowerCase();
    if(q && !hay.includes(q)) return false;
    if(role && u.role!==role) return false;
    if(status==='active' && !u.is_active) return false;
    if(status==='inactive' && u.is_active) return false;
    return true;
  });

  $('usersList').innerHTML=rows.length ? rows.map(u=>{
    const groupNames=(u.group_names||[]).filter(Boolean).join(', ');
    const protectedAdmin = !isAdmin() && u.role==='administrateur';
    const self = u.id===currentProfile.id;
    return `<div class="list-row user-row">
      <div class="row-main">
        <div class="user-identity">
          <strong>${escapeHtml(profileName(u))}</strong>
          <div class="muted">${escapeHtml(u.email||'E-mail non disponible')}</div>
          <div class="user-badges">
            <span class="badge">${escapeHtml(u.role)}</span>
            <span class="badge ${u.is_active?'':'badge-muted'}">${u.is_active?'Actif':'Désactivé'}</span>
            ${u.has_global_scope?'<span class="badge">Accès global</span>':''}
          </div>
          ${groupNames?`<div class="muted">${escapeHtml(groupNames)}</div>`:''}
        </div>
        <div class="user-actions">
          <button class="small-btn" data-edit-user="${u.id}" ${protectedAdmin?'disabled':''}>Modifier</button>
          <button class="ghost" data-toggle-user="${u.id}" ${self||protectedAdmin?'disabled':''}>${u.is_active?'Désactiver':'Réactiver'}</button>
          <button class="danger-btn" data-delete-user="${u.id}" ${self||protectedAdmin?'disabled':''}>Archiver & supprimer</button>
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="empty">Aucun utilisateur pour ce filtre.</div>';

  $('usersList').querySelectorAll('[data-edit-user]').forEach(b=>b.addEventListener('click',()=>openEditUser(b.dataset.editUser)));
  $('usersList').querySelectorAll('[data-toggle-user]').forEach(b=>b.addEventListener('click',()=>toggleUserActive(b.dataset.toggleUser)));
  $('usersList').querySelectorAll('[data-delete-user]').forEach(b=>b.addEventListener('click',()=>openDeleteUser(b.dataset.deleteUser)));
}

function populateUserGroupControls(selectedIds=[], primaryId='') {
  const selected=new Set(selectedIds);
  $('userPrimaryGroup').innerHTML='<option value="">Aucun</option>'+groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  $('userPrimaryGroup').value=primaryId||'';
  $('userGroupsChecks').innerHTML=groups.length ? groups.map(g=>`
    <label class="check-item"><input type="checkbox" class="user-group-check" value="${g.id}" ${selected.has(g.id)?'checked':''}><span><strong>${escapeHtml(g.name)}</strong></span></label>
  `).join('') : '<div class="empty">Aucun groupe disponible.</div>';
}

function openNewUser() {
  $('userId').value='';
  $('userDialogTitle').textContent='Nouvel utilisateur';
  $('userFirstName').value='';
  $('userLastName').value='';
  $('userDisplayName').value='';
  $('userEmail').value='';
  $('userEmail').disabled=false;
  $('passwordWrap').hidden=false;
  $('userTempPassword').required=true;
  $('userTempPassword').value=generateTemporaryPassword();
  $('userRole').value='technicien';
  $('userRole').querySelector('option[value="administrateur"]').disabled=!isAdmin();
  $('userGlobalScope').checked=false;
  $('userActive').checked=true;
  populateUserGroupControls();
  $('userFormError').hidden=true;
  $('userDialog').showModal();
}

function openEditUser(id) {
  const u=adminProfiles.find(x=>x.id===id); if(!u)return;
  if(!isAdmin() && u.role==='administrateur'){showToast('Seul un administrateur peut modifier un administrateur.');return;}
  $('userId').value=u.id;
  $('userDialogTitle').textContent='Modifier l’utilisateur';
  $('userFirstName').value=u.first_name||'';
  $('userLastName').value=u.last_name||'';
  $('userDisplayName').value=u.display_name||'';
  $('userEmail').value=u.email||'';
  $('userEmail').disabled=true;
  $('passwordWrap').hidden=true;
  $('userTempPassword').required=false;
  $('userRole').value=u.role||'technicien';
  $('userRole').querySelector('option[value="administrateur"]').disabled=!isAdmin() && u.role!=='administrateur';
  $('userGlobalScope').checked=!!u.has_global_scope;
  $('userActive').checked=!!u.is_active;
  populateUserGroupControls(u.group_ids||[],u.primary_group_id||'');
  $('userFormError').hidden=true;
  $('userDialog').showModal();
}

function generateTemporaryPassword() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out='MdL!';
  const a=new Uint32Array(12); crypto.getRandomValues(a);
  for(const n of a) out+=chars[n%chars.length];
  return out;
}

async function saveUser(e) {
  e.preventDefault();
  $('userFormError').hidden=true;
  const id=$('userId').value||null;
  const first_name=$('userFirstName').value.trim();
  const last_name=$('userLastName').value.trim();
  const display_name=$('userDisplayName').value.trim()||`${first_name} ${last_name}`.trim();
  const email=$('userEmail').value.trim();
  const password=$('userTempPassword').value;
  const role=$('userRole').value;
  const has_global_scope=$('userGlobalScope').checked;
  const is_active=$('userActive').checked;
  const group_ids=[...document.querySelectorAll('.user-group-check:checked')].map(x=>x.value);
  let primary_group_id=$('userPrimaryGroup').value||null;
  if(primary_group_id && !group_ids.includes(primary_group_id)) group_ids.push(primary_group_id);

  const action=id?'update':'create';
  if(!id && password.length<8){$('userFormError').textContent='Le mot de passe temporaire doit contenir au moins 8 caractères.';$('userFormError').hidden=false;return;}

  const {data,error}=await supabase.functions.invoke('admin-users',{
    body:{action,user_id:id,email,password,first_name,last_name,display_name,role,has_global_scope,is_active,group_ids,primary_group_id}
  });
  if(error){$('userFormError').textContent=await functionErrorMessage(error);$('userFormError').hidden=false;return;}
  if(data?.error){$('userFormError').textContent=data.error;$('userFormError').hidden=false;return;}

  $('userDialog').close();
  showToast(id?'Utilisateur modifié.':'Utilisateur créé.');
  await loadReferenceData();
  await loadAdmin();
}

async function toggleUserActive(id) {
  const u=adminProfiles.find(x=>x.id===id); if(!u)return;
  if(id===currentProfile.id){showToast('Tu ne peux pas désactiver ton propre compte.');return;}
  if(!isAdmin() && u.role==='administrateur'){showToast('Seul un administrateur peut gérer un administrateur.');return;}
  const verb=u.is_active?'désactiver':'réactiver';
  if(!confirm(`Confirmer : ${verb} ${profileName(u)} ?`))return;
  const {data,error}=await supabase.functions.invoke('admin-users',{body:{action:'set_active',user_id:id,is_active:!u.is_active}});
  if(error||data?.error){showToast(data?.error||(await functionErrorMessage(error))||'Opération impossible.');return;}
  showToast(u.is_active?'Compte désactivé.':'Compte réactivé.');
  await loadReferenceData();
  await loadAdmin();
}

function openDeleteUser(id) {
  const u=adminProfiles.find(x=>x.id===id); if(!u)return;
  if(id===currentProfile.id){showToast('La suppression de son propre compte est interdite.');return;}
  if(!isAdmin() && u.role==='administrateur'){showToast('Seul un administrateur peut supprimer un administrateur.');return;}
  deleteTarget=u;
  archiveReadyForUserId=null;
  $('confirmDeleteUserBtn').disabled=true;
  $('archiveUserBtn').disabled=false;
  $('archiveUserBtn').textContent='Exporter Excel';
  $('deleteUserError').hidden=true;
  $('deleteUserSummary').innerHTML=`<strong>${escapeHtml(profileName(u))}</strong><div class="muted">${escapeHtml(u.email||'')}</div><p>La suppression définitive sera débloquée uniquement après la génération de l’archive Excel.</p>`;
  $('deleteUserDialog').showModal();
}

function safeFilePart(s) {
  return String(s||'utilisateur').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'');
}

function formatArchiveDate(value) {
  if(!value) return '';
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(d);
}

async function exportUserArchive() {
  if(!deleteTarget)return;
  $('archiveUserBtn').disabled=true;
  $('archiveUserBtn').textContent='Préparation…';
  $('deleteUserError').hidden=true;

  try{
    const {data,error}=await supabase.rpc('manager_user_archive',{target_user_id:deleteTarget.id});
    if(error)throw error;
    if(!data)throw new Error('Archive vide.');

    const info=data.profile||{};
    const infoRows=[
      ['Archive calendrier','Calendrier Équipe MDL'],
      ['Date de l’archive',new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeStyle:'short'}).format(new Date())],
      ['Nom affiché',info.display_name||''],
      ['Prénom',info.first_name||''],
      ['Nom',info.last_name||''],
      ['E-mail',info.email||''],
      ['Rôle',info.role||''],
      ['Statut',info.is_active?'Actif':'Désactivé'],
      ['Accès global',info.has_global_scope?'Oui':'Non'],
      ['Groupes',(info.group_names||[]).join(', ')]
    ];

    const calendarRows=(data.events||[]).map(ev=>({
      'Début': formatArchiveDate(ev.starts_at),
      'Fin': formatArchiveDate(ev.ends_at),
      'Journée entière': ev.all_day?'Oui':'Non',
      'Titre': ev.title||'',
      'Type': ev.event_type_name||'',
      'Lieu': ev.location||'',
      'Description': ev.description||'',
      'Statut': ev.status||'',
      'Rôle dans l’événement': ev.relationship||'',
      'Propriétaire': ev.owner_name||'',
      'Participants': (ev.participant_names||[]).join(', ')
    }));

    const wb=XLSX.utils.book_new();
    const wsInfo=XLSX.utils.aoa_to_sheet(infoRows);
    wsInfo['!cols']=[{wch:24},{wch:55}];
    const wsCal=XLSX.utils.json_to_sheet(calendarRows.length?calendarRows:[{'Information':'Aucun événement dans le calendrier.'}]);
    wsCal['!cols']=[{wch:20},{wch:20},{wch:16},{wch:34},{wch:22},{wch:28},{wch:55},{wch:16},{wch:22},{wch:28},{wch:50}];
    XLSX.utils.book_append_sheet(wb,wsInfo,'Informations');
    XLSX.utils.book_append_sheet(wb,wsCal,'Calendrier');

    const date=toDateInput(new Date());
    const filename=`Archive-Calendrier-${safeFilePart(profileName(deleteTarget))}-${date}.xlsx`;
    XLSX.writeFile(wb,filename,{compression:true});

    archiveReadyForUserId=deleteTarget.id;
    $('confirmDeleteUserBtn').disabled=false;
    $('archiveUserBtn').textContent='Archive générée ✓';
    showToast('Archive Excel générée. La suppression est maintenant disponible.');
  }catch(err){
    $('archiveUserBtn').disabled=false;
    $('archiveUserBtn').textContent='Exporter Excel';
    $('deleteUserError').textContent=err?.message||String(err);
    $('deleteUserError').hidden=false;
  }
}

async function confirmDeleteUser() {
  if(!deleteTarget || archiveReadyForUserId!==deleteTarget.id){
    showToast('Génère d’abord l’archive Excel.');
    return;
  }
  const typed=prompt(`Dernière confirmation.\nPour supprimer définitivement ${profileName(deleteTarget)}, saisis SUPPRIMER :`);
  if(typed!=='SUPPRIMER')return;

  $('confirmDeleteUserBtn').disabled=true;
  $('confirmDeleteUserBtn').textContent='Suppression…';
  const {data,error}=await supabase.functions.invoke('admin-users',{body:{action:'delete',user_id:deleteTarget.id}});
  if(error||data?.error){
    $('deleteUserError').textContent=data?.error||(await functionErrorMessage(error))||'Suppression impossible.';
    $('deleteUserError').hidden=false;
    $('confirmDeleteUserBtn').disabled=false;
    $('confirmDeleteUserBtn').textContent='Supprimer définitivement';
    return;
  }
  $('deleteUserDialog').close();
  showToast('Utilisateur supprimé après archivage.');
  deleteTarget=null; archiveReadyForUserId=null;
  await loadReferenceData();
  await loadAdmin();
}

async function bootstrap() {
  try { setStatus('vérification de la session…'); const {data:{session},error}=await supabase.auth.getSession(); if(error)throw error;if(!session){showLogin();setStatus('aucune session · veuillez vous connecter.');return;}await enterApplication(session); }
  catch(e){console.error(e);showLogin();showLoginError(e?.message||String(e));setStatus('échec au démarrage.');}
}

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();clearLoginError();setLoginBusy(true);try{const {data,error}=await withTimeout(supabase.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}),12000,'Authentification');if(error)throw error;if(!data?.session)throw new Error('Session absente.');await enterApplication(data.session);}catch(err){showLogin();showLoginError(err?.message||String(err));}finally{setLoginBusy(false);}});
$('logoutBtn').addEventListener('click',async()=>{await supabase.auth.signOut();location.reload();});
$('newEventBtn').addEventListener('click',()=>openNewEvent());
$('eventForm').addEventListener('submit',saveEvent);$('deleteEventBtn').addEventListener('click',deleteEvent);$('cancelEventBtn').addEventListener('click',()=>$('eventDialog').close());$('closeEventDialogBtn').addEventListener('click',()=>$('eventDialog').close());
$('prevBtn').addEventListener('click',async()=>{cursorDate=calendarView==='month'?new Date(cursorDate.getFullYear(),cursorDate.getMonth()-1,1):calendarView==='week'?addDays(cursorDate,-7):addDays(cursorDate,-30);await loadCalendarEvents();renderCalendar();});
$('nextBtn').addEventListener('click',async()=>{cursorDate=calendarView==='month'?new Date(cursorDate.getFullYear(),cursorDate.getMonth()+1,1):calendarView==='week'?addDays(cursorDate,7):addDays(cursorDate,30);await loadCalendarEvents();renderCalendar();});
$('todayBtn').addEventListener('click',async()=>{cursorDate=startOfDay(new Date());await loadCalendarEvents();renderCalendar();});
document.querySelectorAll('.view-btn').forEach(b=>b.addEventListener('click',async()=>{calendarView=b.dataset.calView;await loadCalendarEvents();renderCalendar();}));
$('teamGroupFilter').addEventListener('change',renderTeamUsers);$('refreshTeamBtn').addEventListener('click',async()=>{await loadReferenceData();renderTeamUsers();});$('slotSearchForm').addEventListener('submit',searchSlots);
$('refreshAdminBtn').addEventListener('click',async()=>{await loadReferenceData();await loadAdmin();});

$('addUserBtn').addEventListener('click',openNewUser);
$('userForm').addEventListener('submit',saveUser);
$('closeUserDialogBtn').addEventListener('click',()=>$('userDialog').close());
$('cancelUserBtn').addEventListener('click',()=>$('userDialog').close());
$('generatePasswordBtn').addEventListener('click',()=>{$('userTempPassword').value=generateTemporaryPassword();});
$('userSearch').addEventListener('input',renderAdminUsers);
$('userRoleFilter').addEventListener('change',renderAdminUsers);
$('userStatusFilter').addEventListener('change',renderAdminUsers);
$('archiveUserBtn').addEventListener('click',exportUserArchive);
$('confirmDeleteUserBtn').addEventListener('click',confirmDeleteUser);
$('closeDeleteUserDialogBtn').addEventListener('click',()=>$('deleteUserDialog').close());
$('cancelDeleteUserBtn').addEventListener('click',()=>$('deleteUserDialog').close());

$('addGroupBtn').addEventListener('click',()=>{$('groupName').value='';$('groupDescription').value='';$('groupDialog').showModal();});
$('groupForm').addEventListener('submit',async e=>{
  if(e.submitter?.value==='cancel')return;
  e.preventDefault();
  const name=$('groupName').value.trim();
  if(!name){showToast('Le nom du groupe est obligatoire.',5000);return;}
  const description=$('groupDescription').value.trim()||null;
  const {error}=await supabase.rpc('manager_create_group',{new_name:name,new_description:description});
  if(error){showToast(`Création du groupe impossible : ${error.message}`,7000);return;}
  $('groupDialog').close();
  await loadReferenceData();
  await loadAdmin();
  showToast('Groupe créé.');
});
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',async()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');['agendaPanel','teamPanel','adminPanel'].forEach(id=>$(id).hidden=true);currentMainView=tab.dataset.view;$(currentMainView+'Panel').hidden=false;if(currentMainView==='team')renderTeamUsers();if(currentMainView==='admin')await loadAdmin();}));

bootstrap();
