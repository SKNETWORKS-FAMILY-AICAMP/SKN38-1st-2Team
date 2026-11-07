const assert=require('node:assert/strict');
const {distance,nearest}=require('../components/nearby.js');
assert.equal(distance({lat:37,lng:127},{lat:37,lng:127}),0);
assert.ok(Math.abs(distance({lat:0,lng:0},{lat:0,lng:1})-111195.08)<1);
const origin={lat:37,lng:127};
const rows=[
 {station_id:'same',lat:37,lng:127.01,sigungu_code:'A'},
 {station_id:'same',lat:37,lng:127.02,sigungu_code:'A'},
 {station_id:'cross-border',lat:37,lng:127.001,sigungu_code:'B'},
 {station_id:'invalid',lat:null,lng:127},
 {station_id:'invalid2',lat:'NaN',lng:127},
 ...Array.from({length:8},(_,i)=>({station_id:'other-'+i,lat:37.01+i*.01,lng:127})),
];
const result=nearest(origin,rows);
assert.equal(result.length,5);
assert.equal(new Set(result.map(s=>s.station_id)).size,5);
assert.equal(result[0].station_id,'cross-border');
assert.ok(result.every((s,i)=>i===0||result[i-1].distance_m<=s.distance_m));
assert.equal(result.filter(s=>s.station_id==='same').length,1);
assert.deepEqual(nearest({lat:999,lng:127},rows),[]);
assert.equal(nearest(origin,[]).length,0);
assert.equal(nearest(origin,[rows[0]]).length,1);
console.log('PASS: Haversine distance, cross-border ordering, unique top 5, invalid coordinates, sparse data');
