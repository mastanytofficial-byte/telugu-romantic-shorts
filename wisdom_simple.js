const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const WORK_DIR = path.join(__dirname, 'work');
const STATE_FILE = path.join(__dirname, 'last-article.json');
const REVIEW_FILE = path.join(WORK_DIR, 'review.txt');
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const VIDEO_SECONDS = 20;

const FORBIDDEN = new Set([
  'a','an','and','are','be','but','is','was','were','the','to','of','in','on',
  'for','with','from','this','that','me','mine','my','your','you','one','someone',
  'best','true','real','life','love','heart','story','special','because','first',
  'success','successful','hard','work','working','dream','dreams','goal','goals',
  'effort','courage','patience','discipline','focus','mind','power','strength',
  'believe','achieve','achievement','growth','failure','fail','mistake','mistakes',
  'lesson','lessons','path','journey','time','change','better','inner','control',
  'peace','calm','brave','strong','motivation','motivational','inspire','inspiration',
  'quote','quotes'
]);

const FALLBACKS = [
  { title:'Modati Adugu', screen:'Kashtapadina prathi kshanam vrudha kaadu, aa kastam venaka dagi unna anubhavam manaki kotha balanni istu mundhuku nadipistundi', mood:'quiet determination', image:'lone figure taking the first step onto a misty mountain trail at sunrise, soft golden light, quiet determined atmosphere, cinematic photography, vertical composition' },
  { title:'Kotha Paatam', screen:'Prathi vairalyam venuka oka kotha paatam dagi untundi, aa paatanni artham chesukunna prathi okkaru marintha balamga mari mundhuku sagipotharu', mood:'calm resilience', image:'person standing before a cracked open door with warm light spilling through, symbolic of new beginnings after setback, calm hopeful mood, cinematic photography' },
  { title:'Lopala Balam', screen:'Manaloni atma vishwasam prathi kashtamaina rojunu daatinche asali balam, adi eppudu manatho patu nadustu manaki dhairyanni andistu untundi', mood:'hopeful strength', image:'silhouette of a person standing tall against a stormy sky that is clearing to sunlight, inner strength and hope, cinematic photography, vertical composition' },
  { title:'Sahanam Phalam', screen:'Sahanam tho eduru chuse prathi kshanam vrudha avvadu, adi manaki sarina samayamlo manchi phalithanni teesukochi mana prayatnaniki nijamaina viluva istundi', mood:'warm encouragement', image:'a single sapling growing through cracked rock in warm afternoon light, patience and quiet reward, cinematic photography, vertical composition' },
  { title:'Gamyam Vaipu', screen:'Lakshyam vaipu prathi chinna adugu kuda vrudha kaadu, aa adugulu kalisi oka roju manalni gamyaniki teesukellutayani nammakam tho mundhuku sagali', mood:'steady focus', image:'person walking a long winding path toward a distant sunrise on the horizon, focused determined journey, cinematic photography, vertical composition' }
];

function log(x){ console.log(`[${new Date().toISOString()}] ${x}`); }
async function get(url, options={}, timeout=30000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(t);}
}
function countWords(s){return String(s||'').trim().split(/\s+/).filter(Boolean).length;}
function badWords(s){return [...new Set((String(s||'').toLowerCase().match(/[a-z]+/g)||[]).filter(w=>FORBIDDEN.has(w)))];}
function validQuote(s){const n=countWords(s), bad=badWords(s); return n>=MIN_WORDS&&n<=MAX_WORDS&&bad.length===0&&!/#/.test(s);}
function state(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return {runCount:0};}}
function saveState(title){const s=state();fs.writeFileSync(STATE_FILE,JSON.stringify({runCount:(s.runCount||0)+1,lastTitle:title,lastDate:new Date().toISOString()},null,2));}

async function groq(prompt){
  const r=await get('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model:'openai/gpt-oss-120b',temperature:.85,messages:[{role:'user',content:prompt}]})});
  const d=await r.json(); if(!d.choices?.[0]?.message?.content) throw new Error(`Groq returned no content: HTTP ${r.status} ${JSON.stringify(d)}`);
  return d.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
}
function parse(raw){
  const title=raw.match(/TITLE:\s*(.+)/i)?.[1]?.trim()||'Telugu Life Wisdom';
  const screen=(raw.match(/SCREEN:\s*([\s\S]*?)(?=\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const mood=raw.match(/MOOD:\s*(.+)/i)?.[1]?.trim()||'quiet determination';
  const image=raw.match(/IMAGE_PROMPT:\s*([\s\S]*?)(?=\n$|$)/i)?.[1]?.trim()||'';
  return {title,screen,mood,image};
}
async function makeQuote(){
  const themes=['kashtapadithe vache phalitham','vairalyam nunchi nerchukovadam','atma vishwasam','sahanam mariyu erpu','lakshyam vaipu prayanam','marpu tho vache kotha balam','chinna prayatnam pedda phalitham','gelupu venuka dagi unna kastam'];
  const theme=themes[state().runCount%themes.length];
  const prompt=`Create ONE completely original motivational life-wisdom Telugu quote for a YouTube Short. Theme: ${theme}.
SCREEN: exactly 16-36 words. Write ONLY Telugu vocabulary using English alphabet (Tenglish). ZERO English words. No hashtags. Do NOT quote or reference any real person, book, movie, song, scripture, or existing proverb — the thought must be entirely original. Do NOT make factual claims, statistics, or promises about health, money, or results. Natural Telugu, wise, mature, simple and memorable. Do not write a short slogan. Make one flowing thought with 2-3 connected clauses.
MOOD: give 2-4 English mood words only.
IMAGE_PROMPT: write one detailed English prompt for ONE full-screen 9:16 cinematic photograph that exactly matches the quote's emotion (e.g. determination, growth, quiet strength, new beginnings). Include subject, setting, lighting, atmosphere and emotion. No text, no watermark, no collage, no people's faces resembling real public figures.
Return exactly four lines: TITLE: ...\nSCREEN: ...\nMOOD: ...\nIMAGE_PROMPT: ...`;
  for(let i=1;i<=5;i++){
    const q=parse(await groq(prompt+(i>1?'\nPrevious attempt was invalid. Write a completely new 20-30 word original Telugu thought, not a shorter version, and do not quote anyone.':'')));
    log(`Quote attempt ${i}: ${countWords(q.screen)} words, valid=${validQuote(q.screen)}`);
    if(validQuote(q.screen)&&q.image) return q;
  }
  const f=FALLBACKS[state().runCount%FALLBACKS.length];
  log(`Groq did not pass validation; using curated original fallback: ${f.title}`);
  return f;
}

async function makeImage(prompt){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  const enhanced=`${prompt}, vertical 9:16, cinematic still photograph, realistic natural human emotion, beautiful composition, soft depth of field, subtle film grain, no words, no letters, no logo, no watermark, no collage`;
  const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=1080&height=1920&nologo=true`;
  const r=await get(url,{},60000); if(!r.ok) throw new Error(`AI image failed HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer()); if(b.length<10000) throw new Error('AI image response too small');
  const p=path.join(WORK_DIR,'background.jpg'); fs.writeFileSync(p,b); log('Created ONE quote-specific full-screen AI image.'); return p;
}

function wav(file,duration,mood){
  const sr=44100,total=Math.ceil(sr*duration),a=new Int16Array(total*2);
  const presets={
    'quiet determination':[196,246.94,293.66], 'hopeful strength':[220,277.18,329.63],
    'calm resilience':[174.61,220,261.63], 'warm encouragement':[261.63,329.63,392],
    'steady focus':[196,233.08,293.66]
  };
  const key=Object.keys(presets).find(k=>mood.toLowerCase().includes(k.split(' ')[1]))||'steady focus';
  const notes=presets[key];
  for(let i=0;i<total;i++){
    const t=i/sr, chord=notes[Math.floor(t/4)%notes.length], fade=Math.min(1,t/1.5,(duration-t)/1.5);
    const pad=.012*Math.sin(2*Math.PI*chord*t)+.007*Math.sin(2*Math.PI*(chord*2)*t);
    const melody=.006*Math.sin(2*Math.PI*(chord*(1+(Math.floor(t*2)%3)*.25))*t);
    const s=Math.round((pad+melody)*Math.max(0,fade)*32767); a[i*2]=s;a[i*2+1]=s;
  }
  const h=Buffer.alloc(44+a.length*2); h.write('RIFF',0);h.writeUInt32LE(36+a.length*2,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(2,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*4,28);h.writeUInt16LE(4,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(a.length*2,40);for(let i=0;i<a.length;i++)h.writeInt16LE(a[i],44+i*2);fs.writeFileSync(file,h);return file;
}
function quoteLines(text,max=31){const out=[];let line='';for(const w of text.split(/\s+/)){const n=line?`${line} ${w}`:w;if(line&&n.length>max){out.push(line);line=w}else line=n}if(line)out.push(line);return out.join('\n');}
function render(image,bgm,quote){
  const out=path.join(WORK_DIR,'output.mp4'),txt=path.join(WORK_DIR,'quote.txt');fs.writeFileSync(txt,quoteLines(quote),'utf8');
  const font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const vf=`scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0009,1.08)':d=500:s=1080x1920:fps=25,drawbox=x=55:y=650:w=970:h=620:color=black@0.26:t=fill,drawtext=fontfile='${font}':textfile='${txt}':fontcolor=white:fontsize=46:line_spacing=18:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.9:shadowx=2:shadowy=3`;
  execSync(`ffmpeg -y -loop 1 -i "${image}" -i "${bgm}" -vf "${vf}" -t ${VIDEO_SECONDS} -map 0:v -map 1:a -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "${out}"`,{stdio:'inherit'});return out;
}
async function upload(video,title,quote){
  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET);auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const yt=google.youtube({version:'v3',auth});
  const r=await yt.videos.insert({part:['snippet','status'],requestBody:{snippet:{title:title.slice(0,95),description:`${quote}\n\nOriginal Telugu life-wisdom quote with a quote-specific cinematic image and original instrumental BGM.`,tags:['telugu quotes','telugu motivational quotes','tenglish quotes','life wisdom shorts','telugu shorts','self improvement'],categoryId:'27'},status:{privacyStatus:'private',selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(video)}});
  const url=`https://www.youtube.com/watch?v=${r.data.id}`;
  const studioUrl=`https://studio.youtube.com/video/${r.data.id}/edit`;
  log(`Uploaded as PRIVATE (pending your review): ${url}`);
  const review=`## Review required before publishing\n\n- Title: ${title}\n- Watch (private): ${url}\n- Edit in Studio: ${studioUrl}\n\nCheck the Telugu text, image and audio, then set visibility to Public yourself in YouTube Studio to publish.`;
  fs.mkdirSync(WORK_DIR,{recursive:true});
  fs.writeFileSync(REVIEW_FILE,review,'utf8');
}
async function main(){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  for(const [n,v] of Object.entries({GROQ_API_KEY,YT_CLIENT_ID,YT_CLIENT_SECRET,YT_REFRESH_TOKEN}))if(!v)throw new Error(`${n} is missing`);
  log('Run: quote + ONE full-screen matching image + ONE matching original BGM. NO VOICE. Uploads PRIVATE for review.');
  const q=await makeQuote();log(`SCREEN (${countWords(q.screen)} words): ${q.screen}`);log(`MOOD: ${q.mood}`);log(`IMAGE: ${q.image}`);
  const image=await makeImage(q.image);const bgm=wav(path.join(WORK_DIR,'original_bgm.wav'),VIDEO_SECONDS,q.mood);const video=render(image,bgm,q.screen);await upload(video,q.title,q.screen);saveState(q.title);log('Done. Waiting on your manual review/publish.');
}
main().catch(e=>{console.error('FAILED:',e.stack||e);process.exit(1);});
