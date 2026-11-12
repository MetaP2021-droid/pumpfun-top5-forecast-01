import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
type Row = { rank:number; mint:string; market_cap_lamports:string|number };
type Mark = { ok:boolean; at?:string; timestamp?:string; rows:Row[]|null };

const task = JSON.parse(readFileSync(join(I,'task.json'),'utf8'));
const marks:Mark[] = readFileSync(join(I,'history.ndjson'),'utf8')
 .split('\n').filter(Boolean).map(x=>JSON.parse(x))
 .filter(x=>x.ok && Array.isArray(x.rows) && x.rows.length)
 .slice(-8);

if (!marks.length) throw new Error('No usable history');

const last = marks[marks.length-1];
const chart = [...last.rows!].sort((a,b)=>a.rank-b.rank);
const logcap = (r:Row) => Math.log10(Number(BigInt(r.market_cap_lamports)))-9;
const time = (m:Mark,i:number) => {
 const s=m.at||m.timestamp;
 return s ? Date.parse(s)/3600000 : i;
};
const latestTime=time(last,marks.length-1);

const forecasts = chart.map(r=>{
 const points = marks.map((m,i)=>{
  const found=m.rows!.find(x=>x.mint===r.mint);
  return found ? {x:time(m,i)-latestTime,y:logcap(found)} : null;
 }).filter((p):p is {x:number,y:number}=>p!==null).slice(-5);

 let slope=0;
 if(points.length>=2){
  const mx=points.reduce((s,p)=>s+p.x,0)/points.length;
  const my=points.reduce((s,p)=>s+p.y,0)/points.length;
  const den=points.reduce((s,p)=>s+(p.x-mx)**2,0);
  if(den>0) slope=points.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/den;
 }
 slope=Math.max(-0.15,Math.min(0.15,slope));
 const momentum=slope*1.5*Math.min(1,points.length/3);
 const current=logcap(r);
 return {mint:r.mint,rank:r.rank,cap:current,score:current+momentum,
  momentum,observations:points.length};
});

forecasts.sort((a,b)=>b.score-a.score);
const top5=forecasts.slice(0,task.places).map(x=>x.mint);
const probabilities:Array<{mint:string;place:number;p:number}>=[];
const sizes:Array<{place:number;bin:number;p:number}>=[];
const edges:number[]=task.size.edges;

function erfc(x:number):number {
 const z=Math.abs(x),t=1/(1+0.5*z);
 const r=t*Math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277)))))))));
 return x>=0?r:2-r;
}
const above=(x:number,m:number,s:number)=>x===-Infinity?1:x===Infinity?0:0.5*erfc((x-m)/(s*Math.SQRT2));

for(let place=1;place<=task.places;place++){
 const weights=forecasts.map((f,i)=>({
  mint:f.mint,
  w:Math.exp(-0.5*((i+1-place)/1.15)**2)
 }));
 const total=weights.reduce((s,x)=>s+x.w,0);
 for(const w of weights){
  const p=Math.floor((w.w/total)*0.88*1e6)/1e6;
  if(p>0) probabilities.push({mint:w.mint,place,p});
 }

 const f=forecasts[place-1];
 const sd=0.42+Math.min(0.18,Math.abs(f.momentum)*0.12);
 for(let bin=0;bin<=edges.length;bin++){
  const lo=bin===0?-Infinity:edges[bin-1];
  const hi=bin===edges.length?Infinity:edges[bin];
  const p=Math.floor((above(lo,f.score,sd)-above(hi,f.score,sd))*1e6)/1e6;
  if(p>0)sizes.push({place,bin,p});
 }
}

writeFileSync(join(O,task.output),JSON.stringify({probabilities,top5,sizes})+'\n');
