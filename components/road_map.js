/* The SVG remains the interactive map. This module paints a local road background. */
(() => {
 const cdn='https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/';
 const styleUrl='https://tiles.openfreemap.org/styles/positron';
 const stage=document.getElementById('map-stage');
 const layer=document.getElementById('road-basemap');
 const attribution=document.getElementById('road-attribution');
 let assets, map, creating, roads, target, moving=false, shown=false, camera;

 function visible(show){
  shown=show;
  stage.classList.toggle('has-road-map',show);
  attribution.hidden=!show;
 }

 function loadTag(tag, settings){
  return new Promise((resolve,reject)=>{
   const element=Object.assign(document.createElement(tag),settings);
   const timeout=setTimeout(fail,9000);
   function fail(){clearTimeout(timeout);element.remove();reject(new Error('Road map asset unavailable'));}
   element.onload=()=>{clearTimeout(timeout);resolve();};
   element.onerror=fail;
   document.head.append(element);
  });
 }

 async function roadStyle(){
  const response=await fetch(styleUrl,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('Road map style unavailable');
  const style=await response.json();
  const layers=style.layers.filter(item=>{
   const source=item['source-layer'];
   if(item.type==='background'||source==='water'||source==='waterway'&&item.type==='line')return true;
   if(source==='transportation')return /^(highway_|tunnel_motorway_)/.test(item.id);
   return source==='transportation_name'&&/^highway-name-(major|minor)$/.test(item.id);
  }).map(item=>item['source-layer']==='transportation_name'?{
   ...item,layout:{...item.layout,'text-field':['coalesce',['get','name:ko'],['get','name'],['get','name:latin']]}
  }:item);
  const roads=layers.filter(item=>item.type==='line'&&item['source-layer']==='transportation').map(item=>item.id);
  if(!roads.length)throw new Error('Road layers unavailable');
  const sources=Object.fromEntries(layers.filter(item=>item.source).map(item=>[item.source,style.sources[item.source]]));
  return {style:{version:8,glyphs:style.glyphs,sprite:style.sprite,sources,layers},roads};
 }

 function initialize(){
  if(!assets){
   const sdk=window.maplibregl?Promise.resolve():loadTag('script',{src:cdn+'maplibre-gl.js'});
   const css=document.querySelector(`link[href="${cdn}maplibre-gl.css"]`)?Promise.resolve():
    loadTag('link',{rel:'stylesheet',href:cdn+'maplibre-gl.css'});
   assets=Promise.all([roadStyle(),sdk,css]).then(([style])=>style).catch(error=>{assets=null;throw error;});
  }
  return assets;
 }

 function cameraFor(box){
  const [x,y,w,h]=box,{clientWidth:width,clientHeight:height}=layer;
  if(!width||!height)return null;
  const unit=Math.max(w/width,h/height);
  const lng=(x+w/2)/1000,lat=Math.atan(Math.sinh(-(y+h/2)*Math.PI/180000))*180/Math.PI;
  return {width,height,lng,lat,zoom:Math.log2(360000/(512*unit))};
 }

 function move(box){
  const next=cameraFor(box);
  if(!next||!map)return;
  if(!camera||next.width!==camera.width||next.height!==camera.height)map.resize();
  if(!camera||next.lng!==camera.lng||next.lat!==camera.lat||next.zoom!==camera.zoom){
   map.jumpTo({center:[next.lng,next.lat],zoom:next.zoom});
  }
  camera=next;
 }

 function showWhenReady(){
  if(!target||moving||shown||!map?.loaded())return;
  if(map.queryRenderedFeatures({layers:roads}).length)visible(true);
 }

 function ensureMap(){
  if(creating||map)return;
  creating=initialize().then(loaded=>{
   if(!target)return;
   const initial=cameraFor(target);
   if(!initial)return;
   roads=loaded.roads;
   map=new window.maplibregl.Map({container:layer,style:loaded.style,
    center:[initial.lng,initial.lat],zoom:initial.zoom,interactive:false,
    attributionControl:false,renderWorldCopies:false,fadeDuration:0});
   camera=initial;
   map.on('idle',showWhenReady);
   map.on('error',()=>{}); // The SVG remains visible if the first road view cannot render.
  }).catch(()=>visible(false)).finally(()=>{creating=null;});
 }

 window.EVRoadMap={
  enter(box){
   target=box;moving=true;
   if(!shown){if(map)move(box);else ensureMap();}
  },
  frame(box){
   if(target&&shown)move(box);
  },
  finish(box){
   if(!target)return;
   target=box;moving=false;
   move(box);showWhenReady();
  },
  resize(box){
   if(!target)return;
   if(!moving)target=box;
   if(map)move(shown?box:target);else ensureMap();
   showWhenReady();
  },
  leave(){target=null;moving=false;visible(false);}
 };
})();
