const {spawn}=require('child_process'); const fs=require('fs'); const http=require('http');
const [,, url, outDir, fpsS, durS]=process.argv; const fps=parseInt(fpsS), dur=parseFloat(durS);
const CH=fs.existsSync('/Applications/Google Chrome.app')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/Applications/Arc.app/Contents/MacOS/Arc';
const port=9333+Math.floor(Math.random()*500);
const chrome=spawn(CH,['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port='+port,'--user-data-dir='+outDir+'-profile','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function targets(){ return new Promise((res,rej)=>http.get(`http://127.0.0.1:${port}/json`,r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej)); }
(async()=>{
  let t; for(let i=0;i<40;i++){ try{ t=(await targets()).find(x=>x.type==='page'); if(t) break; }catch(e){} await sleep(250); }
  const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let id=0; const pend={}; ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend[m.id]){pend[m.id](m.result||m.error); delete pend[m.id];}};
  const send=(method,params={})=>new Promise(r=>{const i=++id; pend[i]=r; ws.send(JSON.stringify({id:i,method,params}));});
  await send('Emulation.setDeviceMetricsOverride',{width:1080,height:1920,deviceScaleFactor:1,mobile:false});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url}); await sleep(1500);
  const n=Math.round(fps*dur);
  for(let i=0;i<n;i++){
    await send('Runtime.evaluate',{expression:'seek('+(i/fps)+')'});
    const r=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(outDir+'/f'+String(i).padStart(4,'0')+'.png',Buffer.from(r.data,'base64'));
  }
  console.log('frames', n); ws.close(); chrome.kill();
})().catch(e=>{console.error(e); chrome.kill(); process.exit(1);});
