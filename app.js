const $=id=>document.getElementById(id);
const state={token:null,selected:null,editing:null,manual:false,manualAt:null,manualDate:'',tickets:[],venues:[],favorites:[],link:''};
let searchTimer,searchVersion=0,activeOption=-1,suggestions=[];
const staticPreview=location.hostname.endsWith('.github.io');let previewData;
const when=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(value);
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function feedback(text,isError=false){const node=$('feedback');node.textContent=text;node.classList.toggle('error',isError);node.hidden=!text;if(isError)node.focus();}
async function api(path,body,method){
  if(staticPreview){
    if(path!=='/search'&&!(path==='/venues'&&body===undefined))throw new Error('Для личных уведомлений нужно подключить сервис бота. Эта страница пока работает в режиме просмотра.');
    if(!previewData){const response=await fetch('./preview.json');if(!response.ok)throw new Error('Каталог временно недоступен. Попробуйте позже.');previewData=await response.json();}
    if(path==='/venues')return{venues:previewData.venues};
    const query=String(body?.query||'').trim(),norm=value=>String(value||'').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const words=norm(query).split(' '),isLink=/^https?:\/\//i.test(query);
    return{events:previewData.events.filter(row=>isLink?row.link.replace('://www.', '://')===query.replace('://www.', '://').replace(/\/$/,''):words.every(word=>norm(row.title).includes(word))).map(row=>({...row,sessions:row.sessions.filter(at=>at>Date.now())})).filter(row=>row.sessions.length).slice(0,20)};
  }
  if(!state.token&&!(path==='/auth'||path==='/search'||path==='/venues'&&body===undefined))throw new Error('Откройте приложение в MAX, чтобы сохранять билеты и любимые площадки.');
  let response;try{response=await fetch('/mini/v1'+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw new Error('Нет связи с сервисом. Проверьте интернет и повторите.');}
  if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Сервис бота ещё не подключён к этой странице. Личные уведомления пока недоступны.');
  const value=await response.json();if(!response.ok)throw new Error(value.error||'Не удалось выполнить запрос');return value;
}
function view(name){for(const key of ['add','tickets','venues']){$(key+'-view').hidden=key!==name;const nav=$('nav-'+key);nav.removeAttribute('aria-current');if(key===name)nav.setAttribute('aria-current','page');}feedback('');window.scrollTo({top:0,behavior:'instant'});}
async function action(button,fn){button.disabled=true;try{await fn();}catch(error){feedback(error.message,true);}finally{button.disabled=false;}}
const manualTime=()=>state.manualAt&&$('manual-date').value===state.manualDate?state.manualAt:Date.parse($('manual-date').value+'+05:00');
function syncOffsets(){
  const at=state.manual?manualTime():Number($('session').value);
  let unavailable=0;
  for(const input of document.querySelectorAll('input[name=hours]')){input.disabled=Number.isFinite(at)&&at-Number(input.value)*3600000<=Date.now();if(input.disabled){input.checked=false;unavailable++;}}
  $('offset-note').textContent=unavailable?'Варианты, время которых уже прошло, недоступны.':'';
}
function openTicket(event=null,ticket=null){
  resetSearch();
  feedback('');state.selected=event;state.editing=ticket?.id||null;state.manual=!event;state.link=ticket?.link||'';
  $('ticket-form').hidden=false;$('manual-fields').hidden=Boolean(event);$('sessions-field').hidden=!event;$('results').replaceChildren();
  $('selected-title').textContent=event?.title||ticket?.title||'Добавить вручную';$('manual-title').value=ticket?.title||(!/^https?:\/\//i.test($('query').value)?$('query').value:'');
  $('manual-date').value=ticket?new Date(ticket.eventAt+5*3600000).toISOString().slice(0,16):'';
  state.manualAt=ticket?.eventAt||null;state.manualDate=$('manual-date').value;
  $('manual-title').required=!event;$('manual-date').required=!event;
  $('session').replaceChildren();for(const at of event?.sessions||[]){const option=element('option',when(at));option.value=at;$('session').append(option);}
  if(ticket&&event)$('session').value=ticket.eventAt;
  for(const input of document.querySelectorAll('input[name=hours]'))input.checked=(ticket?.hours||[2]).includes(Number(input.value));
  $('save').firstChild.textContent=ticket?'Сохранить напоминания ':'Билет куплен — сохранить ';
  $('manual-toggle').setAttribute('aria-expanded','true');syncOffsets();$('ticket-form').scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadTickets(){state.tickets=(await api('/my-events')).items;$('ticket-count').textContent=state.tickets.length||'';renderTickets();}
function renderTickets(){
  const list=$('tickets-list');list.replaceChildren();
  if(!state.tickets.length){const empty=element('div',undefined,'empty');empty.append(element('div','✦','empty-icon'),element('h2','Всё начинается с интереса'),element('p',state.token?'Добавьте купленный билет или выберите любимые площадки. Ваши события появятся здесь.':'Откройте приложение в MAX: здесь будут ваши билеты и события любимых площадок.'));list.append(empty);return;}
  for(const ticket of state.tickets){
    const isTicket=ticket.kind==='ticket',card=element('article',undefined,'card ticket'+(isTicket?'':' venue-event')),date=element('time',when(ticket.eventAt));date.dateTime=new Date(ticket.eventAt).toISOString();
    card.append(element('span',isTicket?'БИЛЕТ И НАПОМИНАНИЯ':'С ЛЮБИМОЙ ПЛОЩАДКИ','event-kind'),date,element('h2',ticket.title));
    if(ticket.venues?.length)card.append(element('p',ticket.venues.map(v=>v.title).join(' · '),'venue-caption'));
    const past=ticket.eventAt<=Date.now();if(isTicket)card.append(element('p',past?'Событие уже состоялось':ticket.hours.length?'Напомнить: '+ticket.hours.map(h=>h===24?'за сутки':h===1?'за час':'за 2 часа').join(', '):'Напоминания выключены','ticket-alert'));
    if(ticket.link){const a=element('a','Открыть страницу события ↗');a.href=ticket.link;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
    const actions=element('div',undefined,'ticket-actions');
    if(!past){const edit=element('button',isTicket?'Изменить напоминания':'Я купил билет — напомнить','text-button');edit.type='button';edit.addEventListener('click',()=>{view('add');if(isTicket)openTicket(null,ticket);else openTicket({id:ticket.id,title:ticket.title,sessions:[ticket.eventAt]});});actions.append(edit);}
    if(isTicket){const remove=element('button','Убрать билет','text-button remove');remove.type='button';remove.addEventListener('click',()=>action(remove,async()=>{await api('/tickets/'+ticket.id,undefined,'DELETE');await loadTickets();feedback('Билет убран. Оставшиеся напоминания отменены.');}));actions.append(remove);}card.append(actions);list.append(card);
  }
}
async function loadVenues(){
  const catalog=await api('/venues');state.venues=catalog.venues;
  state.favorites=state.token?(await api('/preferences')).venues:[];renderVenues();
}
function renderVenues(){
  $('venue-count').textContent=`Выбрано: ${state.favorites.length}`;$('venues-list').replaceChildren();
  state.venues.forEach((venue,index)=>{
    const card=element('label',undefined,'venue-card'),number=element('span',String(index+1).padStart(2,'0'),'venue-number'),copy=element('span',undefined,'venue-copy');
    copy.append(element('small',venue.city),element('strong',venue.title));
    if(!venue.available)copy.append(element('small','Каталог событий подключается','venue-pending'));
    const input=element('input');input.type='checkbox';input.checked=state.favorites.includes(venue.id);input.disabled=!state.token;input.setAttribute('aria-label','Уведомления: '+venue.title);
    input.addEventListener('change',async()=>{
      const enabled=input.checked;for(const node of $('venues-list').querySelectorAll('input'))node.disabled=true;
      try{state.favorites=(await api('/venues',{id:venue.id,enabled})).venues;renderVenues();feedback(enabled?'Площадка добавлена. Анонсы будут приходить в чат, события — в «Мои события».':'Подписка на площадку выключена. Купленные билеты сохранены.');}
      catch(error){renderVenues();feedback(error.message,true);}
    });
    card.append(number,copy,input);$('venues-list').append(card);
  });
}
function resetSearch(){
  clearTimeout(searchTimer);searchVersion++;suggestions=[];activeOption=-1;
  $('results').replaceChildren();$('results').hidden=true;$('search-status').hidden=true;
  $('query').setAttribute('aria-expanded','false');$('query').removeAttribute('aria-activedescendant');
}
function selectSuggestion(item){$('query').value=item.title;openTicket(item);$('session').focus();}
async function searchEvents(selectSingle=false){
  clearTimeout(searchTimer);const version=++searchVersion,query=$('query').value.trim();
  if(query.length<2){resetSearch();return;}
  $('search-status').textContent='Ищем события…';$('search-status').hidden=false;
  try{
    const result=await api('/search',{query});if(version!==searchVersion||query!==$('query').value.trim())return;
    suggestions=result.events;activeOption=-1;$('results').replaceChildren();$('query').removeAttribute('aria-activedescendant');
    if(selectSingle&&suggestions.length===1){selectSuggestion(suggestions[0]);return;}
    if(selectSingle&&!suggestions.length){openTicket();state.link=/^https:\/\//i.test(query)?query:'';feedback('Не нашли точный сеанс. Укажите название и дату вашего билета.');return;}
    $('search-status').textContent=suggestions.length?`Найдено: ${suggestions.length}. Выберите своё мероприятие.`:'В каталоге нет будущих сеансов по этому названию. Можно указать событие вручную.';
    $('results').hidden=!suggestions.length;$('query').setAttribute('aria-expanded',String(Boolean(suggestions.length)));
    for(const item of suggestions){
      const b=element('button',undefined,'event-option');b.type='button';b.id=`event-option-${item.id}`;b.tabIndex=-1;b.setAttribute('role','option');b.setAttribute('aria-selected','false');
      b.append(element('strong',item.title),element('small',when(item.sessions[0])+' · сеансов: '+item.sessions.length));b.addEventListener('click',()=>selectSuggestion(item));$('results').append(b);
    }
  }catch(error){if(version===searchVersion){resetSearch();$('search-status').textContent=error.message;$('search-status').hidden=false;}}
}
$('query').addEventListener('input',event=>{
  resetSearch();feedback('');$('ticket-form').hidden=true;
  if(!event.isComposing&&$('query').value.trim().length>=2)searchTimer=setTimeout(()=>void searchEvents(),250);
});
$('query').addEventListener('compositionend',()=>{resetSearch();if($('query').value.trim().length>=2)searchTimer=setTimeout(()=>void searchEvents(),250);});
$('query').addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.key==='Escape'){resetSearch();return;}
  if(!suggestions.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();activeOption=event.key==='ArrowDown'?(activeOption+1)%suggestions.length:activeOption<0?suggestions.length-1:(activeOption-1+suggestions.length)%suggestions.length;
    [...$('results').children].forEach((node,index)=>node.setAttribute('aria-selected',String(index===activeOption)));
    const node=$('results').children[activeOption];$('query').setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});
  }else if(event.key==='Enter'&&activeOption>=0){event.preventDefault();selectSuggestion(suggestions[activeOption]);}
});
$('search-form').addEventListener('submit',event=>{event.preventDefault();if(!event.isComposing){feedback('');action($('find'),()=>searchEvents(true));}});
$('ticket-form').addEventListener('submit',event=>{
  event.preventDefault();action($('save'),async()=>{
    const hours=[...document.querySelectorAll('input[name=hours]:checked:not(:disabled)')].map(input=>Number(input.value));
    const value={hours,...(state.editing?{id:state.editing}:{})};
    if(state.manual){value.title=$('manual-title').value.trim();value.eventAt=manualTime();value.link=state.link;}
    else{value.eventId=state.selected.id;value.eventAt=Number($('session').value);}
    await api('/tickets',value);await loadTickets();view('tickets');feedback('Билет сохранён. '+(hours.length?'Напоминания придут в чат с ботом.':'Вы можете включить напоминания позже.'));
    $('ticket-form').hidden=true;state.editing=null;
  });
});
$('manual-toggle').addEventListener('click',()=>{openTicket();state.link=/^https:\/\//i.test($('query').value)?$('query').value.trim():'';});
$('back-to-search').addEventListener('click',()=>{$('ticket-form').hidden=true;state.editing=null;$('query').focus();$('manual-toggle').setAttribute('aria-expanded','false');});
$('session').addEventListener('change',syncOffsets);$('manual-date').addEventListener('change',syncOffsets);
$('nav-add').addEventListener('click',()=>view('add'));$('add-another').addEventListener('click',()=>{view('add');$('query').focus();});
async function showVenues(){view('venues');await loadVenues();}
$('nav-tickets').addEventListener('click',()=>action($('nav-tickets'),async()=>{view('tickets');if(state.token)await loadTickets();else renderTickets();}));
$('nav-venues').addEventListener('click',()=>action($('nav-venues'),showVenues));
$('choose-venues').addEventListener('click',()=>action($('choose-venues'),showVenues));
async function start(){
  if(staticPreview){$('access').textContent='Предпросмотр на GitHub Pages: доступны поиск и список площадок. Сохранение подписок и напоминания появятся после подключения сервиса бота.';$('access').classList.add('preview');return;}
  if(window.WebApp?.ready){try{window.WebApp.ready();}catch{}}
  const initData=window.WebApp?.initData;
  if(!initData){$('access').textContent='Режим просмотра. Для сохранения билетов и подписки на площадки откройте приложение в MAX.';$('access').classList.add('preview');return;}
  try{const session=await api('/auth',{initData});state.token=session.token;$('access').hidden=true;$('start-notice').hidden=!session.needsStart;await loadTickets();}
  catch(error){$('access').textContent=error.message;$('access').classList.add('preview');}
}
void start();
