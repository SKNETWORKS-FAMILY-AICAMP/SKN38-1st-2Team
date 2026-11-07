/* Minimal Streamlit component protocol. The parent alone supplies payloads. */
let booted=false,lastResponse='',parentOrigin='*';
const send=(type,extra={})=>window.parent.postMessage({isStreamlitMessage:true,type,...extra},parentOrigin);
window.EVBridge={geocode(query,requestId){send('streamlit:setComponentValue',{value:{action:'geocode',query,requestId},dataType:'json'});}};
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.type!=='streamlit:render')return;
  parentOrigin=event.origin;
  const args=event.data.args||{};
  if(!booted&&args.payload){booted=true;document.getElementById('app-data').textContent=JSON.stringify(args.payload);const script=document.createElement('script');script.src='map_view.js';document.body.append(script);}
  const response=args.response;if(response&&response.requestId!==lastResponse){lastResponse=response.requestId;window.dispatchEvent(new CustomEvent('ev-geocode',{detail:response}));}
  send('streamlit:setFrameHeight',{height:1120});
});
send('streamlit:componentReady',{apiVersion:1});
