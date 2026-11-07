'use strict';
const DATA = JSON.parse(document.getElementById('app-data').textContent);
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const collator = new Intl.Collator('ko', {numeric:true});
const provinces = new Map(DATA.maps.sido.map(f=>[f.code,f]));
const districts = new Map(DATA.maps.sigungu.map(f=>[f.code,f]));
const stations = new Map(DATA.stations.map(s=>[s.station_id,s]));
const sidoMetrics = new Map(DATA.sidoMetrics.map(s=>[s.sido_code,s]));
const sigMetrics = new Map(DATA.sigunguMetrics.map(s=>[s.sigungu_code,s]));
const stationGroups = new Map();
for(const s of DATA.stations){if(!stationGroups.has(s.sigungu_code))stationGroups.set(s.sigungu_code,[]);stationGroups.get(s.sigungu_code).push(s);}
const state={sido:null,sig:null,station:null};
const storageKey='ev-infra-favorites-v1';
let favorites=[], pendingFavorite=null, animation=0, currentBox=null, suggestions=[], activeIndex=-1;
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))favorites=saved.filter(f=>f&&typeof f.id==='string'&&typeof f.alias==='string'&&['sido','sig','station'].includes(f.kind));}catch(e){$('storage-note').textContent='브라우저 저장소를 사용할 수 없어 이번 화면에서만 유지됩니다.';}
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const button=(text,fn,className)=>{const b=node('button',text,className);b.type='button';b.addEventListener('click',fn);return b;};
const burden=m=>m?m.ev_count/Math.max(1,m.fast_chargers*2+m.slow_chargers):0;
const num=n=>Number(n||0).toLocaleString('ko-KR');
function paint(value,values){const min=Math.min(...values),max=Math.max(...values);const t=max===min?.5:(value-min)/(max-min);const a=[225,238,218],b=[54,94,73];return `rgb(${a.map((x,i)=>Math.round(x+(b[i]-x)*t)).join(',')})`;}
function svgElement(tag,attrs){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
function accessible(n,label,fn){n.setAttribute('role','button');n.setAttribute('tabindex','0');n.setAttribute('aria-label',label);n.addEventListener('click',e=>{e.stopPropagation();fn();});n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}});}
function region(f,group,fn,metric,values){const p=svgElement('path',{d:f.path,class:'region','data-code':f.code,fill:paint(burden(metric),values)});accessible(p,f.fullName||f.name,fn);p.addEventListener('pointerenter',()=>{$('hover-tip').textContent=f.fullName||f.name;$('hover-tip').hidden=false;});p.addEventListener('pointermove',e=>{const r=$('map-stage').getBoundingClientRect();$('hover-tip').style.left=Math.min(e.clientX-r.left+12,r.width-170)+'px';$('hover-tip').style.top=e.clientY-r.top-35+'px';});p.addEventListener('pointerleave',()=>$('hover-tip').hidden=true);group.append(p);return p;}
const pNodes=new Map(),dNodes=new Map();
const nationalValues=DATA.sidoMetrics.map(burden);
for(const f of provinces.values())pNodes.set(f.code,region(f,$('provinces'),()=>navigate({sido:f.code}),sidoMetrics.get(f.code),nationalValues));
for(const f of districts.values()){const values=DATA.sigunguMetrics.filter(m=>m.sido_code===f.parent).map(burden);dNodes.set(f.code,region(f,$('districts'),()=>navigate({sido:f.parent,sig:f.code}),sigMetrics.get(f.code),values));}
function unionBox(features){const b=features.map(f=>f.bounds);const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return [x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y];}
function padded(box){const [x,y,w,h]=box;const pad=Math.max(w,h)*.09;return [x-pad,y-pad,w+2*pad,h+2*pad];}
const nationalBox=padded(unionBox([...provinces.values()]));
function setBox(box){currentBox=box;$('map').setAttribute('viewBox',box.join(' '));resizeMarkers();}
function flyTo(target){cancelAnimationFrame(animation);const from=currentBox||target;const start=performance.now();const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:720;function tick(now){const t=duration?Math.min(1,(now-start)/duration):1;const ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;setBox(from.map((v,i)=>v+(target[i]-v)*ease));if(t<1)animation=requestAnimationFrame(tick);}animation=requestAnimationFrame(tick);}
function resizeMarkers(){if(!currentBox)return;const rect=$('map').getBoundingClientRect();const unit=Math.max(currentBox[2]/Math.max(rect.width,1),currentBox[3]/Math.max(rect.height,1));for(const marker of $('markers').children)marker.setAttribute('transform',`translate(${marker.dataset.x} ${marker.dataset.y}) scale(${unit})`);}
new ResizeObserver(resizeMarkers).observe($('map'));
function navigate(next={}){
 state.sido=next.sido||null;state.sig=next.sig||null;state.station=next.station||null;
 $('hover-tip').hidden=true;
 for(const [code,p]of pNodes){p.style.display=state.sig?'none':'';p.classList.toggle('dim',!!state.sido&&code!==state.sido);p.classList.toggle('context',!!state.sido&&code===state.sido);p.setAttribute('tabindex',!state.sido?'0':'-1');}
 for(const [code,p]of dNodes){const f=districts.get(code);const visible=!!state.sido&&f.parent===state.sido&&(!state.sig||code===state.sig);p.style.display=visible?'':'none';p.setAttribute('tabindex',visible&&!state.sig?'0':'-1');p.style.pointerEvents=state.sig?'none':'';}
 const f=state.sig?districts.get(state.sig):state.sido?provinces.get(state.sido):null;
 flyTo(f?padded(f.bounds):nationalBox);
 renderMarkers();renderBreadcrumbs();renderMetrics();renderDetails();
 $('map-title').textContent=f?(f.fullName||f.name):'전국 시·도별 부담도';
 $('map-hint').textContent=state.sig?'마커를 눌러 상세주소 확인':state.sido?'시·군·구를 눌러 들어가세요':'시·도를 눌러 들어가세요';
 $('save-place').disabled=!state.sido;
 const list=$('station-list');list.replaceChildren();
 if(state.sig){const group=stationGroups.get(state.sig)||[];for(const s of group)list.append(button(s.station_name,()=>selectStation(s.station_id)));if(!group.length)list.append(node('p','이 지역에는 등록된 샘플 충전소가 없습니다.','muted'));}
}
function renderMarkers(){$('markers').replaceChildren();if(!state.sig)return;for(const s of stationGroups.get(state.sig)||[]){const available=s.fast_available+s.slow_available;const g=svgElement('g',{class:'marker'+(state.station===s.station_id?' selected':''),'data-station-id':s.station_id});g.dataset.x=s.point[0];g.dataset.y=s.point[1];const c=svgElement('circle',{r:8,fill:s.status_code?'#b18a4d':available?'#367d5c':'#a9afa5'});g.append(c);const title=svgElement('title',{});title.textContent=s.station_name;g.append(title);accessible(g,s.station_name,()=>selectStation(s.station_id));$('markers').append(g);}resizeMarkers();}
function selectStation(id){state.station=id;renderMarkers();renderDetails();}
function renderBreadcrumbs(){const host=$('breadcrumbs');host.replaceChildren(button('전국',()=>navigate()));if(state.sido){host.append(node('span','›'),button(provinces.get(state.sido).name,()=>navigate({sido:state.sido})));}if(state.sig)host.append(node('span','›'),node('strong',districts.get(state.sig).name));}
function renderMetrics(){let m=state.sig?sigMetrics.get(state.sig):state.sido?sidoMetrics.get(state.sido):DATA.sidoMetrics.reduce((a,v)=>({ev_count:a.ev_count+v.ev_count,fast_chargers:a.fast_chargers+v.fast_chargers,slow_chargers:a.slow_chargers+v.slow_chargers}),{ev_count:0,fast_chargers:0,slow_chargers:0});m=m||{};const host=$('metrics');host.replaceChildren();for(const [label,value]of [['전기차 등록 대수',num(m.ev_count)+'대'],['급속 충전기',num(m.fast_chargers)+'기'],['완속 충전기',num(m.slow_chargers)+'기'],['인프라 부담도',burden(m).toFixed(1)+'대']]){const box=node('div',undefined,'metric');box.append(node('small',label),node('strong',value));host.append(box);}}
function renderDetails(){const host=$('details');host.replaceChildren();const s=stations.get(state.station);if(!s){host.append(node('p',state.sig?'충전소 마커를 누르면 상세주소를 확인할 수 있습니다.':'지역을 선택해 충전소를 탐색하세요.','muted'));return;}const row=node('div',undefined,'details-row');row.append(node('h2',s.station_name),button('☆ 즐겨찾기',()=>openFavorite({id:'station:'+s.station_id,kind:'station',code:s.station_id,alias:s.station_name,address:s.address})));host.append(row,node('p',s.address),node('p',s.source,'muted small'));if(s.status_code){host.append(node('p',`출력 ${s.output_kw}kW · 상태코드 ${s.status_code} (제공 예시)`));}else host.append(node('p',`급속 ${s.fast_available}/${s.fast_total}기 · 완속 ${s.slow_available}/${s.slow_total}기 사용 가능`));host.append(node('p',`운영기관 ${s.operator} · ${s.hours}`));if(s.phone)host.append(node('p','문의 '+s.phone));host.append(node('p','상태 기준 '+s.updated_at,'muted small'));}
// Search uses labels for region ordering, with the parent as a tie-breaker.
const searchIndex=[...DATA.maps.sido.map(f=>({kind:'sido',code:f.code,label:f.name,detail:'시·도',text:f.name})),...DATA.maps.sigungu.map(f=>({kind:'sig',code:f.code,label:f.name,detail:f.fullName,text:f.fullName})),...DATA.stations.map(s=>({kind:'station',code:s.station_id,label:s.station_name,detail:s.address,text:s.station_name+' '+s.address}))];
function hideSuggestions(){$('suggestions').hidden=true;$('search').setAttribute('aria-expanded','false');$('search').removeAttribute('aria-activedescendant');activeIndex=-1;}
function search(){const q=$('search').value.trim().normalize('NFC').toLocaleLowerCase('ko');const host=$('suggestions');host.replaceChildren();if(!q){hideSuggestions();return;}suggestions=searchIndex.filter(s=>s.text.normalize('NFC').toLocaleLowerCase('ko').includes(q)).sort((a,b)=>(a.kind==='station')-(b.kind==='station')||collator.compare(a.label,b.label)||collator.compare(a.detail,b.detail));activeIndex=-1;host.hidden=false;$('search').setAttribute('aria-expanded','true');$('search').removeAttribute('aria-activedescendant');if(!suggestions.length){host.append(node('p','검색 결과가 없습니다.','muted'));return;}suggestions.forEach((s,i)=>{const b=button(s.label,()=>choose(s),'suggestion');b.id='suggestion-'+i;b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.append(node('small',s.detail));host.append(b);});}
function choose(s){hideSuggestions();$('search').value=s.kind==='station'?s.detail:s.label;if(s.kind==='sido')navigate({sido:s.code});else if(s.kind==='sig')navigate({sido:districts.get(s.code).parent,sig:s.code});else{const station=stations.get(s.code),district=districts.get(station.sigungu_code);navigate({sido:district.parent,sig:district.code,station:s.code});}}
$('search').addEventListener('input',search);
$('search').addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){hideSuggestions();return;}if($('suggestions').hidden||!suggestions.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();activeIndex=(activeIndex+(e.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length;for(const [i,n]of [...$('suggestions').children].entries())n.setAttribute('aria-selected',String(i===activeIndex));const active=$('suggestion-'+activeIndex);$('search').setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'){e.preventDefault();choose(suggestions[Math.max(0,activeIndex)]);}});
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))hideSuggestions();});
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(favorites));}catch(e){$('storage-note').textContent='저장 공간이 부족하거나 제한되어 이번 화면에서만 유지됩니다.';}renderFavorites();}
function openFavorite(f){pendingFavorite=f;$('alias').value=f.alias;$('favorite-address').textContent=f.address;$('favorite-dialog').showModal();$('alias').focus();}
function renderFavorites(){const host=$('favorites');host.replaceChildren();if(!favorites.length)host.append(node('p','저장한 장소가 없습니다. 지역 또는 충전소의 ☆ 버튼을 눌러보세요.','empty'));for(const f of favorites){const row=node('div',undefined,'fav-item'),open=button('',()=>{if(f.kind==='sido'&&provinces.has(f.code))choose({kind:'sido',code:f.code,label:provinces.get(f.code).name});else if(f.kind==='sig'&&districts.has(f.code))choose({kind:'sig',code:f.code,label:districts.get(f.code).name});else if(f.kind==='station'&&stations.has(f.code))choose({kind:'station',code:f.code,detail:stations.get(f.code).address});else $('storage-note').textContent='이 장소는 현재 데이터에 없습니다.';},'fav-open');open.append(node('strong',f.alias),node('small',f.address));const tools=node('div',undefined,'fav-tools');tools.append(button('별명',()=>openFavorite(f)),button('삭제',()=>{favorites=favorites.filter(v=>v.id!==f.id);persist();}));row.append(open,tools);host.append(row);}}
$('favorite-form').addEventListener('submit',e=>{e.preventDefault();const alias=$('alias').value.trim();if(!alias)return;const f={...pendingFavorite,alias};favorites=favorites.filter(v=>v.id!==f.id);favorites.push(f);persist();$('favorite-dialog').close();});
$('cancel-favorite').addEventListener('click',()=>$('favorite-dialog').close());
$('save-place').addEventListener('click',()=>{const f=state.sig?districts.get(state.sig):provinces.get(state.sido);if(f)openFavorite({id:(state.sig?'sig:':'sido:')+f.code,kind:state.sig?'sig':'sido',code:f.code,alias:f.name,address:f.fullName||f.name});});
$('home').addEventListener('click',e=>{e.preventDefault();navigate();});
window.addEventListener('storage',e=>{if(e.key===storageKey){try{const parsed=JSON.parse(e.newValue||'[]');if(Array.isArray(parsed)){favorites=parsed.filter(f=>f&&typeof f.id==='string'&&typeof f.alias==='string'&&['sido','sig','station'].includes(f.kind));renderFavorites();}}catch{}}});
setBox(nationalBox);navigate();renderFavorites();
