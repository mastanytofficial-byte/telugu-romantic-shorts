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
const BGM_FILE = path.join(__dirname, 'assets', 'bgm.mp3');
const RENDER_TEXT_SCRIPT = path.join(__dirname, 'render_text.py');
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const VIDEO_SECONDS = 20;
const TELUGU_RANGE = /[ఀ-౿]/;

const FALLBACKS = [
  { title:'మొదటి అడుగు', screen:'కష్టపడిన ప్రతి క్షణం వృథా కాదు, ఆ కష్టం వెనుక దాగి ఉన్న అనుభవం మనకి కొత్త బలాన్ని ఇస్తూ ముందుకు నడిపిస్తుంది', image:'lone figure taking the first step onto a misty mountain trail at sunrise, soft golden light, quiet determined atmosphere, cinematic photography, vertical composition' },
  { title:'కొత్త పాఠం', screen:'ప్రతి వైఫల్యం వెనుక ఒక కొత్త పాఠం దాగి ఉంటుంది, ఆ పాఠాన్ని అర్థం చేసుకున్న ప్రతి ఒక్కరు మరింత బలంగా మారి ముందుకు సాగిపోతారు', image:'person standing before a cracked open door with warm light spilling through, symbolic of new beginnings after setback, calm hopeful mood, cinematic photography' },
  { title:'లోపల బలం', screen:'మనలోని ఆత్మ విశ్వాసం ప్రతి కష్టమైన రోజును దాటించే అసలి బలం, అది ఎప్పుడూ మనతో పాటు నడుస్తూ మనకి ధైర్యాన్ని అందిస్తూ ఉంటుంది', image:'silhouette of a person standing tall against a stormy sky that is clearing to sunlight, inner strength and hope, cinematic photography, vertical composition' },
  { title:'సహనం ఫలం', screen:'సహనంతో ఎదురు చూసే ప్రతి క్షణం వృథా అవ్వదు, అది మనకి సరైన సమయంలో మంచి ఫలితాన్ని తీసుకొచ్చి మన ప్రయత్నానికి నిజమైన విలువ ఇస్తుంది', image:'a single sapling growing through cracked rock in warm afternoon light, patience and quiet reward, cinematic photography, vertical composition' },
  { title:'గమ్యం వైపు', screen:'లక్ష్యం వైపు ప్రతి చిన్న అడుగు కూడా వృథా కాదు, ఆ అడుగులు కలిసి ఒక రోజు మనల్ని గమ్యానికి తీసుకెళ్తాయని నమ్మకంతో ముందుకు సాగాలి', image:'person walking a long winding path toward a distant sunrise on the horizon, focused determined journey, cinematic photography, vertical composition' }
];

function log(x){ console.log(`[${new Date().toISOString()}] ${x}`); }
async function get(url, options={}, timeout=30000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(t);}
}
function countWords(s){return String(s||'').trim().split(/\s+/).filter(Boolean).length;}
function latinLeakage(s){return (String(s||'').match(/[A-Za-z]{2,}/g)||[]);}
function validQuote(s){
  const n=countWords(s), leaked=latinLeakage(s);
  return n>=MIN_WORDS&&n<=MAX_WORDS&&leaked.length===0&&!/#/.test(s)&&TELUGU_RANGE.test(s);
}
function state(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return {runCount:0};}}
function saveState(title){const s=state();fs.writeFileSync(STATE_FILE,JSON.stringify({runCount:(s.runCount||0)+1,lastTitle:title,lastDate:new Date().toISOString()},null,2));}

async function groq(prompt){
  const r=await get('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model:'openai/gpt-oss-120b',temperature:.85,messages:[{role:'user',content:prompt}]})});
  const d=await r.json(); if(!d.choices?.[0]?.message?.content) throw new Error(`Groq returned no content: HTTP ${r.status} ${JSON.stringify(d)}`);
  return d.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
}
function parse(raw){
  const title=raw.match(/TITLE:\s*(.+)/i)?.[1]?.trim()||'తెలుగు జీవిత సత్యం';
  const screen=(raw.match(/SCREEN:\s*([\s\S]*?)(?=\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const mood=raw.match(/MOOD:\s*(.+)/i)?.[1]?.trim()||'quiet determination';
  const image=raw.match(/IMAGE_PROMPT:\s*([\s\S]*?)(?=\n$|$)/i)?.[1]?.trim()||'';
  return {title,screen,mood,image};
}
async function makeQuote(){
  const themes=['kashtapadithe vache phalitham','vairalyam nunchi nerchukovadam','atma vishwasam','sahanam mariyu erpu','lakshyam vaipu prayanam','marpu tho vache kotha balam','chinna prayatnam pedda phalitham','gelupu venuka dagi unna kastam'];
  const theme=themes[state().runCount%themes.length];
  const prompt=`Create ONE completely original motivational life-wisdom quote for a YouTube Short, in the Telugu language. Theme: ${theme}.
TITLE: a short 2-4 word title, written entirely in native Telugu script.
SCREEN: exactly 16-36 words, written ENTIRELY in native Telugu script (Unicode Telugu letters). Do NOT use English/Latin letters anywhere in this line, not even for names or filler. No hashtags. Do NOT quote or reference any real person, book, movie, song, scripture, or existing proverb — the thought must be entirely original. Do NOT make factual claims, statistics, or promises about health, money, or results. Natural Telugu, wise, mature, simple and memorable. Do not write a short slogan. Make one flowing thought with 2-3 connected clauses.
MOOD: give 2-4 English mood words only.
IMAGE_PROMPT: write one detailed English prompt for ONE full-screen 9:16 cinematic photograph that exactly matches the quote's emotion (e.g. determination, growth, quiet strength, new beginnings). Include subject, setting, lighting, atmosphere and emotion. No text, no watermark, no collage, no people's faces resembling real public figures.
Return exactly four lines: TITLE: ...\nSCREEN: ...\nMOOD: ...\nIMAGE_PROMPT: ...`;
  for(let i=1;i<=5;i++){
    const q=parse(await groq(prompt+(i>1?'\nPrevious attempt was invalid (it had English letters, wrong word count, or a quoted/borrowed line). Write a completely new 20-30 word original Telugu thought, entirely in Telugu script, not a shorter version, and do not quote anyone.':'')));
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

function render(image,quote){
  const out=path.join(WORK_DIR,'output.mp4'),txt=path.join(WORK_DIR,'quote.txt'),overlay=path.join(WORK_DIR,'overlay.png');
  fs.writeFileSync(txt,quote,'utf8');
  execSync(`python3 "${RENDER_TEXT_SCRIPT}" "${txt}" "${overlay}"`,{stdio:'inherit'});
  const fc=`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0009,1.08)':d=500:s=1080x1920:fps=25[bg];[bg][2:v]overlay=0:0:format=auto[v]`;
  execSync(`ffmpeg -y -loop 1 -i "${image}" -i "${BGM_FILE}" -loop 1 -i "${overlay}" -filter_complex "${fc}" -map "[v]" -map 1:a -t ${VIDEO_SECONDS} -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "${out}"`,{stdio:'inherit'});return out;
}
async function upload(video,title,quote){
  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET);auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const yt=google.youtube({version:'v3',auth});
  const r=await yt.videos.insert({part:['snippet','status'],requestBody:{snippet:{title:title.slice(0,95),description:`${quote}\n\nOriginal Telugu life-wisdom quote with a quote-specific cinematic image.`,tags:['telugu quotes','telugu motivational quotes','life wisdom shorts','telugu shorts','self improvement','జీవిత సత్యాలు'],categoryId:'27'},status:{privacyStatus:'private',selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(video)}});
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
  if(!fs.existsSync(BGM_FILE))throw new Error(`Bundled BGM file missing: ${BGM_FILE}`);
  log('Run: quote (Telugu script) + ONE full-screen matching image + fixed channel BGM. NO VOICE. Uploads PRIVATE for review.');
  const q=await makeQuote();log(`SCREEN (${countWords(q.screen)} words): ${q.screen}`);log(`IMAGE: ${q.image}`);
  const image=await makeImage(q.image);const video=render(image,q.screen);await upload(video,q.title,q.screen);saveState(q.title);log('Done. Waiting on your manual review/publish.');
}
main().catch(e=>{console.error('FAILED:',e.stack||e);process.exit(1);});
