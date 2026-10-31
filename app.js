const $=id=>document.getElementById(id);
const state={token:null,selected:null,editing:null,manual:false,manualAt:null,manualDate:'',tickets:[],venues:[],favorites:[],link:''};
const staticPreview=location.hostname.endsWith('.github.io');let previewData;
let venueBusy=false;
const normalizeText=value=>String(value||'').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const when=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(value);
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function feedback(text,isError=false){const node=$('feedback');node.textContent=text;node.classList.toggle('error',isError);node.hidden=!text;if(isError)node.focus();}
async function api(path,body,method){
  const route=new URL(path,'http://mini.local');
  if(staticPreview){
    if(path!=='/search'&&!(route.pathname==='/venues'&&body===undefined))throw new Error('Для личных уведомлений нужно подключить сервис бота. Эта страница пока работает в режиме просмотра.');
    if(!previewData){const response=await fetch('./preview.json');if(!response.ok)throw new Error('Каталог временно недоступен. Попробуйте позже.');previewData=await response.json();}
    if(route.pathname==='/venues'){
      const query=route.searchParams.get('query');if(query===null)return{venues:previewData.venues};
      const text=normalizeText(query),words=text.split(' ');
      return{venues:previewData.venues.filter(row=>row.id.startsWith('place:')&&text&&words.every(word=>normalizeText(row.title+' '+row.city).includes(word))).sort((a,b)=>a.title.localeCompare(b.title,'ru')||a.city.localeCompare(b.city,'ru')).slice(0,20)};
    }
    const query=String(body?.query||'').trim(),words=normalizeText(query).split(' '),isLink=/^https?:\/\//i.test(query);
    return{events:previewData.events.filter(row=>isLink?row.link.replace('://www.', '://')===query.replace('://www.', '://').replace(/\/$/,''):words.every(word=>normalizeText(row.title).includes(word))).map(row=>({...row,sessions:row.sessions.filter(at=>at>Date.now())})).filter(row=>row.sessions.length).slice(0,20)};
  }
  if(!state.token&&!(path==='/auth'||path==='/search'||route.pathname==='/venues'&&body===undefined))throw new Error('Откройте приложение в MAX, чтобы сохранять билеты и любимые площадки.');
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
  if(!state.favorites.length)$('venues-list').append(element('p','Введите название или город и выберите площадку из подсказок. Избранные площадки появятся здесь.','venues-empty'));
  state.favorites.map(id=>state.venues.find(row=>row.id===id)||{id,title:'Площадка №'+id.replace('place:',''),city:'',available:false}).forEach((venue,index)=>{
    const card=element('label',undefined,'venue-card'),number=element('span',String(index+1).padStart(2,'0'),'venue-number'),copy=element('span',undefined,'venue-copy');
    copy.append(element('small',venue.city),element('strong',venue.title));
    if(!venue.available)copy.append(element('small','Каталог событий подключается','venue-pending'));
    const input=element('input');input.type='checkbox';input.checked=state.favorites.includes(venue.id);input.disabled=!state.token||venueBusy;input.setAttribute('aria-label','Уведомления: '+venue.title);
    input.addEventListener('change',async()=>{
      const enabled=input.checked;
      try{await setFavorite(venue.id,enabled);}
      catch(error){renderVenues();feedback(error.message,true);}
    });
    card.append(number,copy,input);$('venues-list').append(card);
  });
}
async function setFavorite(id,enabled){
  if(venueBusy)return;venueBusy=true;$('venue-query').disabled=true;$('venue-find').disabled=true;renderVenues();
  try{
    state.favorites=(await api('/venues',{id,enabled})).venues;
    if(enabled){$('venue-query').value='';venueSearch.reset();}
    feedback(enabled?'Площадка добавлена. Анонсы будут приходить в чат, события — в «Мои события».':'Подписка на площадку выключена. Купленные билеты сохранены.');
  }finally{venueBusy=false;$('venue-query').disabled=false;$('venue-find').disabled=false;renderVenues();}
}
function autocomplete({inputId,resultsId,statusId,load,subtitle,select,onInput=()=>{},loadingText,emptyText,onEmptySubmit}){
  const input=$(inputId),results=$(resultsId),status=$(statusId);let timer,version=0,active=-1,items=[];
  function reset(){clearTimeout(timer);version++;active=-1;items=[];results.replaceChildren();results.hidden=true;status.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function choose(item){reset();input.value=item.title;select(item);}
  async function run(selectSingle=false){
    clearTimeout(timer);const request=++version,query=input.value.trim();if(query.length<2){reset();return;}
    status.textContent=loadingText;status.hidden=false;
    try{
      const found=await load(query);if(request!==version||query!==input.value.trim())return;
      items=found;active=-1;results.replaceChildren();input.removeAttribute('aria-activedescendant');
      if(selectSingle&&items.length===1){choose(items[0]);return;}
      if(selectSingle&&!items.length&&onEmptySubmit){reset();onEmptySubmit(query);return;}
      status.textContent=items.length?`Найдено: ${items.length}. Выберите вариант.`:emptyText;results.hidden=!items.length;input.setAttribute('aria-expanded',String(Boolean(items.length)));
      for(const item of items){const button=element('button',undefined,'event-option');button.type='button';button.id=`${resultsId}-option-${item.id}`;button.tabIndex=-1;button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.append(element('strong',item.title),element('small',subtitle(item)));button.addEventListener('click',()=>choose(item));results.append(button);}
    }catch(error){if(request===version){reset();status.textContent=error.message;status.hidden=false;}}
  }
  function changed(event){reset();onInput();if(!event.isComposing&&input.value.trim().length>=2)timer=setTimeout(()=>void run(),250);}
  input.addEventListener('input',changed);input.addEventListener('compositionend',changed);
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;if(event.key==='Escape'){reset();return;}if(!items.length)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();active=event.key==='ArrowDown'?(active+1)%items.length:active<0?items.length-1:(active-1+items.length)%items.length;
      [...results.children].forEach((node,index)=>node.setAttribute('aria-selected',String(index===active)));const node=results.children[active];input.setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});
    }else if(event.key==='Enter'&&active>=0){event.preventDefault();choose(items[active]);}
  });
  return{reset,run};
}
function resetSearch(){eventSearch.reset();}
const eventSearch=autocomplete({inputId:'query',resultsId:'results',statusId:'search-status',load:async query=>(await api('/search',{query})).events,subtitle:item=>when(item.sessions[0])+' · сеансов: '+item.sessions.length,select:item=>{openTicket(item);$('session').focus();},onInput:()=>{feedback('');$('ticket-form').hidden=true;},loadingText:'Ищем события…',emptyText:'В каталоге нет будущих сеансов по этому названию. Можно указать событие вручную.',onEmptySubmit:query=>{openTicket();state.link=/^https:\/\//i.test(query)?query:'';feedback('Не нашли точный сеанс. Укажите название и дату вашего билета.');}});
const venueSearch=autocomplete({inputId:'venue-query',resultsId:'venue-results',statusId:'venue-status',load:async query=>(await api('/venues?query='+encodeURIComponent(query))).venues,subtitle:item=>[item.city,state.favorites.includes(item.id)?'Уже в избранном':state.token?'Добавить в избранное':'Откройте MAX для подписки'].filter(Boolean).join(' · '),select:item=>{if(!state.venues.some(row=>row.id===item.id))state.venues.push(item);void action($('venue-find'),()=>setFavorite(item.id,true));},onInput:()=>feedback(''),loadingText:'Ищем площадки…',emptyText:'Площадка не найдена. Попробуйте часть названия или другой город.'});
$('search-form').addEventListener('submit',event=>{event.preventDefault();if(!event.isComposing){feedback('');void action($('find'),()=>eventSearch.run(true));}});
$('venue-search-form').addEventListener('submit',event=>{event.preventDefault();if(!event.isComposing){feedback('');void action($('venue-find'),()=>venueSearch.run(true));}});
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
