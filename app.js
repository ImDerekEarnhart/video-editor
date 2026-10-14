const $=id=>document.getElementById(id);
const cv=$('cv'),g=cv.getContext('2d');
let clips=[],caps=[],sel=-1,t=0,playing=false,exporting=false,ctx=null,recDest=null;
const pool=[0,1].map(()=>{const v=document.createElement('video');v.playsInline=true;v.preload='auto';v.crossOrigin='anonymous';v.setAttribute('playsinline','');v._clip=-1;return v;});
const fmt=s=>{s=Math.max(0,s);return Math.floor(s/60)+':'+(s%60).toFixed(1).padStart(4,'0')};
function audio(){if(ctx)return;ctx=new (window.AudioContext||window.webkitAudioContext)();recDest=ctx.createMediaStreamDestination();
 pool.forEach(v=>{const s=ctx.createMediaElementSource(v);v._gain=ctx.createGain();s.connect(v._gain);v._gain.connect(ctx.destination);v._gain.connect(recDest);});}
const len=c=>c.end-c.start;
function tdur(i){const c=clips[i];if(!c||i>=clips.length-1||c.tr==='none')return 0;return Math.max(0.05,Math.min(c.td,len(c)/2,len(clips[i+1])/2));}
function starts(){let a=[],T=0;clips.forEach((c,i)=>{a.push(T);T+=len(c)-tdur(i)});return a;}
function total(){if(!clips.length)return 0;const s=starts(),i=clips.length-1;return s[i]+len(clips[i]);}
// which clips are visible at time t: returns [{i,local}] and transition progress
function at(T){const s=starts();for(let i=0;i<clips.length;i++){const e=s[i]+len(clips[i]);if(T<e||i===clips.length-1){const d=tdur(i);const r={i,local:clips[i].start+Math.min(T-s[i],len(clips[i])),p:0,nxt:null};
 if(d&&T>=e-d){r.p=(T-(e-d))/d;r.nxt={i:i+1,local:clips[i+1].start+(T-s[i+1])};}return r;}}}
async function importFiles(files){for(const f of files){const url=URL.createObjectURL(f);const v=document.createElement('video');v.preload='metadata';v.src=url;v.muted=true;v.playsInline=true;
 await new Promise((ok,no)=>{v.onloadedmetadata=ok;v.onerror=()=>no(new Error('Cannot read '+f.name))});
 if(!clips.length){let w=v.videoWidth||1280,h=v.videoHeight||720,k=Math.min(1,1280/Math.max(w,h));cv.width=Math.round(w*k/2)*2;cv.height=Math.round(h*k/2)*2;}
 clips.push({src:url,start:0,end:v.duration,dur:v.duration,tr:'none',td:1,name:f.name});}
 $('empty').hidden=true;sel=clips.length-1;refresh();seek(t);}
function vidFor(i){return pool[i%2]}
async function prep(i,local,play){const v=vidFor(i);if(v._src!==clips[i].src){v._src=clips[i].src;v.src=clips[i].src;await new Promise(r=>v.onloadeddata=r);}
 v._clip=i;if(Math.abs(v.currentTime-local)>(play?0.25:0.02)){v.currentTime=local;await new Promise(r=>v.onseeked=r);}
 if(play&&v.paused)await v.play().catch(()=>{});if(!play&&!v.paused)v.pause();return v;}
function fit(v,x=0,alpha=1){if(!v.videoWidth)return;const k=Math.min(cv.width/v.videoWidth,cv.height/v.videoHeight),w=v.videoWidth*k,h=v.videoHeight*k;g.globalAlpha=alpha;g.drawImage(v,x+(cv.width-w)/2,(cv.height-h)/2,w,h);g.globalAlpha=1;}
function draw(r){g.fillStyle='#000';g.fillRect(0,0,cv.width,cv.height);if(!r)return;const A=vidFor(r.i),p=r.p,type=clips[r.i].tr;
 let ga=1,gb=0;if(!r.nxt)fit(A);else{const B=vidFor(r.nxt.i);
  if(type==='crossfade'){fit(A);fit(B,0,p);ga=1-p;gb=p}
  else if(type==='fadeblack'){if(p<.5){fit(A);g.fillStyle=`rgba(0,0,0,${p*2})`;ga=1-p*2}else{fit(B);g.fillStyle=`rgba(0,0,0,${2-p*2})`;gb=p*2-1}g.fillRect(0,0,cv.width,cv.height)}
  else if(type==='slide'){fit(A,-p*cv.width);fit(B,(1-p)*cv.width);ga=1-p;gb=p}}
 if(A._gain)A._gain.gain.value=ga;if(r.nxt&&vidFor(r.nxt.i)._gain)vidFor(r.nxt.i)._gain.gain.value=gb;
 for(const c of caps)if(t>=c.start&&t<c.end&&c.text){const fs=Math.round(cv.height*c.size/100);g.font=`bold ${fs}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';
  const x=cv.width*c.x/100,y=cv.height*c.y/100;g.lineWidth=fs/6;g.strokeStyle='rgba(0,0,0,.85)';g.fillStyle='#fff';
  c.text.split('\n').forEach((l,k,a)=>{const yy=y+(k-(a.length-1)/2)*fs*1.15;g.strokeText(l,x,yy);g.fillText(l,x,yy)});}
 $('time').textContent=fmt(t)+' / '+fmt(total());$('scrub').max=total();$('scrub').value=t;}
let seekId=0;async function seek(T){t=Math.max(0,Math.min(T,total()));if(!clips.length)return draw();const id=++seekId,r=at(t);
 await prep(r.i,r.local,false);if(r.nxt)await prep(r.nxt.i,r.nxt.local,false);if(id===seekId)draw(r);}
let t0=0,c0=0,onEnd=null;
async function play(){if(!clips.length)return;audio();ctx.resume();if(t>=total()-0.05)t=0;playing=true;$('play').textContent='❚❚';
 let r=at(t);await prep(r.i,r.local,true);if(r.nxt)await prep(r.nxt.i,r.nxt.local,true);t0=performance.now();c0=t;loop();}
function stop(){playing=false;$('play').textContent='▶';pool.forEach(v=>v.pause());}
function loop(){if(!playing)return;t=c0+(performance.now()-t0)/1000;if(t>=total()){t=total();stop();draw(at(t-0.001));onEnd&&onEnd();return;}
 const r=at(t),need=[r.i];if(r.nxt)need.push(r.nxt.i);
 pool.forEach(v=>{if(!need.includes(v._clip)&&!v.paused&&!(r.nxt&&v===vidFor(r.nxt.i)))v.pause()});
 const s=starts();for(const o of [r,r.nxt].filter(Boolean)){const v=vidFor(o.i);
  if(v._clip!==o.i||v.paused||Math.abs(v.currentTime-o.local)>0.35){if(!v._busy){v._busy=true;prep(o.i,o.local,true).finally(()=>v._busy=false);}}}
 draw(r);requestAnimationFrame(loop);}
function refresh(){const tl=$('timeline');tl.innerHTML='';clips.forEach((c,i)=>{const d=document.createElement('div');d.className='clip'+(i===sel?' sel':'');d.style.width=Math.max(56,len(c)*14)+'px';
 d.innerHTML=`#${i+1}<br>${len(c).toFixed(1)}s`;d.onclick=()=>{sel=i;refresh();seek(starts()[i]+0.01)};tl.appendChild(d);
 if(i<clips.length-1){const e=document.createElement('span');e.className='tr';e.textContent=c.tr==='none'?'|':({crossfade:'⨉',fadeblack:'◐',slide:'⇢'})[c.tr]+tdur(i).toFixed(1);tl.appendChild(e)}});
 const c=clips[sel];$('clipPanel').hidden=!c;if(c){$('clipNo').textContent=(sel+1)+' / '+clips.length;$('cStart').value=c.start.toFixed(2);$('cEnd').value=c.end.toFixed(2);$('tType').value=c.tr;$('tDur').value=c.td;$('tType').disabled=$('tDur').disabled=sel===clips.length-1;}
 const cp=$('caps');cp.innerHTML='';caps.forEach((k,j)=>{const d=document.createElement('div');d.className='cap';
 d.innerHTML=`<input type="text" value="" placeholder="Caption text"><label>From <input type=number step=0.1 data-k=start></label><label>To <input type=number step=0.1 data-k=end></label><label>X% <input type=number data-k=x></label><label>Y% <input type=number data-k=y></label><label>Size <input type=number data-k=size></label><button class="btn danger">✕</button>`;
 const tx=d.querySelector('input[type=text]');tx.value=k.text;tx.oninput=()=>{k.text=tx.value;seek(t)};
 d.querySelectorAll('[data-k]').forEach(n=>{n.value=k[n.dataset.k];n.onchange=()=>{k[n.dataset.k]=parseFloat(n.value)||0;seek(t)}});
 d.querySelector('button').onclick=()=>{caps.splice(j,1);refresh();seek(t)};cp.appendChild(d)});}
$('file').onchange=e=>importFiles([...e.target.files]).catch(x=>$('status').textContent=x.message);
$('play').onclick=()=>playing?stop():play();
$('scrub').oninput=e=>{stop();seek(+e.target.value)};
$('split').onclick=()=>{if(!clips.length)return;const r=at(t),c=clips[r.i];if(r.local-c.start<0.1||c.end-r.local<0.1)return;
 clips.splice(r.i+1,0,{...c,start:r.local});c.end=r.local;c.tr='none';sel=r.i+1;refresh();seek(t)};
$('cStart').onchange=e=>{const c=clips[sel];c.start=Math.max(0,Math.min(+e.target.value,c.end-0.1));refresh();seek(starts()[sel])};
$('cEnd').onchange=e=>{const c=clips[sel];c.end=Math.min(c.dur,Math.max(+e.target.value,c.start+0.1));refresh();seek(starts()[sel]+len(c)-0.05)};
$('cDel').onclick=()=>{clips.splice(sel,1);sel=Math.min(sel,clips.length-1);if(!clips.length)$('empty').hidden=false;refresh();seek(t)};
const mv=d=>{const j=sel+d;if(j<0||j>=clips.length)return;[clips[sel],clips[j]]=[clips[j],clips[sel]];sel=j;refresh();seek(starts()[sel])};
$('cLeft').onclick=()=>mv(-1);$('cRight').onclick=()=>mv(1);
$('tType').onchange=e=>{clips[sel].tr=e.target.value;refresh();seek(t)};$('tDur').onchange=e=>{clips[sel].td=Math.max(0.1,+e.target.value||1);refresh();seek(t)};
$('addCap').onclick=()=>{caps.push({text:'Caption',start:+t.toFixed(1),end:+(t+3).toFixed(1),x:50,y:85,size:7});refresh();seek(t)};
function pickType(){for(const m of['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'])if(window.MediaRecorder&&MediaRecorder.isTypeSupported(m))return m;return '';}
async function exportVideo(){if(!clips.length||exporting)return;if(!window.MediaRecorder||!cv.captureStream)return $('status').textContent='Export not supported in this browser';
 stop();audio();await ctx.resume();exporting=true;const type=pickType();
 const st=new MediaStream([...cv.captureStream(30).getVideoTracks(),...recDest.stream.getAudioTracks()]);
 const rec=new MediaRecorder(st,{mimeType:type,videoBitsPerSecond:5e6}),chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
 pool.forEach(v=>v._gain.disconnect(ctx.destination));
 const done=new Promise(r=>rec.onstop=r);t=0;await seek(0);rec.start(500);
 const iv=setInterval(()=>$('status').textContent=`Exporting… ${Math.round(100*t/total())}% (plays in real time, keep this tab open)`,300);
 onEnd=()=>rec.stop();await play();await done;onEnd=null;clearInterval(iv);exporting=false;pool.forEach(v=>v._gain.connect(ctx.destination));
 const blob=new Blob(chunks,{type:type.split(';')[0]}),ext=type.includes('mp4')?'mp4':'webm';window.lastExport=blob;
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='edit-'+Date.now()+'.'+ext;document.body.appendChild(a);a.click();a.remove();
 $('status').textContent=`Exported ${ext.toUpperCase()} (${(blob.size/1e6).toFixed(1)} MB)`;}
$('exportBtn').onclick=exportVideo;draw();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
