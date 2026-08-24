const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');
const puppeteer = require('puppeteer-core');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const WORK_DIR = path.join(__dirname, 'work');
const FRAMES_DIR = path.join(WORK_DIR, 'frames');
const STATE_FILE = path.join(__dirname, 'last-article.json');
const REVIEW_FILE = path.join(WORK_DIR, 'review.txt');
const BGM_FILE = path.join(__dirname, 'assets', 'bgm.mp3');
const TELUGU_FONT = '/usr/share/fonts/truetype/noto/NotoSansTelugu-SemiBold.ttf';
const CHROME_PATH = process.env.CHROME_PATH || ['/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium-browser','/usr/bin/chromium'].find(p=>fs.existsSync(p));
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const TITLE_MIN_WORDS = 1;
const TITLE_MAX_WORDS = 6;
const HOOK_MIN_WORDS = 4;
const HOOK_MAX_WORDS = 20;
const VIDEO_SECONDS = 20;
const REVEAL_SECONDS = 14; // words appear progressively over this window
const HOLD_SECONDS = VIDEO_SECONDS - REVEAL_SECONDS; // full quote holds steady for the rest
const TELUGU_RANGE = /[ఀ-౿]/;
const MOOD_EMOJI = [[/determin/i,'💪'],[/resilien/i,'🌊'],[/strength/i,'🔥'],[/hope/i,'🌅'],[/focus/i,'🎯'],[/calm/i,'🍃'],[/growth/i,'🌱'],[/courage|brave/i,'🦁']];

const FALLBACKS = [
  { title:'మొదటి అడుగు', screen:'కష్టపడిన ప్రతి క్షణం వృథా కాదు, ఆ కష్టం వెనుక దాగి ఉన్న అనుభవం మనకి కొత్త బలాన్ని ఇస్తూ ముందుకు నడిపిస్తుంది', hook:'ప్రతి కష్టం వెనుక ఏం దాగుందో తెలుసా?', mood:'quiet determination', image:'lone figure taking the first step onto a misty mountain trail at sunrise, soft golden light, quiet determined atmosphere, cinematic photography, vertical composition' },
  { title:'కొత్త పాఠం', screen:'ప్రతి వైఫల్యం వెనుక ఒక కొత్త పాఠం దాగి ఉంటుంది, ఆ పాఠాన్ని అర్థం చేసుకున్న ప్రతి ఒక్కరు మరింత బలంగా మారి ముందుకు సాగిపోతారు', hook:'వైఫల్యం నిజంగా ఏం నేర్పిస్తుందో ఇక్కడ చూడండి.', mood:'calm resilience', image:'person standing before a cracked open door with warm light spilling through, symbolic of new beginnings after setback, calm hopeful mood, cinematic photography' },
  { title:'లోపల బలం', screen:'మనలోని ఆత్మ విశ్వాసం ప్రతి కష్టమైన రోజును దాటించే అసలి బలం, అది ఎప్పుడూ మనతో పాటు నడుస్తూ మనకి ధైర్యాన్ని అందిస్తూ ఉంటుంది', hook:'నిజమైన బలం ఎక్కడ నుండి వస్తుందో తెలుసా?', mood:'hopeful strength', image:'silhouette of a person standing tall against a stormy sky that is clearing to sunlight, inner strength and hope, cinematic photography, vertical composition' },
  { title:'సహనం ఫలం', screen:'సహనంతో ఎదురు చూసే ప్రతి క్షణం వృథా అవ్వదు, అది మనకి సరైన సమయంలో మంచి ఫలితాన్ని తీసుకొచ్చి మన ప్రయత్నానికి నిజమైన విలువ ఇస్తుంది', hook:'సహనం మీకు ఏం ఇస్తుందో తెలుసా?', mood:'warm encouragement', image:'a single sapling growing through cracked rock in warm afternoon light, patience and quiet reward, cinematic photography, vertical composition' },
  { title:'గమ్యం వైపు', screen:'లక్ష్యం వైపు ప్రతి చిన్న అడుగు కూడా వృథా కాదు, ఆ అడుగులు కలిసి ఒక రోజు మనల్ని గమ్యానికి తీసుకెళ్తాయని నమ్మకంతో ముందుకు సాగాలి', hook:'చిన్న అడుగులు ఎంత దూరం తీసుకెళ్తాయో చూడండి.', mood:'steady focus', image:'person walking a long winding path toward a distant sunrise on the horizon, focused determined journey, cinematic photography, vertical composition' }
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
function validTitle(t){
  const n=countWords(t), leaked=latinLeakage(t);
  return n>=TITLE_MIN_WORDS&&n<=TITLE_MAX_WORDS&&leaked.length===0&&!/#/.test(t)&&TELUGU_RANGE.test(t)&&String(t||'').length<=60;
}
function validHook(h){
  const n=countWords(h), leaked=latinLeakage(h);
  return n>=HOOK_MIN_WORDS&&n<=HOOK_MAX_WORDS&&leaked.length===0&&!/#/.test(h)&&TELUGU_RANGE.test(h);
}
function pickEmoji(mood){const hit=MOOD_EMOJI.find(([re])=>re.test(mood||''));return hit?hit[1]:'✨';}
function state(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return {runCount:0,used:[]};}}
// `used` grows without trimming: once a title/quote has aired, it must never repeat, not just
// within the last few runs. The list only holds two short strings per run so it stays tiny for years.
function isDuplicate(title,screen,image){
  const used=state().used||[];
  return used.some(r=>r.title===title.trim()||r.screen===screen.trim()||(image&&r.image===image.trim()));
}
function saveState(title,screen,image){
  const s=state();
  const used=[...(s.used||[]),{title:title.trim(),screen:screen.trim(),image:(image||'').trim()}];
  fs.writeFileSync(STATE_FILE,JSON.stringify({runCount:(s.runCount||0)+1,lastTitle:title,lastDate:new Date().toISOString(),used},null,2));
}

async function groq(prompt){
  const r=await get('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model:'openai/gpt-oss-120b',temperature:.85,messages:[{role:'user',content:prompt}]})});
  const d=await r.json(); if(!d.choices?.[0]?.message?.content) throw new Error(`Groq returned no content: HTTP ${r.status} ${JSON.stringify(d)}`);
  return d.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
}
function parse(raw){
  const title=raw.match(/TITLE:\s*(.+)/i)?.[1]?.trim()||'తెలుగు జీవిత సత్యం';
  const screen=(raw.match(/SCREEN:\s*([\s\S]*?)(?=\nHOOK:|\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const hook=(raw.match(/HOOK:\s*([\s\S]*?)(?=\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const mood=raw.match(/MOOD:\s*(.+)/i)?.[1]?.trim()||'quiet determination';
  const image=raw.match(/IMAGE_PROMPT:\s*([\s\S]*?)(?=\n$|$)/i)?.[1]?.trim()||'';
  return {title,screen,hook,mood,image};
}
async function makeQuote(){
  const themes=['kashtapadithe vache phalitham','vairalyam nunchi nerchukovadam','atma vishwasam','sahanam mariyu erpu','lakshyam vaipu prayanam','marpu tho vache kotha balam','chinna prayatnam pedda phalitham','gelupu venuka dagi unna kastam'];
  const theme=themes[state().runCount%themes.length];
  const prompt=`Create ONE completely original motivational life-wisdom quote for a YouTube Short, in the Telugu language. Theme: ${theme}.
TITLE: a short, grammatically complete, correctly spelled 2-4 word Telugu phrase that captures the quote's core idea, written entirely in native Telugu script. Double-check the spelling of every word before answering — for example "లక్ష్యం" (goal) must keep its "్యం" ending, do not drop it.
SCREEN: exactly 16-36 words, written ENTIRELY in native Telugu script (Unicode Telugu letters). Do NOT use English/Latin letters anywhere in this line, not even for names or filler. No hashtags. Do NOT quote or reference any real person, book, movie, song, scripture, or existing proverb — the thought must be entirely original. Do NOT make factual claims, statistics, or promises about health, money, or results. Natural Telugu, wise, mature, simple and memorable. Do not write a short slogan. Make one flowing thought with 2-3 connected clauses.
HOOK: a short 4-20 word Telugu sentence, entirely in Telugu script, that teases the quote's idea WITHOUT repeating the SCREEN line word-for-word — phrase it as a curiosity-driven question or statement suitable as the opening line of a YouTube description.
Before finalizing, silently proofread SCREEN and HOOK as a strict native Telugu editor would: check subject-verb agreement, correct case markers (never attach an accusative "-ని/-ను" to a noun governed by an intransitive verb like పూయు/వికసించు/పెరుగు), transitive vs intransitive verb usage, and natural everyday idiom (e.g. prefer "ఎప్పుడైనా చూసారా" over the unnatural "ఎప్పుడూ చూసారా" in a question). Rewrite silently until every line reads completely natural, grammatically flawless Telugu before answering.
MOOD: give 2-4 English mood words only.
IMAGE_PROMPT: write one detailed English prompt for ONE full-screen 9:16 cinematic photograph that exactly matches the quote's emotion (e.g. determination, growth, quiet strength, new beginnings). Include subject, setting, lighting, atmosphere and emotion. No text, no watermark, no collage, no people's faces resembling real public figures.
Return exactly five lines: TITLE: ...\nSCREEN: ...\nHOOK: ...\nMOOD: ...\nIMAGE_PROMPT: ...`;
  for(let i=1;i<=5;i++){
    const q=parse(await groq(prompt+(i>1?'\nPrevious attempt was invalid (it had English letters, a misspelled/incomplete title, wrong word count, a quoted/borrowed line, or repeated a quote already used on this channel before). Write a completely new 20-30 word original Telugu thought with a correctly spelled title and a fresh hook line, entirely in Telugu script, not a shorter version, and do not quote anyone.':'')));
    const ok=validQuote(q.screen)&&validTitle(q.title)&&validHook(q.hook)&&q.image&&!isDuplicate(q.title,q.screen,q.image);
    log(`Quote attempt ${i}: title="${q.title}" (${countWords(q.title)}w), screen=${countWords(q.screen)}w, hook=${countWords(q.hook)}w, valid=${ok}`);
    if(ok) return q;
  }
  const pool=FALLBACKS.filter(f=>!isDuplicate(f.title,f.screen,f.image));
  if(!pool.length) throw new Error('All curated fallbacks have already been used and Groq keeps failing validation — add more FALLBACKS entries.');
  const f=pool[state().runCount%pool.length];
  log(`Groq did not pass validation; using curated original fallback: ${f.title}`);
  return f;
}

async function makeImage(prompt){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  const enhanced=`${prompt}, vertical 9:16, cinematic still photograph, realistic natural human emotion, beautiful composition, soft depth of field, subtle film grain, no words, no letters, no logo, no watermark, no collage`;
  const seed=Math.floor(Math.random()*1e9);
  const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=1080&height=1920&nologo=true&seed=${seed}`;
  const r=await get(url,{},60000); if(!r.ok) throw new Error(`AI image failed HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer()); if(b.length<10000) throw new Error('AI image response too small');
  const p=path.join(WORK_DIR,'background.jpg'); fs.writeFileSync(p,b); log('Created ONE quote-specific full-screen AI image.'); return p;
}

function stripEmoji(s){return String(s||'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,'').trim();}
function escapeHtml(s){return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// The newest word is rendered as its own span with an inline opacity + translateY so each sub-frame
// captures a step of a fade-up "float in" instead of the whole line changing in a single hard cut.
function overlayHtmlPartial(words,revealFrac){
  const prior=words.slice(0,-1).map(escapeHtml).join(' ');
  const last=escapeHtml(words[words.length-1]);
  const rise=((1-revealFrac)*14).toFixed(2);
  const lastSpan=`<span style="opacity:${revealFrac};display:inline-block;transform:translateY(${rise}px)">${last}</span>`;
  const inner=prior?`${prior} ${lastSpan}`:lastSpan;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'TeluguFont';src:url('file://${TELUGU_FONT}');}
    html,body{margin:0;padding:0;width:1080px;height:1920px;background:transparent;}
    .box{position:absolute;left:55px;top:650px;width:970px;height:620px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 60px;}
    .txt{font-family:'TeluguFont',sans-serif;font-size:54px;line-height:1.5;color:#fff;text-align:center;text-shadow:0 0 14px rgba(0,0,0,0.95),0 0 28px rgba(0,0,0,0.85),2px 3px 4px rgba(0,0,0,0.9);width:850px;}
  </style></head><body><div class="box"><div class="txt">${inner}</div></div></body></html>`;
}
// 6 ease-out steps instead of 4 linear ones, each held for exactly one output frame (25fps = 0.04s/frame)
// so every step is actually distinct on screen instead of some being skipped by frame sampling, and the
// eased (fast-then-settle) spacing reads as a smoother float-in than even linear steps would.
const FADE_STEPS=[1,2,3,4,5,6].map(n=>1-(1-n/6)**3);
const FADE_STEP_SECONDS=0.04;
// Renders several PNGs per newly-added word (a fade+float-up sequence) instead of one flat cut, so
// the quote visibly builds up word by word across REVEAL_SECONDS, then holds the full text for
// HOLD_SECONDS. A ffmpeg concat-demuxer list drives the per-frame timing.
async function renderRevealSequence(quote){
  if(!CHROME_PATH) throw new Error('No Chrome/Chromium binary found to render Telugu text');
  fs.rmSync(FRAMES_DIR,{recursive:true,force:true});
  fs.mkdirSync(FRAMES_DIR,{recursive:true});
  const words=stripEmoji(quote).trim().split(/\s+/);
  const perWord=REVEAL_SECONDS/words.length;
  const settleSeconds=Math.max(perWord-(FADE_STEPS.length-1)*FADE_STEP_SECONDS,FADE_STEP_SECONDS);
  const browser=await puppeteer.launch({executablePath:CHROME_PATH,headless:true,args:['--no-sandbox','--disable-gpu']});
  const timeline=[];
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1080,height:1920});
    for(let i=1;i<=words.length;i++){
      const cumulative=words.slice(0,i);
      for(let s=0;s<FADE_STEPS.length;s++){
        const frac=FADE_STEPS[s];
        await page.setContent(overlayHtmlPartial(cumulative,frac),{waitUntil:'load'});
        await page.evaluate(()=>document.fonts.ready);
        const p=path.join(FRAMES_DIR,`f${String(i).padStart(3,'0')}_${s}.png`);
        await page.screenshot({path:p,omitBackground:true});
        const isLastStep=s===FADE_STEPS.length-1;
        const isLastWord=i===words.length;
        const duration=isLastStep?(isLastWord?HOLD_SECONDS:settleSeconds):FADE_STEP_SECONDS;
        timeline.push({path:p,duration});
      }
    }
  }finally{await browser.close();}
  const lines=[];
  for(const f of timeline){lines.push(`file '${f.path}'`);lines.push(`duration ${f.duration.toFixed(3)}`);}
  lines.push(`file '${timeline[timeline.length-1].path}'`); // concat demuxer quirk: last duration only counts if the file repeats once more
  const listFile=path.join(FRAMES_DIR,'list.txt');
  fs.writeFileSync(listFile,lines.join('\n'),'utf8');
  return listFile;
}
async function render(image,quote){
  const out=path.join(WORK_DIR,'output.mp4');
  const overlayList=await renderRevealSequence(quote);
  // zoompan holds d=500 output frames (25fps * 20s); increment reaches the 1.08 cap exactly at the last frame
  // instead of within the first ~3.5s, so the Ken Burns zoom runs smoothly for the whole clip instead of freezing.
  const zoomStep=(0.08/(VIDEO_SECONDS*25)).toFixed(6);
  const fc=`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+${zoomStep},1.08)':d=${VIDEO_SECONDS*25}:s=1080x1920:fps=25[bg];[bg][2:v]overlay=0:0:format=auto[v];[1:a]volume=-18dB[a]`;
  execSync(`ffmpeg -y -loop 1 -i "${image}" -i "${BGM_FILE}" -f concat -safe 0 -i "${overlayList}" -filter_complex "${fc}" -map "[v]" -map "[a]" -t ${VIDEO_SECONDS} -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "${out}"`,{stdio:'inherit'});return out;
}
function buildDescription(hook){
  const hashtags='#TeluguQuotes #JeevithaSatyalu #TeluguMotivation #LifeWisdom #TeluguShorts #MotivationalQuotes #InspirationalQuotes #TeluguStatus #Shorts';
  return `${hook}\n\n✨ ప్రతిరోజూ ఒక కొత్త జీవిత సత్యం కోసం ఈ ఛానల్‌ని ఫాలో అవ్వండి.\nమీకు ఈ మాట నచ్చిందా? కామెంట్ చేసి చెప్పండి 💬\n\n${hashtags}`;
}
async function upload(video,title,hook){
  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET);auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const yt=google.youtube({version:'v3',auth});
  const r=await yt.videos.insert({part:['snippet','status'],requestBody:{snippet:{title:title.slice(0,95),description:buildDescription(hook),tags:['telugu quotes','telugu motivational quotes','life wisdom shorts','telugu shorts','self improvement','జీవిత సత్యాలు','motivational quotes','inspirational quotes','telugu status'],categoryId:'27'},status:{privacyStatus:'private',selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(video)}});
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
  const q=await makeQuote();log(`SCREEN (${countWords(q.screen)} words): ${q.screen}`);log(`HOOK: ${q.hook}`);log(`IMAGE: ${q.image}`);
  const image=await makeImage(q.image);
  const video=await render(image,q.screen);
  const titleWithEmoji=`${pickEmoji(q.mood)} ${q.title}`;
  await upload(video,titleWithEmoji,q.hook);
  saveState(q.title,q.screen,q.image);
  log('Done. Waiting on your manual review/publish.');
}
main().catch(e=>{console.error('FAILED:',e.stack||e);process.exit(1);});
