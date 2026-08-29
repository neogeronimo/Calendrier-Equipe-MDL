import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=110';

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
let teamEvents = [];
let teamSelectedIds = new Set();
let pendingParticipantIds = [];
let dashboardRangeDays=5;
let dashboardCursor=new Date();
let dashboardSelectedIds=new Set();
let dashboardSlotData=[];
let localNotifications=[];
let deferredInstallPrompt=null;
let teamAbsenceOnly=false;
let notificationTimer=null;
let schedulingSettings = null;
const APP_VERSION='1.1.0';
const PUSH_VAPID_PUBLIC_KEY='BOM2G56uDxJtG30Jjv_3n4w3JxWCRKZe0v8gA9aN7qSAJjpRRi-7LNxST2pb74bsc4rEhiIXEMZpw08tQIlImkE';
let lastSuccessfulSync=null;
let diagnosticsText='';

function setStatus(message) {
  const box = $('loginStatus');
  if (box) box.textContent = `Version 1.1.0 · ${message}`;
  console.log('[Calendrier MDL]', message);
}
function showLoginError(message) { $('loginError').textContent = message; $('loginError').hidden = false; }
function clearLoginError() { $('loginError').hidden = true; $('loginError').textContent = ''; }
function setLoginBusy(isBusy) {
  const b = document.querySelector('#loginForm button[type="submit"]');
  if (!b) return; b.disabled = isBusy; b.textContent = isBusy ? 'Connexion…' : 'Se connecter';
}
function showToast(message, ms=3000) {
  const t = $('toast'); if(!t){console.log('[Toast]',message);return;} t.textContent = message; t.hidden = false;
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

function roleLabel(role){
  const labels={
    technicien:'Technicien',
    planificateur:'Planificateur',
    responsable:'Responsable',
    administrateur:'Administrateur'
  };
  return labels[role]||role||'Utilisateur';
}
function groupNamesForUser(userId) {
  return memberships
    .filter(m=>m.user_id===userId)
    .map(m=>groups.find(g=>g.id===m.group_id)?.name)
    .filter(Boolean);
}
function selectedTeamIds() {
  return [...document.querySelectorAll('.team-user-check:checked')].map(x=>x.value);
}

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
  setTimeout(()=>{updateHeaderIdentity();initDashboardBindings();setMainView('dashboard');startNotificationLoop();},0);
  const first = currentProfile?.first_name?.trim();
  $('welcomeTitle').textContent = first ? `Bonjour ${first}` : `Bonjour ${profileName(currentProfile)}`;
  if($('adminTab')) $('adminTab').hidden = !roleCanManageUsers();
  if($('teamTab')) $('teamTab').hidden = !roleCanManageTeam();
}
function showLogin() { $('appView').hidden = true; $('loginView').hidden = false; }

async function enterApplication(session) {
  currentSession = session;
  currentProfile = await loadProfile(session.user.id);
  showAppShell();
  await loadReferenceData();
  await loadCalendarEvents();
  lastSuccessfulSync=new Date();
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
function filteredCalendarEvents() {
  const q=($('agendaSearch')?.value||'').trim().toLowerCase();
  const type=$('agendaTypeFilter')?.value||'';
  const status=$('agendaStatusFilter')?.value||'';
  return events.filter(ev=>{
    if(type && ev.event_type_id!==type)return false;
    if(status && ev.status!==status)return false;
    if(q && !`${ev.title||''} ${ev.location||''} ${ev.description||''}`.toLowerCase().includes(q))return false;
    return true;
  });
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
    const dayEvents=filteredCalendarEvents().filter(ev=>new Date(ev.starts_at)<dayEnd && new Date(ev.ends_at)>day).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
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
  const host=$('calendarHost');
  const s=startOfWeek(cursorDate);
  const today=startOfDay(new Date());
  const startHour=8,endHour=19,totalHours=endHour-startHour;
  const filtered=filteredCalendarEvents();

  let allDay='<div class="week-wrap"><div class="all-day-strip"><div class="all-day-label">Journée</div>';
  for(let i=0;i<7;i++){
    const d=addDays(s,i),dEnd=addDays(d,1);
    const list=filtered.filter(ev=>ev.all_day && new Date(ev.starts_at)<dEnd && new Date(ev.ends_at)>d);
    allDay+=`<div class="all-day-cell">`;
    list.forEach(ev=>allDay+=`<button class="all-day-event" data-event-id="${ev.id}" style="border-left-color:${escapeHtml(eventColor(ev))}">${escapeHtml(ev.title)}</button>`);
    allDay+='</div>';
  }
  allDay+='</div>';

  let html='<div class="week-grid"><div class="week-corner"></div>';
  for(let i=0;i<7;i++){const d=addDays(s,i);html+=`<div class="week-day-head ${sameDay(d,today)?'today':''}"><strong>${fmtDate(d,{weekday:'short'})}</strong><span>${fmtDate(d,{day:'2-digit',month:'short'})}</span></div>`;}
  html+='<div class="time-col">';
  for(let h=startHour;h<endHour;h++)html+=`<div class="time-label">${pad(h)}:00</div>`;
  html+='</div>';

  for(let i=0;i<7;i++){
    const d=addDays(s,i),dEnd=addDays(d,1);
    const dayEvents=filtered.filter(ev=>new Date(ev.starts_at)<dEnd && new Date(ev.ends_at)>d && !ev.all_day);
    html+=`<div class="day-col" data-day="${toDateInput(d)}" data-start-hour="${startHour}">`;
    dayEvents.forEach(ev=>{
      const a=new Date(ev.starts_at),b=new Date(ev.ends_at);
      const clipStart=new Date(Math.max(a,d)),clipEnd=new Date(Math.min(b,dEnd));
      const startMin=Math.max(0,(clipStart.getHours()-startHour)*60+clipStart.getMinutes());
      const endMin=Math.min(totalHours*60,(clipEnd.getHours()-startHour)*60+clipEnd.getMinutes());
      if(endMin<=0||startMin>=totalHours*60)return;
      const top=(Math.max(0,startMin)/60)*54;
      const height=Math.max(28,((Math.min(totalHours*60,endMin)-Math.max(0,startMin))/60)*54);
      html+=`<button class="week-event ${ev.status==='cancelled'?'cancelled':''}" data-event-id="${ev.id}" style="top:${top}px;height:${height}px;border-left-color:${escapeHtml(eventColor(ev))}"><strong>${escapeHtml(ev.title)}</strong><span>${fmtTime(a)}–${fmtTime(b)}</span></button>`;
    });
    html+='</div>';
  }
  html+='</div></div>';
  host.innerHTML=allDay+html;

  host.querySelectorAll('[data-event-id]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openEventById(b.dataset.eventId);}));
  host.querySelectorAll('.day-col').forEach(col=>col.addEventListener('dblclick',e=>{
    if(e.target!==col)return;
    const rect=col.getBoundingClientRect(),y=e.clientY-rect.top;
    const mins=Math.max(0,Math.min(totalHours*60,Math.round((y/54*60)/15)*15));
    const d=new Date(`${col.dataset.day}T00:00`);
    d.setMinutes(startHour*60+mins);
    openNewEvent(d);
  }));
}

function renderAgenda() {
  const host=$('calendarHost'); const sorted=[...filteredCalendarEvents()].sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
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
  if($('agendaTypeFilter')) $('agendaTypeFilter').innerHTML='<option value="">Tous les types</option>'+eventTypes.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

function renderEventParticipants(selectedIds=[]) {
  const selected=new Set(selectedIds||[]);
  const q=($('participantSearch')?.value||'').trim().toLowerCase();
  const ownerId=$('eventOwner')?.value;
  const candidates=profiles.filter(p=>p.is_active!==false && p.id!==ownerId);

  const selectedProfiles=[...selected].map(id=>profiles.find(p=>p.id===id)).filter(Boolean);
  $('selectedParticipantsSummary').innerHTML=selectedProfiles.length
    ? selectedProfiles.map(p=>`<span class="selected-participant-chip">✓ ${escapeHtml(profileName(p))}</span>`).join('')
    : '<span class="muted tiny">Aucun participant sélectionné.</span>';

  const filtered=candidates.filter(p=>{
    if(!q)return true;
    return `${profileName(p)} ${groupNamesForUser(p.id).join(' ')} ${p.role||''}`.toLowerCase().includes(q);
  });

  $('eventParticipants').innerHTML=filtered.length ? filtered.map(p=>`
    <label class="check-item participant-check">
      <input type="checkbox" class="event-participant-check" value="${p.id}" ${selected.has(p.id)?'checked':''}>
      <span><strong>${escapeHtml(profileName(p))}</strong><small>${escapeHtml(groupNamesForUser(p.id).join(', ')||p.role)}</small></span>
    </label>
  `).join('') : `<div class="empty">${q?'Aucun participant correspondant.':'Aucun participant disponible.'}</div>`;

  document.querySelectorAll('.event-participant-check').forEach(cb=>cb.addEventListener('change',()=>{
    pendingParticipantIds=[...document.querySelectorAll('.event-participant-check:checked')].map(x=>x.value);
    renderEventParticipants(pendingParticipantIds);
  }));
}
function openNewEvent(start=null, ownerId=null, participantIds=[]) {
  const a=start?new Date(start):new Date();
  a.setSeconds(0,0);
  if(!start){a.setMinutes(Math.ceil(a.getMinutes()/15)*15);}
  const b=new Date(a.getTime()+60*60*1000);

  pendingParticipantIds=[...(participantIds||[])];
  $('eventId').value='';
  $('eventDialogTitle').textContent='Nouveau rendez-vous';
  $('deleteEventBtn').hidden=true;
  $('eventOwner').value=ownerId||currentProfile.id;
  $('eventTitle').value='';
  $('eventStart').value=toLocalInput(a);
  $('eventEnd').value=toLocalInput(b);
  $('eventType').value='';
  $('eventStatus').value='confirmed';
  $('eventLocation').value='';
  $('eventDescription').value='';
  $('eventAllDay').checked=false;
  $('participantSearch').value='';
  renderEventParticipants(pendingParticipantIds);
  $('eventFormError').hidden=true;
  $('eventDialog').showModal();
}

async function openEventById(id) {
  const ev=events.find(x=>x.id===id) || teamEvents.find(x=>x.id===id);
  if(!ev)return;
  const {data: parts}=await supabase.from('event_participants').select('user_id').eq('event_id',id);
  pendingParticipantIds=(parts||[]).map(x=>x.user_id);
  $('eventId').value=ev.id;
  $('eventDialogTitle').textContent='Modifier le rendez-vous';
  $('deleteEventBtn').hidden=false;
  $('eventOwner').value=ev.owner_id;
  $('eventTitle').value=ev.title||'';
  $('eventStart').value=toLocalInput(new Date(ev.starts_at));
  $('eventEnd').value=toLocalInput(new Date(ev.ends_at));
  $('eventType').value=ev.event_type_id||'';
  $('eventStatus').value=ev.status||'confirmed';
  $('eventLocation').value=ev.location||'';
  $('eventDescription').value=ev.description||'';
  $('eventAllDay').checked=!!ev.all_day;
  $('participantSearch').value='';
  renderEventParticipants(pendingParticipantIds);
  $('eventFormError').hidden=true;
  $('eventDialog').showModal();
}

async function saveEvent(e) {
  e.preventDefault();
  $('eventFormError').hidden=true;
  const id=$('eventId').value||null;
  const starts=parseLocalInput($('eventStart').value);
  const ends=parseLocalInput($('eventEnd').value);
  if(!(starts instanceof Date)||isNaN(starts)||!(ends instanceof Date)||isNaN(ends)||ends<=starts){
    $('eventFormError').textContent='La date de fin doit être après le début.';
    $('eventFormError').hidden=false;
    return;
  }

  const ownerId=$('eventOwner').value||currentProfile.id;
  const participantIds=[...document.querySelectorAll('.event-participant-check:checked')]
    .map(x=>x.value).filter(id=>id!==ownerId);

  const payload={
    owner_id:ownerId,
    created_by:currentProfile.id,
    event_type_id:$('eventType').value||null,
    title:$('eventTitle').value.trim(),
    description:$('eventDescription').value.trim()||null,
    location:$('eventLocation').value.trim()||null,
    starts_at:starts.toISOString(),
    ends_at:ends.toISOString(),
    all_day:$('eventAllDay').checked,
    status:$('eventStatus').value,
    visibility:'normal'
  };

  let eventId=id;
  if(id){
    const {error}=await supabase.from('events').update(payload).eq('id',id);
    if(error){$('eventFormError').textContent=error.message;$('eventFormError').hidden=false;return;}
  } else {
    const {data,error}=await supabase.from('events').insert(payload).select('id').single();
    if(error){$('eventFormError').textContent=error.message;$('eventFormError').hidden=false;return;}
    eventId=data.id;
  }

  const {error:deletePartError}=await supabase.from('event_participants').delete().eq('event_id',eventId);
  if(deletePartError){
    $('eventFormError').textContent=`Rendez-vous enregistré, mais participants non mis à jour : ${deletePartError.message}`;
    $('eventFormError').hidden=false;
    return;
  }
  if(participantIds.length){
    const {error:partError}=await supabase.from('event_participants').insert(
      participantIds.map(user_id=>({event_id:eventId,user_id,participation_status:'accepted'}))
    );
    if(partError){
      $('eventFormError').textContent=`Rendez-vous enregistré, mais participants non ajoutés : ${partError.message}`;
      $('eventFormError').hidden=false;
      return;
    }
  }

  $('eventDialog').close();
  showToast(id?'Rendez-vous modifié.':'Rendez-vous créé.');
  await loadCalendarEvents();
  renderCalendar();
  if(currentMainView==='team') await refreshTeamSchedule();
}

async function deleteEvent() {
  const id=$('eventId').value;if(!id)return;if(!confirm('Supprimer définitivement ce rendez-vous ?'))return;
  const {error}=await supabase.from('events').delete().eq('id',id); if(error){$('eventFormError').textContent=error.message;$('eventFormError').hidden=false;return;}
  $('eventDialog').close();showToast('Rendez-vous supprimé.');await loadCalendarEvents();renderCalendar();buildLocalNotifications();
}


function csvEscape(v){
  const s=String(v??'');
  return /[;"\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;
}
function downloadText(filename,text,mime='text/plain;charset=utf-8'){
  const blob=new Blob(['\ufeff'+text],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function eventRows(list,ownerLabel=''){
  return list.map(ev=>({
    'Calendrier':ownerLabel || profileName(profiles.find(p=>p.id===ev.owner_id)) || '',
    'Début':ev.all_day?toDateInput(new Date(ev.starts_at)):new Date(ev.starts_at).toLocaleString('fr-FR'),
    'Fin':ev.all_day?toDateInput(new Date(ev.ends_at)):new Date(ev.ends_at).toLocaleString('fr-FR'),
    'Journée entière':ev.all_day?'Oui':'Non',
    'Titre':ev.title||'',
    'Type':eventTypes.find(t=>t.id===ev.event_type_id)?.name||'',
    'Lieu':ev.location||'',
    'Description':ev.description||'',
    'Statut':ev.status||''
  }));
}
function exportRowsCsv(rows,filename){
  if(!rows.length){showToast('Aucune donnée à exporter.');return;}
  const headers=Object.keys(rows[0]);
  const text=[headers.map(csvEscape).join(';'),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(';'))].join('\n');
  downloadText(filename,text,'text/csv;charset=utf-8');
}
function icsEscape(v){return String(v??'').replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;');}
function icsDate(d){return new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function eventsToIcs(list,name='Calendrier Équipe MDL'){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Calendrier Equipe MDL//FR',`X-WR-CALNAME:${icsEscape(name)}`];
  for(const ev of list){
    lines.push('BEGIN:VEVENT',`UID:${ev.id}@calendrier-equipe-mdl`,`DTSTAMP:${icsDate(new Date())}`);
    if(ev.all_day){
      const s=toDateInput(new Date(ev.starts_at)).replaceAll('-','');
      let end=new Date(ev.ends_at);
      if(s===toDateInput(end).replaceAll('-','')) end=addDays(new Date(ev.starts_at),1);
      lines.push(`DTSTART;VALUE=DATE:${s}`,`DTEND;VALUE=DATE:${toDateInput(end).replaceAll('-','')}`);
    }else{
      lines.push(`DTSTART:${icsDate(ev.starts_at)}`,`DTEND:${icsDate(ev.ends_at)}`);
    }
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if(ev.location)lines.push(`LOCATION:${icsEscape(ev.location)}`);
    if(ev.description)lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function exportAgendaXlsx(){
  const rows=eventRows(filteredCalendarEvents(),profileName(currentProfile));
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'Information':'Aucun rendez-vous'}]);
  ws['!cols']=[{wch:25},{wch:20},{wch:20},{wch:14},{wch:32},{wch:20},{wch:25},{wch:45},{wch:14}];
  XLSX.utils.book_append_sheet(wb,ws,'Agenda');
  XLSX.writeFile(wb,`Agenda-${toDateInput(cursorDate)}.xlsx`,{compression:true});
}
function exportAgendaCsv(){exportRowsCsv(eventRows(filteredCalendarEvents(),profileName(currentProfile)),`Agenda-${toDateInput(cursorDate)}.csv`);}
function exportAgendaIcs(){downloadText(`Agenda-${toDateInput(cursorDate)}.ics`,eventsToIcs(filteredCalendarEvents(),`Agenda ${profileName(currentProfile)}`),'text/calendar;charset=utf-8');}


function techniciansInGroup(groupId){
  if(!groupId)return profiles.filter(p=>p.is_active!==false && p.role==='technicien');
  const ids=new Set(memberships.filter(m=>m.group_id===groupId).map(m=>m.user_id));
  return profiles.filter(p=>p.is_active!==false && p.role==='technicien' && ids.has(p.id));
}
function selectGroupTechnicians(groupId,replace=true){
  const users=techniciansInGroup(groupId);
  if(replace)teamSelectedIds.clear();
  users.forEach(p=>teamSelectedIds.add(p.id));
  renderTeamUsers();
}
function renderGroupOverview(){
  const host=$('groupOverview');
  if(!host)return;
  const visibleGroups=groups.filter(g=>g.is_active!==false);
  host.innerHTML=visibleGroups.length?visibleGroups.map(g=>{
    const count=techniciansInGroup(g.id).length;
    return `<article class="group-card">
      <div class="group-card-head">
        <div><h4>${escapeHtml(g.name)}</h4><div class="muted">${escapeHtml(g.description||'')}</div></div>
        <span class="group-count">${count}</span>
      </div>
      <div class="group-card-actions">
        <button class="ghost" data-group-filter="${g.id}">Afficher</button>
        <button class="small-btn" data-group-select="${g.id}">Sélectionner le groupe</button>
      </div>
    </article>`;
  }).join(''):'';

  host.querySelectorAll('[data-group-filter]').forEach(btn=>btn.addEventListener('click',async()=>{
    $('teamGroupFilter').value=btn.dataset.groupFilter;
    $('teamGroupMode').value='filter';
    teamSelectedIds.clear();
    renderTeamUsers();
    await refreshTeamSchedule();
  }));
  host.querySelectorAll('[data-group-select]').forEach(btn=>btn.addEventListener('click',async()=>{
    $('teamGroupFilter').value=btn.dataset.groupSelect;
    $('teamGroupMode').value='select_all';
    selectGroupTechnicians(btn.dataset.groupSelect,true);
    await refreshTeamSchedule();
  }));
}
function populateTeamFilters() {
  const groupOptions=groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  $('teamGroupFilter').innerHTML='<option value="">Tous les groupes</option>'+groupOptions;
  $('slotGroupFilter').innerHTML='<option value="">Techniciens sélectionnés</option>'+groupOptions;
  const now=new Date();
  $('teamDate').value=toDateInput(now);
  $('slotStartDate').value=toDateInput(now);
  $('slotEndDate').value=toDateInput(addDays(now,7));
  renderGroupOverview();

  if($('teamEventTypeFilter')) $('teamEventTypeFilter').innerHTML='<option value="">Tous les types</option>'+eventTypes.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

function renderTeamUsers() {
  const groupId=$('teamGroupFilter').value;
  const mode=$('teamGroupMode')?.value||'filter';
  let users=techniciansInGroup(groupId);

  if(groupId && mode==='select_all'){
    users.forEach(p=>teamSelectedIds.add(p.id));
  }

  $('teamUsers').innerHTML=users.length ? users.map(p=>{
    const checked=teamSelectedIds.has(p.id);
    return `<label class="check-item">
      <input type="checkbox" value="${p.id}" class="team-user-check" ${checked?'checked':''}>
      <span><strong>${escapeHtml(profileName(p))}</strong><small>${escapeHtml(groupNamesForUser(p.id).join(', ')||'Technicien')}</small></span>
    </label>`;
  }).join('') : '<div class="empty">Aucun technicien dans ce groupe.</div>';

  document.querySelectorAll('.team-user-check').forEach(cb=>cb.addEventListener('change',async()=>{
    if(cb.checked)teamSelectedIds.add(cb.value);else teamSelectedIds.delete(cb.value);
    await refreshTeamSchedule();
  }));
}

async function loadTeamEvents(ids,start,end) {
  if(!ids.length)return [];

  const ownedRes=await supabase
    .from('events')
    .select('id,owner_id,created_by,event_type_id,title,description,location,starts_at,ends_at,all_day,status,visibility')
    .in('owner_id',ids)
    .lt('starts_at',end.toISOString())
    .gt('ends_at',start.toISOString())
    .order('starts_at');

  if(ownedRes.error) throw ownedRes.error;

  const partsRes=await supabase
    .from('event_participants')
    .select('event_id,user_id,participation_status')
    .in('user_id',ids)
    .neq('participation_status','declined');

  if(partsRes.error) throw partsRes.error;

  const participantEventIds=[...new Set((partsRes.data||[]).map(x=>x.event_id))];
  let participantEvents=[];
  if(participantEventIds.length){
    const pEventsRes=await supabase
      .from('events')
      .select('id,owner_id,created_by,event_type_id,title,description,location,starts_at,ends_at,all_day,status,visibility')
      .in('id',participantEventIds)
      .lt('starts_at',end.toISOString())
      .gt('ends_at',start.toISOString())
      .order('starts_at');
    if(pEventsRes.error) throw pEventsRes.error;
    participantEvents=pEventsRes.data||[];
  }

  const map=new Map();
  [...(ownedRes.data||[]),...participantEvents].forEach(ev=>map.set(ev.id,ev));
  const participationByEvent=new Map();
  (partsRes.data||[]).forEach(p=>{
    if(!participationByEvent.has(p.event_id))participationByEvent.set(p.event_id,new Set());
    participationByEvent.get(p.event_id).add(p.user_id);
  });

  return [...map.values()].map(ev=>({
    ...ev,
    participant_user_ids:[...(participationByEvent.get(ev.id)||new Set())]
  }));
}

async function refreshTeamSchedule() {
  if(currentMainView!=='team')return;
  const ids=selectedTeamIds();
  teamSelectedIds=new Set(ids);
  if(!ids.length){
    teamEvents=[];
    $('teamPlanningCaption').textContent='Sélectionne un ou plusieurs techniciens.';
    $('teamSchedule').innerHTML='<div class="empty">Sélectionne des techniciens pour afficher leurs plannings.</div>';
    return;
  }

  const start=new Date(`${$('teamDate').value}T00:00:00`);
  const days=Math.max(1,Number($('teamRange').value)||5);
  const end=addDays(start,days);

  $('teamSchedule').innerHTML='<div class="empty">Chargement des calendriers…</div>';
  try{
    teamEvents=await loadTeamEvents(ids,start,end);
    renderTeamSchedule(ids,start,days);
  }catch(err){
    $('teamSchedule').innerHTML=`<div class="error">${escapeHtml(err?.message||String(err))}</div>`;
  }
}

function renderTeamSchedule(ids,start,days) {
  const users=ids.map(id=>profiles.find(p=>p.id===id)).filter(Boolean);
  const detailMode=$('teamDetailMode')?.value||'detailed';
  $('teamSchedule').classList.toggle('compact',detailMode==='compact');

  $('teamPlanningCaption').textContent=`${users.length} technicien${users.length>1?'s':''} · ${fmtDate(start,{day:'2-digit',month:'short'})} → ${fmtDate(addDays(start,days-1),{day:'2-digit',month:'short',year:'numeric'})}`;

  // Statistiques globales utiles au planificateur.
  const periodEnd=addDays(start,days);
  const relevant=teamEvents.filter(ev=>new Date(ev.starts_at)<periodEnd && new Date(ev.ends_at)>start && ev.status!=='cancelled');
  const allDayCount=relevant.filter(ev=>ev.all_day).length;
  const timedCount=relevant.filter(ev=>!ev.all_day).length;
  const busyHours=relevant.filter(ev=>!ev.all_day).reduce((sum,ev)=>{
    const a=Math.max(new Date(ev.starts_at).getTime(),start.getTime());
    const b=Math.min(new Date(ev.ends_at).getTime(),periodEnd.getTime());
    return sum+Math.max(0,(b-a)/3600000);
  },0);

  $('teamPlanningStats').hidden=false;
  $('teamPlanningStats').innerHTML=`
    <div class="team-stat"><span>👥</span><strong>${users.length}</strong><span>technicien${users.length>1?'s':''}</span></div>
    <div class="team-stat"><span>📅</span><strong>${timedCount}</strong><span>rendez-vous horaires</span></div>
    <div class="team-stat"><span>🗓️</span><strong>${allDayCount}</strong><span>journée${allDayCount>1?'s':''} entière${allDayCount>1?'s':''}</span></div>
    <div class="team-stat"><span>⏱️</span><strong>${busyHours.toFixed(1).replace('.',',')} h</strong><span>planifiées</span></div>`;

  let html=`<div class="team-schedule-table" style="--team-days:${days}">`;
  html+=`<div class="team-schedule-head"><div>Technicien</div>`;
  for(let d=0;d<days;d++){
    const day=addDays(start,d);
    html+=`<div>${escapeHtml(fmtDate(day,{weekday:'long',day:'2-digit',month:'short'}))}</div>`;
  }
  html+='</div>';

  for(const user of users){
    const userPeriodEvents=teamEvents.filter(ev=>{
      const applies=ev.owner_id===user.id || (ev.participant_user_ids||[]).includes(user.id);
      return applies && new Date(ev.starts_at)<periodEnd && new Date(ev.ends_at)>start && ev.status!=='cancelled';
    });
    const userTimed=userPeriodEvents.filter(ev=>!ev.all_day);
    const userHours=userTimed.reduce((sum,ev)=>{
      const a=Math.max(new Date(ev.starts_at).getTime(),start.getTime());
      const b=Math.min(new Date(ev.ends_at).getTime(),periodEnd.getTime());
      return sum+Math.max(0,(b-a)/3600000);
    },0);

    html+=`<div class="team-person-row">
      <div class="team-person">
        <strong>${escapeHtml(profileName(user))}</strong>
        <small>${escapeHtml(groupNamesForUser(user.id).join(', ')||'Technicien')}</small>
        <div class="person-metrics">
          <span>📌 ${userPeriodEvents.length} événement${userPeriodEvents.length>1?'s':''}</span>
          <span>⏱️ ${userHours.toFixed(1).replace('.',',')} h planifiées</span>
          <span>🗓️ ${userPeriodEvents.filter(e=>e.all_day).length} journée(s) entière(s)</span>
        </div>
      </div>`;

    for(let d=0;d<days;d++){
      const day=addDays(start,d),dayEnd=addDays(day,1);
      const list=teamEvents.filter(ev=>{
        const typeFilter=$('teamEventTypeFilter')?.value||'';
        const statusFilter=$('teamEventStatusFilter')?.value||'';
        if(teamAbsenceOnly && !isAbsenceEvent(ev))return false;
        if(typeFilter && ev.event_type_id!==typeFilter)return false;
        if(statusFilter && ev.status!==statusFilter)return false;
        const applies=ev.owner_id===user.id || (ev.participant_user_ids||[]).includes(user.id);
        return applies && new Date(ev.starts_at)<dayEnd && new Date(ev.ends_at)>day && ev.status!=='cancelled';
      }).sort((a,b)=>{
        if(a.all_day!==b.all_day)return a.all_day?-1:1;
        return new Date(a.starts_at)-new Date(b.starts_at);
      });

      html+=`<div class="team-day-cell" data-team-day="${toDateInput(day)}" data-team-user="${user.id}">`;

      if(!list.length){
        html+='<span class="team-empty-day">Libre</span>';
      }

      for(const ev of list){
        const participantOnly=ev.owner_id!==user.id;
        const type=eventTypes.find(t=>t.id===ev.event_type_id);
        const timeText=ev.all_day?'Journée entière':`${fmtTime(new Date(ev.starts_at))}–${fmtTime(new Date(ev.ends_at))}`;
        const statusLabel=ev.status==='tentative'?'Provisoire':ev.status==='cancelled'?'Annulé':'Confirmé';
        const details=[
          ev.location?`📍 ${escapeHtml(ev.location)}`:'',
          type?.name?`🏷️ ${escapeHtml(type.name)}`:'',
          participantOnly?'👥 Participant':'👤 Propriétaire',
          `● ${statusLabel}`
        ].filter(Boolean);

        const tooltip=[
          ev.title,
          timeText,
          ev.location||'',
          type?.name||'',
          participantOnly?'Participant':'Propriétaire',
          statusLabel,
          ev.description||''
        ].filter(Boolean).join(' · ');

        html+=`<button
          class="team-event-chip ${participantOnly?'participant-event':''} ${isAbsenceEvent(ev)?'absence-event':''}"
          data-team-event="${ev.id}"
          title="${escapeHtml(tooltip)}"
          style="border-left-color:${escapeHtml(eventColor(ev))}">
          <strong>${escapeHtml(ev.title)}</strong>
          <span class="team-event-time">${escapeHtml(timeText)}</span>
          <span class="team-event-details">
            ${details.map(x=>`<span>${x}</span>`).join('')}
          </span>
        </button>`;
      }

      html+='</div>';
    }
    html+='</div>';
  }

  html+='</div>';
  $('teamSchedule').innerHTML=html;

  $('teamSchedule').querySelectorAll('[data-team-event]').forEach(btn=>btn.addEventListener('click',()=>openEventById(btn.dataset.teamEvent)));
  $('teamSchedule').querySelectorAll('[data-team-day]').forEach(cell=>cell.addEventListener('dblclick',()=>{
    const a=new Date(`${cell.dataset.teamDay}T09:00:00`);
    openNewEvent(a,cell.dataset.teamUser);
  }));
}

function hmToMinutes(value){
  const [h,m]=String(value||'00:00').split(':').map(Number);
  return h*60+(m||0);
}
function isoDay(date){
  const d=date.getDay();
  return d===0?7:d;
}
function atMinutes(day,mins){
  const d=new Date(day);
  d.setHours(Math.floor(mins/60),mins%60,0,0);
  return d;
}
function overlaps(aStart,aEnd,bStart,bEnd){ return aStart < bEnd && aEnd > bStart; }

async function getUserBusySlots(userId,start,end){
  // On lit les événements avec all_day, car get_busy_slots() ne transporte
  // que starts_at / ends_at et ne permet donc pas de savoir qu'une journée
  // doit être bloquée entièrement.
  const ownedRes=await supabase
    .from('events')
    .select('id,starts_at,ends_at,all_day,status')
    .eq('owner_id',userId)
    .neq('status','cancelled')
    .lt('starts_at',end.toISOString())
    .gt('ends_at',start.toISOString());

  if(ownedRes.error)throw ownedRes.error;

  const partRes=await supabase
    .from('event_participants')
    .select('event_id,participation_status')
    .eq('user_id',userId)
    .neq('participation_status','declined');

  if(partRes.error)throw partRes.error;

  const eventIds=[...new Set((partRes.data||[]).map(x=>x.event_id))];
  let participantEvents=[];

  if(eventIds.length){
    const evRes=await supabase
      .from('events')
      .select('id,starts_at,ends_at,all_day,status')
      .in('id',eventIds)
      .neq('status','cancelled')
      .lt('starts_at',end.toISOString())
      .gt('ends_at',start.toISOString());

    if(evRes.error)throw evRes.error;
    participantEvents=evRes.data||[];
  }

  const byId=new Map();
  [...(ownedRes.data||[]),...participantEvents].forEach(ev=>byId.set(ev.id,ev));

  return [...byId.values()].map(ev=>{
    const rawStart=new Date(ev.starts_at);
    const rawEnd=new Date(ev.ends_at);

    if(ev.all_day){
      // Une "journée entière" bloque réellement toute la ou les journées
      // couvertes, même si les heures internes du rendez-vous sont 08:15-09:15.
      const busyStart=new Date(rawStart);
      busyStart.setHours(0,0,0,0);

      const busyEnd=new Date(rawEnd);
      busyEnd.setHours(0,0,0,0);

      // Si début et fin sont le même jour, on bloque jusqu'au lendemain.
      if(busyEnd <= busyStart){
        busyEnd.setDate(busyStart.getDate()+1);
      } else if(
        rawEnd.getHours()!==0 || rawEnd.getMinutes()!==0 ||
        rawEnd.getSeconds()!==0 || rawEnd.getMilliseconds()!==0
      ){
        // Si la fin porte une heure quelconque, la journée de fin est aussi bloquée.
        busyEnd.setDate(busyEnd.getDate()+1);
      }

      return {start:busyStart,end:busyEnd,all_day:true};
    }

    return {start:rawStart,end:rawEnd,all_day:false};
  });
}

async function computeCommonSlots(ids,start,end,duration,step,maxResults=20){
  const [whRes,setRes,...busyLists]=await Promise.all([
    supabase.from('working_hours').select('user_id,day_of_week,start_time,end_time,is_active').in('user_id',ids).eq('is_active',true),
    supabase.from('scheduling_settings').select('*').eq('id',1).maybeSingle(),
    ...ids.map(id=>getUserBusySlots(id,start,end))
  ]);
  if(whRes.error)throw whRes.error;
  if(setRes.error)throw setRes.error;

  const settings=setRes.data||{};
  const defStart=hmToMinutes(settings.default_day_start||'08:00');
  const defEnd=hmToMinutes(settings.default_day_end||'18:00');
  const lunchStart=hmToMinutes(settings.lunch_start||'12:00');
  const lunchEnd=hmToMinutes(settings.lunch_end||'14:00');
  const excludeLunch=settings.exclude_lunch!==false;

  const whByUser=new Map(ids.map(id=>[id,[]]));
  (whRes.data||[]).forEach(r=>whByUser.get(r.user_id)?.push(r));
  const busyByUser=new Map(ids.map((id,i)=>[id,busyLists[i]||[]]));

  const results=[];
  const day=new Date(start);
  day.setHours(0,0,0,0);

  while(day<=end && results.length<maxResults){
    const dow=isoDay(day);
    const userWindows=ids.map(id=>{
      const all=whByUser.get(id)||[];
      const custom=all.filter(r=>Number(r.day_of_week)===dow)
        .map(r=>({start:hmToMinutes(r.start_time),end:hmToMinutes(r.end_time)}));
      const windows=all.length ? custom : ((dow>=1&&dow<=5)?[{start:defStart,end:defEnd}]:[]);
      return {id,windows};
    });

    const everyHasWork=userWindows.every(x=>x.windows.length>0);
    if(everyHasWork){
      const scanStart=Math.max(...userWindows.map(x=>Math.min(...x.windows.map(w=>w.start))));
      const scanEnd=Math.min(...userWindows.map(x=>Math.max(...x.windows.map(w=>w.end))));

      for(let mins=scanStart;mins+duration<=scanEnd && results.length<maxResults;mins+=step){
        const slotStart=atMinutes(day,mins);
        const slotEnd=new Date(slotStart.getTime()+duration*60000);
        if(slotStart<start || slotEnd>end || slotStart<new Date())continue;
        if(excludeLunch && overlaps(mins,mins+duration,lunchStart,lunchEnd))continue;

        let ok=true;
        for(const {id,windows} of userWindows){
          if(!windows.some(w=>mins>=w.start && mins+duration<=w.end)){ok=false;break;}
          if((busyByUser.get(id)||[]).some(b=>overlaps(slotStart,slotEnd,b.start,b.end))){ok=false;break;}
        }
        if(ok)results.push({slot_start:slotStart.toISOString(),slot_end:slotEnd.toISOString()});
      }
    }
    day.setDate(day.getDate()+1);
  }
  return results;
}


async function searchSlots(e) {
  e.preventDefault();
  const slotGroupId=$('slotGroupFilter').value;
  const ids=slotGroupId ? techniciansInGroup(slotGroupId).map(p=>p.id) : selectedTeamIds();
  if(!ids.length){showToast(slotGroupId?'Ce groupe ne contient aucun technicien actif.':'Sélectionne au moins un technicien.');return;}

  const start=new Date(`${$('slotStartDate').value}T00:00:00`);
  const end=new Date(`${$('slotEndDate').value}T23:59:59`);
  const duration=Number($('slotDuration').value);
  const step=Number($('slotStep').value);
  $('slotResults').innerHTML='<div class="empty">Analyse précise des calendriers…</div>';

  try{
    const data=await computeCommonSlots(ids,start,end,duration,step,20);
    if(!data.length){
      $('slotResults').innerHTML='<div class="empty">Aucun créneau réellement commun trouvé sur cette période.</div>';
      return;
    }

    const names=ids.map(id=>profiles.find(p=>p.id===id)).filter(Boolean).map(profileName);
    const scopeLabel=slotGroupId ? `groupe ${groups.find(g=>g.id===slotGroupId)?.name||''}` : names.join(', ');
    $('slotResults').innerHTML=
      `<div class="availability-meta">Calcul pour <strong>${escapeHtml(scopeLabel)}</strong> : rendez-vous propriétaires + participations + horaires de travail + pause déjeuner.</div>`+
      data.map((s,i)=>{
        const a=new Date(s.slot_start),b=new Date(s.slot_end);
        return `<div class="slot-card"><div>
          <strong>${fmtDate(a,{weekday:'long',day:'2-digit',month:'long'})}</strong>
          <span class="muted">${fmtTime(a)} → ${fmtTime(b)}</span>
          <div class="slot-reason">Tous les techniciens sélectionnés sont libres.</div>
        </div><button class="small-btn" data-slot-index="${i}">Créer une réunion</button></div>`;
      }).join('');

    $('slotResults').querySelectorAll('[data-slot-index]').forEach(btn=>btn.addEventListener('click',()=>{
      const s=data[Number(btn.dataset.slotIndex)];
      const a=new Date(s.slot_start);
      openNewEvent(a,currentProfile.id,ids);
      $('eventEnd').value=toLocalInput(new Date(s.slot_end));
      $('eventTitle').value='Réunion';
    }));
  }catch(err){
    $('slotResults').innerHTML=`<div class="error">Recherche impossible : ${escapeHtml(err?.message||String(err))}</div>`;
  }
}


function teamExportEvents(){
  const ids=selectedTeamIds(),seen=new Map();
  teamEvents.forEach(ev=>{
    if(ids.includes(ev.owner_id)||(ev.participant_user_ids||[]).some(id=>ids.includes(id)))seen.set(ev.id,ev);
  });
  return [...seen.values()].sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
}
function exportTeamCsv(){exportRowsCsv(eventRows(teamExportEvents()),`Planning-Equipe-${$('teamDate').value}.csv`);}
function exportTeamIcs(){downloadText(`Planning-Equipe-${$('teamDate').value}.ics`,eventsToIcs(teamExportEvents(),'Planning Équipe MDL'),'text/calendar;charset=utf-8');}

function exportTeamPlanningExcel() {
  const ids=selectedTeamIds();
  if(!ids.length){showToast('Sélectionne au moins un technicien.');return;}
  const start=new Date(`${$('teamDate').value}T00:00:00`);
  const days=Math.max(1,Number($('teamRange').value)||5);
  const end=addDays(start,days);

  const rows=[];
  for(const userId of ids){
    const user=profiles.find(p=>p.id===userId);
    const userEvents=teamEvents.filter(ev=>
      (ev.owner_id===userId || (ev.participant_user_ids||[]).includes(userId)) &&
      new Date(ev.starts_at)<end && new Date(ev.ends_at)>start
    );
    for(const ev of userEvents){
      rows.push({
        'Technicien':profileName(user),
        'Groupes':groupNamesForUser(userId).join(', '),
        'Début':fmtDate(new Date(ev.starts_at),{day:'2-digit',month:'2-digit',year:'numeric'})+' '+fmtTime(new Date(ev.starts_at)),
        'Fin':fmtDate(new Date(ev.ends_at),{day:'2-digit',month:'2-digit',year:'numeric'})+' '+fmtTime(new Date(ev.ends_at)),
        'Titre':ev.title||'',
        'Type':eventTypes.find(t=>t.id===ev.event_type_id)?.name||'',
        'Lieu':ev.location||'',
        'Statut':ev.status||'',
        'Participation':ev.owner_id===userId?'Propriétaire':'Participant'
      });
    }
  }

  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'Information':'Aucun événement sur la période.'}]);
  ws['!cols']=[{wch:26},{wch:30},{wch:20},{wch:20},{wch:34},{wch:20},{wch:28},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb,ws,'Planning équipe');
  XLSX.writeFile(wb,`Planning-Equipe-${toDateInput(start)}-${toDateInput(addDays(end,-1))}.xlsx`,{compression:true});
  showToast('Export Excel généré.');
}


async function loadMySettings(){
  $('shareCalendarToggle').checked=!!currentProfile.share_calendar;
  $('shareModeSelect').value=currentProfile.calendar_share_mode||'details';
  $('shareModeSelect').disabled=!currentProfile.share_calendar;
  $('myAccountSummary').innerHTML=`
    <div class="account-line"><span>Nom</span><strong>${escapeHtml(profileName(currentProfile))}</strong></div>
    <div class="account-line"><span>Rôle</span><strong>${escapeHtml(roleLabel(currentProfile.role))}</strong></div>
    <div class="account-line"><span>Accès global</span><strong>${currentProfile.has_global_scope?'Oui':'Non'}</strong></div>
    <div class="account-line"><span>Groupes</span><strong>${escapeHtml(groupNamesForUser(currentProfile.id).join(', ')||'Aucun')}</strong></div>`;
}
async function saveMySharing(){
  const share=$('shareCalendarToggle').checked,mode=$('shareModeSelect').value;
  $('sharingStatus').textContent='Enregistrement…';
  const {error}=await supabase.rpc('update_my_calendar_sharing',{new_share_calendar:share,new_share_mode:mode});
  if(error){$('sharingStatus').textContent=error.message;return;}
  currentProfile.share_calendar=share;currentProfile.calendar_share_mode=mode;
  $('sharingStatus').textContent='Préférences enregistrées.';
  showToast('Préférences enregistrées.');
}
function renderEventTypesAdmin(){
  if(!$('eventTypesAdminList'))return;
  $('eventTypesAdminList').innerHTML=eventTypes.length?eventTypes.map(t=>{
    const used=(events||[]).filter(ev=>ev.event_type_id===t.id).length;
    return `<div class="simple-row type-admin-row">
      <div><span class="type-color-dot" style="background:${escapeHtml(t.color||'#5b4fd6')}"></span><strong>${escapeHtml(t.name)}</strong><div class="muted tiny">${escapeHtml(t.description||'')}${used?` · ${used} rendez-vous`:''}</div></div>
      <div class="admin-row-actions">
        <button class="ghost" data-edit-type="${t.id}">Modifier</button>
        <button class="danger-btn compact-danger" data-direct-delete-type="${t.id}">Supprimer</button>
      </div>
    </div>`;
  }).join(''):'<div class="empty">Aucun type.</div>';
  document.querySelectorAll('[data-edit-type]').forEach(b=>b.addEventListener('click',()=>openEventTypeDialog(b.dataset.editType)));
  document.querySelectorAll('[data-direct-delete-type]').forEach(b=>b.addEventListener('click',()=>deleteEventTypeById(b.dataset.directDeleteType)));
}
function openEventTypeDialog(id=null){
  const t=id?eventTypes.find(x=>x.id===id):null;
  $('eventTypeAdminId').value=t?.id||'';
  $('eventTypeDialogTitle').textContent=t?'Modifier le type':'Nouveau type';
  $('eventTypeAdminName').value=t?.name||'';
  $('eventTypeAdminDescription').value=t?.description||'';
  $('eventTypeAdminColor').value=t?.color||'#5b4fd6';
  $('eventTypeAdminActive').checked=t?.is_active!==false;
  $('deleteEventTypeBtn').hidden=!t;
  $('eventTypeAdminError').hidden=true;
  $('eventTypeDialog').showModal();
}
async function saveEventTypeAdmin(e){
  e.preventDefault();
  const id=$('eventTypeAdminId').value;
  const payload={name:$('eventTypeAdminName').value.trim(),description:$('eventTypeAdminDescription').value.trim()||null,color:$('eventTypeAdminColor').value,is_active:$('eventTypeAdminActive').checked};
  let res=id?await supabase.from('event_types').update(payload).eq('id',id):await supabase.from('event_types').insert(payload);
  if(res.error){$('eventTypeAdminError').textContent=res.error.message;$('eventTypeAdminError').hidden=false;return;}
  $('eventTypeDialog').close();await loadReferenceData();renderEventTypesAdmin();showToast('Type enregistré.');
}
async function deleteEventTypeById(id,fromDialog=false){
  const t=eventTypes.find(x=>x.id===id);if(!t)return;
  if(!isAdmin()){showToast('Seul un administrateur peut supprimer un type de rendez-vous.');return}
  const used=(events||[]).filter(ev=>ev.event_type_id===id).length;
  const msg=used
    ? `Le type « ${t.name} » est utilisé par ${used} rendez-vous.\n\nLes rendez-vous seront conservés, mais leur catégorie sera retirée.\n\nSaisis SUPPRIMER pour confirmer :`
    : `Supprimer définitivement le type « ${t.name} » ?\n\nSaisis SUPPRIMER pour confirmer :`;
  if(prompt(msg)!=='SUPPRIMER')return;
  const {data,error}=await supabase.rpc('admin_delete_event_type',{target_type_id:id});
  if(error){
    if(fromDialog){$('eventTypeAdminError').textContent=error.message;$('eventTypeAdminError').hidden=false;}
    else showToast(`Suppression impossible : ${error.message}`,7000);
    return;
  }
  if(fromDialog)$('eventTypeDialog').close();
  await loadReferenceData();
  await loadCalendarEvents();
  renderCalendar();
  renderEventTypesAdmin();
  showToast(data||'Type supprimé.');
}
async function deleteEventTypeAdmin(){
  const id=$('eventTypeAdminId').value;if(!id)return;
  await deleteEventTypeById(id,true);
}
async function loadSchedulingSettings(){
  const {data,error}=await supabase.from('scheduling_settings').select('*').eq('id',1).maybeSingle();
  if(error)return;
  schedulingSettings=data;
  if(!data)return;
  $('schedDayStart').value=String(data.default_day_start||'08:00').slice(0,5);
  $('schedDayEnd').value=String(data.default_day_end||'18:00').slice(0,5);
  $('schedExcludeLunch').checked=data.exclude_lunch!==false;
  $('schedLunchStart').value=String(data.lunch_start||'12:00').slice(0,5);
  $('schedLunchEnd').value=String(data.lunch_end||'14:00').slice(0,5);
  $('schedStep').value=String(data.default_slot_step_minutes||15);
}
async function saveSchedulingSettings(e){
  e.preventDefault();
  const payload={default_day_start:$('schedDayStart').value,default_day_end:$('schedDayEnd').value,exclude_lunch:$('schedExcludeLunch').checked,lunch_start:$('schedLunchStart').value,lunch_end:$('schedLunchEnd').value,default_slot_step_minutes:Number($('schedStep').value)};
  const {error}=await supabase.from('scheduling_settings').update(payload).eq('id',1);
  if(error){showToast(error.message,5000);return;}
  await loadSchedulingSettings();showToast('Horaires enregistrés.');
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
    ? groups.map(g=>{
        const memberCount=(profiles||[]).filter(p=>(p.group_ids||[]).includes(g.id)).length;
        return `<div class="list-row group-admin-row">
          <div class="row-main">
            <div>
              <strong>${escapeHtml(g.name)}</strong>
              <div class="muted">${memberCount} membre${memberCount>1?'s':''}${g.description?` · ${escapeHtml(g.description)}`:''}</div>
            </div>
            <div class="admin-row-actions">
              <span class="badge">${g.is_active?'Actif':'Inactif'}</span>
              <button class="danger-btn compact-danger" data-delete-group="${g.id}">Supprimer</button>
            </div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Aucun groupe.</div>';
  $('groupsList').querySelectorAll('[data-delete-group]').forEach(b=>b.addEventListener('click',()=>deleteGroupAdmin(b.dataset.deleteGroup)));

  if(!usersError) renderAdminUsers();
  renderEventTypesAdmin();
  await loadSchedulingSettings();
}


async function deleteGroupAdmin(id){
  if(!isAdmin()){showToast('Seul un administrateur peut supprimer un groupe.');return}
  const g=groups.find(x=>x.id===id); if(!g)return;
  const memberCount=(profiles||[]).filter(p=>(p.group_ids||[]).includes(id)).length;
  const message=memberCount
    ? `Le groupe « ${g.name} » contient ${memberCount} membre${memberCount>1?'s':''}.\n\nLa suppression retirera le groupe de ces utilisateurs et supprimera aussi les droits de planification liés à ce groupe.\n\nLes utilisateurs et leurs calendriers NE seront PAS supprimés.\n\nSaisis SUPPRIMER pour confirmer :`
    : `Supprimer définitivement le groupe « ${g.name} » ?\n\nSaisis SUPPRIMER pour confirmer :`;
  const typed=prompt(message);
  if(typed!=='SUPPRIMER')return;
  const {data,error}=await supabase.rpc('admin_delete_group',{target_group_id:id});
  if(error){showToast(`Suppression impossible : ${error.message}`,7000);return}
  showToast(data||'Groupe supprimé.');
  await loadReferenceData();
  await loadAdmin();
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
          <button class="danger-btn" data-delete-user="${u.id}" ${self||protectedAdmin?'disabled':''}>Supprimer</button>
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
  $('deleteUserSummary').innerHTML=`<strong>${escapeHtml(profileName(u))}</strong><div class="muted">${escapeHtml(u.email||'')}</div><p>L’archive Excel est obligatoire avant suppression. Elle contient l’identité, les groupes et le calendrier. Les rendez-vous dont cette personne est propriétaire seront ensuite supprimés.</p>`;
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


function initials(name='U'){
  return String(name).trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'U';
}
function weekRangeFrom(date,days=5){
  const start=startOfWeek(date);
  return {start,end:addDays(start,days),days};
}
function thisWeekEvents(){
  const {start,end}=weekRangeFrom(new Date(),7);
  return (events||[]).filter(ev=>new Date(ev.starts_at)<end && new Date(ev.ends_at)>start && ev.status!=='cancelled');
}
function updateDashboardMetrics(){
  const techs=profiles.filter(p=>p.role==='technicien'&&p.is_active!==false);
  const week=thisWeekEvents();
  const hours=week.filter(e=>!e.all_day).reduce((s,e)=>s+Math.max(0,(new Date(e.ends_at)-new Date(e.starts_at))/3600000),0);
  const totalCapacity=Math.max(1,techs.length*5*8);
  $('metricTechnicians').textContent=techs.length;
  $('metricGroups').textContent=`${groups.length} groupe${groups.length>1?'s':''}`;
  $('metricMeetings').textContent=week.length;
  $('metricHours').textContent=`${Math.round(hours)} h`;
  $('metricOccupancy').textContent=`${Math.min(100,Math.round(hours/totalCapacity*100))} %`;
  $('metricAvailability').textContent=Math.max(0,techs.length-Math.min(techs.length,week.filter(e=>sameDay(new Date(e.starts_at),new Date())).length));
}
function dashboardDefaultSelection(){
  const techs=profiles.filter(p=>p.role==='technicien'&&p.is_active!==false);
  if(!dashboardSelectedIds.size) techs.slice(0,5).forEach(p=>dashboardSelectedIds.add(p.id));
}
function renderDashboardGroups(){
  const host=$('dashboardGroups'); if(!host)return;
  host.innerHTML=groups.filter(g=>g.is_active!==false).slice(0,4).map(g=>{
    const members=techniciansInGroup(g.id);
    return `<div class="dash-group-card">
      <div class="dash-group-top">
        <div class="dash-group-icon">👥</div>
        <div><strong>${escapeHtml(g.name)}</strong><small>${members.length} technicien${members.length>1?'s':''}</small></div>
      </div>
      <div class="dash-group-actions">
        <button data-dash-group-view="${g.id}">Afficher</button>
        <button class="select" data-dash-group-select="${g.id}">Sélectionner</button>
      </div>
    </div>`;
  }).join('')||'<div class="empty">Aucun groupe.</div>';
  host.querySelectorAll('[data-dash-group-view]').forEach(b=>b.addEventListener('click',()=>{
    dashboardSelectedIds=new Set(techniciansInGroup(b.dataset.dashGroupView).map(p=>p.id));
    renderDashboardParticipants(); renderDashboardPlanning();
  }));
  host.querySelectorAll('[data-dash-group-select]').forEach(b=>b.addEventListener('click',()=>{
    dashboardSelectedIds=new Set(techniciansInGroup(b.dataset.dashGroupSelect).map(p=>p.id));
    renderDashboardParticipants(); renderDashboardPlanning();
  }));
}
function dashboardEventsForUser(userId,start,end){
  return teamEvents.filter(ev=>{
    const applies=ev.owner_id===userId || (ev.participant_user_ids||[]).includes(userId);
    return applies && new Date(ev.starts_at)<end && new Date(ev.ends_at)>start && ev.status!=='cancelled';
  });
}
async function refreshDashboardPlanning(){
  dashboardDefaultSelection();
  const ids=[...dashboardSelectedIds];
  const {start,end}=weekRangeFrom(dashboardCursor,dashboardRangeDays);
  try{
    teamEvents=await loadTeamEvents(ids,start,end);
  }catch(e){
    $('dashboardTeamSchedule').innerHTML=`<div class="error">${escapeHtml(e.message||String(e))}</div>`;
    return;
  }
  renderDashboardPlanning();
  renderDashboardUpcoming();
  updateDashboardMetrics();
}
function renderDashboardPlanning(){
  const ids=[...dashboardSelectedIds];
  const users=ids.map(id=>profiles.find(p=>p.id===id)).filter(Boolean);
  const {start,end,days}=weekRangeFrom(dashboardCursor,dashboardRangeDays);
  $('dashDateLabel').textContent=`${fmtDate(start,{day:'2-digit',month:'short'})} – ${fmtDate(addDays(start,days-1),{day:'2-digit',month:'short',year:'numeric'})}`;
  $('dashboardPlanningCaption').textContent=`${users.length} technicien${users.length>1?'s':''} sélectionné${users.length>1?'s':''}`;
  let html=`<div class="dashboard-team-table" style="--dash-days:${days}"><div class="dash-head"><div>Technicien</div>`;
  for(let d=0;d<days;d++){const day=addDays(start,d);html+=`<div>${escapeHtml(fmtDate(day,{weekday:'short',day:'2-digit',month:'short'}))}</div>`}
  html+='</div>';
  for(const u of users){
    html+=`<div class="dash-row"><div class="dash-person"><div class="dash-avatar">${escapeHtml(initials(profileName(u)))}</div><div><strong>${escapeHtml(profileName(u))}</strong><small>${escapeHtml(roleLabel(u.role))}</small></div></div>`;
    for(let d=0;d<days;d++){
      const day=addDays(start,d),dayEnd=addDays(day,1);
      const list=dashboardEventsForUser(u.id,day,dayEnd).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
      html+='<div class="dash-cell">';
      if(!list.length)html+='<span class="dash-free">Libre</span>';
      list.slice(0,3).forEach(ev=>{
        const type=eventTypes.find(t=>t.id===ev.event_type_id);
        const time=ev.all_day?'Journée entière':`${fmtTime(new Date(ev.starts_at))} – ${fmtTime(new Date(ev.ends_at))}`;
        html+=`<button class="dash-event" data-dash-event="${ev.id}" style="border-left-color:${escapeHtml(eventColor(ev))}"><span>${escapeHtml(time)}</span><strong>${escapeHtml(ev.title)}</strong>${ev.location?`<span>${escapeHtml(ev.location)}</span>`:''}${type?`<span class="event-badge">${escapeHtml(type.name)}</span>`:''}</button>`;
      });
      html+='</div>';
    }
    html+='</div>';
  }
  html+='</div>';
  $('dashboardTeamSchedule').innerHTML=html;
  $('dashboardTeamSchedule').querySelectorAll('[data-dash-event]').forEach(b=>b.addEventListener('click',()=>openEventById(b.dataset.dashEvent)));
}
function renderDashboardParticipants(){
  const host=$('dashboardParticipants'); if(!host)return;
  const ids=[...dashboardSelectedIds];
  host.innerHTML=ids.map(id=>profiles.find(p=>p.id===id)).filter(Boolean).map(p=>`<span class="participant-chip">${escapeHtml(profileName(p))}</span>`).join('')||'<span class="muted">Aucun participant</span>';
  $('dashboardSlotCaption').textContent=`${ids.length} participant${ids.length>1?'s':''}`;
}
async function dashboardSearchSlots(){
  const ids=[...dashboardSelectedIds];
  if(!ids.length){showToast('Sélectionne au moins un technicien.');return;}
  const start=new Date(`${$('dashSlotStart').value}T00:00:00`);
  const end=new Date(`${$('dashSlotEnd').value}T23:59:59`);
  const duration=Number($('dashSlotDuration').value),step=Number($('dashSlotStep').value);
  $('dashboardSlotResults').innerHTML='<div class="slot-mini muted-box">Recherche…</div>';
  try{
    dashboardSlotData=await computeCommonSlots(ids,start,end,duration,step,6);
    if(!dashboardSlotData.length){$('dashboardSlotResults').innerHTML='<div class="slot-mini muted-box">Aucun créneau commun.</div>';return;}
    $('dashboardSlotResults').innerHTML=dashboardSlotData.map((s,i)=>{const a=new Date(s.slot_start),b=new Date(s.slot_end);return `<button class="slot-mini" data-dash-slot="${i}"><span>${escapeHtml(fmtDate(a,{weekday:'short',day:'2-digit',month:'short'}))}</span><strong>${fmtTime(a)} – ${fmtTime(b)}</strong></button>`}).join('');
    $('dashboardSlotResults').querySelectorAll('[data-dash-slot]').forEach(b=>b.addEventListener('click',()=>{const s=dashboardSlotData[Number(b.dataset.dashSlot)];openNewEvent(new Date(s.slot_start),currentProfile.id,ids);$('eventEnd').value=toLocalInput(new Date(s.slot_end));$('eventTitle').value='Réunion';}));
  }catch(e){$('dashboardSlotResults').innerHTML=`<div class="slot-mini muted-box">${escapeHtml(e.message||String(e))}</div>`}
}
function renderDashboardUpcoming(){
  const host=$('dashboardUpcoming'); if(!host)return;
  const now=new Date();
  const list=[...events].filter(e=>new Date(e.ends_at)>=now&&e.status!=='cancelled').sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,5);
  host.innerHTML=list.map(e=>`<button class="upcoming-item" data-upcoming="${e.id}"><small>${escapeHtml(fmtDate(new Date(e.starts_at),{weekday:'long',day:'2-digit',month:'short'}))} · ${e.all_day?'Journée entière':fmtTime(new Date(e.starts_at))}</small><strong>${escapeHtml(e.title)}</strong>${e.location?`<small>${escapeHtml(e.location)}</small>`:''}</button>`).join('')||'<div class="empty">Aucune réunion à venir.</div>';
  host.querySelectorAll('[data-upcoming]').forEach(b=>b.addEventListener('click',()=>openEventById(b.dataset.upcoming)));
}
function renderGroupsPage(){
  const h=$('groupsPageGrid'); if(!h)return;
  h.innerHTML=groups.map(g=>`<article class="page-card"><h3>${escapeHtml(g.name)}</h3><p>${escapeHtml(g.description||'')}</p><strong>${techniciansInGroup(g.id).length} technicien(s)</strong></article>`).join('');
}
function renderTechniciansPage(){
  const h=$('techniciansPageGrid'); if(!h)return;
  h.innerHTML=profiles.filter(p=>p.role==='technicien').map(p=>`<article class="page-card"><h3>${escapeHtml(profileName(p))}</h3><p>${escapeHtml(groupNamesForUser(p.id).join(', ')||'Sans groupe')}</p><strong>${p.is_active===false?'Inactif':'Actif'}</strong></article>`).join('');
}
function updateHeaderIdentity(){
  if(!$('headerAvatar'))return;
  $('headerAvatar').textContent=initials(profileName(currentProfile));
  $('welcomeTitle').textContent=profileName(currentProfile);
  $('roleChip').textContent=roleLabel(currentProfile.role);
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!roleCanManageUsers());
  if($('adminSideTitle')) $('adminSideTitle').hidden=!roleCanManageUsers();
}

function updateConnectionUi(){
  const offline=!navigator.onLine;
  if($('connectionBanner')) $('connectionBanner').hidden=!offline;
  if($('syncNowBtn')){
    $('syncNowBtn').classList.toggle('offline',offline);
    $('syncNowBtn').title=offline?'Hors connexion':'Synchroniser';
  }
}
window.addEventListener('online',()=>{updateConnectionUi();showToast('Connexion rétablie.');synchronizeApp(false);});
window.addEventListener('offline',()=>{updateConnectionUi();showToast('Connexion perdue. Mode consultation limitée.',5000);});
updateConnectionUi();

async function synchronizeApp(showMessage=true){
  if(!navigator.onLine){updateConnectionUi();if(showMessage)showToast('Pas de connexion réseau.');return false}
  const btn=$('syncNowBtn');
  if(btn){btn.disabled=true;btn.classList.add('spinning')}
  try{
    await loadReferenceData();
    await loadCalendarEvents();
    renderCalendar();
    if(roleCanManageTeam()){
      renderTeamUsers();
      if(currentMainView==='team')await refreshTeamSchedule();
    }
    if(currentMainView==='dashboard'){
      await refreshDashboardPlanning();
      renderDashboardGroups();
      renderDashboardParticipants();
    }
    buildLocalNotifications();
    lastSuccessfulSync=new Date();
    if(showMessage)showToast('Données synchronisées.');
    return true;
  }catch(err){
    console.error('Synchronisation',err);
    if(showMessage)showToast(`Synchronisation impossible : ${err?.message||err}`,6000);
    return false;
  }finally{
    if(btn){btn.disabled=false;btn.classList.remove('spinning')}
  }
}

function browserLabel(){
  const ua=navigator.userAgent||'';
  if(/Android/i.test(ua))return 'Android';
  if(/iPhone|iPad/i.test(ua))return 'iOS/iPadOS';
  if(/Windows/i.test(ua))return 'Windows';
  if(/Macintosh/i.test(ua))return 'macOS';
  return 'Navigateur Web';
}
async function runDiagnostics(showMessage=true){
  const rows=[];
  const add=(label,value,ok=true)=>rows.push({label,value:String(value),ok});
  add('Version',APP_VERSION,true);
  add('Connexion',navigator.onLine?'En ligne':'Hors ligne',navigator.onLine);
  add('Plateforme',browserLabel(),true);
  add('HTTPS',location.protocol==='https:'?'Oui':'Non',location.protocol==='https:');
  add('Service Worker','serviceWorker' in navigator?'Disponible':'Indisponible','serviceWorker' in navigator);
  add('PWA installée',window.matchMedia('(display-mode: standalone)').matches?'Oui':'Non',true);
  add('Notifications',('Notification' in window)?Notification.permission:'Non prises en charge',('Notification' in window));
  let storageOk=false;
  try{
    localStorage.setItem('mdl_storage_test','ok');
    storageOk=localStorage.getItem('mdl_storage_test')==='ok';
    localStorage.removeItem('mdl_storage_test');
  }catch{}
  add('Mémoire locale',storageOk?'OK':'Indisponible',storageOk);
  add('Utilisateur',currentProfile?profileName(currentProfile):'Non connecté',!!currentProfile);
  add('Rôle',currentProfile?roleLabel(currentProfile.role):'—',!!currentProfile);
  add('Utilisateurs chargés',profiles.length,profiles.length>0);
  add('Groupes chargés',groups.length,true);
  add('Types de rendez-vous',eventTypes.length,eventTypes.length>0);
  add('Dernière synchro',lastSuccessfulSync?lastSuccessfulSync.toLocaleString('fr-FR'):'Cette session',true);

  let dbOk=false;
  try{
    const {error}=await supabase.from('profiles').select('id',{head:true,count:'exact'}).limit(1);
    dbOk=!error;
  }catch{}
  add('Accès Supabase',dbOk?'OK':'Échec',dbOk);

  diagnosticsText=[
    `Calendrier Équipe MDL v${APP_VERSION}`,
    ...rows.map(r=>`${r.ok?'OK':'ERREUR'} | ${r.label} : ${r.value}`)
  ].join('\n');

  if($('diagnosticsSummary')){
    $('diagnosticsSummary').innerHTML=rows.map(r=>`<div class="account-line diagnostic-line"><span>${escapeHtml(r.label)}</span><strong class="${r.ok?'diag-ok':'diag-ko'}">${escapeHtml(r.value)}</strong></div>`).join('');
  }
  if($('diagnosticsStatus'))$('diagnosticsStatus').textContent=dbOk?'Contrôle terminé. Aucun blocage détecté.':'Contrôle terminé avec au moins une anomalie.';
  if(showMessage)showToast(dbOk?'Diagnostic terminé.':'Diagnostic : anomalie détectée.',5000);
  return dbOk;
}
async function copyDiagnostics(){
  if(!diagnosticsText)await runDiagnostics(false);
  try{
    await navigator.clipboard.writeText(diagnosticsText);
    showToast('Diagnostic copié.');
  }catch{
    showToast('Copie automatique impossible.');
  }
}

async function setMainView(view){
  const valid=['dashboard','agenda','team','groups','technicians','settings','admin'];
  if(!valid.includes(view)) return;

  if(view==='admin' && !roleCanManageUsers()){
    showToast('Accès administration non autorisé.');
    return;
  }
  if((view==='team') && !roleCanManageTeam()){
    showToast('Accès au planning équipe non autorisé.');
    return;
  }

  currentMainView=view;

  valid.forEach(v=>{
    const el=$(v+'Panel');
    if(el) el.hidden=(v!==view);
  });

  document.querySelectorAll('.side-link[data-view],.mobile-link[data-view]').forEach(b=>{
    b.classList.toggle('active',b.dataset.view===view);
  });

  try{
    if(view==='dashboard'){
      await refreshDashboardPlanning();
      renderDashboardGroups();
      renderDashboardParticipants();
    } else if(view==='agenda'){
      await loadCalendarEvents();
      renderCalendar();
    } else if(view==='team'){
      renderTeamUsers();
      await refreshTeamSchedule();
    } else if(view==='groups'){
      renderGroupsPage();
    } else if(view==='technicians'){
      renderTechniciansPage();
    } else if(view==='settings'){
      const tasks=[
        ['Compte',loadMySettings],
        ['Horaires',prepareWorkingHoursSettings],
        ['Notifications',loadNotificationSettings],
        ['Diagnostic',()=>runDiagnostics(false)]
      ];
      for(const [label,fn] of tasks){
        try{await fn()}catch(err){console.error(`Réglages ${label}`,err)}
      }
    } else if(view==='admin'){
      await loadAdmin();
    }
  }catch(err){
    console.error('Navigation',view,err);
    showToast(`Ouverture impossible : ${err?.message||err}`,5000);
  }
}

function initDashboardBindings(){
  if(window.__dashboardBindingsReady)return;
  window.__dashboardBindingsReady=true;
  const today=new Date();$('dashSlotStart').value=toDateInput(today);$('dashSlotEnd').value=toDateInput(addDays(today,7));
  $('dashPrevBtn').addEventListener('click',()=>{dashboardCursor=addDays(dashboardCursor,-dashboardRangeDays);refreshDashboardPlanning()});
  $('dashNextBtn').addEventListener('click',()=>{dashboardCursor=addDays(dashboardCursor,dashboardRangeDays);refreshDashboardPlanning()});
  $('dashDayBtn').addEventListener('click',()=>{dashboardRangeDays=1;document.querySelectorAll('#dashWeekBtn,#dashDayBtn,#dashMonthBtn').forEach(x=>x.classList.remove('active'));$('dashDayBtn').classList.add('active');refreshDashboardPlanning()});
  $('dashWeekBtn').addEventListener('click',()=>{dashboardRangeDays=5;document.querySelectorAll('#dashWeekBtn,#dashDayBtn,#dashMonthBtn').forEach(x=>x.classList.remove('active'));$('dashWeekBtn').classList.add('active');refreshDashboardPlanning()});
  $('dashMonthBtn').addEventListener('click',()=>{dashboardRangeDays=7;document.querySelectorAll('#dashWeekBtn,#dashDayBtn,#dashMonthBtn').forEach(x=>x.classList.remove('active'));$('dashMonthBtn').classList.add('active');refreshDashboardPlanning()});
  $('dashSearchAvailabilityBtn').addEventListener('click',dashboardSearchSlots);
  $('dashboardCreateMeetingBtn').addEventListener('click',()=>{const ids=[...dashboardSelectedIds];openNewEvent(new Date(),currentProfile.id,ids)});
  $('viewAllGroupsBtn').addEventListener('click',()=>setMainView('groups'));
  $('viewAgendaBtn').addEventListener('click',()=>setMainView('agenda'));
  $('globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){setMainView('agenda');$('agendaSearch').value=e.target.value;renderCalendar()}});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('globalSearch').focus()}});
}


function installNavigationDelegation(){
  if(window.__mdlNavDelegationReady) return;
  window.__mdlNavDelegationReady=true;

  document.addEventListener('click',async e=>{
    const nav=e.target.closest('.side-link[data-view], .mobile-link[data-view]');
    if(!nav) return;
    e.preventDefault();
    e.stopPropagation();
    await setMainView(nav.dataset.view);
  });
}

installNavigationDelegation();

document.addEventListener('click',e=>{
  const btn=e.target.closest('#quickCreateEventBtn,#sideExportXlsx,#sideExportCsv,#sideExportIcs');
  if(!btn)return;
  e.preventDefault();
  if(btn.id==='quickCreateEventBtn') openNewEvent(new Date());
  if(btn.id==='sideExportXlsx') exportTeamPlanningExcel();
  if(btn.id==='sideExportCsv') exportTeamCsv();
  if(btn.id==='sideExportIcs') exportTeamIcs();
});



const WEEK_DAYS=[
  [1,'Lundi'],[2,'Mardi'],[3,'Mercredi'],[4,'Jeudi'],[5,'Vendredi'],[6,'Samedi'],[7,'Dimanche']
];

function absenceTypeOptions(){
  const preferred=eventTypes.filter(t=>/absence|congé|conge|repos|rtt/i.test(`${t.name} ${t.description||''}`));
  const list=preferred.length?preferred:eventTypes;
  return list.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}
function openAbsenceDialog(){
  const today=toDateInput(new Date());
  $('absenceStart').value=today;$('absenceEnd').value=today;
  $('absenceTitle').value='Absence';$('absenceDescription').value='';$('absenceError').hidden=true;
  const owners=roleCanManageTeam()?profiles.filter(p=>p.is_active!==false):[currentProfile];
  $('absenceOwner').innerHTML=owners.map(p=>`<option value="${p.id}">${escapeHtml(profileName(p))}</option>`).join('');
  $('absenceOwner').value=currentProfile.id;
  $('absenceOwnerWrap').hidden=!roleCanManageTeam();
  $('absenceType').innerHTML=absenceTypeOptions();
  const preferred=eventTypes.find(t=>/absence|congé|conge/i.test(t.name));
  if(preferred)$('absenceType').value=preferred.id;
  $('absenceDialog').showModal();
}
async function saveAbsence(e){
  e.preventDefault();
  const start=$('absenceStart').value,end=$('absenceEnd').value;
  if(!start||!end||end<start){$('absenceError').textContent='La date de fin doit être égale ou postérieure au début.';$('absenceError').hidden=false;return}
  const a=new Date(`${start}T00:00:00`), b=addDays(new Date(`${end}T00:00:00`),1);
  const payload={
    owner_id:$('absenceOwner').value||currentProfile.id,
    created_by:currentProfile.id,
    event_type_id:$('absenceType').value||null,
    title:$('absenceTitle').value.trim()||'Absence',
    description:$('absenceDescription').value.trim()||null,
    location:null,starts_at:a.toISOString(),ends_at:b.toISOString(),
    all_day:true,status:$('absenceTentative').checked?'tentative':'confirmed',visibility:'normal'
  };
  const {error}=await supabase.from('events').insert(payload);
  if(error){$('absenceError').textContent=error.message;$('absenceError').hidden=false;return}
  $('absenceDialog').close();showToast('Absence enregistrée.');
  await loadCalendarEvents();renderCalendar();
  if(currentMainView==='dashboard')await refreshDashboardPlanning();
  if(currentMainView==='team')await refreshTeamSchedule();
}

function renderWorkingHours(rows=[]){
  const byDay=new Map((rows||[]).map(r=>[Number(r.day_of_week),r]));
  $('workingHoursEditor').innerHTML=WEEK_DAYS.map(([day,label])=>{
    const r=byDay.get(day);
    const active=!!r?.is_active;
    return `<div class="wh-row" data-day="${day}">
      <span class="wh-day">${label}</span>
      <label class="wh-active"><input type="checkbox" class="wh-enabled" ${active?'checked':''}> Actif</label>
      <input class="wh-start" type="time" value="${String(r?.start_time||'08:00').slice(0,5)}" ${active?'':'disabled'}>
      <input class="wh-end" type="time" value="${String(r?.end_time||'18:00').slice(0,5)}" ${active?'':'disabled'}>
    </div>`;
  }).join('');
  document.querySelectorAll('.wh-enabled').forEach(cb=>cb.addEventListener('change',()=>{
    const row=cb.closest('.wh-row');row.querySelector('.wh-start').disabled=!cb.checked;row.querySelector('.wh-end').disabled=!cb.checked;
  }));
}
async function loadWorkingHours(){
  const target=$('workingHoursUser')?.value||currentProfile.id;
  const {data,error}=await supabase.from('working_hours').select('*').eq('user_id',target).order('day_of_week');
  if(error){$('workingHoursStatus').textContent=error.message;return}
  renderWorkingHours(data||[]);
}
async function prepareWorkingHoursSettings(){
  const isAdmin=currentProfile.role==='administrateur';
  $('workingHoursUserWrap').hidden=!isAdmin;
  if(isAdmin){
    $('workingHoursUser').innerHTML=profiles.filter(p=>p.is_active!==false).map(p=>`<option value="${p.id}">${escapeHtml(profileName(p))}</option>`).join('');
    if(!$('workingHoursUser').value)$('workingHoursUser').value=currentProfile.id;
  }
  await loadWorkingHours();
}
async function saveWorkingHours(){
  const target=$('workingHoursUser')?.value||currentProfile.id;
  const rows=[...document.querySelectorAll('.wh-row')];
  for(const row of rows){
    const day=Number(row.dataset.day),enabled=row.querySelector('.wh-enabled').checked;
    const start=row.querySelector('.wh-start').value,end=row.querySelector('.wh-end').value;
    const {error:delErr}=await supabase.from('working_hours').delete().eq('user_id',target).eq('day_of_week',day);
    if(delErr){$('workingHoursStatus').textContent=delErr.message;return}
    if(enabled){
      if(!start||!end||end<=start){$('workingHoursStatus').textContent=`Horaire invalide pour ${WEEK_DAYS.find(x=>x[0]===day)[1]}.`;return}
      const {error}=await supabase.from('working_hours').insert({user_id:target,day_of_week:day,start_time:start,end_time:end,is_active:true});
      if(error){$('workingHoursStatus').textContent=error.message;return}
    }
  }
  $('workingHoursStatus').textContent='Horaires enregistrés.';
  showToast('Horaires individuels enregistrés.');
}
function installPwa(){
  if('serviceWorker' in navigator){
    window.addEventListener('load',async()=>{
      try{
        const reg=await navigator.serviceWorker.register('./sw.js?v=110');
        await reg.update();
        if(reg.waiting)showToast('Une mise à jour est prête. Recharge l’application.',5000);
      }catch(err){console.warn('Service Worker',err)}
    });
  }
}
installPwa();


function isAbsenceEvent(ev){
  const t=eventTypes.find(x=>x.id===ev.event_type_id);
  return !!(ev.all_day && /absence|congé|conge|rtt|repos/i.test(`${ev.title||''} ${t?.name||''}`));
}
function notificationPrefs(){
  try{return JSON.parse(localStorage.getItem('mdl_notification_prefs')||'{}')}catch{return{}}
}
function saveNotificationPrefs(p){
  localStorage.setItem('mdl_notification_prefs',JSON.stringify(p));
}
function notificationReadIds(){
  try{return new Set(JSON.parse(localStorage.getItem('mdl_notification_read')||'[]'))}catch{return new Set()}
}
function saveNotificationReadIds(set){
  localStorage.setItem('mdl_notification_read',JSON.stringify([...set].slice(-200)))
}
function buildLocalNotifications(){
  if(!currentProfile)return [];
  const now=new Date(), horizon=addDays(now,7);
  const relevant=(events||[]).filter(ev=>new Date(ev.ends_at)>=now&&new Date(ev.starts_at)<=horizon&&ev.status!=='cancelled');
  const notes=[];
  for(const ev of relevant){
    if(isAbsenceEvent(ev)){
      notes.push({id:`absence-${ev.id}`,kind:'absence',icon:'☂',title:ev.title||'Absence',detail:`${fmtDate(new Date(ev.starts_at),{day:'2-digit',month:'short'})} · ${ev.all_day?'Journée entière':fmtTime(new Date(ev.starts_at))}`,event_id:ev.id,time:new Date(ev.starts_at)});
    }else{
      notes.push({id:`event-${ev.id}`,kind:'event',icon:'▣',title:ev.title||'Rendez-vous',detail:`${fmtDate(new Date(ev.starts_at),{weekday:'short',day:'2-digit',month:'short'})} · ${ev.all_day?'Journée entière':fmtTime(new Date(ev.starts_at))}`,event_id:ev.id,time:new Date(ev.starts_at)});
    }
  }
  localNotifications=notes.sort((a,b)=>a.time-b.time);
  renderNotificationUi();
  return localNotifications;
}
function renderNotificationUi(){
  if(!$('notificationDrawerList'))return;
  const read=notificationReadIds();
  const unread=localNotifications.filter(n=>!read.has(n.id)).length;
  $('notificationBadge').hidden=!unread;
  $('notificationBadge').textContent=unread>99?'99+':String(unread);

  const rows=localNotifications.slice(0,20).map(n=>`<button class="notification-item ${read.has(n.id)?'':'unread'}" data-note-event="${n.event_id}" data-note-id="${n.id}">
    <strong>${n.icon} ${escapeHtml(n.title)}</strong><small>${escapeHtml(n.detail)}</small>
  </button>`).join('')||'<div class="empty">Aucune notification.</div>';
  $('notificationDrawerList').innerHTML=rows;

  if($('dashboardAlerts')){
    $('dashboardAlerts').innerHTML=localNotifications.slice(0,4).map(n=>`<div class="alert-mini"><div class="alert-mini-icon">${n.icon}</div><div><strong>${escapeHtml(n.title)}</strong><small>${escapeHtml(n.detail)}</small></div></div>`).join('')||'<div class="empty">Aucune alerte.</div>';
  }

  document.querySelectorAll('[data-note-event]').forEach(b=>b.addEventListener('click',()=>{
    const set=notificationReadIds();set.add(b.dataset.noteId);saveNotificationReadIds(set);renderNotificationUi();
    $('notificationDrawer').hidden=true;openEventById(b.dataset.noteEvent);
  }));
}
async function showSystemNotification(title,options={}){
  if(!('Notification' in window) || Notification.permission!=='granted')return false;
  const opts={
    icon:'icons/icon-192.png',
    badge:'icons/icon-192.png',
    vibrate:[180,80,180],
    requireInteraction:false,
    ...options
  };
  try{
    if('serviceWorker' in navigator){
      const reg=await navigator.serviceWorker.ready;
      await reg.showNotification(title,opts);
      if('vibrate' in navigator)navigator.vibrate([120,60,120]);
      return true;
    }
  }catch(err){ console.warn('Notification Service Worker impossible',err); }
  try{
    // Secours desktop. Sur Android, la voie Service Worker ci-dessus est privilégiée.
    new Notification(title,opts);
    return true;
  }catch(err){
    console.warn('Notification navigateur impossible',err);
    return false;
  }
}
async function maybeSendBrowserReminder(){
  const prefs=notificationPrefs();
  if(!prefs.enabled || !('Notification' in window) || Notification.permission!=='granted')return;
  const reminder=Number(prefs.minutes||30);
  const now=Date.now(),max=now+reminder*60000;
  const sentKey='mdl_notification_sent';
  let sent;try{sent=new Set(JSON.parse(sessionStorage.getItem(sentKey)||'[]'))}catch{sent=new Set()}
  for(const ev of events||[]){
    const start=new Date(ev.starts_at).getTime();
    if(ev.all_day||ev.status==='cancelled'||start<now||start>max||sent.has(ev.id))continue;
    const ok=await showSystemNotification(ev.title||'Rendez-vous',{
      body:`Dans ${Math.max(1,Math.round((start-now)/60000))} min${ev.location?` · ${ev.location}`:''}`,
      tag:`mdl-${ev.id}`,
      data:{eventId:ev.id,url:location.href}
    });
    if(ok)sent.add(ev.id);
  }
  sessionStorage.setItem(sentKey,JSON.stringify([...sent]));
}
function startNotificationLoop(){
  clearInterval(notificationTimer);
  buildLocalNotifications();
  maybeSendBrowserReminder();
  notificationTimer=setInterval(()=>{buildLocalNotifications();maybeSendBrowserReminder()},30000);
}


function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function syncPushSubscription(enabled){
  if(!currentUser?.id)throw new Error('Utilisateur non connecté');
  if(!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('Push non pris en charge');
  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  if(!enabled){
    if(sub){
      await supabase.from('push_subscriptions').delete().eq('endpoint',sub.endpoint);
      await sub.unsubscribe();
    }
    await supabase.from('push_preferences').upsert({user_id:currentUser.id,enabled:false,reminder_minutes:Number($('notificationReminderMinutes').value||30),notify_changes:$('notifyMeetingChanges').checked,updated_at:new Date().toISOString()},{onConflict:'user_id'});
    return false;
  }
  if(Notification.permission!=='granted')throw new Error('Autorisation Android non accordée');
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)});
  const j=sub.toJSON();
  const {error:se}=await supabase.from('push_subscriptions').upsert({user_id:currentUser.id,endpoint:sub.endpoint,p256dh:j.keys?.p256dh,auth:j.keys?.auth,user_agent:navigator.userAgent,is_active:true,updated_at:new Date().toISOString()},{onConflict:'endpoint'});
  if(se)throw se;
  const {error:pe}=await supabase.from('push_preferences').upsert({user_id:currentUser.id,enabled:true,reminder_minutes:Number($('notificationReminderMinutes').value||30),notify_changes:$('notifyMeetingChanges').checked,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(pe)throw pe;
  return true;
}
async function loadServerPushPreference(){
  if(!currentUser?.id)return null;
  const {data,error}=await supabase.from('push_preferences').select('*').eq('user_id',currentUser.id).maybeSingle();
  if(error){console.error('push_preferences',error);return null}
  return data;
}

function androidNotificationHelp(){
  return 'Android bloque actuellement les notifications. Ouvre Paramètres Android > Applications > Calendrier Équipe MDL (ou Chrome) > Notifications, puis autorise-les.';
}
async function ensureNotificationPermission(){
  if(!('Notification' in window))return 'unsupported';
  if(Notification.permission==='granted')return 'granted';
  if(Notification.permission==='denied')return 'denied';
  try{
    return await Notification.requestPermission();
  }catch(err){
    console.error('Demande autorisation notifications',err);
    return Notification.permission||'default';
  }
}
async function handleNotificationToggle(){
  const box=$('notificationsEnabled');
  if(!box.checked){
    const p=notificationPrefs();
    saveNotificationPrefs({...p,enabled:false,saved_at:new Date().toISOString()});
    try{await syncPushSubscription(false)}catch(err){console.error('Désactivation push',err)}
    $('notificationSettingsStatus').textContent='Rappels push désactivés et mémorisés.';
    startNotificationLoop();
    return;
  }

  $('notificationSettingsStatus').textContent='Demande d’autorisation Android…';
  const permission=await ensureNotificationPermission();

  if(permission==='granted'){
    const p=notificationPrefs();
    saveNotificationPrefs({
      ...p,
      enabled:true,
      minutes:Number($('notificationReminderMinutes').value||30),
      changes:$('notifyMeetingChanges').checked,
      saved_at:new Date().toISOString()
    });
    try{
      await syncPushSubscription(true);
      box.checked=true;
      $('notificationSettingsStatus').textContent='Push Android activé · rappels reçus même application fermée.';
    }catch(err){
      console.error('Activation push',err);
      box.checked=false;
      saveNotificationPrefs({...p,enabled:false,saved_at:new Date().toISOString()});
      $('notificationSettingsStatus').textContent='Autorisation accordée, mais abonnement Push impossible.';
      showToast(`Push impossible : ${err.message}`,8000);
      return;
    }
    startNotificationLoop();
    return;
  }

  box.checked=false;
  const p=notificationPrefs();
  saveNotificationPrefs({...p,enabled:false,saved_at:new Date().toISOString()});
  if(permission==='denied'){
    $('notificationSettingsStatus').textContent='Notifications refusées par Android. Autorise-les dans les paramètres système.';
    showToast(androidNotificationHelp(),8000);
  }else if(permission==='unsupported'){
    $('notificationSettingsStatus').textContent='Notifications non prises en charge sur cet appareil.';
    showToast('Les notifications ne sont pas prises en charge par ce navigateur.',6000);
  }else{
    $('notificationSettingsStatus').textContent='Autorisation non accordée. Réessaie en touchant Activer les notifications.';
    showToast('Android n’a pas accordé l’autorisation de notification.',6000);
  }
}

async function loadNotificationSettings(){
  let p=notificationPrefs();
  const serverPref=await loadServerPushPreference();
  if(serverPref)p={...p,enabled:serverPref.enabled,minutes:serverPref.reminder_minutes,changes:serverPref.notify_changes};
  const permission=('Notification' in window)?Notification.permission:'unsupported';

  // L'autorisation Android et le choix utilisateur sont deux choses distinctes.
  // Si l'utilisateur a déjà enregistré un choix, on le respecte.
  // Si aucun choix n'existe et qu'Android a déjà autorisé les notifications,
  // on active les rappels par défaut.
  const hasSavedChoice=Object.prototype.hasOwnProperty.call(p,'enabled');
  const enabled=hasSavedChoice ? p.enabled===true : permission==='granted';

  const normalized={
    enabled,
    minutes:Number(p.minutes||30),
    changes:p.changes!==false,
    saved_at:p.saved_at||null
  };
  saveNotificationPrefs(normalized);

  $('notificationsEnabled').checked=normalized.enabled;
  $('notificationReminderMinutes').value=String(normalized.minutes);
  $('notifyMeetingChanges').checked=normalized.changes;
  $('notificationSettingsStatus').textContent=`Autorisation : ${permission}${/Android/i.test(navigator.userAgent)?' · Android détecté':''}${normalized.enabled?' · rappels activés et mémorisés':' · rappels désactivés'}`;
  renderPwaStatus();
}
async function saveNotificationSettings(){
  if($('notificationsEnabled').checked){
    const permission=await ensureNotificationPermission();
    if(permission!=='granted'){
      $('notificationsEnabled').checked=false;
      saveNotificationPrefs({
        enabled:false,
        minutes:Number($('notificationReminderMinutes').value),
        changes:$('notifyMeetingChanges').checked,
        saved_at:new Date().toISOString()
      });
      $('notificationSettingsStatus').textContent=permission==='denied'
        ? 'Notifications refusées par Android. Autorise-les dans les paramètres système.'
        : 'Autorisation Android non accordée.';
      if(permission==='denied')showToast(androidNotificationHelp(),8000);
      return;
    }
  }
  const prefs={
    enabled:$('notificationsEnabled').checked,
    minutes:Number($('notificationReminderMinutes').value),
    changes:$('notifyMeetingChanges').checked,
    saved_at:new Date().toISOString()
  };
  saveNotificationPrefs(prefs);
  try{await syncPushSubscription(prefs.enabled)}catch(err){showToast(`Push : ${err.message}`,8000);return}
  $('notificationSettingsStatus').textContent=prefs.enabled
    ? 'Notifications Android autorisées · réglages mémorisés.'
    : 'Notifications désactivées et mémorisées.';
  startNotificationLoop();
}
async function testNotification(){
  if(!('Notification' in window)){showToast('Notifications non prises en charge.');return}
  const permission=await ensureNotificationPermission();
  if(permission!=='granted'){
    $('notificationsEnabled').checked=false;
    const p=notificationPrefs();
    saveNotificationPrefs({...p,enabled:false,saved_at:new Date().toISOString()});
    $('notificationSettingsStatus').textContent=permission==='denied'
      ? 'Notifications refusées par Android.'
      : 'Autorisation Android non accordée.';
    showToast(permission==='denied'?androidNotificationHelp():'Autorise les notifications dans la fenêtre Android puis réessaie.',8000);
    return;
  }

  $('notificationsEnabled').checked=true;
  const p=notificationPrefs();
  saveNotificationPrefs({
    ...p,
    enabled:true,
    minutes:Number($('notificationReminderMinutes').value||30),
    changes:$('notifyMeetingChanges').checked,
    saved_at:new Date().toISOString()
  });
  try{await syncPushSubscription(true)}catch(err){showToast(`Abonnement Push impossible : ${err.message}`,8000);return}

  const ok=await showSystemNotification('Calendrier Équipe MDL',{
    body:'Test Android réussi. Les notifications système sont bien autorisées.',
    tag:'mdl-test',
    data:{url:location.href}
  });
  $('notificationSettingsStatus').textContent=ok
    ? 'Test envoyé · notifications activées et mémorisées.'
    : 'Autorisation accordée, mais Android n’a pas affiché la notification.';
  showToast(ok?'Notification de test envoyée.':'Impossible d’afficher la notification.',6000);
}
function renderPwaStatus(){
  if(!$('pwaStatus'))return;
  const standalone=window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
  $('pwaStatus').innerHTML=`<div class="account-line"><span>Mode</span><strong>${standalone?'Application installée':'Navigateur'}</strong></div>
  <div class="account-line"><span>Service Worker</span><strong>${'serviceWorker' in navigator?'Disponible':'Non disponible'}</strong></div>
  <div class="account-line"><span>Notifications</span><strong>${'Notification' in window?Notification.permission:'Non prises en charge'}</strong></div>`;
  $('installPwaBtn').hidden=standalone || !deferredInstallPrompt;
}
async function triggerInstallPwa(){
  if(!deferredInstallPrompt){showToast('Utilise “Ajouter à l’écran d’accueil” dans le menu du navigateur.');return}
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;renderPwaStatus();
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;renderPwaStatus()});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;renderPwaStatus();showToast('Application installée.')});

function resetTeamFilters(){
  if($('teamEventTypeFilter'))$('teamEventTypeFilter').value='';
  if($('teamEventStatusFilter'))$('teamEventStatusFilter').value='';
  teamAbsenceOnly=false;
  $('teamOnlyAbsencesBtn').classList.remove('active');
  $('teamFilterSummary').textContent='';
  refreshTeamSchedule();
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

$('agendaSearch').addEventListener('input',renderCalendar);
$('agendaTypeFilter').addEventListener('change',renderCalendar);
$('agendaStatusFilter').addEventListener('change',renderCalendar);
$('exportAgendaXlsxBtn').addEventListener('click',exportAgendaXlsx);
$('exportAgendaCsvBtn').addEventListener('click',exportAgendaCsv);
$('exportAgendaIcsBtn').addEventListener('click',exportAgendaIcs);
$('shareCalendarToggle').addEventListener('change',()=>{$('shareModeSelect').disabled=!$('shareCalendarToggle').checked;});
$('saveSharingBtn').addEventListener('click',saveMySharing);
$('exportTeamCsvBtn').addEventListener('click',exportTeamCsv);
$('exportTeamIcsBtn').addEventListener('click',exportTeamIcs);
$('teamPrevBtn').addEventListener('click',async()=>{const d=new Date(`${$('teamDate').value}T12:00:00`);$('teamDate').value=toDateInput(addDays(d,-Number($('teamRange').value||5)));await refreshTeamSchedule();});
$('teamNextBtn').addEventListener('click',async()=>{const d=new Date(`${$('teamDate').value}T12:00:00`);$('teamDate').value=toDateInput(addDays(d,Number($('teamRange').value||5)));await refreshTeamSchedule();});
$('addEventTypeBtn').addEventListener('click',()=>openEventTypeDialog());
$('closeEventTypeDialog').addEventListener('click',()=>$('eventTypeDialog').close());
$('cancelEventTypeBtn').addEventListener('click',()=>$('eventTypeDialog').close());
$('eventTypeForm').addEventListener('submit',saveEventTypeAdmin);
$('deleteEventTypeBtn').addEventListener('click',deleteEventTypeAdmin);
$('schedulingForm').addEventListener('submit',saveSchedulingSettings);
$('teamGroupFilter').addEventListener('change',async()=>{
  const groupId=$('teamGroupFilter').value;
  const mode=$('teamGroupMode').value;
  teamSelectedIds.clear();
  if(groupId && mode==='select_all') selectGroupTechnicians(groupId,true);
  else renderTeamUsers();
  await refreshTeamSchedule();
});
$('teamGroupMode').addEventListener('change',async()=>{
  const groupId=$('teamGroupFilter').value;
  teamSelectedIds.clear();
  if(groupId && $('teamGroupMode').value==='select_all') selectGroupTechnicians(groupId,true);
  else renderTeamUsers();
  await refreshTeamSchedule();
});
$('refreshTeamBtn').addEventListener('click',async()=>{await loadReferenceData();renderGroupOverview();renderTeamUsers();await refreshTeamSchedule();});
$('teamTodayBtn').addEventListener('click',async()=>{$('teamDate').value=toDateInput(new Date());await refreshTeamSchedule();});
$('teamDate').addEventListener('change',refreshTeamSchedule);
$('teamRange').addEventListener('change',refreshTeamSchedule);
$('teamDetailMode').addEventListener('change',refreshTeamSchedule);
$('selectAllTeamBtn').addEventListener('click',async()=>{document.querySelectorAll('.team-user-check').forEach(cb=>{cb.checked=true;teamSelectedIds.add(cb.value);});await refreshTeamSchedule();});
$('clearTeamBtn').addEventListener('click',async()=>{document.querySelectorAll('.team-user-check').forEach(cb=>cb.checked=false);teamSelectedIds.clear();await refreshTeamSchedule();});
$('exportTeamBtn').addEventListener('click',exportTeamPlanningExcel);
$('slotSearchForm').addEventListener('submit',searchSlots);
$('participantSearch').addEventListener('input',()=>renderEventParticipants(pendingParticipantIds));
$('clearParticipantsBtn').addEventListener('click',()=>{pendingParticipantIds=[];renderEventParticipants([]);});
$('eventOwner').addEventListener('change',()=>renderEventParticipants(pendingParticipantIds));
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
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',async()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');['agendaPanel','teamPanel','settingsPanel','adminPanel'].forEach(id=>{const el=$(id);if(el)el.hidden=true});currentMainView=tab.dataset.view;$(currentMainView+'Panel').hidden=false;if(currentMainView==='team'){renderTeamUsers();await refreshTeamSchedule();}if(currentMainView==='settings'){
  try{await loadMySettings()}catch(err){console.error('Réglages compte',err)}
  try{await prepareWorkingHoursSettings()}catch(err){console.error('Réglages horaires',err)}
  try{await loadNotificationSettings()}catch(err){console.error('Réglages notifications',err)}
}if(currentMainView==='admin')await loadAdmin();}));


$('quickAbsenceBtn').addEventListener('click',openAbsenceDialog);
$('mobileCreateEventBtn').addEventListener('click',()=>openNewEvent(new Date()));
$('mobileAbsenceBtn').addEventListener('click',openAbsenceDialog);
$('mobileSearchSlotsBtn').addEventListener('click',()=>setMainView('team'));
$('absenceForm').addEventListener('submit',saveAbsence);
$('closeAbsenceDialogBtn').addEventListener('click',()=>$('absenceDialog').close());
$('cancelAbsenceBtn').addEventListener('click',()=>$('absenceDialog').close());
$('saveWorkingHoursBtn').addEventListener('click',saveWorkingHours);
$('workingHoursUser').addEventListener('change',loadWorkingHours);
if($('teamEventTypeFilter')) $('teamEventTypeFilter').addEventListener('change',refreshTeamSchedule);
if($('teamEventStatusFilter')) $('teamEventStatusFilter').addEventListener('change',refreshTeamSchedule);


$('notificationBellBtn').addEventListener('click',()=>{$('notificationDrawer').hidden=!$('notificationDrawer').hidden;});
$('closeNotificationDrawerBtn').addEventListener('click',()=>{$('notificationDrawer').hidden=true;});
$('markNotificationsReadBtn').addEventListener('click',()=>{const set=new Set(localNotifications.map(n=>n.id));saveNotificationReadIds(set);renderNotificationUi();});
$('drawerSettingsBtn').addEventListener('click',()=>{$('notificationDrawer').hidden=true;setMainView('settings');});
$('openNotificationSettingsBtn').addEventListener('click',()=>setMainView('settings'));
$('saveNotificationSettingsBtn').addEventListener('click',saveNotificationSettings);
$('notificationsEnabled').addEventListener('change',handleNotificationToggle);
['notificationReminderMinutes','notifyMeetingChanges'].forEach(id=>{
  $(id).addEventListener('change',()=>{
    const current=notificationPrefs();
    saveNotificationPrefs({
      ...current,
      enabled:$('notificationsEnabled').checked && ('Notification' in window) && Notification.permission==='granted',
      minutes:Number($('notificationReminderMinutes').value),
      changes:$('notifyMeetingChanges').checked,
      saved_at:new Date().toISOString()
    });
  });
});
$('testNotificationBtn').addEventListener('click',testNotification);
$('installPwaBtn').addEventListener('click',triggerInstallPwa);
$('teamOnlyAbsencesBtn').addEventListener('click',()=>{teamAbsenceOnly=!teamAbsenceOnly;$('teamOnlyAbsencesBtn').classList.toggle('active',teamAbsenceOnly);$('teamFilterSummary').textContent=teamAbsenceOnly?'Filtre : absences uniquement':'';refreshTeamSchedule();});
$('teamResetFiltersBtn').addEventListener('click',resetTeamFilters);


$('syncNowBtn').addEventListener('click',()=>synchronizeApp(true));
$('runDiagnosticsBtn').addEventListener('click',()=>runDiagnostics(true));
$('copyDiagnosticsBtn').addEventListener('click',copyDiagnostics);

window.addEventListener('unhandledrejection',e=>{console.error('Erreur asynchrone',e.reason);showToast(`Erreur : ${e.reason?.message||e.reason||'opération impossible'}`,6000);});
window.addEventListener('error',e=>{console.error('Erreur JavaScript',e.error||e.message);});
bootstrap();
