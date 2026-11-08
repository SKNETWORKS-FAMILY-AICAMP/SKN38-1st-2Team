/* Streamlit exposes one component value at a time. Serialize requests and keep the iframe alive. */
let booted=false,parentOrigin='*',pending;
const queue=[];
const send=(type,extra={})=>window.parent.postMessage({isStreamlitMessage:true,type,...extra},parentOrigin);
function advance(){
  if(pending||!queue.length)return;
  pending=queue.shift();
  pending.timer=setTimeout(()=>finish({error:'조회 응답이 늦습니다. 다시 시도해 주세요.'}),50000);
  send('streamlit:setComponentValue',{value:pending.value,dataType:'json'});
}
function finish(result){
  clearTimeout(pending.timer);const complete=pending.resolve;pending=null;complete(result);
  setTimeout(advance,0);
}
window.EVBridge={request(action,fields={}){
  return new Promise(resolve=>{
    if(action==='search'||action==='district'){
      const obsolete=queue.findIndex(item=>item.value.action===action);
      if(obsolete>=0)queue.splice(obsolete,1)[0].resolve({cancelled:true});
    }
    const requestId=globalThis.crypto?.randomUUID?.() || Date.now()+'-'+Math.random();
    queue.push({value:{action,requestId,...fields},resolve});advance();
  });
}};
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.type!=='streamlit:render')return;
  parentOrigin=event.origin;
  const args=event.data.args||{};
  if(!booted&&args.payload){
    booted=true;document.getElementById('app-data').textContent=JSON.stringify(args.payload);
    const script=document.createElement('script');script.src='map_view.js';document.body.append(script);
  }
  if(pending&&args.response?.requestId===pending.value.requestId)finish(args.response);
  send('streamlit:setFrameHeight',{height:1120});
});
send('streamlit:componentReady',{apiVersion:1});
