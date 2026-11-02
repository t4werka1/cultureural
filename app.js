const $=id=>document.getElementById(id);
const state={token:null,selected:null,editing:null,manual:false,manualAt:null,manualDate:'',tickets:[],venues:[],favorites:[],link:'',filter:'all'};
const hostedOnPages=location.hostname.endsWith('.github.io');let staticPreview=hostedOnPages,apiBase='',previewData;
let venueBusy=false;
const normalizeText=value=>String(value||'').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const when=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(value);
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function feedback(text,isError=false){const node=$('feedback');node.textContent=text;node.classList.toggle('error',isError);node.hidden=!text;if(isError)node.focus();}
const localTicketsKey='cultureural_tickets_v1';
const localFavsKey='cultureural_favorites_v1';
async function api(path,body,method,isFallback=false){
  const m=(method||(body===undefined?'GET':'POST')).toUpperCase();
  const route=new URL(path,'http://mini.local');
  if(staticPreview||!apiBase||isFallback){
    if(!previewData){const response=await fetch('./preview.json');if(!response.ok)throw new Error('Каталог временно недоступен. Попробуйте позже.');previewData=await response.json();}
    if(route.pathname==='/venues'){
      const query=route.searchParams.get('query');
      if(query!==null){
        const text=normalizeText(query),words=text.split(' ');
        return{venues:previewData.venues.filter(row=>row.id.startsWith('place:')&&text&&words.every(word=>normalizeText(row.title+' '+row.city).includes(word))).sort((a,b)=>a.title.localeCompare(b.title,'ru')||a.city.localeCompare(b.city,'ru')).slice(0,20)};
      }
      if(body&&typeof body.id==='string'){
        let favs=JSON.parse(localStorage.getItem(localFavsKey)||'[]');
        if(body.enabled){if(!favs.includes(body.id))favs.push(body.id);}
        else{favs=favs.filter(id=>id!==body.id);}
        localStorage.setItem(localFavsKey,JSON.stringify(favs));
        return{venues:favs,favorites:favs};
      }
      return{venues:previewData.venues};
    }
    if(route.pathname==='/preferences'){
      const favs=JSON.parse(localStorage.getItem(localFavsKey)||'[]');
      return{venues:favs,favorites:favs};
    }
    if(route.pathname==='/tickets'){
      let tickets=JSON.parse(localStorage.getItem(localTicketsKey)||'[]');
      if(m==='POST'){
        const id=body.id||Date.now();
        const item={...body,id,kind:'ticket'};
        const idx=tickets.findIndex(t=>t.id===id);
        if(idx>=0)tickets[idx]=item;else tickets.push(item);
        localStorage.setItem(localTicketsKey,JSON.stringify(tickets));
        return item;
      }
      return tickets;
    }
    if(route.pathname.startsWith('/tickets/')&&m==='DELETE'){
      const id=Number(route.pathname.slice(9));
      let tickets=JSON.parse(localStorage.getItem(localTicketsKey)||'[]');
      tickets=tickets.filter(t=>t.id!==id);
      localStorage.setItem(localTicketsKey,JSON.stringify(tickets));
      return{ok:true};
    }
    if(route.pathname==='/my-events'){
      const tickets=JSON.parse(localStorage.getItem(localTicketsKey)||'[]');
      const favs=JSON.parse(localStorage.getItem(localFavsKey)||'[]');
      const catalog=previewData.events||[];
      const now=Date.now();
      const venueEvents=catalog.flatMap(row=>{
        const matches=favs.includes(`place:${row.placeId}`);
        const eventAt=(row.sessions||[]).find(at=>at>now);
        return matches&&eventAt?[{kind:'venue',id:row.id,title:row.title,link:row.link,eventAt,venues:[{title:row.place||''}]}]:[];
      }).slice(0,50);
      return{items:[...tickets,...venueEvents].sort((a,b)=>a.eventAt-b.eventAt)};
    }
    const query=String(body?.query||'').trim(),words=normalizeText(query).split(' '),isLink=/^https?:\/\//i.test(query);
    return{events:previewData.events.filter(row=>isLink?row.link.replace('://www.', '://')===query.replace('://www.', '://').replace(/\/$/,''):words.every(word=>normalizeText(row.title).includes(word))).map(row=>({...row,sessions:row.sessions.filter(at=>at>Date.now())})).filter(row=>row.sessions.length).slice(0,20)};
  }
  try{
    const response=await fetch(apiBase+'/mini/v1'+path,{method:m,headers:{'Content-Type':'application/json','bypass-tunnel-reminder':'true',...(state.token?{Authorization:'Bearer '+state.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok){const val=await response.json().catch(()=>({}));throw new Error(val.error||`HTTP ${response.status}`);}
    const value=await response.json();return value;
  }catch(err){
    return api(path,body,method,true);
  }
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
const reminderText=hours=>hours.length?'Напоминания: '+hours.map(hour=>hour===24?'за сутки':hour===1?'за час':'за '+new Intl.NumberFormat('ru-RU',{style:'unit',unit:'hour',unitDisplay:'long'}).format(hour)).join(', '):'Напоминания выключены';
function renderTickets(){
  const list=$('tickets-list');list.replaceChildren();
  const filter=state.filter||'all';
  const items=state.tickets.filter(row=>{
    if(filter==='tickets')return row.kind==='ticket';
    if(filter==='venues')return row.kind!=='ticket';
    return true;
  });
  if(!items.length){
    const empty=element('div',undefined,'empty');
    const icon=element('div',undefined,'empty-icon');
    const iconImg=element('img');iconImg.src='./lizard-harp.svg';iconImg.width=36;iconImg.height=40;iconImg.alt='';
    icon.append(iconImg);
    empty.append(icon);
    if(filter==='tickets'){
      empty.append(element('h2',state.token?'Пока нет купленных билетов':'Ваши билеты'),element('p',state.token?'Отметьте купленный билет в разделе «Добавить билет». Здесь появятся его дата и выбранные напоминания.':'Здесь будут ваши купленные билеты, даты событий и выбранные напоминания.'));
    }else if(filter==='venues'){
      empty.append(element('h2','Нет событий любимых площадок'),element('p','Выберите интересные площадки в разделе «Площадки», чтобы видеть их сеансы здесь.'));
    }else{
      empty.append(element('h2','Всё начинается с интереса'),element('p',state.token?'Добавьте купленный билет или выберите любимые площадки. Ваши события появятся здесь.':'Откройте приложение в MAX: здесь будут ваши билеты и события любимых площадок.'));
    }
    list.append(empty);return;
  }
  for(const ticket of items){
    const isTicket=ticket.kind==='ticket',card=element('article',undefined,'card ticket'+(isTicket?'':' venue-event')),date=element('time',when(ticket.eventAt));date.dateTime=new Date(ticket.eventAt).toISOString();
    card.append(element('span',isTicket?'БИЛЕТ И НАПОМИНАНИЯ':'С ЛЮБИМОЙ ПЛОЩАДКИ','event-kind'),date,element('h2',ticket.title));
    if(ticket.venues?.length)card.append(element('p',ticket.venues.map(v=>v.title).join(' · '),'venue-caption'));
    const past=ticket.eventAt<=Date.now();if(isTicket)card.append(element('p',past?'Событие уже состоялось':reminderText(ticket.hours),'ticket-alert'));
    if(ticket.link){const a=element('a','Открыть страницу события ↗');a.href=ticket.link;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
    const actions=element('div',undefined,'ticket-actions');
    if(!past){const edit=element('button',isTicket?'Изменить напоминания':'Я купил билет — напомнить','text-button');edit.type='button';edit.addEventListener('click',()=>{view('add');if(isTicket)openTicket(null,ticket);else openTicket({id:ticket.id,title:ticket.title,sessions:[ticket.eventAt]});});actions.append(edit);}
    if(isTicket){const remove=element('button','Убрать билет','text-button remove');remove.type='button';remove.addEventListener('click',()=>action(remove,async()=>{await api('/tickets/'+ticket.id,undefined,'DELETE');let tickets=JSON.parse(localStorage.getItem(localTicketsKey)||'[]');tickets=tickets.filter(t=>t.id!==ticket.id);localStorage.setItem(localTicketsKey,JSON.stringify(tickets));await loadTickets();feedback('Билет убран. Оставшиеся напоминания отменены.');}));actions.append(remove);}card.append(actions);list.append(card);
  }
}
async function loadVenues(){
  const catalog=await api('/venues');state.venues=catalog.venues;
  try{
    const prefs=await api('/preferences');
    state.favorites=prefs.favorites||prefs.venues||JSON.parse(localStorage.getItem(localFavsKey)||'[]');
    localStorage.setItem(localFavsKey,JSON.stringify(state.favorites));
  }catch{
    state.favorites=JSON.parse(localStorage.getItem(localFavsKey)||'[]');
  }
  renderVenues();
}
function renderVenues(){
  $('venue-count').textContent=`Выбрано: ${state.favorites.length}`;$('venues-list').replaceChildren();
  if(!state.favorites.length)$('venues-list').append(element('p','Введите название или город и выберите площадку из подсказок. Избранные площадки появятся здесь.','venues-empty'));
  state.favorites.map(id=>state.venues.find(row=>row.id===id)||{id,title:'Площадка №'+id.replace('place:',''),city:'',available:false}).forEach((venue,index)=>{
    const card=element('label',undefined,'venue-card'),number=element('span',String(index+1).padStart(2,'0'),'venue-number'),copy=element('span',undefined,'venue-copy');
    copy.append(element('small',venue.city),element('strong',venue.title));
    if(!venue.available)copy.append(element('small','Каталог событий подключается','venue-pending'));
    const input=element('input');input.type='checkbox';input.checked=state.favorites.includes(venue.id);input.disabled=venueBusy;input.setAttribute('aria-label','Уведомления: '+venue.title);
    input.addEventListener('change',async()=>{
      const enabled=input.checked;
      try{await setFavorite(venue.id,enabled);}
      catch(error){renderVenues();feedback(error.message,true);}
    });
    card.append(number,copy,input);$('venues-list').append(card);
  });
}
async function setFavorite(id,enabled){
  if(venueBusy)return;venueBusy=true;$('venue-query').disabled=true;$('venue-find').disabled=true;
  try{
    let favs=JSON.parse(localStorage.getItem(localFavsKey)||'[]');
    if(enabled){if(!favs.includes(id))favs.push(id);}else{favs=favs.filter(x=>x!==id);}
    localStorage.setItem(localFavsKey,JSON.stringify(favs));
    state.favorites=favs;renderVenues();
    try{
      const res=await api('/venues',{id,enabled});
      if(res?.favorites||res?.venues){
        state.favorites=res.favorites||res.venues;
        localStorage.setItem(localFavsKey,JSON.stringify(state.favorites));
      }
    }catch{}
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
    else{value.eventId=state.selected.id;value.title=state.selected.title;value.eventAt=Number($('session').value);value.link=state.selected.link||'';}
    await api('/tickets',value,'POST');
    let tickets=JSON.parse(localStorage.getItem(localTicketsKey)||'[]');
    const id=value.id||Date.now();
    const item={...value,id,kind:'ticket'};
    const idx=tickets.findIndex(t=>t.id===id);
    if(idx>=0)tickets[idx]=item;else tickets.push(item);
    localStorage.setItem(localTicketsKey,JSON.stringify(tickets));
    await loadTickets();view('tickets');feedback('Билет сохранён в приложении ✓ '+(hours.length?'Напоминания активны.':''));
    $('ticket-form').hidden=true;state.editing=null;
  });
});
$('manual-toggle').addEventListener('click',()=>{openTicket();state.link=/^https:\/\//i.test($('query').value)?$('query').value.trim():'';});
$('back-to-search').addEventListener('click',()=>{$('ticket-form').hidden=true;state.editing=null;$('query').focus();$('manual-toggle').setAttribute('aria-expanded','false');});
$('session').addEventListener('change',syncOffsets);$('manual-date').addEventListener('change',syncOffsets);
$('nav-add').addEventListener('click',()=>view('add'));$('add-another').addEventListener('click',()=>{view('add');$('query').focus();});
async function showVenues(){view('venues');await loadVenues();}
$('nav-tickets').addEventListener('click',()=>action($('nav-tickets'),async()=>{view('tickets');await loadTickets();}));
document.querySelectorAll('.filter-tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    state.filter=btn.dataset.filter||'all';
    document.querySelectorAll('.filter-tab').forEach(b=>{
      const active=b===btn;
      b.classList.toggle('active',active);
      b.setAttribute('aria-selected',String(active));
    });
    renderTickets();
  });
});
$('nav-venues').addEventListener('click',()=>action($('nav-venues'),showVenues));
$('choose-venues').addEventListener('click',()=>action($('choose-venues'),showVenues));
function getInitData(){
  if(window.WebApp?.initData)return window.WebApp.initData;
  if(window.Telegram?.WebApp?.initData)return window.Telegram.WebApp.initData;
  if(window.Max?.WebApp?.initData)return window.Max.WebApp.initData;
  if(window.MaxWebApp?.initData)return window.MaxWebApp.initData;
  try{
    const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));
    if(hash.get('tgWebAppData'))return hash.get('tgWebAppData');
    if(hash.get('maxWebAppData'))return hash.get('maxWebAppData');
    if(hash.get('initData'))return hash.get('initData');
    const search=new URLSearchParams(window.location.search);
    if(search.get('tgWebAppData'))return search.get('tgWebAppData');
    if(search.get('maxWebAppData'))return search.get('maxWebAppData');
    if(search.get('initData'))return search.get('initData');
  }catch{}
  return null;
}
async function start(){
  for(const o of [window.WebApp, window.Telegram?.WebApp, window.Max?.WebApp, window.MaxWebApp]){
    if(o?.ready){try{o.ready();}catch{}}
  }
  if(!window.WebApp&&window.Telegram?.WebApp)window.WebApp=window.Telegram.WebApp;
  if(!window.WebApp&&window.Max?.WebApp)window.WebApp=window.Max.WebApp;
  if(hostedOnPages){
    try{
      const response=await fetch('./connection.json',{cache:'no-store',signal:AbortSignal.timeout(6000)});
      if(response.ok){
        const config=await response.json();
        if(config.apiBase){
          const url=new URL(config.apiBase);
          if(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'){
            apiBase=url.origin;staticPreview=false;
          }
        }
      }
    }catch{}
  }
  const initData=getInitData();
  if(initData&&apiBase){
    try{
      const session=await api('/auth',{initData});
      state.token=session.token;
      $('access').hidden=true;
      $('start-notice').hidden=!session.needsStart;
      const localFavs=JSON.parse(localStorage.getItem(localFavsKey)||'[]');
      for(const id of localFavs){try{await api('/venues',{id,enabled:true});}catch{}}
    }catch(error){$('access').textContent=error.message;$('access').hidden=false;}
  }
  await loadTickets();
  try{
    const prefs=await api('/preferences');
    state.favorites=prefs.favorites||prefs.venues||JSON.parse(localStorage.getItem(localFavsKey)||'[]');
    localStorage.setItem(localFavsKey,JSON.stringify(state.favorites));
  }catch{
    state.favorites=JSON.parse(localStorage.getItem(localFavsKey)||'[]');
  }
}
void start();
