/* Distance math is independent of the UI and can be tested with Node. */
(function(root){
  function valid(p){return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat!==null && p.lng!==null && String(p.lat).trim()!=='' && String(p.lng).trim()!=='' && Math.abs(Number(p.lat))<=90 && Math.abs(Number(p.lng))<=180;}
  function distance(a,b){const rad=Math.PI/180;const lat1=Number(a.lat)*rad,lat2=Number(b.lat)*rad;const dlat=lat2-lat1,dlng=(Number(b.lng)-Number(a.lng))*rad;const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlng/2)**2;return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));}
  function nearest(origin,stations,limit=5){if(!valid(origin))return [];const unique=new Map();for(const s of stations){if(!s.station_id||!valid(s))continue;const result={...s,distance_m:distance(origin,s)};const old=unique.get(s.station_id);if(!old||result.distance_m<old.distance_m)unique.set(s.station_id,result);}return [...unique.values()].sort((a,b)=>a.distance_m-b.distance_m||String(a.station_id).localeCompare(String(b.station_id))).slice(0,limit);}
  const api={valid,distance,nearest};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EVNearby=api;
})(typeof window!=='undefined'?window:globalThis);
