'use strict';
const DATA = JSON.parse(document.getElementById('app-data').textContent);
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const collator = new Intl.Collator('ko', {numeric:true});
const provinces = new Map(DATA.maps.sido.map(f=>[f.code,f]));
const districts = new Map(DATA.maps.sigungu.map(f=>[f.code,f]));
const stations = new Map();
const sidoMetrics = new Map(DATA.sidoMetrics.map(s=>[s.sido_code,s]));
const sigMetrics = new Map(DATA.sigunguMetrics.map(s=>[s.sigungu_code,s]));
const stationGroups = new Map();
const remember=rows=>{for(const s of rows)stations.set(s.station_id,s);};
let navigationVersion=0;
const state={sido:null,sig:null,station:null,cluster:null,nearby:null,detailBox:null};
let searchMode='normal',pendingAddressId=0,searchVersion=0,searchTimer;
const formatDistance=m=>m<1000?`직선거리 약 ${Math.round(m)}m`:`직선거리 약 ${(m/1000).toFixed(1)}km`;
const projectPoint=(lng,lat)=>[Number(lng)*1000,-Math.log(Math.tan(Math.PI/4+Number(lat)*Math.PI/360))*180/Math.PI*1000];
const storageKey='ev-infra-favorites-v1';
let favorites=[], pendingFavorite=null, animation=0, currentBox=null, suggestions=[], activeIndex=-1;
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))favorites=saved.filter(f=>f&&typeof f.id==='string'&&typeof f.alias==='string'&&['sido','sig','station'].includes(f.kind));}catch(e){$('storage-note').textContent='브라우저 저장소를 사용할 수 없어 이번 화면에서만 유지됩니다.';}
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const button=(text,fn,className)=>{const b=node('button',text,className);b.type='button';b.addEventListener('click',fn);return b;};
const supplyValue=m=>m?.public_kw!=null&&m.ev_count>0?m.public_kw/m.ev_count:null;
const supplyGrades=[
 {label:'매우 부족',below:1.3,range:'<1.3',color:'#cb8072'},
 {label:'부족',below:3,range:'1.3–<3',color:'#e7b37e'},
 {label:'보통',below:5,range:'3–<5',color:'#eedfa6'},
 {label:'충분',below:8,range:'5–<8',color:'#c0dcc2'},
 {label:'여유',below:Infinity,range:'≥8',color:'#80b58f'},
];
function supplyGrade(value){
 return Number.isFinite(value)&&value>=0?supplyGrades.find(grade=>value<grade.below):null;
}
for(const grade of supplyGrades){
 const key=node('span',undefined,'grade-key-item');
 const swatch=node('span',undefined,'grade-swatch');swatch.style.backgroundColor=grade.color;
 key.append(swatch,node('span',`${grade.label} ${grade.range}`));$('grade-key').append(key);
}
$('grade-note').textContent=`공급 기준 kW/대 · 등록 ${DATA.reportMonth||'미확인'}`;
const num=n=>Number(n||0).toLocaleString('ko-KR');
function paint(value,values){if(value==null||!values.length)return '#e9ede6';const min=Math.min(...values),max=Math.max(...values);const t=max===min?.5:(value-min)/(max-min);const a=[225,238,218],b=[54,94,73];return `rgb(${a.map((x,i)=>Math.round(x+(b[i]-x)*t)).join(',')})`;}
function svgElement(tag,attrs){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
function accessible(n,label,fn){n.setAttribute('role','button');n.setAttribute('tabindex','0');n.setAttribute('aria-label',label);n.addEventListener('click',e=>{e.stopPropagation();fn();});n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}});}
function region(f,group,fn,metric,values){
 const district=!!values, count=metric?.chargers??0;
 const value=supplyValue(metric), grade=supplyGrade(value);
 const fill=district?paint(count,values):grade?.color??'#e9ede6';
 const label=f.fullName||f.name;
 const measure=district?`충전기 ${num(count)}기`:
  grade?`${metric.combined?metric.region_name+' 합산 · ':''}${grade.label} · ${value.toFixed(2)} kW/대`:'공급 등급 미집계';
 const p=svgElement('path',{d:f.path,class:'region','data-code':f.code,fill,'data-supply-grade':grade?.label??''});
 accessible(p,label,()=>{if(localBox())centerLocalMap(...f.labelPoint);else fn();});
 p.addEventListener('pointerenter',()=>{$('hover-tip').textContent=`${label} · ${measure}`;$('hover-tip').hidden=false;});
 p.addEventListener('pointermove',e=>{
  const r=$('map-stage').getBoundingClientRect();
  $('hover-tip').style.left=Math.max(8,Math.min(e.clientX-r.left+12,r.width-245))+'px';
  $('hover-tip').style.top=Math.max(8,e.clientY-r.top-45)+'px';
 });
 p.addEventListener('pointerleave',()=>{$('hover-tip').hidden=true;});
 group.append(p);return p;
}
const pNodes=new Map(),dNodes=new Map();
for(const f of provinces.values())pNodes.set(f.code,region(f,$('provinces'),()=>navigate({sido:f.code}),sidoMetrics.get(f.code)));
for(const f of districts.values()){const values=[0,...DATA.sigunguMetrics.filter(m=>m.sido_code===f.parent).map(m=>m.chargers)];dNodes.set(f.code,region(f,$('districts'),()=>navigate({sido:f.parent,sig:f.code}),sigMetrics.get(f.code),values));}
function unionBox(features){const b=features.map(f=>f.bounds);const x=Math.min(...b.map(v=>v[0])),y=Math.min(...b.map(v=>v[1]));return [x,y,Math.max(...b.map(v=>v[0]+v[2]))-x,Math.max(...b.map(v=>v[1]+v[3]))-y];}
function padded(box,padding=.09){const [x,y,w,h]=box;const pad=Math.max(w,h)*padding;return [x-pad,y-pad,w+2*pad,h+2*pad];}
const nationalBox=padded(unionBox([...provinces.values()]));
// Focus the chosen district, but leave surrounding paths rendered at the edges.
function districtBox(){return padded(districts.get(state.sig).bounds,.28);}
function selectedStationBox(){
 const station=stations.get(state.station);
 return !state.nearby&&state.sig&&station?.sigungu_code===state.sig?stationBox(station,districtBox()):null;
}
// SVG x uses 1,000 units per degree. The Mercator y axis has the same local scale.
const metersPerUnit=lat=>111.32*Math.cos(Number(lat)*Math.PI/180);
function stationBox(station, base){
 const aspect=Math.max(.8,Math.min(1.5,base[2]/base[3]));
 const width=Math.min(base[2]*.58,base[3]*.58*aspect,4800/metersPerUnit(station.lat));
 const height=width/aspect,[x,y]=station.point;
 return [x-width/2,y-height/2,width,height];
}
const latitudeAt=y=>Math.atan(Math.sinh(-y*Math.PI/180000))*180/Math.PI;
function clusterBox(group, base){
 const xs=group.map(s=>s.point[0]),ys=group.map(s=>s.point[1]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const x=(minX+maxX)/2,y=(minY+maxY)/2,aspect=Math.max(.8,Math.min(1.5,base[2]/base[3]));
 const minimum=700/metersPerUnit(latitudeAt(y));
 const desired=Math.max(minimum,(maxX-minX)*1.5,(maxY-minY)*1.5*aspect);
 const width=Math.max(Math.min(base[2],minimum),Math.min(base[2]*.64,base[3]*aspect*.64,desired));
 const height=width/aspect;
 return [x-width/2,y-height/2,width,height];
}
const localBox=()=>state.detailBox;
function centerLocalMap(x,y){
 const box=localBox();
 if(!box)return;
 const [, , width,height]=box;
 state.detailBox=[x-width/2,y-height/2,width,height];
 $('hover-tip').hidden=true;
 updateStationView();flyTo(state.detailBox);
}
function cityBox(){
 if(state.nearby){
  const points=[state.nearby.origin.point,...state.nearby.results.map(s=>s.point)];
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const w=Math.max(8,maxX-minX),h=Math.max(8,maxY-minY);
  return padded([(minX+maxX-w)/2,(minY+maxY-h)/2,w,h],.22);
 }
 if(state.sig)return localBox()||districtBox();
 return state.sido?padded(unionBox([provinces.get(state.sido),...DATA.maps.sigungu.filter(f=>f.parent===state.sido)])):nationalBox;
}
function updateScale(unit){
 const box=localBox(),scale=$('station-scale');
 scale.hidden=!box||!Number.isFinite(unit)||unit<=0;
 if(scale.hidden)return;
 const meters=unit*metersPerUnit(latitudeAt(box[1]+box[3]/2));
 const span=[2000,1000,500,200,100,50].find(distance=>distance/meters<=85)??50;
 scale.style.width=Math.round(span/meters)+'px';
 scale.firstElementChild.textContent=span>=1000?`${span/1000} km`:`${span} m`;
}
function updateStationView(){
 const station=stations.get(state.station),focus=localBox(),toggle=$('station-focus-toggle'),overview=$('station-overview');
 const canFocus=!!focus||(!!station&&!state.nearby&&!!state.sig&&station.sigungu_code===state.sig);
 $('map-workspace').classList.toggle('has-station-location',canFocus);
 toggle.hidden=!!focus||!canFocus;
 $('map-stage').classList.toggle('can-center-map',!!focus);
 $('home').setAttribute('aria-disabled',String(!!focus));$('home').tabIndex=focus?-1:0;
 overview.hidden=!focus;
 $('map-hint').textContent=state.nearby?'파란 링: 기준 위치 · 1~5번: 직선거리순':
  focus?'지도 클릭으로 중앙 이동 · 한 단계 뒤로로 시군구 전체 보기':state.sig?'옆 구역 클릭으로 이동 · 마커 선택으로 충전소 정보 보기':
  state.sido?'시·군·구를 눌러 들어가세요':'시·도를 눌러 들어가세요';
 $('back-map').title=focus?'시군구 전체 보기':state.nearby?'이전 지역 탐색으로 돌아가기':
  state.sig?`${provinces.get(state.sido).name} 전체 보기`:'전국 전체 보기';
 const map=$('station-overview-map');map.replaceChildren();
 if(!focus)return;
 const district=districts.get(state.sig),base=districtBox();
 const overviewBox=unionBox([{bounds:base},{bounds:focus}]);
 const [left,top,w,h]=overviewBox,[x,y,width,height]=focus;
 map.setAttribute('viewBox',overviewBox.join(' '));
 for(const region of districts.values()){
  const [rx,ry,rw,rh]=region.bounds;
  if(rx>left+w||rx+rw<left||ry>top+h||ry+rh<top)continue;
  map.append(svgElement('path',{d:region.path,class:region.code===district.code?'overview-selected':'overview-neighbor'}));
 }
 map.append(svgElement('rect',{x,y,width,height,class:'overview-frame'}),
            svgElement('circle',{cx:x+width/2,cy:y+height/2,r:Math.max(w,h)*.03,class:'overview-pin'}));
 $('station-overview-label').textContent=`${district.name} 기준 위치`;
}
function setStationFocus(focused){
 state.detailBox=focused?selectedStationBox():null;renderBreadcrumbs();updateStationView();flyTo(cityBox());renderMarkers();
}
// Fit the camera to the full map area. The details panel crops the sides at that scale.
const mapWorkspace=$('map-workspace'),mapCard=mapWorkspace.querySelector('.map-card'),mapSvg=$('map');
function viewportBox(box){
 const [x,y,w,h]=box,{clientWidth:width,clientHeight:height}=mapSvg;
 const fullWidth=mapWorkspace.clientWidth-(mapCard.offsetWidth-mapCard.clientWidth);
 if(!width||!height||!fullWidth)return box;
 const unit=Math.max(w/fullWidth,h/height),visibleWidth=unit*width,visibleHeight=unit*height;
 return [x+(w-visibleWidth)/2,y+(h-visibleHeight)/2,visibleWidth,visibleHeight];
}
let visibleBox=null;
function setBox(box){
 currentBox=box;visibleBox=viewportBox(box);mapSvg.setAttribute('viewBox',visibleBox.join(' '));
 resizeMarkers();EVRoadMap.frame(visibleBox);
}
function flyTo(target){
 cancelAnimationFrame(animation);animation=0;
 if(localBox())EVRoadMap.enter(viewportBox(target));else EVRoadMap.leave();
 const from=currentBox||target;
 if(from.every((v,i)=>Math.abs(v-target[i])<.001)){setBox(target);EVRoadMap.finish(visibleBox);return;}
 const start=performance.now(),duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:720;
 function tick(now){
  const t=duration?Math.min(1,(now-start)/duration):1,ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  setBox(from.map((v,i)=>v+(target[i]-v)*ease));
  if(t<1)animation=requestAnimationFrame(tick);
  else{animation=0;renderMarkers();EVRoadMap.finish(visibleBox);}
 }
 animation=requestAnimationFrame(tick);
}
function resizeMarkers(){if(!currentBox)return;const rect=$('map').getBoundingClientRect();const unit=Math.max(visibleBox[2]/Math.max(rect.width,1),visibleBox[3]/Math.max(rect.height,1));for(const marker of $('markers').children)marker.setAttribute('transform',`translate(${marker.dataset.x} ${marker.dataset.y}) scale(${unit})`);resizeLabels(unit);positionAddress();updateScale(unit);}
new ResizeObserver(()=>{
 if(!currentBox)return;
 setBox(currentBox);renderMarkers();EVRoadMap.resize(visibleBox);
}).observe(mapSvg);
function navigate(next={}){
 navigationVersion++;
 state.sido=next.sido||null;state.sig=next.sig||null;state.station=next.station||null;state.cluster=null;state.nearby=next.nearby||null;state.detailBox=selectedStationBox();
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
 $('map-title').textContent=state.nearby?'입력한 주소 주변 충전소':f?(f.fullName||f.name):'전국 시·도별 충전 인프라 공급 등급';
 updateStationView();
 $('save-place').disabled=!state.sido;
 $('save-place').hidden=!!state.nearby;
 $('back-map').hidden=!state.sido&&!state.nearby;
 const showsDistricts=!!(state.sido||state.nearby);
 $('grade-legend').hidden=showsDistricts;
 $('count-legend').hidden=!showsDistricts;
 $('station-list').replaceChildren();
 if(state.sig)loadDistrict(state.sig,navigationVersion);
}
async function loadDistrict(code,version){
 const list=$('station-list');
 if(!stationGroups.has(code)){
  list.replaceChildren(node('p','충전소를 불러오는 중…','muted'));
  const result=await EVBridge.request('district',{code});
  if(result.cancelled)return;
  if(result.error){
   if(version===navigationVersion)list.replaceChildren(node('p',result.error),button('다시 조회',()=>loadDistrict(code,version)));
   return;
  }
  remember(result.stations);stationGroups.set(code,result.stations);
 }
 if(version!==navigationVersion)return;
 renderMarkers();
 const rows=stationGroups.get(code);list.replaceChildren(node('p',`충전소 ${num(rows.length)}곳`,'muted small'));
 function showBatch(start){
  for(const s of rows.slice(start,start+100))list.append(button(s.station_name,()=>selectStation(s.station_id)));
  if(start+100<rows.length){const more=button('더 보기',()=>{more.remove();showBatch(start+100);});list.append(more);}
 }
 showBatch(0);
}
function renderDistrictLabels(){$('district-labels').replaceChildren();}
function resizeLabels(){} // Region names are available on hover only.
// Screen-distance grouping: markers remain individually selectable from the panel/list.
function clustered(items,unit){const groups=[],buckets=new Map(),parents=items.map((_,i)=>i);const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));items.forEach((s,i)=>{const x=s.point[0]/unit,y=s.point[1]/unit,cx=Math.floor(x/25),cy=Math.floor(y/25);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of buckets.get(`${cx+dx},${cy+dy}`)||[]){const t=items[j];if(Math.hypot(x-t.point[0]/unit,y-t.point[1]/unit)<25)parents[find(i)]=find(j);}const key=`${cx},${cy}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);});const byRoot=new Map();items.forEach((s,i)=>{const r=find(i);if(!byRoot.has(r))byRoot.set(r,[]);byRoot.get(r).push(s);});groups.push(...byRoot.values());return groups;}
function renderMarkers(){
 const host=$('markers');host.replaceChildren();
 if(state.nearby){renderNearbyMarkers(host);resizeMarkers();return;}
 if(!state.sig){positionAddress();return;}
 const rect=mapSvg.getBoundingClientRect(),box=viewportBox(cityBox());
 const unit=Math.max(box[2]/Math.max(rect.width,1),box[3]/Math.max(rect.height,1));
 const items=stationGroups.get(state.sig)||[],selected=stations.get(state.station);
 const marginX=(rect.width*unit-box[2])/2+12*unit,marginY=(rect.height*unit-box[3])/2+12*unit;
 const visible=localBox()?items.filter(({point:[x,y]})=>
  x>=box[0]-marginX&&x<=box[0]+box[2]+marginX&&y>=box[1]-marginY&&y<=box[1]+box[3]+marginY):items;
 const groups=clustered(visible.filter(s=>s!==selected),unit);if(selected)groups.push([selected]);
 for(const group of groups){
  const s=group[0],isCluster=group.length>1;
  const point=isCluster?[group.reduce((a,s)=>a+s.point[0],0)/group.length,group.reduce((a,s)=>a+s.point[1],0)/group.length]:s.point;
  const g=svgElement('g',{class:'marker'+(isCluster?' cluster':'')+(state.station===s.station_id&&!isCluster?' selected':''),'data-station-id':isCluster?'':s.station_id});
  g.dataset.x=point[0];g.dataset.y=point[1];g.dataset.count=group.length;
  g.append(svgElement('circle',{r:isCluster?13:state.station===s.station_id?10:8,fill:isCluster?'#486c55':'#617f6c'}));
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
function selectStation(id){
 state.station=id;state.cluster=null;$('hover-tip').hidden=true;
 renderDetails();updateStationView();renderMarkers();
}
function openCluster(group){
 const target=clusterBox(group,cityBox());
 state.station=null;state.cluster=group.map(s=>s.station_id);state.detailBox=target;renderBreadcrumbs();
 $('hover-tip').hidden=true;renderDetails();updateStationView();flyTo(target);renderMarkers();
}
function pointOnScreen([x,y]){
 const rect=mapSvg.getBoundingClientRect(),point=new DOMPoint(x,y).matrixTransform(mapSvg.getScreenCTM());
 return [point.x-rect.left,point.y-rect.top];
}
function showStationHover(s){const p=pointOnScreen(s.point),r=$('map').getBoundingClientRect();$('hover-tip').textContent=s.station_name+' · '+s.address;$('hover-tip').style.left=Math.max(8,Math.min(p[0]+14,r.width-245))+'px';$('hover-tip').style.top=Math.max(8,p[1]-50)+'px';$('hover-tip').hidden=false;}
function positionAddress(){
 const host=$('address-label'),station=stations.get(state.station);
 host.hidden=true;
 if(!station?.sigungu_code||!currentBox)return;
 const point=pointOnScreen(station.point),rect=$('map').getBoundingClientRect();
 if(point[0]<0||point[0]>rect.width||point[1]<0||point[1]>rect.height)return;
 if(host.dataset.station!==station.station_id){
  host.dataset.station=station.station_id;host.replaceChildren(node('strong',station.station_name),node('span',station.address));
 }
 host.hidden=false;
 host.style.maxWidth=Math.max(110,Math.min(270,rect.width-24))+'px';
 host.style.left=Math.max(10,Math.min(point[0]+16,rect.width-host.offsetWidth-10))+'px';
 host.style.top=Math.max(10,Math.min(point[1]-host.offsetHeight-15,rect.height-10))+'px';
}
function renderBreadcrumbs(){
 const host=$('breadcrumbs');
 const item=(label,action)=>localBox()?node('span',label):button(label,action);
 host.replaceChildren(item('전국',()=>navigate()));
 if(state.nearby){host.append(node('span','›'),node('strong','입력 주소 주변'));return;}
 if(state.sido)host.append(node('span','›'),item(provinces.get(state.sido).name,()=>navigate({sido:state.sido})));
 if(state.sig)host.append(node('span','›'),node('strong',districts.get(state.sig).name));
}
function renderMetrics(){
 const m=(state.sig?sigMetrics.get(state.sig):state.sido?sidoMetrics.get(state.sido):DATA.nationalMetrics)||{};
 const host=$('metrics');host.replaceChildren();
 const suffix=m.combined?` · ${m.region_name} 합산`:'';
 const grade=supplyGrade(supplyValue(m));
 for(const [label,value] of [['전기차 등록 대수'+suffix,m.ev_count==null?'미집계':num(m.ev_count)+'대'],
                            ['충전기 수'+suffix,num(m.chargers)+'기'],
                            ['급속 · 완속',num(m.fast_chargers)+' · '+num(m.slow_chargers)+'기'],
                            ['충전 인프라 공급 등급',grade?.label??'미집계']]){
  const box=node('div',undefined,'metric'), result=node('strong',value);
  if(label==='충전 인프라 공급 등급'&&grade){result.classList.add('grade-badge');result.style.backgroundColor=grade.color;}
  box.append(node('small',label),result);host.append(box);
 }
}
let stationApi=null;
const statusLabels=new Map([['0','알 수 없음'],['1','통신 이상'],['2','사용 가능'],['3','충전 중'],['4','운영 중지'],['5','점검 중']]);
const statusLabel=code=>statusLabels.get(String(code)) ?? '알 수 없음';
const isAvailable=code=>String(code)==='2';

async function requestStationApi(action, station){
 const active=stationApi;
 if(active?.station!==station||active.pending)return;
 active.pending=true;active.error='';renderDetails();
 const result=await EVBridge.request(action,{stationId:station});
 if(stationApi!==active)return;
 active.pending=false;active.error=result.error;
 if(result.statuses){active.statuses=result.statuses;active.sync=result.sync;}
 if(result.cafes)active.cafes=result.cafes;
 renderDetails();
}
function renderAvailability(host, station, rows){
 if(!rows){
  host.append(node('p','충전기 대수 '+(stationApi?.pending ? '조회 중…' : '미확인'),'muted small'));
  return;
 }
 const bins=[['급속',0,0],['완속',0,0],['중속',0,0],['출력 미확인',0,0]];
 for(const row of rows){
  const power=Number(row.outputKw);
  const bin=bins[!Number.isFinite(power)||power<=0 ? 3 : power>=50 ? 0 : power<30 ? 1 : 2];
  bin[2]++;
  bin[1]+=Number(isAvailable(row.status));
 }
 const available=bins.reduce((n,bin)=>n+bin[1],0), total=bins.reduce((n,bin)=>n+bin[2],0);
 host.append(node('p',`전체 ${available}/${total}기 사용 가능${rows?' (저장 상태 기준)':''}`,'availability'),
             node('p',bins.filter((bin,index)=>index<2||bin[2]).map(([name,ready,count])=>`${name} ${ready}/${count}기`).join(' · ')+' 사용 가능'));
}
function renderAccess(host, data){
 const parking={Y:'무료',N:'무료 주차 아님'}[data.parkingFree] ?? '미확인';
 const limited={Y:'이용 제한 있음',N:'이용 제한 없음'}[data.limitYn] ?? '미확인';
 host.append(node('p',`주차 · ${parking}`),node('p',`이용 · ${limited}`),
             node('p',`제한 상세 · ${data.limitDetail?.trim() || '미제공'}`,'muted small'));
}
function renderStationApi(host, station){
 if(!DATA.stationApis)return;
 const buttons=node('div',undefined,'detail-actions');
 for(const [action,label] of [['stored-status','저장 상태 다시 읽기'],['cafes','주변 카페 찾기']]){
  if(action==='cafes'&&(!DATA.stationApis.cafes||!station.sigungu_code))continue;
  const control=button(label,()=>requestStationApi(action,station.station_id));control.disabled=!!stationApi?.pending;buttons.append(control);
 }
 if(buttons.childElementCount)host.append(buttons);
 if(!stationApi)return;
 const result=stationApi;
 if(result.pending)host.append(node('p','조회 중…','muted small'));
 if(result.error)host.append(node('p',result.error,'demo-note'));
 if(result.statuses){
  host.append(node('h3','저장된 충전기 상태'));
  const sync=result.sync;
  host.append(node('p',sync?`전국 수집 ${sync.lastSuccess} UTC`:'전국 수집 기록 없음','muted small'));
  if(sync?.stale)host.append(node('p','전국 상태 수집이 지연되고 있습니다.','demo-note'));
  if(sync?.gap)host.append(node('p','10분을 넘긴 수집 공백이 기록되어 일부 상태 확인이 필요할 수 있습니다.','muted small'));
  if(!result.statuses.length)host.append(node('p','DB에서 연결된 충전기를 찾지 못했습니다.','muted small'));
  for(const row of result.statuses){
   host.append(node('p',`${row.charger}번 · ${statusLabel(row.status)} · 변경(KST) ${row.changed ?? '미확인'}`),
               node('p',row.checked ? `API 관측 ${row.checked} UTC` : 'API 관측 기록 없음','muted small'));
   renderAccess(host,row);
  }
 }
 if(result.cafes){
  host.append(node('h3','300m 이내 카페 · 최대 10곳'));
  if(!result.cafes.length)host.append(node('p','주변 카페 결과가 없습니다.','muted small'));
  for(const place of result.cafes)host.append(node('p',`${place.name} · ${place.distance}m`),node('p',place.address,'muted small'));
 }
}
function renderDetails(){
 const s=stations.get(state.station),panel=$('details-panel');
 if(panel.dataset.station!==(state.station || '')){
  panel.dataset.station=state.station || '';panel.scrollTop=0;
  stationApi=null;
  if(s){
   stationApi={station:s.station_id};
   queueMicrotask(()=>requestStationApi('stored-status',s.station_id));
  }
 }
 const host=$('details');host.replaceChildren();const open=!!s||!!state.cluster||!!state.nearby;
 $('map-workspace').classList.toggle('has-details',open);$('details-panel').hidden=!open;positionAddress();if(!open)return;
 if(state.nearby&&!s){renderNearbyList(host);return;}
 if(state.cluster){$('panel-caption').textContent='가까운 충전소';host.append(node('h2',`충전소 ${state.cluster.length}곳`),node('p','목록에서 충전소를 선택하세요.','muted small'));for(const id of state.cluster){const station=stations.get(id);const b=button('',()=>selectStation(id),'cluster-option');b.append(node('strong',station.station_name),node('span',station.address));host.append(b);}return;}
 $('panel-caption').textContent='충전소 상세';
 if(state.nearby){host.append(button('← 가까운 5곳 목록',()=>{state.station=null;renderMarkers();renderDetails();},'nearby-list-back'));const match=state.nearby.results.find(r=>r.station_id===s.station_id);if(match)host.append(node('p',formatDistance(match.distance_m),'distance'));}
 host.append(node('p',s.source,'badge'),node('h2',s.station_name),node('p',s.address,'detail-address'));
 const actions=node('div',undefined,'detail-actions');actions.append(button('주소 복사',()=>copyAddress(s.address)),button('☆ 즐겨찾기',()=>openFavorite({id:'station:'+s.station_id,kind:'station',code:s.station_id,alias:s.station_name,address:s.address})));host.append(actions,node('p','','copy-status'));
 renderAvailability(host,s,stationApi?.statuses);
 host.append(node('p',`운영기관 ${s.operator}`),node('p',`이용시간 ${s.hours}`));if(s.phone)host.append(node('p','문의 '+s.phone));if(!s.sigungu_code)host.append(node('p','지도 위치 검토 중','demo-note'));
 renderStationApi(host,s);
}
const detailsPanel=$('details-panel');
let panelDrag;
detailsPanel.addEventListener('pointerdown',event=>{
 if(event.pointerType!=='mouse'||event.button!==0||detailsPanel.scrollHeight<=detailsPanel.clientHeight||
    event.target.closest('button,a,input,textarea,select,.detail-address')||
    event.clientX>=detailsPanel.getBoundingClientRect().left+detailsPanel.clientWidth)return;
 panelDrag={id:event.pointerId,y:event.clientY,scroll:detailsPanel.scrollTop};
 detailsPanel.setPointerCapture(event.pointerId);
});
detailsPanel.addEventListener('pointermove',event=>{
 if(panelDrag?.id!==event.pointerId)return;
 const distance=event.clientY-panelDrag.y;
 if(Math.abs(distance)>4)detailsPanel.classList.add('is-dragging');
 if(detailsPanel.classList.contains('is-dragging'))detailsPanel.scrollTop=panelDrag.scroll-distance;
});
detailsPanel.addEventListener('lostpointercapture',()=>{panelDrag=null;detailsPanel.classList.remove('is-dragging');});

function renderNearbyMetrics(){const results=state.nearby.results,host=$('metrics');host.replaceChildren();for(const [label,value]of [['추천 충전소',results.length+'곳'],['가장 가까운 곳',results.length?formatDistance(results[0].distance_m):'없음'],['검색 범위','행정구역 무관'],['거리 기준','직선거리']]){const card=node('div',undefined,'metric');card.append(node('small',label),node('strong',value));host.append(card);}}
function renderNearbyList(host){$('panel-caption').textContent='내 주변 충전소 추천';host.append(node('h2',`가까운 충전소 ${state.nearby.results.length}곳`),node('p','기준 위치: '+state.nearby.origin.address,'nearby-origin'),node('p','직선거리순 · 실제 이동거리와 다릅니다.','muted small'));if(!state.nearby.results.length){host.append(node('p','좌표가 유효한 충전소가 없습니다.'));return;}state.nearby.results.forEach((s,i)=>{const b=button('',()=>selectStation(s.station_id),'nearby-result');b.dataset.rank=i+1;b.dataset.distance=s.distance_m;b.append(node('strong',`${i+1}. ${s.station_name}`),node('span',s.address),node('small',formatDistance(s.distance_m)));host.append(b);});}
async function startNearby(origin){
 const previous=state.nearby?.previous||{sido:state.sido,sig:state.sig};
 const version=navigationVersion, searchId=++pendingAddressId;
 $('search-status').textContent='가까운 충전소를 찾고 있습니다…';
 const result=await EVBridge.request('nearby',{lat:origin.lat,lng:origin.lng});
 if(version!==navigationVersion||searchId!==pendingAddressId)return;
 if(result.error){$('search-status').textContent=result.error;return;}
 remember(result.stations);hideSuggestions();setSearchMode('normal');$('search').value=origin.address;
 navigate({nearby:{origin:{...origin,point:projectPoint(origin.lng,origin.lat)},results:result.stations,previous}});
}
function exitNearby(){const previous=state.nearby?.previous||{};navigate(previous);}
async function copyAddress(address){const status=$('details').querySelector('.copy-status');try{await navigator.clipboard.writeText(address);status.textContent='주소를 복사했습니다.';}catch{status.textContent='자동 복사가 제한되어 주소를 선택했습니다. Ctrl+C로 복사하세요.';const selection=window.getSelection(),range=document.createRange();range.selectNodeContents($('details').querySelector('.detail-address'));selection.removeAllRanges();selection.addRange(range);}}
$('close-details').addEventListener('click',()=>{if(state.nearby){exitNearby();return;}state.station=null;state.cluster=null;renderDetails();updateStationView();renderMarkers();});
// Search uses labels for region ordering, with the parent as a tie-breaker.
const searchIndex=[...DATA.maps.sido.map(f=>({kind:'sido',code:f.code,label:f.name,detail:'시·도',text:f.name})),...DATA.maps.sigungu.map(f=>({kind:'sig',code:f.code,label:f.name,detail:f.fullName,text:f.fullName}))];
function hideSuggestions(){searchVersion++;clearTimeout(searchTimer);$('suggestions').hidden=true;$('search').setAttribute('aria-expanded','false');$('search').removeAttribute('aria-activedescendant');activeIndex=-1;}
function showSuggestions(items){suggestions=items;activeIndex=-1;const host=$('suggestions');host.replaceChildren();host.hidden=false;$('search').setAttribute('aria-expanded','true');$('search').removeAttribute('aria-activedescendant');if(!items.length){host.append(node('p','검색 결과가 없습니다.','muted'));return;}items.forEach((s,i)=>{const b=button(s.label,()=>choose(s),'suggestion');b.addEventListener('click',e=>e.stopPropagation());b.id='suggestion-'+i;b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.append(node('small',s.detail));host.append(b);});}
function search(event){
 const q=$('search').value.trim().normalize('NFC').toLocaleLowerCase('ko');
 if(searchMode==='address'){
  if(event?.type==='input'){pendingAddressId++;$('address-search').disabled=false;$('search-status').textContent='';}
  else if($('address-search').disabled||suggestions.some(s=>s.kind==='address')&&!$('suggestions').hidden)return;
  hideSuggestions();return;
 }
 const version=++searchVersion;clearTimeout(searchTimer);
 if(!q){showSuggestions([{kind:'nearby',label:'📍 내 주변 충전소 찾기',detail:'도로명주소를 입력해 가까운 충전소 5곳을 찾아보세요.'}]);return;}
 const local=searchIndex.filter(s=>s.text.normalize('NFC').toLocaleLowerCase('ko').includes(q)).sort((a,b)=>collator.compare(a.label,b.label)||collator.compare(a.detail,b.detail));
 showSuggestions(local);
 searchTimer=setTimeout(async()=>{
  const result=await EVBridge.request('search',{query:q});
  if(version!==searchVersion||searchMode!=='normal'||result.cancelled)return;
  if(result.error){$('search-status').textContent=result.error;return;}
  remember(result.stations);
  showSuggestions([...local,...result.stations.map(s=>({kind:'station',code:s.station_id,label:s.station_name,detail:s.address}))]);
 },250);
}
function choose(s){
 hideSuggestions();
 if(s.kind==='nearby'){setSearchMode('address');$('search').value='';$('search').focus();search();return;}
 if(s.kind==='address'){startNearby(s.origin);return;}
 setSearchMode('normal');$('search').value=s.kind==='station'?s.detail:s.label;
 if(s.kind==='sido')navigate({sido:s.code});else if(s.kind==='sig')navigate({sido:districts.get(s.code).parent,sig:s.code});else{const station=stations.get(s.code),district=districts.get(station?.sigungu_code);if(station)navigate({sido:district?.parent,sig:district?.code,station:s.code});}
}
function setSearchMode(mode){searchMode=mode;pendingAddressId++;const address=mode==='address';$('address-search').hidden=!address;$('address-search').disabled=false;$('cancel-nearby').hidden=!address;$('address-help').hidden=!address;$('search-status').textContent='';$('search-label').textContent=address?'기준 위치의 도로명주소 입력':'지역 · 도로명주소 · 충전소 검색';$('search').placeholder=address?'예: 서울특별시 관악구 낙성대로4가길 5':'강, 강서구, 낙성대로…';$('address-help').textContent=DATA.geocoder.mode==='database'?'DB에 등록된 충전소 주소를 기준 위치로 검색할 수 있습니다.':'주소 검색을 누르면 입력 주소를 카카오 주소 검색에 전달합니다.';}
async function requestAddress(){
 const query=$('search').value.trim();if(query.length<2){$('search-status').textContent='도로명주소를 두 글자 이상 입력해 주세요.';return;}
 hideSuggestions();const id=++pendingAddressId;$('address-search').disabled=true;$('search-status').textContent='주소 후보를 검색하고 있습니다…';
 const response=await EVBridge.request('geocode',{query});
 if(searchMode!=='address'||id!==pendingAddressId)return;
 $('address-search').disabled=false;
 if(response.error){$('search-status').textContent=response.error;hideSuggestions();return;}
 if(!response.candidates?.length){$('search-status').textContent='일치하는 주소가 없습니다. 도로명과 건물번호를 확인해 주세요.';hideSuggestions();return;}
 $('search-status').textContent='정확한 기준 주소를 선택해 주세요.';
 showSuggestions(response.candidates.map(origin=>({kind:'address',origin,label:origin.address,detail:origin.source+' · 이 주소 주변 검색'})));
}
$('address-search').addEventListener('click',requestAddress);
$('cancel-nearby').addEventListener('click',()=>{setSearchMode('normal');$('search').value='';hideSuggestions();$('search').focus();});
$('search').addEventListener('focus',search);
$('search').addEventListener('click',()=>{if(!$('search').value.trim())search();});
$('search').addEventListener('input',search);
$('search').addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){hideSuggestions();if(searchMode==='address')setSearchMode('normal');return;}if(e.key==='Enter'&&searchMode==='address'&&($('suggestions').hidden||!suggestions.some(s=>s.kind==='address'))){e.preventDefault();requestAddress();return;}if($('suggestions').hidden||!suggestions.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();activeIndex=(activeIndex+(e.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length;for(const [i,n]of [...$('suggestions').children].entries())n.setAttribute('aria-selected',String(i===activeIndex));const active=$('suggestion-'+activeIndex);$('search').setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'){e.preventDefault();choose(suggestions[Math.max(0,activeIndex)]);}});
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))hideSuggestions();});
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(favorites));}catch(e){$('storage-note').textContent='저장 공간이 부족하거나 제한되어 이번 화면에서만 유지됩니다.';}renderFavorites();}
function openFavorite(f){pendingFavorite=f;$('alias').value=f.alias;$('favorite-address').textContent=f.address;$('favorite-dialog').showModal();$('alias').focus();}
function renderFavorites(){const host=$('favorites');host.replaceChildren();if(!favorites.length)host.append(node('p','저장한 장소가 없습니다. 지역 또는 충전소의 ☆ 버튼을 눌러보세요.','empty'));for(const f of favorites){const row=node('div',undefined,'fav-item'),open=button('',async()=>{if(f.kind==='sido'&&provinces.has(f.code))choose({kind:'sido',code:f.code,label:provinces.get(f.code).name});else if(f.kind==='sig'&&districts.has(f.code))choose({kind:'sig',code:f.code,label:districts.get(f.code).name});else if(f.kind==='station'){
  const version=navigationVersion;
  if(!stations.has(f.code)){
   const result=await EVBridge.request('find-station',{stationId:f.code});
   if(version!==navigationVersion)return;
   if(result.error){$('storage-note').textContent=result.error;return;}
   remember(result.stations);
  }
  choose({kind:'station',code:f.code,detail:stations.get(f.code).address});
 }else $('storage-note').textContent='이 장소는 현재 데이터에 없습니다.';},'fav-open');open.append(node('strong',f.alias),node('small',f.address));const tools=node('div',undefined,'fav-tools');tools.append(button('별명',()=>openFavorite(f)),button('삭제',()=>{favorites=favorites.filter(v=>v.id!==f.id);persist();}));row.append(open,tools);host.append(row);}}
$('favorite-form').addEventListener('submit',e=>{e.preventDefault();const alias=$('alias').value.trim();if(!alias)return;const f={...pendingFavorite,alias};favorites=favorites.filter(v=>v.id!==f.id);favorites.push(f);persist();$('favorite-dialog').close();});
$('cancel-favorite').addEventListener('click',()=>$('favorite-dialog').close());
$('save-place').addEventListener('click',()=>{const f=state.sig?districts.get(state.sig):provinces.get(state.sido);if(f)openFavorite({id:(state.sig?'sig:':'sido:')+f.code,kind:state.sig?'sig':'sido',code:f.code,alias:f.name,address:f.fullName||f.name});});
$('home').addEventListener('click',e=>{e.preventDefault();if(!localBox())navigate();});
$('back-map').addEventListener('click',()=>{if(localBox())setStationFocus(false);else if(state.nearby)exitNearby();else if(state.sig)navigate({sido:state.sido});else navigate();});
$('station-focus-toggle').addEventListener('click',()=>setStationFocus(true));
$('map').addEventListener('click',event=>{
 if(!localBox()||event.target.closest('.marker'))return;
 const matrix=$('map').getScreenCTM();
 if(!matrix)return;
 event.stopPropagation();
 const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
 centerLocalMap(point.x,point.y);
},true);
window.addEventListener('storage',e=>{if(e.key===storageKey){try{const parsed=JSON.parse(e.newValue||'[]');if(Array.isArray(parsed)){favorites=parsed.filter(f=>f&&typeof f.id==='string'&&typeof f.alias==='string'&&['sido','sig','station'].includes(f.kind));renderFavorites();}}catch{}}});
setBox(nationalBox);navigate();renderFavorites();
