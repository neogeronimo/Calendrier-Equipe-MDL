import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=042';

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

function setStatus(message) {
  const box = $('loginStatus');
  if (box) box.textContent = `Version 0.4.2 · ${message}`;
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
  $('eventDialog').close();showToast('Rendez-vous supprimé.');await loadCalendarEvents();renderCalendar();
}

function populateTeamFilters() {
  $('teamGroupFilter').innerHTML='<option value="">Tous les groupes</option>'+groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  const now=new Date();
  $('teamDate').value=toDateInput(now);
  $('slotStartDate').value=toDateInput(now);
  $('slotEndDate').value=toDateInput(addDays(now,7));
}

function renderTeamUsers() {
  const groupId=$('teamGroupFilter').value;
  let users=profiles.filter(p=>p.is_active!==false && p.role==='technicien');

  if(groupId){
    const ids=new Set(memberships.filter(m=>m.group_id===groupId).map(m=>m.user_id));
    users=users.filter(p=>ids.has(p.id));
  }

  $('teamUsers').innerHTML=users.length ? users.map(p=>{
    const checked=teamSelectedIds.has(p.id);
    return `<label class="check-item">
      <input type="checkbox" value="${p.id}" class="team-user-check" ${checked?'checked':''}>
      <span><strong>${escapeHtml(profileName(p))}</strong><small>${escapeHtml(groupNamesForUser(p.id).join(', ')||'Technicien')}</small></span>
    </label>`;
  }).join('') : '<div class="empty">Aucun technicien dans ce filtre.</div>';

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
  $('teamPlanningCaption').textContent=`${users.length} technicien${users.length>1?'s':''} · ${fmtDate(start,{day:'2-digit',month:'short'})} → ${fmtDate(addDays(start,days-1),{day:'2-digit',month:'short',year:'numeric'})}`;

  let html=`<div class="team-schedule-table" style="--team-days:${days}">`;
  html+=`<div class="team-schedule-head"><div>Technicien</div>`;
  for(let d=0;d<days;d++){
    const day=addDays(start,d);
    html+=`<div>${escapeHtml(fmtDate(day,{weekday:'short',day:'2-digit',month:'short'}))}</div>`;
  }
  html+='</div>';

  for(const user of users){
    html+=`<div class="team-person-row"><div class="team-person"><strong>${escapeHtml(profileName(user))}</strong><small>${escapeHtml(groupNamesForUser(user.id).join(', '))}</small></div>`;
    for(let d=0;d<days;d++){
      const day=addDays(start,d),dayEnd=addDays(day,1);
      const list=teamEvents.filter(ev=>{
        const applies=ev.owner_id===user.id || (ev.participant_user_ids||[]).includes(user.id);
        return applies && new Date(ev.starts_at)<dayEnd && new Date(ev.ends_at)>day && ev.status!=='cancelled';
      }).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
      html+=`<div class="team-day-cell" data-team-day="${toDateInput(day)}" data-team-user="${user.id}">`;
      if(!list.length)html+='<span class="team-empty-day">Libre</span>';
      for(const ev of list){
        const participantOnly=ev.owner_id!==user.id;
        html+=`<button class="team-event-chip ${participantOnly?'participant-event':''}" data-team-event="${ev.id}" style="border-left-color:${escapeHtml(eventColor(ev))}">
          <strong>${escapeHtml(ev.title)}</strong>
          <span>${ev.all_day?'Journée entière':`${fmtTime(new Date(ev.starts_at))}–${fmtTime(new Date(ev.ends_at))}`}${participantOnly?' · participant':''}</span>
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
  const ids=selectedTeamIds();
  if(!ids.length){showToast('Sélectionne au moins un technicien.');return;}

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
    $('slotResults').innerHTML=
      `<div class="availability-meta">Calcul pour <strong>${escapeHtml(names.join(', '))}</strong> : rendez-vous propriétaires + participations + horaires de travail + pause déjeuner.</div>`+
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
$('teamGroupFilter').addEventListener('change',async()=>{teamSelectedIds.clear();renderTeamUsers();await refreshTeamSchedule();});
$('refreshTeamBtn').addEventListener('click',async()=>{await loadReferenceData();renderTeamUsers();await refreshTeamSchedule();});
$('teamTodayBtn').addEventListener('click',async()=>{$('teamDate').value=toDateInput(new Date());await refreshTeamSchedule();});
$('teamDate').addEventListener('change',refreshTeamSchedule);
$('teamRange').addEventListener('change',refreshTeamSchedule);
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
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',async()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');['agendaPanel','teamPanel','adminPanel'].forEach(id=>$(id).hidden=true);currentMainView=tab.dataset.view;$(currentMainView+'Panel').hidden=false;if(currentMainView==='team'){renderTeamUsers();await refreshTeamSchedule();}if(currentMainView==='admin')await loadAdmin();}));

bootstrap();
