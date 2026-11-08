/* Voice Clean 1.1 for Suffler's "Only my voice" (a Web Worker; same method as the Voice Clean Android app):
   1. neural voice filter: RNNoise 0.2 (rnnoise.wasm) keeps what sounds like a human voice, 10 ms at a time,
      and its speech detector turns down what is left between words;
   2. noise-profile cleaner: learns the background still left from the pauses and removes it
      (log-spectral-amplitude gain, rumble and hiss cut);
   3. level: a quiet voice is raised to a normal level, with a soft limiter so it never clips.
   Input and output: mono Float32Array at 48 kHz, same length. Message in: {id, x, strength 0..1, wasm}. */
'use strict';
let net=null, bufs=null; // the RNNoise WebAssembly instance and its sample buffers, made once per worker
async function loadNet(url){
  if(net!==null) return net;
  try{
    const env={exp:Math.exp,log:Math.log,pow:Math.pow,sin:Math.sin,cos:Math.cos,tanh:Math.tanh,atan:Math.atan};
    const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    const {instance}=await WebAssembly.instantiate(await r.arrayBuffer(),{env});
    net=instance.exports;
  }catch(e){ net=false; }
  return net;
}

/* ---------- 1. neural voice filter + voice gate (NeuralCleaner.java) ---------- */
function neural(e,x,strength,progress){
  const F=480,BATCH=32,LOOK=3,HOLD=25,DELAY=2;          // RNNoise delays the sound by two frames
  const s=Math.max(0,Math.min(1,strength)), floor=Math.pow(10,-(30*s)/20);
  const n=x.length, frames=Math.ceil(n/F)+DELAY+LOOK+1;
  const raw=new Float32Array(frames*F), vad=new Float32Array(frames);
  if(!e.reset()) throw new Error('rnnoise');
  if(!bufs) bufs={bp:e.buf(F*BATCH),vp:e.buf(BATCH)};      // made once; the heap never shrinks
  const {bp,vp}=bufs;
  for(let f=0;f<frames;f+=BATCH){
    const c=Math.min(BATCH,frames-f), b=new Float32Array(e.memory.buffer,bp,F*c);
    for(let i=0;i<F*c;i++){ const j=(f*F)+i; b[i]=j<n?x[j]*32768:0; }
    e.run(bp,c,vp);
    const ob=new Float32Array(e.memory.buffer,bp,F*c), ov=new Float32Array(e.memory.buffer,vp,c);
    raw.set(ob,f*F); vad.set(ov,f);
    if((f/BATCH)%20===0) progress(f/frames);
  }
  const y=new Float32Array(n); let since=1<<20, gain=1;
  for(let m=0;m*F<n;m++){
    let speech=false;
    for(let j=m+DELAY;j<=Math.min(frames-1,m+DELAY+LOOK);j++) if(vad[j]>0.35){ speech=true; break; }
    if(speech) since=0; else since++;
    const target=since<=HOLD?1:floor, g0=gain, g1=target>gain?target:gain+(target-gain)*0.25;   // fast open, ~100 ms close
    for(let i=0;i<F;i++){ const k=m*F+i; if(k>=n) break; y[k]=raw[k+DELAY*F]/32768*(g0+(g1-g0)*i/F); }
    gain=g1;
  }
  return y;
}

/* ---------- 2. noise-profile cleaner (Denoiser.java) ---------- */
function e1(x){
  if(x<1e-8) x=1e-8;
  if(x<=1){ let sum=0,term=1; for(let k=1;k<30;k++){ term*=-x/k; sum-=term/k; } return -0.5772156649015329-Math.log(x)+sum; }
  let b=x+1,c=1e30,d=1/b,h=d;
  for(let i=1;i<60;i++){ const an=-i*i; b+=2; d=1/(an*d+b); c=b+an/c; const del=c*d; h*=del; if(Math.abs(del-1)<1e-10) break; }
  return h*Math.exp(-x);
}
function denoise(x,fs,strength,voiceBand,progress){
  let n=256; while(n*2<=0.032*fs) n*=2;
  const hop=n/4, bins=n/2+1, win=new Float32Array(n);
  for(let i=0;i<n;i++) win[i]=0.5-0.5*Math.cos(2*Math.PI*i/n);
  let tot=0; for(let i=0;i<n;i++) tot+=win[i]*win[i]; const winNorm=tot/hop;
  const re=new Float32Array(n), im=new Float32Array(n), bitrev=new Int32Array(n), bitsN=Math.log2(n);
  for(let i=0;i<n;i++){ let r=0; for(let b=0;b<bitsN;b++) if(i&(1<<b)) r|=1<<(bitsN-1-b); bitrev[i]=r; }
  const cosT=new Float32Array(n/2), sinT=new Float32Array(n/2);
  for(let i=0;i<n/2;i++){ cosT[i]=Math.cos(-2*Math.PI*i/n); sinT[i]=Math.sin(-2*Math.PI*i/n); }
  const fft=()=>{
    for(let i=0;i<n;i++){ const j=bitrev[i]; if(j>i){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
    for(let len=2;len<=n;len<<=1){ const half=len>>1, step=n/len;
      for(let i=0;i<n;i+=len) for(let j=0;j<half;j++){ const wr=cosT[j*step], wi=sinT[j*step], a=i+j, b=a+half;
        const xr=re[b]*wr-im[b]*wi, xi=re[b]*wi+im[b]*wr; re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi; } }
  };
  const spectrum=(src,off)=>{ for(let i=0;i<n;i++){ re[i]=src[off+i]*win[i]; im[i]=0; } fft(); };
  const s=Math.max(0,Math.min(1,strength));
  const gMin=Math.pow(10,-(8+27*s)/20), overSub=1+1.5*s, gateFloor=Math.pow(10,-(12*s)/20);

  // pass 1: histogram of smoothed log power per bin; a low percentile is the steady background
  const H_LO=-200, H_STEP=0.5, H_BINS=600, hist=new Int32Array(bins*H_BINS), smooth1=new Float32Array(bins);
  let histFrames=0;
  for(let o=0;o+n<=x.length;o+=hop){
    spectrum(x,o);
    let total=0; for(let k=0;k<bins;k++) total+=re[k]*re[k]+im[k]*im[k];
    const silent=total<1e-9*n;
    for(let k=0;k<bins;k++){ const p=re[k]*re[k]+im[k]*im[k];
      smooth1[k]=histFrames===0?p:0.6*smooth1[k]+0.4*p;
      if(!silent){ const h=Math.floor((10*Math.log10(smooth1[k]+1e-20)-H_LO)/H_STEP); hist[k*H_BINS+Math.max(0,Math.min(H_BINS-1,h))]++; } }
    if(!silent) histFrames++;
    if((o/hop)%400===0) progress(0.15*o/x.length);
  }
  const noiseGlobal=new Float32Array(bins);
  if(histFrames>=4){
    const target=Math.max(1,Math.floor(histFrames*0.12));
    for(let k=0;k<bins;k++){ let c=0,h=0; for(;h<H_BINS;h++){ c+=hist[k*H_BINS+h]; if(c>=target) break; }
      noiseGlobal[k]=Math.pow(10,(H_LO+(h+0.5)*H_STEP)/10)*1.9; }
    const t=noiseGlobal.slice(); for(let k=1;k<bins-1;k++) noiseGlobal[k]=0.25*t[k-1]+0.5*t[k]+0.25*t[k+1];
  }

  // pass 2: minimum statistics + LSA gain + voice gate, overlap-add
  const BIAS=1.9, SUB=8, subLen=Math.max(1,Math.round(1.6*fs/hop/SUB));
  const smooth2=new Float32Array(bins), minCur=new Float32Array(bins), gPrev=new Float32Array(bins), gammaPrev=new Float32Array(bins), noise=new Float32Array(bins), g=new Float32Array(bins);
  const subMins=Array.from({length:SUB},()=>new Float32Array(bins));
  let subIdx=0, subCount=0, frameIdx=0, gate=1, hold=0;
  const latency=n-hop, pad=new Float32Array(latency+x.length+n), outAcc=new Float32Array(pad.length+n);
  pad.set(x,latency);                    // starts on zeros so the first samples get full overlap
  const lo=Math.max(1,Math.floor(250*n/fs)), hi=Math.min(bins-1,Math.floor(4000*n/fs)), binHz=fs/n, sc=1/(n*winNorm);
  const last=latency+x.length;
  for(let o=0;o<last;o+=hop){
    spectrum(pad,o);
    for(let k=0;k<bins;k++){ const p=re[k]*re[k]+im[k]*im[k];
      smooth2[k]=frameIdx===0?p:0.85*smooth2[k]+0.15*p;
      if(subCount===0||smooth2[k]<minCur[k]) minCur[k]=smooth2[k]; }
    if(frameIdx===0) for(const m of subMins) m.set(smooth2);
    if(++subCount>=subLen){ subMins[subIdx].set(minCur); subIdx=(subIdx+1)%SUB; subCount=0; }
    for(let k=0;k<bins;k++){ let m=minCur[k]; for(const sm of subMins) if(sm[k]<m) m=sm[k]; noise[k]=Math.max(noiseGlobal[k],m*BIAS)*overSub; }
    let sp=0,nz=0; for(let k=lo;k<=hi;k++){ sp+=re[k]*re[k]+im[k]*im[k]; nz+=noise[k]/overSub; }
    const speech=sp/(nz+1e-20)>2.5;
    if(speech) hold=Math.floor(0.25*fs/hop); else if(hold>0) hold--;
    const gt=(speech||hold>0)?1:gateFloor; gate+=(gt-gate)*(gt>gate?0.6:0.08);
    for(let k=0;k<bins;k++){ const p=re[k]*re[k]+im[k]*im[k], lam=noise[k]+1e-20, gamma=Math.min(p/lam,1e4);
      let xi=frameIdx===0?Math.max(gamma-1,0):0.98*gPrev[k]*gPrev[k]*gammaPrev[k]+0.02*Math.max(gamma-1,0);
      xi=Math.max(xi,0.003); const v=xi*gamma/(1+xi); let gain=xi/(1+xi)*Math.exp(0.5*e1(v)); if(gain>1) gain=1;
      gPrev[k]=gain; gammaPrev[k]=gamma; g[k]=gain; }
    for(let k=0;k<bins;k++){
      let gk=Math.max(0.25*g[Math.max(0,k-1)]+0.5*g[k]+0.25*g[Math.min(bins-1,k+1)],gMin)*gate;
      if(voiceBand){ const f=k*binHz; if(f<70) gk*=gMin; else if(f<110) gk*=0.35; else if(f>10000) gk*=0.25; }
      re[k]*=gk; im[k]*=gk; if(k>0&&k<n/2){ re[n-k]=re[k]; im[n-k]=-im[k]; } }
    im[0]=0; im[n/2]=0;
    for(let i=0;i<n;i++) im[i]=-im[i];
    fft();
    for(let i=0;i<n;i++) outAcc[o+i]+=re[i]*win[i]*sc;
    frameIdx++;
    if(frameIdx%200===0) progress(0.15+0.85*o/last);
  }
  return outAcc.slice(latency,latency+x.length);
}

/* ---------- 3. level (VideoProcessor.Level + soft limiter) ---------- */
function level(y,fs){
  const block=Math.floor(fs/20), rms=[]; let peak=0;
  for(let i=0;i+block<=y.length;i+=block){ let s=0; for(let j=i;j<i+block;j++){ s+=y[j]*y[j]; const a=Math.abs(y[j]); if(a>peak) peak=a; } rms.push(Math.sqrt(s/block)); }
  let gain=1;
  if(rms.length&&peak>0){ rms.sort((a,b)=>a-b); const loud=rms[Math.floor(rms.length*0.9)]; if(loud>1e-5) gain=Math.max(1,Math.min(0.18/loud,12)); }
  for(let i=0;i<y.length;i++){ let v=y[i]*gain; const a=Math.abs(v); if(a>0.8){ const l=0.8+0.2*Math.tanh((a-0.8)/0.2); v=v<0?-l:l; } y[i]=v; }
  return y;
}

self.onmessage=async ev=>{
  const {id,x,strength,wasm}=ev.data, fs=48000;
  const post=(stage,p)=>self.postMessage({id,progress:stage,p});
  try{
    const e=await loadNet(wasm);
    let y=x, usedNet=false;
    if(e){ try{ y=neural(e,x,strength,p=>post('neural',p)); usedNet=true; }catch(err){ y=x; } }
    y=denoise(y,fs,strength,true,p=>post('clean',p));
    level(y,fs);
    self.postMessage({id,y,neural:usedNet},[y.buffer]);
  }catch(err){ self.postMessage({id,error:String(err&&err.message||err)}); }
};
