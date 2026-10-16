'use strict';
const $=id=>document.getElementById(id);
const cv=$('cv'),g=cv.getContext('2d');
const R=2000,RH=70,AT=76,VFPS=30;
const db2=x=>Math.pow(10,x/20),lin2db=x=>20*Math.log10(Math.max(x,1e-9));
const fmt=s=>{s=Math.max(0,s);return Math.floor(s/60)+':'+(s%60).toFixed(3).padStart(6,'0')};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const blank=()=>({media:[],vclips:[],aclips:[],caps:[],nid:1,tracks:['Clip audio','Audio 2','Audio 3'].map(n=>({name:n,vol:0,mute:false,solo:false}))});
let S=blank(),M={},ctx=null,master,spk,analyser,recDest,t=0,playing=false,exporting=false,sel=null,zoom=40;
const uid=()=>'i'+(S.nid++);
// ---------- video sequence ----------
const pool=[0,1].map(()=>{const v=document.createElement('video');v.playsInline=true;v.muted=true;v.preload='auto';v.setAttribute('playsinline','');v._clip=-1;return v});
const len=c=>c.end-c.start;
function tdur(i){const c=S.vclips[i];if(!c||i>=S.vclips.length-1||c.tr==='none')return 0;return Math.max(0.05,Math.min(c.td,len(c)/2,len(S.vclips[i+1])/2))}
function starts(){let a=[],T=0;S.vclips.forEach((c,i)=>{a.push(T);T+=len(c)-tdur(i)});return a}
function vtotal(){const n=S.vclips.length;if(!n)return 0;return starts()[n-1]+len(S.vclips[n-1])}
const aEnd=c=>c.at+c.len;
function total(){return Math.max(vtotal(),0,...S.aclips.map(aEnd))}
function at(T){const n=S.vclips.length;if(!n||T>vtotal())return null;const s=starts();for(let i=0;i<n;i++){const c=S.vclips[i],e=s[i]+len(c);if(T<e||i===n-1){const d=tdur(i),r={i,local:c.start+clamp(T-s[i],0,len(c)),p:0,nxt:null};
 if(d&&T>=e-d){r.p=(T-(e-d))/d;r.nxt={i:i+1,local:S.vclips[i+1].start+(T-s[i+1])}}return r}}}
const vidFor=i=>pool[i%2];
async function prep(i,local,play){const v=vidFor(i),c=S.vclips[i];if(v._src!==c.media){v._src=c.media;v.src=M[c.media].url;await new Promise(r=>{v.onloadeddata=r;v.onerror=r})}
 v._clip=i;if(Math.abs(v.currentTime-local)>(play?0.25:0.02)){v.currentTime=local;await new Promise(r=>{v.onseeked=r;setTimeout(r,1500)})}
 if(play&&v.paused)await v.play().catch(()=>{});if(!play&&!v.paused)v.pause();return v}
function fit(v,x=0,alpha=1){if(!v.videoWidth)return;const k=Math.min(cv.width/v.videoWidth,cv.height/v.videoHeight),w=v.videoWidth*k,h=v.videoHeight*k;g.globalAlpha=alpha;g.drawImage(v,x+(cv.width-w)/2,(cv.height-h)/2,w,h);g.globalAlpha=1}
function draw(r){g.fillStyle='#000';g.fillRect(0,0,cv.width,cv.height);
 if(r){const A=vidFor(r.i),p=r.p,type=S.vclips[r.i].tr;if(!r.nxt)fit(A);else{const B=vidFor(r.nxt.i);
  if(type==='crossfade'){fit(A);fit(B,0,p)}else if(type==='fadeblack'){if(p<.5){fit(A);g.fillStyle=`rgba(0,0,0,${p*2})`}else{fit(B);g.fillStyle=`rgba(0,0,0,${2-p*2})`}g.fillRect(0,0,cv.width,cv.height)}
  else if(type==='slide'){fit(A,-p*cv.width);fit(B,(1-p)*cv.width)}}}
 for(const c of S.caps)if(t>=c.start&&t<c.end&&c.text){const fs=Math.round(cv.height*c.size/100);g.font=`bold ${fs}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';
  const x=cv.width*c.x/100,y=cv.height*c.y/100;g.lineWidth=fs/6;g.strokeStyle='rgba(0,0,0,.85)';g.fillStyle='#fff';
  c.text.split('\n').forEach((l,k,a)=>{const yy=y+(k-(a.length-1)/2)*fs*1.15;g.strokeText(l,x,yy);g.fillText(l,x,yy)})}
 $('time').textContent=fmt(t);const ph=$('ph');if(ph)ph.style.left=t*zoom+'px'}
// ---------- audio model ----------
const shapes={linear:x=>x,scurve:x=>(1-Math.cos(Math.PI*x))/2,exp:x=>x<=0?0:(Math.pow(10,3*(x-1))-0.001)/0.999,log:x=>1-((Math.pow(10,3*(-x))-0.001)/0.999),eqpow:x=>Math.sin(x*Math.PI/2)};
const CURVES={linear:'Linear',scurve:'S-curve (ease)',exp:'Exponential (slow start)',log:'Logarithmic (fast start)'};
function virt(){const s=starts(),out=[];S.vclips.forEach((c,i)=>{if((c.audio||'linked')!=='linked'||!M[c.media]||!M[c.media].buf)return;
 out.push({id:'v_'+c.id,vid:c.id,virt:true,track:0,media:c.media,at:s[i],off:c.start,len:len(c),gain:c.gain||0,norm:0,fi:0,fo:0,ci:'linear',co:'linear',env:[]})});return out}
const allA=()=>virt().concat(S.aclips);
function ovl(c,list){let i=0,o=0;for(const d of list){if(d===c||d.track!==c.track)continue;
 if(d.at<c.at&&aEnd(d)>c.at)i=Math.max(i,Math.min(aEnd(d),aEnd(c))-c.at);
 if(d.at>c.at&&d.at<aEnd(c)&&aEnd(d)>aEnd(c))o=Math.max(o,aEnd(c)-d.at)}return[i,o]}
function envAt(e,x){if(x<=e[0].t)return e[0].db;for(let i=1;i<e.length;i++)if(x<=e[i].t){const a=e[i-1],b=e[i];return a.db+(b.db-a.db)*(x-a.t)/((b.t-a.t)||1)}return e[e.length-1].db}
function gainFn(c,list){const[oi,oo]=ovl(c,list||allA());const fi=Math.min(Math.max(c.fi,oi),c.len),fo=Math.min(Math.max(c.fo,oo),c.len);
 const si=shapes[oi>c.fi?'eqpow':c.ci]||shapes.linear,so=shapes[oo>c.fo?'eqpow':c.co]||shapes.linear,base=db2(c.gain+(c.norm||0)),env=(c.env||[]).slice().sort((a,b)=>a.t-b.t);
 return tau=>{let v=base;if(fi>0&&tau<fi)v*=si(clamp(tau/fi,0,1));if(fo>0&&tau>c.len-fo)v*=so(clamp((c.len-tau)/fo,0,1));if(env.length)v*=db2(envAt(env,tau));return v}}
function schedule(ac,dest,from,when){const list=allA(),solo=S.tracks.some(x=>x.solo),nodes=[];
 const tg=S.tracks.map(tr=>{const n=ac.createGain();n.gain.value=(tr.mute||(solo&&!tr.solo))?0:db2(tr.vol);n.connect(dest);return n});
 for(const c of list){const m=M[c.media];if(!m||!m.buf||aEnd(c)<=from||c.len<=0)continue;const s0=Math.max(0,from-c.at),dur=Math.min(c.len,m.buf.duration-c.off)-s0;if(dur<=0.0005)continue;
  const src=ac.createBufferSource();src.buffer=m.buf;const gn=ac.createGain();src.connect(gn);gn.connect(tg[c.track]);
  const f=gainFn(c,list),st=when+Math.max(0,c.at-from),mf=Math.min(...[c.fi,c.fo,1].filter(x=>x>0)),n=Math.max(2,Math.ceil(dur*clamp(400/mf,R,48000))+1),arr=new Float32Array(n);for(let k=0;k<n;k++)arr[k]=f(s0+dur*k/(n-1));
  gn.gain.value=arr[0];gn.gain.setValueCurveAtTime(arr,st,dur);src.start(st,c.off+s0,dur);nodes.push(src)}return nodes}
async function mixdown(){audioInit();const T=total(),sr=ctx.sampleRate,oc=new OfflineAudioContext(2,Math.max(1,Math.ceil(T*sr)),sr);schedule(oc,oc.destination,0,0);return oc.startRendering()}
function peakOf(buf){let p=0;for(let ch=0;ch<buf.numberOfChannels;ch++){const d=buf.getChannelData(ch);for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>p)p=a}}return p}
function audioInit(){if(ctx)return;ctx=new (window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();analyser=ctx.createAnalyser();analyser.fftSize=2048;spk=ctx.createGain();
 master.connect(analyser);analyser.connect(spk);spk.connect(ctx.destination);recDest=ctx.createMediaStreamDestination();analyser.connect(recDest);meter()}
let clipHold=0;function meter(){const d=new Float32Array(analyser.fftSize);(function f(){analyser.getFloatTimeDomainData(d);let p=0;for(const x of d)p=Math.max(p,Math.abs(x));
 if(p>=0.999)clipHold=performance.now()+2000;$('mbar').style.width=clamp((lin2db(p)+60)/60*100,0,100)+'%';$('meter').classList.toggle('clip',performance.now()<clipHold);requestAnimationFrame(f)})()}
// ---------- media ----------
async function loadMedia(blob,kind){const url=URL.createObjectURL(blob),m={url,kind};audioInit();
 try{m.buf=await new Promise((ok,no)=>blob.arrayBuffer().then(ab=>ctx.decodeAudioData(ab,ok,no)))}catch(e){m.buf=null}
 if(kind==='video'){const v=document.createElement('video');v.muted=true;v.preload='metadata';v.src=url;await new Promise((ok,no)=>{v.onloadedmetadata=ok;v.onerror=()=>no(new Error('Cannot read video'))});m.dur=v.duration;m.w=v.videoWidth;m.h=v.videoHeight}
 else{if(!m.buf)throw new Error('Cannot decode audio');m.dur=m.buf.duration}
 if(m.buf){const d=m.buf.getChannelData(0),d2=m.buf.numberOfChannels>1?m.buf.getChannelData(1):d,step=Math.max(1,Math.floor(m.buf.sampleRate/400)),pk=new Float32Array(Math.ceil(d.length/step));
  for(let i=0;i<pk.length;i++){let p=0;for(let j=i*step,e=Math.min(d.length,j+step);j<e;j++){const a=Math.max(Math.abs(d[j]),Math.abs(d2[j]));if(a>p)p=a}pk[i]=p}m.peaks=pk;m.pps=m.buf.sampleRate/step}
 return m}
function sizeCanvas(){const v=S.media.find(x=>x.kind==='video'&&M[x.id]);if(!v)return;const m=M[v.id];let w=m.w||1280,h=m.h||720,k=Math.min(1,1280/Math.max(w,h));cv.width=Math.round(w*k/2)*2;cv.height=Math.round(h*k/2)*2}
async function importFiles(files){for(const f of files){const kind=(f.type.startsWith('video')||/\.(mp4|mov|webm|mkv)$/i.test(f.name))?'video':'audio';
 status('Loading '+f.name+'…');const id=uid(),m=await loadMedia(f,kind);M[id]=m;S.media.push({id,kind,name:f.name,dur:m.dur});kv('m:'+id,f);
 if(kind==='video'){S.vclips.push({id:uid(),media:id,start:0,end:m.dur,tr:'none',td:1,audio:'linked',gain:0});sel={k:'v',id:S.vclips[S.vclips.length-1].id}}
 else{const tr=S.aclips.some(c=>c.track===1&&c.at<t+m.dur&&aEnd(c)>t)?2:1;const c={id:uid(),media:id,track:tr,at:+t.toFixed(3),off:0,len:m.dur,gain:0,norm:0,fi:0,fo:0,ci:'linear',co:'linear',env:[],name:f.name};S.aclips.push(c);sel={k:'a',id:c.id}}}
 sizeCanvas();status('');commit()}
// ---------- persistence & history ----------
const idb=new Promise(r=>{try{const q=indexedDB.open('cut',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)}catch(e){r(null)}});
async function kv(k,v,del){const db=await idb;if(!db)return null;return new Promise(res=>{const tx=db.transaction('kv',v===undefined&&!del?'readonly':'readwrite'),st=tx.objectStore('kv');
 const q=del?(k==='*'?st.clear():st.delete(k)):v===undefined?st.get(k):st.put(v,k);q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)})}
let saveT=0;const save=()=>{clearTimeout(saveT);saveT=setTimeout(()=>kv('project',JSON.stringify(S)),500)};
let hist=[],fut=[],cur=JSON.stringify(S);
function commit(){const s=JSON.stringify(S);if(s!==cur){hist.push(cur);if(hist.length>300)hist.shift();cur=s;fut=[]}after()}
function undo(){if(!hist.length)return;fut.push(cur);cur=hist.pop();S=JSON.parse(cur);after()}
function redo(){if(!fut.length)return;hist.push(cur);cur=fut.pop();S=JSON.parse(cur);after()}
function after(){save();if(sel&&!selObj())sel=null;$('empty').hidden=!!(S.vclips.length||S.aclips.length);renderAll();seek(t);if(playing&&!exporting){stop();play()}}
function selObj(){if(!sel)return null;return sel.k==='v'?S.vclips.find(c=>c.id===sel.id):S.aclips.find(c=>c.id===sel.id)}
async function restore(){const p=await kv('project');if(!p)return;try{const s=JSON.parse(p);for(const m of s.media){const b=await kv('m:'+m.id);if(b)M[m.id]=await loadMedia(b,m.kind)}
 S=s;S.media=S.media.filter(m=>M[m.id]);S.vclips=S.vclips.filter(c=>M[c.media]);S.aclips=S.aclips.filter(c=>M[c.media]);cur=JSON.stringify(S);sizeCanvas();status('Restored autosaved project');after()}catch(e){console.warn(e)}}
// ---------- transport ----------
let srcs=[],a0=0,c0=0,onEnd=null,seekId=0;
async function seek(T){t=clamp(T,0,total());const r=at(t),id=++seekId;if(r){await prep(r.i,r.local,false);if(r.nxt)await prep(r.nxt.i,r.nxt.local,false)}if(id===seekId)draw(r)}
async function play(mix){if(!total())return;audioInit();await ctx.resume();if(t>=total()-0.02)t=0;playing=true;$('play').textContent='❚❚';
 const r=at(t);if(r){await prep(r.i,r.local,false);if(r.nxt)await prep(r.nxt.i,r.nxt.local,false)}
 a0=ctx.currentTime+0.12;c0=t;if(mix){const s=ctx.createBufferSource();s.buffer=mix;s.connect(master);s.start(a0,t);srcs=[s]}else srcs=schedule(ctx,master,t,a0);loop()}
function stop(){playing=false;$('play').textContent='▶';srcs.forEach(s=>{try{s.stop()}catch(e){}});srcs=[];pool.forEach(v=>v.pause())}
function loop(){if(!playing)return;t=c0+Math.max(0,ctx.currentTime-a0);const T=total();if(t>=T){t=T;stop();draw(at(t-0.001));onEnd&&onEnd();return}
 const r=at(t),need=r?[r,r.nxt].filter(Boolean):[];pool.forEach(v=>{if(!need.some(o=>vidFor(o.i)===v&&v._clip===o.i)&&!v.paused)v.pause()});
 if(ctx.currentTime>=a0)for(const o of need){const v=vidFor(o.i);if((v._clip!==o.i||v.paused||Math.abs(v.currentTime-o.local)>0.3)&&!v._busy){v._busy=true;prep(o.i,o.local,true).finally(()=>v._busy=false)}}
 draw(r);const w=$('tlwrap'),x=t*zoom;if(x<w.scrollLeft||x>w.scrollLeft+w.clientWidth-40)w.scrollLeft=x-40;requestAnimationFrame(loop)}
// ---------- timeline ----------
const z2s=v=>5*Math.pow(2,v*8.7/100),s2z=z=>Math.log2(z/5)*100/8.7;
function setZoom(z,anchorT,anchorX){zoom=clamp(z,5,2000);$('zoom').value=s2z(zoom);renderTL();const w=$('tlwrap');if(anchorT!=null)w.scrollLeft=anchorT*zoom-anchorX}
function drawClip(cvs,c,list){const m=M[c.media],w=Math.max(1,Math.min(Math.round(c.len*zoom),6000)),h=62;cvs.width=w;cvs.height=h;const q=cvs.getContext('2d');q.clearRect(0,0,w,h);if(!m||!m.peaks)return;
 const f=gainFn(c,list);q.fillStyle=c.virt?'#6f8fb8':'#5fd0a8';for(let x=0;x<w;x++){const tau=(x+.5)/w*c.len,i=Math.floor((c.off+tau)*m.pps);const a=Math.min(1,(m.peaks[i]||0)*f(tau))*(h/2-4);q.fillRect(x,h/2-a,1,a*2||1)}
 q.strokeStyle='#ffd34d';q.lineWidth=1.5;q.beginPath();for(let x=0;x<=w;x+=2){const v=f(x/w*c.len),y=h-4-clamp(v/db2(6),0,1)*(h-8);x?q.lineTo(x,y):q.moveTo(x,y)}q.stroke()}
function renderTL(){const tl=$('tl'),T=total(),W=Math.max((T+3)*zoom,$('tlwrap').clientWidth);tl.innerHTML='';tl.style.width=W+'px';tl.style.height=(AT+RH*3+4)+'px';
 const step=[0.01,0.05,0.1,0.5,1,2,5,10,30,60].find(s=>s*zoom>=60)||60;for(let s=0;s<=T+3;s+=step){const d=document.createElement('div');d.className='tick';d.style.left=s*zoom+'px';d.textContent=step<1?s.toFixed(2):fmt(s).replace(/\.000$/,'');tl.appendChild(d)}
 S.tracks.forEach((tr,k)=>{const l=document.createElement('div');l.className='lane';l.style.top=(AT+k*RH-3)+'px';l.style.height=RH+'px';l.innerHTML=`<span>${tr.name}</span>`;tl.appendChild(l)});
 const s=starts();S.vclips.forEach((c,i)=>{const d=document.createElement('div');d.className='vb'+(sel&&sel.id===c.id?' sel':'');d.style.left=s[i]*zoom+'px';d.style.width=Math.max(4,len(c)*zoom-2)+'px';
  d.textContent=`🎬 ${i+1}`+(c.tr!=='none'&&i<S.vclips.length-1?` → ${c.tr}`:'')+(c.audio==='muted'?' 🔇':c.audio==='detached'?' ⛓':'');d.onclick=e=>{e.stopPropagation();sel={k:'v',id:c.id};renderAll()};tl.appendChild(d)});
 const list=allA();for(const c of list){const d=document.createElement('div'),isSel=sel&&(sel.id===c.id||(c.virt&&sel.id===c.vid));d.className='ab'+(c.virt?' virt':'')+(isSel?' sel':'');d._c=c;
  const cvs=document.createElement('canvas');d.appendChild(cvs);const nm=document.createElement('div');nm.className='nm';nm.textContent=c.virt?'clip audio (linked)':(c.name||'audio')+(c.gain||c.norm?` ${(c.gain+(c.norm||0)).toFixed(1)}dB`:'');d.appendChild(nm);
  place(d,c);drawClip(cvs,c,list);tl.appendChild(d);
  if(c.virt){d.onclick=e=>{e.stopPropagation();sel={k:'v',id:c.vid};renderAll()};continue}
  bindClip(d,c);if(isSel){for(const k of['tl','tr2','fk fi','fk fo']){const h=document.createElement('div');h.className='h '+k;d.appendChild(h);bindHandle(h,d,c,k)}posHandles(d,c)}}
 const ph=document.createElement('div');ph.id='ph';ph.style.left=t*zoom+'px';tl.appendChild(ph)}
function place(d,c){d.style.left=c.at*zoom+'px';d.style.width=Math.max(3,c.len*zoom)+'px';d.style.top=(AT+c.track*RH)+'px'}
function posHandles(d,c){const a=d.querySelector('.fi'),b=d.querySelector('.fo');if(a)a.style.left=(c.fi*zoom)+'px';if(b)b.style.left=(c.len-c.fo)*zoom+'px'}
function dragger(el,onMove,onEnd){el.addEventListener('pointerdown',e=>{if(e.button>0||pinching)return;e.stopPropagation();e.preventDefault();el.setPointerCapture(e.pointerId);const x0=e.clientX,y0=e.clientY;let moved=false;
 const mv=ev=>{if(pinching)return;const dx=ev.clientX-x0,dy=ev.clientY-y0;if(!moved&&Math.hypot(dx,dy)<5)return;moved=true;onMove(dx,dy)};
 const up=()=>{el.removeEventListener('pointermove',mv);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);onEnd(moved)};
 el.addEventListener('pointermove',mv);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up)})}
function refreshClip(d,c){place(d,c);posHandles(d,c);drawClip(d.querySelector('canvas'),c,allA())}
function bindClip(d,c){let o;d.onclick=e=>e.stopPropagation();d.addEventListener('pointerdown',()=>o={...c},true);
 dragger(d,(dx,dy)=>{c.at=Math.max(0,o.at+dx/zoom);c.track=clamp(o.track+Math.round(dy/RH),0,S.tracks.length-1);refreshClip(d,c)},moved=>{sel={k:'a',id:c.id};if(moved)commit();else renderAll()})}
function bindHandle(h,d,c,k){let o;h.onclick=e=>e.stopPropagation();h.addEventListener('pointerdown',()=>o={...c,env:(c.env||[]).map(p=>({...p}))},true);const dur=M[c.media].dur;
 dragger(h,dx=>{const dt=dx/zoom;
  if(k==='tl'){const s=clamp(dt,-o.off,o.len-0.01);c.off=o.off+s;c.at=o.at+s;c.len=o.len-s;c.env=o.env.map(p=>({...p,t:p.t-s}));c.fi=Math.min(o.fi,c.len);c.fo=Math.min(o.fo,c.len-c.fi)}
  else if(k==='tr2'){c.len=clamp(o.len+dt,0.01,dur-o.off);c.fo=Math.min(o.fo,c.len);c.fi=Math.min(o.fi,c.len-c.fo)}
  else if(k==='fk fi')c.fi=+clamp(o.fi+dt,0,c.len-c.fo).toFixed(4);else c.fo=+clamp(o.fo-dt,0,c.len-c.fi).toFixed(4);refreshClip(d,c)},moved=>{if(moved)commit()})}
let pinching=false;(function(){const w=$('tlwrap');let d0,z0,aT,aX;const dist=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
 w.addEventListener('touchstart',e=>{if(e.touches.length===2){pinching=true;d0=dist(e);z0=zoom;const r=w.getBoundingClientRect();aX=(e.touches[0].clientX+e.touches[1].clientX)/2-r.left;aT=(w.scrollLeft+aX)/zoom;e.preventDefault()}},{passive:false});
 w.addEventListener('touchmove',e=>{if(pinching&&e.touches.length===2){e.preventDefault();setZoom(z0*dist(e)/d0,aT,aX)}},{passive:false});
 w.addEventListener('touchend',e=>{if(e.touches.length<2)setTimeout(()=>pinching=false,50)});
 w.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();const r=w.getBoundingClientRect(),x=e.clientX-r.left;setZoom(zoom*Math.exp(-e.deltaY/200),(w.scrollLeft+x)/zoom,x)}},{passive:false});
 document.addEventListener('gesturestart',e=>e.preventDefault());
 $('tl').addEventListener('click',e=>{if(pinching)return;const r=$('tl').getBoundingClientRect();stop();seek((e.clientX-r.left)/zoom);if(e.target.id==='tl'||e.target.classList.contains('lane')||e.target.classList.contains('tick')){sel=null;renderAll()}})})();
// ---------- panels ----------
function el(tag,html,cls){const e=document.createElement(tag);if(html!=null)e.innerHTML=html;if(cls)e.className=cls;return e}
function num(p,label,val,step,set,min,max){const l=el('label',label+' ');const i=el('input');i.type='number';i.step=step;if(min!=null)i.min=min;if(max!=null)i.max=max;i.value=+(+val).toFixed(4);i.onchange=()=>{const v=parseFloat(i.value);if(!isNaN(v)){set(min!=null||max!=null?clamp(v,min??-1e9,max??1e9):v);commit()}};l.appendChild(i);p.appendChild(l);return i}
function selBox(p,label,val,opts,set){const l=el('label',label+' '),s=el('select');for(const[k,v]of Object.entries(opts))s.appendChild(new Option(v,k));s.value=val;s.onchange=()=>{set(s.value);commit()};l.appendChild(s);p.appendChild(l);return s}
function btn(p,txt,fn,cls){const b=el('button',txt,'btn'+(cls?' '+cls:''));b.onclick=fn;p.appendChild(b);return b}
function dbSlider(p,label,val,set){const l=el('label',label+' ');const r=el('input');r.type='range';r.min=-60;r.max=12;r.step=0.5;r.value=val;r.style.width='140px';const n=el('input');n.type='number';n.min=-60;n.max=12;n.step=0.1;n.value=val;
 r.oninput=()=>n.value=r.value;r.onchange=()=>{set(+r.value);commit()};n.onchange=()=>{set(clamp(+n.value||0,-60,12));commit()};l.append(r,n,'dB');p.appendChild(l)}
function renderPanel(){const p=$('panel');p.innerHTML='';const c=selObj();if(!c)return;
 if(sel.k==='v'){const i=S.vclips.indexOf(c),last=i===S.vclips.length-1,dur=M[c.media].dur;p.appendChild(el('h3',`Video clip ${i+1} / ${S.vclips.length}`));
  num(p,'Start',c.start,0.01,v=>c.start=clamp(v,0,c.end-0.05));num(p,'End',c.end,0.01,v=>c.end=clamp(v,c.start+0.05,dur));
  const r=el('div',null,'row');btn(r,'◀ Move',()=>{if(i>0){[S.vclips[i-1],S.vclips[i]]=[S.vclips[i],S.vclips[i-1]];commit()}});btn(r,'Move ▶',()=>{if(!last){[S.vclips[i+1],S.vclips[i]]=[S.vclips[i],S.vclips[i+1]];commit()}});p.appendChild(r);
  const a=el('div',null,'row');selBox(a,'Audio',c.audio||'linked',{linked:'On (linked)',muted:'Muted',detached:'Detached'},v=>{if(v==='detached')return detach(c);c.audio=v});
  if((c.audio||'linked')==='linked'){btn(a,'Detach audio',()=>{detach(c);commit()})}p.appendChild(a);if((c.audio||'linked')==='linked')dbSlider(p,'Clip audio',c.gain||0,v=>c.gain=v);
  if(!last){const tr=el('div',null,'row');selBox(tr,'Transition →',c.tr,{none:'None',crossfade:'Crossfade',fadeblack:'Fade through black',slide:'Slide'},v=>c.tr=v);num(tr,'Duration s',c.td,0.1,v=>c.td=Math.max(0.1,v));p.appendChild(tr)}}
 else{const dur=M[c.media].dur;p.appendChild(el('h3',`Audio clip: ${c.name||''}`));
  num(p,'Timeline start',c.at,0.001,v=>c.at=Math.max(0,v));num(p,'Source in',c.off,0.001,v=>{const d=clamp(v,0,c.off+c.len-0.01)-c.off;c.off+=d;c.len-=d});num(p,'Length',c.len,0.001,v=>c.len=clamp(v,0.01,dur-c.off));
  selBox(p,'Track',c.track,Object.fromEntries(S.tracks.map((x,k)=>[k,x.name])),v=>c.track=+v);
  dbSlider(p,'Volume',c.gain,v=>c.gain=v);
  const f=el('div',null,'row');num(f,'Fade in s',c.fi,0.005,v=>c.fi=clamp(v,0,c.len-c.fo),0);selBox(f,'',c.ci,CURVES,v=>c.ci=v);p.appendChild(f);
  const f2=el('div',null,'row');num(f2,'Fade out s',c.fo,0.005,v=>c.fo=clamp(v,0,c.len-c.fi),0);selBox(f2,'',c.co,CURVES,v=>c.co=v);p.appendChild(f2);
  const nr=el('div',null,'row');btn(nr,c.norm?`Normalized (${c.norm.toFixed(1)} dB) – undo`:'Normalize to −1 dB',()=>{if(c.norm)c.norm=0;else{c.norm=normGain(c)}commit()});p.appendChild(nr);
  p.appendChild(el('h3','Volume envelope'));const e=el('div',null,'pts');(c.env||[]).sort((a,b)=>a.t-b.t).forEach((pt,k)=>{const r=el('div',null,'row');num(r,'At s',pt.t,0.01,v=>pt.t=clamp(v,0,c.len));num(r,'dB',pt.db,0.5,v=>pt.db=v,-60,12);btn(r,'✕',()=>{c.env.splice(k,1);commit()},'danger');e.appendChild(r)});
  btn(e,'+ Point at playhead',()=>{const tau=clamp(t-c.at,0,c.len);c.env=c.env||[];c.env.push({t:+tau.toFixed(3),db:c.env.length?+envAt(c.env.slice().sort((a,b)=>a.t-b.t),tau).toFixed(1):0});commit()});p.appendChild(e)}}
function normGain(c){const b=M[c.media].buf,sr=b.sampleRate,i0=Math.floor(c.off*sr),i1=Math.min(b.length,Math.ceil((c.off+c.len)*sr));let pk=0;for(let ch=0;ch<b.numberOfChannels;ch++){const d=b.getChannelData(ch);for(let i=i0;i<i1;i++){const a=Math.abs(d[i]);if(a>pk)pk=a}}return pk?-1-lin2db(pk):0}
function detach(c){const v=virt().find(x=>x.vid===c.id);c.audio='detached';if(v){const n={...v,id:uid(),name:'detached audio'};delete n.virt;delete n.vid;S.aclips.push(n);sel={k:'a',id:n.id}}}
function renderMixer(){const p=$('mixer');p.innerHTML='';S.tracks.forEach(tr=>{const r=el('div',null,'mx');r.appendChild(el('b',tr.name));dbSlider(r,'',tr.vol,v=>tr.vol=v);
 btn(r,'M',()=>{tr.mute=!tr.mute;commit()},tr.mute?'on':'');btn(r,'S',()=>{tr.solo=!tr.solo;commit()},'solo'+(tr.solo?' on':''));p.appendChild(r)})}
function renderCaps(){const cp=$('caps');cp.innerHTML='';S.caps.forEach((k,j)=>{const d=el('div',null,'cap');const tx=el('input');tx.type='text';tx.value=k.text;tx.placeholder='Caption text';tx.onchange=()=>{k.text=tx.value;commit()};d.appendChild(tx);
 num(d,'From',k.start,0.1,v=>k.start=v);num(d,'To',k.end,0.1,v=>k.end=v);num(d,'X%',k.x,1,v=>k.x=v);num(d,'Y%',k.y,1,v=>k.y=v);num(d,'Size',k.size,1,v=>k.size=v);btn(d,'✕',()=>{S.caps.splice(j,1);commit()},'danger');cp.appendChild(d)})}
function renderAll(){renderTL();renderPanel();renderMixer();renderCaps();$('nudgeLbl').textContent=sel&&sel.k==='a'?'Nudge clip':'Nudge playhead';$('undo').disabled=!hist.length;$('redo').disabled=!fut.length}
const status=s=>$('status').textContent=s;
// ---------- edit actions ----------
function splitAt(){const c=selObj();if(sel&&sel.k==='a'){const tau=t-c.at;if(tau<0.005||c.len-tau<0.005)return status('Move the playhead inside the selected clip');
  const n={...c,id:uid(),at:t,off:c.off+tau,len:c.len-tau,fi:0,env:(c.env||[]).filter(p=>p.t>=tau).map(p=>({...p,t:p.t-tau}))};c.len=tau;c.fo=0;c.fi=Math.min(c.fi,tau);c.env=(c.env||[]).filter(p=>p.t<=tau);S.aclips.push(n);sel={k:'a',id:n.id};return commit()}
 const r=at(t);if(!r)return;const v=S.vclips[r.i];if(r.local-v.start<0.05||v.end-r.local<0.05)return;const n={...v,id:uid(),start:r.local};v.end=r.local;v.tr='none';S.vclips.splice(r.i+1,0,n);sel={k:'v',id:n.id};commit()}
function delSel(){if(!sel)return;if(sel.k==='a')S.aclips=S.aclips.filter(c=>c.id!==sel.id);else S.vclips=S.vclips.filter(c=>c.id!==sel.id);sel=null;commit()}
function nudge(d){const c=selObj();if(sel&&sel.k==='a'){c.at=Math.max(0,+(c.at+d).toFixed(4));commit()}else{stop();seek(t+d)}}
// ---------- export ----------
function wav(buf){const ch=buf.numberOfChannels,n=buf.length,sr=buf.sampleRate,b=new DataView(new ArrayBuffer(44+n*ch*2));const w=(o,s)=>[...s].forEach((x,i)=>b.setUint8(o+i,x.charCodeAt(0)));
 w(0,'RIFF');b.setUint32(4,36+n*ch*2,true);w(8,'WAVEfmt ');b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,ch,true);b.setUint32(24,sr,true);b.setUint32(28,sr*ch*2,true);b.setUint16(32,ch*2,true);b.setUint16(34,16,true);w(36,'data');b.setUint32(40,n*ch*2,true);
 const d=[...Array(ch)].map((_,c)=>buf.getChannelData(c));let o=44;for(let i=0;i<n;i++)for(let c=0;c<ch;c++){const s=clamp(d[c][i],-1,1);b.setInt16(o,Math.round(s<0?s*32768:s*32767),true);o+=2}return new Blob([b],{type:'audio/wav'})}
function download(blob,name){window.lastExport=blob;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove()}
function clipMsg(mix){const p=peakOf(mix);return p>=1?` ⚠ Peaks at ${lin2db(p).toFixed(1)} dBFS – it will clip; lower some volumes.`:` Peak ${lin2db(p).toFixed(1)} dBFS.`}
async function exportWav(){if(!total())return;stop();status('Mixing audio…');const mix=await mixdown();download(wav(mix),'mix-'+Date.now()+'.wav');status('Exported WAV ('+mix.duration.toFixed(2)+' s).'+clipMsg(mix))}
function pickType(){for(const m of['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'])if(window.MediaRecorder&&MediaRecorder.isTypeSupported(m))return m;return ''}
async function exportVideo(){if(!total()||exporting)return;if(!window.MediaRecorder||!cv.captureStream)return status('Video export not supported in this browser – try Audio WAV');
 stop();audioInit();await ctx.resume();status('Mixing audio…');const mix=await mixdown();exporting=true;const type=pickType(),msg=clipMsg(mix);
 const st=new MediaStream([...cv.captureStream(30).getVideoTracks(),...recDest.stream.getAudioTracks()]);const rec=new MediaRecorder(st,{mimeType:type,videoBitsPerSecond:5e6}),chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
 const done=new Promise(r=>rec.onstop=r);t=0;await seek(0);rec.start(500);const iv=setInterval(()=>status(`Exporting… ${Math.round(100*t/total())}% (real time – keep this tab open & screen on)`),300);
 onEnd=()=>rec.stop();await play(mix);await done;onEnd=null;clearInterval(iv);exporting=false;const ext=type.includes('mp4')?'mp4':'webm',blob=new Blob(chunks,{type:type.split(';')[0]});
 download(blob,'edit-'+Date.now()+'.'+ext);status(`Exported ${ext.toUpperCase()} (${(blob.size/1e6).toFixed(1)} MB).`+msg)}
// ---------- wiring ----------
$('file').onchange=e=>{importFiles([...e.target.files]).catch(x=>status(x.message));e.target.value=''};
$('play').onclick=()=>playing?stop():play();$('split').onclick=splitAt;$('del').onclick=delSel;$('undo').onclick=undo;$('redo').onclick=redo;
document.querySelectorAll('.nd').forEach(b=>b.onclick=()=>nudge(+b.dataset.d));
$('zoom').oninput=e=>{const w=$('tlwrap'),cx=w.clientWidth/2;setZoom(z2s(+e.target.value),(w.scrollLeft+cx)/zoom,cx)};
$('addCap').onclick=()=>{S.caps.push({text:'Caption',start:+t.toFixed(1),end:+(t+3).toFixed(1),x:50,y:85,size:7});commit()};
$('exportBtn').onclick=exportVideo;$('wavBtn').onclick=exportWav;
$('newBtn').onclick=async()=>{if(!confirm('Start a new project? (Current one is discarded.)'))return;stop();await kv('*',undefined,true);S=blank();M={};hist=[];fut=[];cur=JSON.stringify(S);sel=null;t=0;after()};
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;const k=e.key.toLowerCase();
 if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();redo()}
 else if(k===' '){e.preventDefault();playing?stop():play()}else if(k==='arrowleft'||k==='arrowright'){e.preventDefault();nudge((k==='arrowleft'?-1:1)*(e.shiftKey?0.01:1/VFPS))}
 else if(k==='s')splitAt();else if(k==='delete'||k==='backspace')delSel()});
zoom=z2s(35);renderAll();draw(null);restore();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
