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
const state={sido:null,sig:null,station:null,cluster:null,nearby:null};
let searchMode='normal',pendingAddressId='',addressTimer=null;
const formatDistance=m=>m<1000?`직선거리 약 ${Math.round(m)}m`:`직선거리 약 ${(m/1000).toFixed(1)}km`;
const projectPoint=(lng,lat)=>[Number(lng)*1000,-Math.log(Math.tan(Math.PI/4+Number(lat)*Math.PI/360))*180/Math.PI*1000];
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
function region(f,group,fn,metric,values){const p=svgElement('path',{d:f.path,class:'region','data-code':f.code,fill:paint(burden(metric),values),'data-burden':metric?burden(metric).toFixed(1):''});accessible(p,f.fullName||f.name,fn);p.addEventListener('pointerenter',()=>{$('hover-tip').textContent=(f.fullName||f.name)+(metric?` · 부담도 ${burden(metric).toFixed(1)}대 / 환산충전기`:'');$('hover-tip').hidden=false;});p.addEventListener('pointermove',e=>{const r=$('map-stage').getBoundingClientRect();$('hover-tip').style.left=Math.max(8,Math.min(e.clientX-r.left+12,r.width-245))+'px';$('hover-tip').style.top=Math.max(8,e.clientY-r.top-45)+'px';});p.addEventListener('pointerleave',()=>$('hover-tip').hidden=true);group.append(p);return p;}
const pNodes=new Map(),dNodes=new Map();
const nationalValues=DATA.sidoMetrics.map(burden);
for(const f of provinces.values())pNodes.set(f.code,region(f,$('provinces'),()=>navigate({sido:f.code}),sidoMetrics.get(f.code),nationalValues));
for(const f of districts.values()){const values=DATA.sigunguMetrics.filter(m=>m.sido_code===f.parent).map(burden);dNodes.set(f.code,region(f,$('districts'),()=>navigate({sido:f.parent,sig:f.code}),sigMetrics.get(f.code),values));}
function unionBox(features){const b=features.map(f=>f.bounds);const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return [x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y];}
function padded(box,padding=.09){const [x,y,w,h]=box;const pad=Math.max(w,h)*padding;return [x-pad,y-pad,w+2*pad,h+2*pad];}
const nationalBox=padded(unionBox([...provinces.values()]));
// Focus the chosen district, but leave surrounding paths rendered at the edges.
function cityBox(){if(state.nearby){const points=[state.nearby.origin.point,...state.nearby.results.map(s=>s.point)];const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const w=Math.max(8,maxX-minX),h=Math.max(8,maxY-minY);return padded([(minX+maxX-w)/2,(minY+maxY-h)/2,w,h],.22);}if(state.sig)return padded(districts.get(state.sig).bounds,.28);return state.sido?padded(unionBox([provinces.get(state.sido),...DATA.maps.sigungu.filter(f=>f.parent===state.sido)])):nationalBox;}
function setBox(box){currentBox=box;$('map').setAttribute('viewBox',box.join(' '));resizeMarkers();}
function flyTo(target){cancelAnimationFrame(animation);const from=currentBox||target;if(from.every((v,i)=>Math.abs(v-target[i])<.001)){setBox(target);return;}const start=performance.now();const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:720;function tick(now){const t=duration?Math.min(1,(now-start)/duration):1;const ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;setBox(from.map((v,i)=>v+(target[i]-v)*ease));if(t<1)animation=requestAnimationFrame(tick);else renderMarkers();}animation=requestAnimationFrame(tick);}
function resizeMarkers(){if(!currentBox)return;const rect=$('map').getBoundingClientRect();const unit=Math.max(currentBox[2]/Math.max(rect.width,1),currentBox[3]/Math.max(rect.height,1));for(const marker of $('markers').children)marker.setAttribute('transform',`translate(${marker.dataset.x} ${marker.dataset.y}) scale(${unit})`);resizeLabels(unit);positionAddress();}
new ResizeObserver(()=>{renderMarkers();resizeMarkers();}).observe($('map'));
function navigate(next={}){
 state.sido=next.sido||null;state.sig=next.sig||null;state.station=next.station||null;state.cluster=null;state.nearby=next.nearby||null;
 $('hover-tip').hidden=true;
 for(const [code,p]of pNodes){p.style.display=state.sido&&code!==state.sido?'none':'';p.classList.remove('dim');p.classList.toggle('context',!!state.sido||!!state.nearby);p.setAttribute('tabindex',!state.sido&&!state.nearby?'0':'-1');}
 for(const [code,p]of dNodes){const f=districts.get(code);const visible=!!state.nearby||!!state.sido&&f.parent===state.sido;p.style.display=visible?'':'none';p.setAttribute('tabindex',visible?'0':'-1');p.style.pointerEvents='';p.classList.toggle('subdued',!!state.sig&&code!==state.sig);p.classList.toggle('selected-district',code===state.sig);p.setAttribute('aria-pressed',String(code===state.sig));}
 if(state.sig)$('districts').append(dNodes.get(state.sig));
 $('outlines').replaceChildren();
 if(state.sido)$('outlines').append(svgElement('path',{d:provinces.get(state.sido).path,class:'city-outline'}));
 renderDistrictLabels();
 const f=state.sig?districts.get(state.sig):state.sido?provinces.get(state.sido):null;
 flyTo(cityBox());
 renderMarkers();renderBreadcrumbs();if(state.nearby)renderNearbyMetrics();else renderMetrics();renderDetails();
 $('map-title').textContent=state.nearby?'입력한 주소 주변 충전소':f?(f.fullName||f.name):'전국 시·도별 부담도';
 $('map-hint').textContent=state.nearby?'파란 링: 기준 위치 · 1~5번: 직선거리순':state.sig?'옆 구역 클릭으로 이동 · 마커 선택으로 상세 확인':state.sido?'시·군·구를 눌러 들어가세요':'시·도를 눌러 들어가세요';
 $('save-place').disabled=!state.sido;
 $('save-place').hidden=!!state.nearby;
 $('back-map').hidden=!state.sido&&!state.nearby;
 $('back-map').title=state.nearby?'이전 지역 탐색으로 돌아가기':state.sig?`${provinces.get(state.sido).name} 전체 보기`:'전국 전체 보기';
 const list=$('station-list');list.replaceChildren();
 if(state.sig){const group=stationGroups.get(state.sig)||[];for(const s of group)list.append(button(s.station_name,()=>selectStation(s.station_id)));if(!group.length)list.append(node('p','이 지역에는 등록된 샘플 충전소가 없습니다.','muted'));}
}
function renderDistrictLabels(){$('district-labels').replaceChildren();}
function resizeLabels(){} // Region names are available on hover only.
// Screen-distance grouping: markers remain individually selectable from the panel/list.
function clustered(items,unit){const groups=[],buckets=new Map(),parents=items.map((_,i)=>i);const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));items.forEach((s,i)=>{const x=s.point[0]/unit,y=s.point[1]/unit,cx=Math.floor(x/25),cy=Math.floor(y/25);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of buckets.get(`${cx+dx},${cy+dy}`)||[]){const t=items[j];if(Math.hypot(x-t.point[0]/unit,y-t.point[1]/unit)<25)parents[find(i)]=find(j);}const key=`${cx},${cy}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);});const byRoot=new Map();items.forEach((s,i)=>{const r=find(i);if(!byRoot.has(r))byRoot.set(r,[]);byRoot.get(r).push(s);});groups.push(...byRoot.values());return groups;}
function renderMarkers(){
 const host=$('markers');host.replaceChildren();
 if(state.nearby){renderNearbyMarkers(host);resizeMarkers();return;}
 if(!state.sig){positionAddress();return;}
 const rect=$('map').getBoundingClientRect(),box=cityBox();
 const unit=Math.max(box[2]/Math.max(rect.width,1),box[3]/Math.max(rect.height,1));
 const items=stationGroups.get(state.sig)||[],selected=stations.get(state.station);
 const groups=clustered(items.filter(s=>s!==selected),unit);if(selected)groups.push([selected]);
 for(const group of groups){
  const s=group[0],isCluster=group.length>1;
  const point=isCluster?[group.reduce((a,s)=>a+s.point[0],0)/group.length,group.reduce((a,s)=>a+s.point[1],0)/group.length]:s.point;
  const g=svgElement('g',{class:'marker'+(isCluster?' cluster':'')+(state.station===s.station_id&&!isCluster?' selected':''),'data-station-id':isCluster?'':s.station_id});
  g.dataset.x=point[0];g.dataset.y=point[1];g.dataset.count=group.length;
  const available=s.fast_available+s.slow_available;
  g.append(svgElement('circle',{r:isCluster?13:state.station===s.station_id?10:8,fill:isCluster?'#486c55':s.status_code?'#b18a4d':available?'#367d5c':'#a9afa5'}));
  if(isCluster){const text=svgElement('text',{'text-anchor':'middle',dy:4,'font-size':11,fill:'white'});text.textContent=group.length;g.append(text);}
  const title=svgElement('title',{}),label=isCluster?`가까운 충전소 ${group.length}곳`:s.station_name;title.textContent=label;g.append(title);
  accessible(g,label,()=>isCluster?openCluster(group):selectStation(s.station_id));
  if(!isCluster){g.addEventListener('pointerenter',()=>showStationHover(s));g.addEventListener('pointerleave',()=>$('hover-tip').hidden=true);}host.append(g);
 }
 resizeMarkers();
}
function renderNearbyMarkers(host){
 const origin=state.nearby.origin;
 const g=svgElement('g',{class:'origin-marker','aria-label':'입력한 기준 위치'});g.dataset.x=origin.point[0];g.dataset.y=origin.point[1];
 g.append(svgElement('circle',{r:19,fill:'#3e83bf22',stroke:'#3e83bf','stroke-width':3}),svgElement('circle',{r:4,fill:'#3e83bf',stroke:'#fff','stroke-width':2}));const title=svgElement('title',{});title.textContent='기준 위치 · '+origin.address;g.append(title);host.append(g);
 state.nearby.results.forEach((s,i)=>{const marker=svgElement('g',{class:'marker ranked'+(state.station===s.station_id?' selected':''),'data-station-id':s.station_id,'data-rank':i+1});marker.dataset.x=s.point[0];marker.dataset.y=s.point[1];marker.append(svgElement('circle',{r:13,fill:'#365e49'}));const text=svgElement('text',{'text-anchor':'middle',dy:4,'font-size':12,fill:'white'});text.textContent=i+1;marker.append(text);accessible(marker,`${i+1}위 ${s.station_name} ${formatDistance(s.distance_m)}`,()=>selectStation(s.station_id));marker.addEventListener('pointerenter',()=>showStationHover(s));marker.addEventListener('pointerleave',()=>$('hover-tip').hidden=true);host.append(marker);});
 const selected=host.querySelector('.selected');if(selected)host.append(selected);
}
function selectStation(id){state.station=id;state.cluster=null;$('hover-tip').hidden=true;renderMarkers();renderDetails();}
function openCluster(group){state.station=null;state.cluster=group.map(s=>s.station_id);renderMarkers();renderDetails();}
function pointOnScreen(point){const rect=$('map').getBoundingClientRect();const scale=Math.min(rect.width/currentBox[2],rect.height/currentBox[3]);return [(point[0]-currentBox[0])*scale+(rect.width-currentBox[2]*scale)/2,(point[1]-currentBox[1])*scale+(rect.height-currentBox[3]*scale)/2];}
function showStationHover(s){const p=pointOnScreen(s.point),r=$('map').getBoundingClientRect();$('hover-tip').textContent=s.station_name+' · '+s.address;$('hover-tip').style.left=Math.max(8,Math.min(p[0]+14,r.width-245))+'px';$('hover-tip').style.top=Math.max(8,p[1]-50)+'px';$('hover-tip').hidden=false;}
function positionAddress(){const host=$('address-label'),s=stations.get(state.station);host.hidden=!s;if(!s||!currentBox)return;host.replaceChildren(node('strong',s.station_name),node('span',s.address));const p=pointOnScreen(s.point),rect=$('map').getBoundingClientRect();host.style.maxWidth=Math.max(110,Math.min(270,rect.width-24))+'px';const width=host.offsetWidth,height=host.offsetHeight;host.style.left=Math.max(10,Math.min(p[0]+16,rect.width-width-10))+'px';host.style.top=Math.max(10,Math.min(p[1]-height-15,rect.height-height-10))+'px';}
function renderBreadcrumbs(){const host=$('breadcrumbs');host.replaceChildren(button('전국',()=>navigate()));if(state.nearby){host.append(node('span','›'),node('strong','입력 주소 주변'));return;}if(state.sido){host.append(node('span','›'),button(provinces.get(state.sido).name,()=>navigate({sido:state.sido})));}if(state.sig)host.append(node('span','›'),node('strong',districts.get(state.sig).name));}
function renderMetrics(){let m=state.sig?sigMetrics.get(state.sig):state.sido?sidoMetrics.get(state.sido):DATA.sidoMetrics.reduce((a,v)=>({ev_count:a.ev_count+v.ev_count,fast_chargers:a.fast_chargers+v.fast_chargers,slow_chargers:a.slow_chargers+v.slow_chargers}),{ev_count:0,fast_chargers:0,slow_chargers:0});m=m||{};const host=$('metrics');host.replaceChildren();for(const [label,value]of [['전기차 등록 대수',num(m.ev_count)+'대'],['급속 충전기',num(m.fast_chargers)+'기'],['완속 충전기',num(m.slow_chargers)+'기'],['인프라 부담도',burden(m).toFixed(1)+'대']]){const box=node('div',undefined,'metric');box.append(node('small',label),node('strong',value));host.append(box);}}
function renderDetails(){
 const host=$('details');host.replaceChildren();const s=stations.get(state.station),open=!!s||!!state.cluster||!!state.nearby;
 $('map-workspace').classList.toggle('has-details',open);$('details-panel').hidden=!open;positionAddress();if(!open)return;
 if(state.nearby&&!s){renderNearbyList(host);return;}
 if(state.cluster){$('panel-caption').textContent='가까운 충전소';host.append(node('h2',`충전소 ${state.cluster.length}곳`),node('p','목록에서 충전소를 선택하세요.','muted small'));for(const id of state.cluster){const station=stations.get(id);const b=button('',()=>selectStation(id),'cluster-option');b.append(node('strong',station.station_name),node('span',station.address));host.append(b);}return;}
 $('panel-caption').textContent='충전소 상세';
 if(state.nearby){host.append(button('← 가까운 5곳 목록',()=>{state.station=null;renderMarkers();renderDetails();},'nearby-list-back'));const match=state.nearby.results.find(r=>r.station_id===s.station_id);if(match)host.append(node('p',formatDistance(match.distance_m),'distance'));}
 host.append(node('p',s.source,'badge'),node('h2',s.station_name),node('p',s.address,'detail-address'));
 const actions=node('div',undefined,'detail-actions');actions.append(button('주소 복사',()=>copyAddress(s.address)),button('☆ 즐겨찾기',()=>openFavorite({id:'station:'+s.station_id,kind:'station',code:s.station_id,alias:s.station_name,address:s.address})));host.append(actions,node('p','','copy-status'));
 if(s.status_code)host.append(node('p',`출력 ${s.output_kw}kW · 상태코드 ${s.status_code} (제공 예시)`));else host.append(node('p',`급속 ${s.fast_available}/${s.fast_total}기 · 완속 ${s.slow_available}/${s.slow_total}기 사용 가능`));
 host.append(node('p',`운영기관 ${s.operator}`),node('p',`이용시간 ${s.hours}`));if(s.phone)host.append(node('p','문의 '+s.phone));host.append(node('p','상태 기준 '+s.updated_at,'muted small'));
}
function renderNearbyMetrics(){const results=state.nearby.results,host=$('metrics');host.replaceChildren();for(const [label,value]of [['추천 충전소',results.length+'곳'],['가장 가까운 곳',results.length?formatDistance(results[0].distance_m):'없음'],['검색 범위','행정구역 무관'],['거리 기준','직선거리']]){const card=node('div',undefined,'metric');card.append(node('small',label),node('strong',value));host.append(card);}}
function renderNearbyList(host){$('panel-caption').textContent='내 주변 충전소 추천';host.append(node('h2',`가까운 충전소 ${state.nearby.results.length}곳`),node('p','기준 위치: '+state.nearby.origin.address,'nearby-origin'),node('p','직선거리순 · 실제 이동거리와 다릅니다.','muted small'),node('p','현재 충전소는 가상 샘플을 포함합니다. 실제 방문 안내용이 아닙니다.','demo-note'));if(!state.nearby.results.length){host.append(node('p','좌표가 유효한 충전소가 없습니다.'));return;}state.nearby.results.forEach((s,i)=>{const b=button('',()=>selectStation(s.station_id),'nearby-result');b.dataset.rank=i+1;b.dataset.distance=s.distance_m;b.append(node('strong',`${i+1}. ${s.station_name}`),node('span',s.address),node('small',formatDistance(s.distance_m)));host.append(b);});}
function startNearby(origin){const previous=state.nearby?.previous||{sido:state.sido,sig:state.sig};const point=projectPoint(origin.lng,origin.lat);const results=EVNearby.nearest(origin,[...stations.values()],5);hideSuggestions();setSearchMode('normal');$('search').value=origin.address;navigate({nearby:{origin:{...origin,point},results,previous}});}
function exitNearby(){const previous=state.nearby?.previous||{};navigate(previous);}
async function copyAddress(address){const status=$('details').querySelector('.copy-status');try{await navigator.clipboard.writeText(address);status.textContent='주소를 복사했습니다.';}catch{status.textContent='자동 복사가 제한되어 주소를 선택했습니다. Ctrl+C로 복사하세요.';const selection=window.getSelection(),range=document.createRange();range.selectNodeContents($('details').querySelector('.detail-address'));selection.removeAllRanges();selection.addRange(range);}}
$('close-details').addEventListener('click',()=>{if(state.nearby){exitNearby();return;}state.station=null;state.cluster=null;renderMarkers();renderDetails();});
// Search uses labels for region ordering, with the parent as a tie-breaker.
const searchIndex=[...DATA.maps.sido.map(f=>({kind:'sido',code:f.code,label:f.name,detail:'시·도',text:f.name})),...DATA.maps.sigungu.map(f=>({kind:'sig',code:f.code,label:f.name,detail:f.fullName,text:f.fullName})),...DATA.stations.map(s=>({kind:'station',code:s.station_id,label:s.station_name,detail:s.address,text:s.station_name+' '+s.address}))];
function hideSuggestions(){$('suggestions').hidden=true;$('search').setAttribute('aria-expanded','false');$('search').removeAttribute('aria-activedescendant');activeIndex=-1;}
function showSuggestions(items){suggestions=items;activeIndex=-1;const host=$('suggestions');host.replaceChildren();host.hidden=false;$('search').setAttribute('aria-expanded','true');$('search').removeAttribute('aria-activedescendant');if(!items.length){host.append(node('p','검색 결과가 없습니다.','muted'));return;}items.forEach((s,i)=>{const b=button(s.label,()=>choose(s),'suggestion');b.addEventListener('click',e=>e.stopPropagation());b.id='suggestion-'+i;b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.append(node('small',s.detail));host.append(b);});}
function search(event){
 const q=$('search').value.trim().normalize('NFC').toLocaleLowerCase('ko');
 if(searchMode==='address'){
  if(event?.type==='input'){pendingAddressId='';clearTimeout(addressTimer);$('address-search').disabled=false;$('search-status').textContent='';}
  else if(pendingAddressId||suggestions.some(s=>s.kind==='address')&&!$('suggestions').hidden)return;
  if(!q&&DATA.geocoder.mode==='demo')showSuggestions([{kind:'sample-query',label:'예시 주소로 체험하기',detail:DATA.geocoder.sampleAddress}]);else hideSuggestions();return;
 }
 if(!q){showSuggestions([{kind:'nearby',label:'📍 내 주변 충전소 찾기',detail:'도로명주소를 입력해 가까운 충전소 5곳을 찾아보세요.'}]);return;}
 showSuggestions(searchIndex.filter(s=>s.text.normalize('NFC').toLocaleLowerCase('ko').includes(q)).sort((a,b)=>(a.kind==='station')-(b.kind==='station')||collator.compare(a.label,b.label)||collator.compare(a.detail,b.detail)));
}
function choose(s){
 hideSuggestions();
 if(s.kind==='nearby'){setSearchMode('address');$('search').value='';$('search').focus();search();return;}
 if(s.kind==='sample-query'){$('search').value=DATA.geocoder.sampleAddress;requestAddress();return;}
 if(s.kind==='address'){startNearby(s.origin);return;}
 setSearchMode('normal');$('search').value=s.kind==='station'?s.detail:s.label;
 if(s.kind==='sido')navigate({sido:s.code});else if(s.kind==='sig')navigate({sido:districts.get(s.code).parent,sig:s.code});else{const station=stations.get(s.code),district=districts.get(station.sigungu_code);if(district)navigate({sido:district.parent,sig:district.code,station:s.code});}
}
function setSearchMode(mode){searchMode=mode;pendingAddressId='';clearTimeout(addressTimer);const address=mode==='address';$('address-search').hidden=!address;$('address-search').disabled=false;$('cancel-nearby').hidden=!address;$('address-help').hidden=!address;$('search-status').textContent='';$('search-label').textContent=address?'기준 위치의 도로명주소 입력':'지역 · 도로명주소 · 충전소 검색';$('search').placeholder=address?'예: 서울특별시 관악구 낙성대로4가길 5':'강, 강서구, 낙성대로…';$('address-help').textContent=DATA.geocoder.mode==='demo'?'현재는 예시 주소만 지원합니다. 카카오 API 키를 설정하면 일반 도로명주소를 검색할 수 있습니다.':'주소 검색을 누르면 입력 주소를 카카오 주소 검색에 전달합니다.';}
function requestAddress(){
 const query=$('search').value.trim();if(query.length<2){$('search-status').textContent='도로명주소를 두 글자 이상 입력해 주세요.';return;}
 hideSuggestions();pendingAddressId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);$('address-search').disabled=true;$('search-status').textContent='주소 후보를 검색하고 있습니다…';
 EVBridge.geocode(query,pendingAddressId);clearTimeout(addressTimer);addressTimer=setTimeout(()=>{pendingAddressId='';$('address-search').disabled=false;$('search-status').textContent='검색 응답이 늦어지고 있습니다. 다시 시도해 주세요.';},15000);
}
window.addEventListener('ev-geocode',event=>{
 const response=event.detail;if(searchMode!=='address'||response.requestId!==pendingAddressId)return;
 clearTimeout(addressTimer);pendingAddressId='';$('address-search').disabled=false;
 if(response.error){$('search-status').textContent=response.error;hideSuggestions();return;}
 if(!response.candidates?.length){$('search-status').textContent=DATA.geocoder.mode==='demo'?'일반 주소 검색에는 카카오 API 키가 필요합니다. 예시 주소: '+DATA.geocoder.sampleAddress:'일치하는 주소가 없습니다. 도로명과 건물번호를 확인해 주세요.';hideSuggestions();return;}
 $('search-status').textContent='정확한 기준 주소를 선택해 주세요.';
 showSuggestions(response.candidates.map(origin=>({kind:'address',origin,label:origin.address,detail:origin.source+' · 이 주소 주변 검색'})));
});
$('address-search').addEventListener('click',requestAddress);
$('cancel-nearby').addEventListener('click',()=>{setSearchMode('normal');$('search').value='';hideSuggestions();$('search').focus();});
$('search').addEventListener('focus',search);
$('search').addEventListener('click',()=>{if(!$('search').value.trim())search();});
$('search').addEventListener('input',search);
$('search').addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){hideSuggestions();if(searchMode==='address')setSearchMode('normal');return;}if(e.key==='Enter'&&searchMode==='address'&&($('suggestions').hidden||!suggestions.some(s=>s.kind==='address'||s.kind==='sample-query'))){e.preventDefault();requestAddress();return;}if($('suggestions').hidden||!suggestions.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();activeIndex=(activeIndex+(e.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length;for(const [i,n]of [...$('suggestions').children].entries())n.setAttribute('aria-selected',String(i===activeIndex));const active=$('suggestion-'+activeIndex);$('search').setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'){e.preventDefault();choose(suggestions[Math.max(0,activeIndex)]);}});
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))hideSuggestions();});
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(favorites));}catch(e){$('storage-note').textContent='저장 공간이 부족하거나 제한되어 이번 화면에서만 유지됩니다.';}renderFavorites();}
function openFavorite(f){pendingFavorite=f;$('alias').value=f.alias;$('favorite-address').textContent=f.address;$('favorite-dialog').showModal();$('alias').focus();}
function renderFavorites(){const host=$('favorites');host.replaceChildren();if(!favorites.length)host.append(node('p','저장한 장소가 없습니다. 지역 또는 충전소의 ☆ 버튼을 눌러보세요.','empty'));for(const f of favorites){const row=node('div',undefined,'fav-item'),open=button('',()=>{if(f.kind==='sido'&&provinces.has(f.code))choose({kind:'sido',code:f.code,label:provinces.get(f.code).name});else if(f.kind==='sig'&&districts.has(f.code))choose({kind:'sig',code:f.code,label:districts.get(f.code).name});else if(f.kind==='station'&&stations.has(f.code))choose({kind:'station',code:f.code,detail:stations.get(f.code).address});else $('storage-note').textContent='이 장소는 현재 데이터에 없습니다.';},'fav-open');open.append(node('strong',f.alias),node('small',f.address));const tools=node('div',undefined,'fav-tools');tools.append(button('별명',()=>openFavorite(f)),button('삭제',()=>{favorites=favorites.filter(v=>v.id!==f.id);persist();}));row.append(open,tools);host.append(row);}}
$('favorite-form').addEventListener('submit',e=>{e.preventDefault();const alias=$('alias').value.trim();if(!alias)return;const f={...pendingFavorite,alias};favorites=favorites.filter(v=>v.id!==f.id);favorites.push(f);persist();$('favorite-dialog').close();});
$('cancel-favorite').addEventListener('click',()=>$('favorite-dialog').close());
$('save-place').addEventListener('click',()=>{const f=state.sig?districts.get(state.sig):provinces.get(state.sido);if(f)openFavorite({id:(state.sig?'sig:':'sido:')+f.code,kind:state.sig?'sig':'sido',code:f.code,alias:f.name,address:f.fullName||f.name});});
$('home').addEventListener('click',e=>{e.preventDefault();navigate();});
$('back-map').addEventListener('click',()=>{if(state.nearby)exitNearby();else if(state.sig)navigate({sido:state.sido});else navigate();});
window.addEventListener('storage',e=>{if(e.key===storageKey){try{const parsed=JSON.parse(e.newValue||'[]');if(Array.isArray(parsed)){favorites=parsed.filter(f=>f&&typeof f.id==='string'&&typeof f.alias==='string'&&['sido','sig','station'].includes(f.kind));renderFavorites();}}catch{}}});
setBox(nationalBox);navigate();renderFavorites();
