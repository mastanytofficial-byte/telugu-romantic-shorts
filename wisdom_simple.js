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
const PRIMARY_MODEL = 'openai/gpt-oss-120b';
const FALLBACK_MODEL = 'openai/gpt-oss-20b';
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const TITLE_MIN_WORDS = 1;
const TITLE_MAX_WORDS = 6;
const HOOK_MIN_WORDS = 4;
const HOOK_MAX_WORDS = 20;
const CHUNK_WORDS = 3;
const CHUNK_HOLD_SECONDS = 1.8;
const TYPE_STEP_SECONDS = 0.04;
const TYPE_BUDGET_SECONDS = 0.9;
const TAIL_PAD_SECONDS = 0.6;
const TELUGU_RANGE = /[ఀ-౿]/;
const TELUGU_COMMA_RE = /[,،]/g;
const MOOD_EMOJI = [[/determin/i,'💪'],[/resilien/i,'🌊'],[/strength/i,'🔥'],[/hope/i,'🌅'],[/focus/i,'🎯'],[/calm/i,'🍃'],[/growth/i,'🌱'],[/courage|brave/i,'🦁']];
const MOOD_TOP_LABEL = [[/trust|betray/i,'MINDSET 🧠'],[/success|hard.?work|effort/i,'LIFE LESSON 💡'],[/time|patience/i,'TRUE WORDS ⏳'],[/silen|matur/i,'SILENT POWER 🤫'],[/money|wealth|relation/i,'REALITY OF LIFE 💯'],[/determin/i,'MINDSET 🧠'],[/resilien|strength/i,'INNER POWER 🔥'],[/hope/i,'NEW BEGINNING 🌅'],[/focus/i,'STAY FOCUSED 🎯'],[/calm/i,'STAY CALM 🍃'],[/growth/i,'KEEP GROWING 🌱'],[/courage|brave/i,'BE BRAVE 🦁']];
function pickTopLabel(mood){const hit=MOOD_TOP_LABEL.find(([re])=>re.test(mood||''));return hit?hit[1]:'LIFE LESSON 💡';}

const FALLBACKS = [
  { title:'మొదటి అడుగు', screen:'కష్టపడిన ప్రతి క్షణం వృథా కాదు, ఆ కష్టం వెనుక దాగి ఉన్న అనుభవం మనకి కొత్త బలాన్ని ఇస్తుంది, అదే బలం మనల్ని ముందుకు నడిపిస్తుంది.', highlightWords:['బలాన్ని'], hook:'ప్రతి కష్టం మనలో ఏమి పెంచుతుందో ఎప్పుడైనా గమనించారా?', mood:'quiet determination', image:'lone figure taking the first step onto a misty mountain trail at sunrise, soft golden light, quiet determined atmosphere, cinematic photography, vertical composition' },
  { title:'కొత్త పాఠం', screen:'ప్రతి వైఫల్యం వెనుక ఒక కొత్త పాఠం దాగి ఉంటుంది, దాన్ని అర్థం చేసుకున్నప్పుడు మనలోని బలం మరింత పెరుగుతుంది, అదే బలం కొత్త దారిని చూపిస్తుంది.', highlightWords:['పాఠం'], hook:'వైఫల్యం మనకు నిజంగా ఏం నేర్పుతుందో తెలుసా?', mood:'calm resilience', image:'person standing before a cracked open door with warm light spilling through, symbolic of new beginnings after setback, calm hopeful mood, cinematic photography' },
  { title:'లోపల బలం', screen:'మనలోని ఆత్మవిశ్వాసం ప్రతి కష్టమైన రోజును దాటించే అసలైన బలం, అది నిశ్శబ్దంగా మనతో నడుస్తుంది, అవసరమైనప్పుడు ధైర్యంగా ముందుకు తీసుకెళ్తుంది.', highlightWords:['బలం'], hook:'నిజమైన బలం మనలోనే ఉందని ఎప్పుడైనా అనిపించిందా?', mood:'hopeful strength', image:'silhouette of a person standing tall against a stormy sky that is clearing to sunlight, inner strength and hope, cinematic photography, vertical composition' },
  { title:'సహనం ఫలం', screen:'సహనంతో ఎదురుచూసిన ప్రతి క్షణం వృథా కాదు, కాలం గడిచేకొద్దీ మన ప్రయత్నం బలపడుతుంది, సరైన సమయంలో దానికి తగిన ఫలితం కనిపిస్తుంది.', highlightWords:['ఫలితం'], hook:'సహనం ఎప్పుడూ ఎందుకు విలువైనదో తెలుసా?', mood:'warm encouragement', image:'a single sapling growing through cracked rock in warm afternoon light, patience and quiet reward, cinematic photography, vertical composition' },
  { title:'గమ్యం వైపు', screen:'లక్ష్యం వైపు వేసే ప్రతి చిన్న అడుగు కూడా విలువైనదే, ఆ అడుగులు కలిసినప్పుడు దూరమైన గమ్యం దగ్గరవుతుంది, నమ్మకంతో ముందుకు సాగాలి.', highlightWords:['గమ్యం'], hook:'చిన్న అడుగులు ఎంత దూరం తీసుకెళ్తాయో ఎప్పుడైనా ఆలోచించారా?', mood:'steady focus', image:'person walking a long winding path toward a distant sunrise on the horizon, focused determined journey, cinematic photography, vertical composition' },
  { title:'నిశ్శబ్ద శ్రమ', screen:'నిశ్శబ్దంగా చేసే శ్రమకు వెంటనే గుర్తింపు రావకపోవచ్చు, కానీ ప్రతి రోజు చేసిన ప్రయత్నం లోపల బలాన్ని పెంచుతుంది, ఒక రోజు ఫలితం తానే మాట్లాడుతుంది.', highlightWords:['శ్రమ'], hook:'ఎవరూ చూడని శ్రమకు నిజమైన విలువ ఉంటుందా?', mood:'quiet determination', image:'solitary person working alone before dawn in a simple workshop, soft window light, calm focused atmosphere, cinematic vertical photography' },
  { title:'మార్పు బలం', screen:'మార్పు మొదట భయంగా అనిపించవచ్చు, కానీ దాన్ని స్వీకరించినప్పుడు మనలో కొత్త బలం మేల్కొంటుంది, అదే బలం ముందున్న దారిని సులభం చేస్తుంది.', highlightWords:['బలం'], hook:'మార్పు మనలో దాచిన ఏ బలాన్ని బయటకు తెస్తుందో తెలుసా?', mood:'new beginning', image:'person stepping from a shadowed doorway into warm morning light, symbolic transition and inner strength, cinematic vertical photography' },
  { title:'నమ్మకం విలువ', screen:'నిన్ను నువ్వు నమ్మడం అంటే ప్రతి సమస్య సులభమవుతుందని కాదు, కానీ ప్రతి సమస్యను ఎదుర్కొనే ధైర్యం నీలో పెరుగుతుందని అర్థం.', highlightWords:['నమ్మడం'], hook:'మనల్ని మనం నమ్మడం ఎందుకు అంత ముఖ్యమో తెలుసా?', mood:'inner strength', image:'confident solitary figure overlooking a vast valley at sunrise, subtle warm light, reflective hopeful mood, cinematic vertical photography' },
  { title:'కాలం పాఠం', screen:'కాలం మనకు కొన్ని సమాధానాలు మాటలతో ఇవ్వదు, అనుభవాల ద్వారా చూపిస్తుంది, అర్థం చేసుకున్న కొద్దీ జీవితం మీద మన దృష్టి మరింత స్పష్టమవుతుంది.', highlightWords:['అనుభవాల'], hook:'కాలం మాటలు లేకుండా నేర్పే పాఠాలు ఏమిటో గమనించారా?', mood:'quiet wisdom', image:'old path through trees with morning mist and soft sunlight, contemplative atmosphere, symbolic of time and learning, cinematic vertical photography' },
  { title:'కష్టంలో అవకాశం', screen:'కష్టం వచ్చినప్పుడు దారి మూసుకుపోయిందని అనిపించవచ్చు, కానీ అదే పరిస్థితి మనలో దాగి ఉన్న సామర్థ్యాన్ని బయటకు తెచ్చే అవకాశంగా మారుతుంది.', highlightWords:['సామర్థ్యాన్ని'], hook:'కష్టమే మనలో దాగిన ఏ శక్తిని బయటకు తెస్తుందో తెలుసా?', mood:'resilient strength', image:'person standing before a steep mountain trail after rain, sunlight breaking through clouds, determined hopeful cinematic vertical scene' }
];

function log(x){ console.log(`[${new Date().toISOString()}] ${x}`); }
async function get(url, options={}, timeout=30000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(t);}
}
function countWords(s){return String(s||'').trim().split(/\s+/).filter(Boolean).length;}
function latinLeakage(s){return (String(s||'').match(/[A-Za-z]{2,}/g)||[]);}
function normalizeTeluguText(s){
  return String(s||'')
    .replace(/["“”'‘’]/g,'')
    .replace(/\*/g,'')
    .replace(/\u00a0/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function hasBrokenMarkers(s){return /(^|\s)[,.;:!?…]+($|\s)/.test(String(s||''));}
function hasRunOnPunctuation(s){return /[,،]\s*[,،]|\.\s*\.|!\s*!|\?\s*\?/.test(String(s||''));}
function endsCleanly(s){return /[.!?…]$/.test(String(s||'').trim());}
function validQuote(s){
  const n=countWords(s), leaked=latinLeakage(s), t=normalizeTeluguText(s);
  return n>=MIN_WORDS&&n<=MAX_WORDS&&leaked.length===0&&!/#/.test(s)&&TELUGU_RANGE.test(s)&&!hasBrokenMarkers(t)&&!hasRunOnPunctuation(t)&&endsCleanly(t);
}
function validTitle(t){
  const n=countWords(t), leaked=latinLeakage(t), clean=normalizeTeluguText(t);
  return n>=TITLE_MIN_WORDS&&n<=TITLE_MAX_WORDS&&leaked.length===0&&!/#/.test(t)&&TELUGU_RANGE.test(t)&&clean.length<=60&&!/[.!?]$/.test(clean);
}
function validHook(h){
  const n=countWords(h), leaked=latinLeakage(h), clean=normalizeTeluguText(h);
  return n>=HOOK_MIN_WORDS&&n<=HOOK_MAX_WORDS&&leaked.length===0&&!/#/.test(h)&&TELUGU_RANGE.test(h)&&!hasBrokenMarkers(clean)&&!hasRunOnPunctuation(clean)&&(/[!?]$/.test(clean));
}
function pickEmoji(mood){const hit=MOOD_EMOJI.find(([re])=>re.test(mood||''));return hit?hit[1]:'✨';}
function state(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return {runCount:0,used:[]};}}
function isDuplicate(title,screen,image){
  const used=state().used||[];
  return used.some(r=>r.title===title.trim()||r.screen===screen.trim()||(image&&r.image===image.trim()));
}
function saveState(title,screen,image){
  const s=state();
  const used=[...(s.used||[]),{title:title.trim(),screen:screen.trim(),image:(image||'').trim()}];
  fs.writeFileSync(STATE_FILE,JSON.stringify({runCount:(s.runCount||0)+1,lastTitle:title,lastDate:new Date().toISOString(),used},null,2));
}
async function sleep(ms){return new Promise(res=>setTimeout(res,ms));}
async function groq(prompt,model=PRIMARY_MODEL,attempt=1){
  const maxTokens=model===FALLBACK_MODEL?6000:1536;
  const r=await get('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model,temperature:.85,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
  const d=await r.json();
  if(r.status===429&&attempt<=3){
    const waitSeconds=Number(d?.error?.message?.match(/try again in ([\d.]+)s/)?.[1])||15;
    log(`Groq rate-limited on ${model} (attempt ${attempt}); waiting ${waitSeconds}s before retry`);
    await sleep(Math.ceil(waitSeconds*1000)+1000);
    return groq(prompt,model,attempt+1);
  }
  if(!d.choices?.[0]?.message?.content) throw new Error(`Groq returned no content: HTTP ${r.status} model=${model} ${JSON.stringify(d)}`);
  return d.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
}
function parse(raw){
  const title=raw.match(/TITLE:\s*(.+)/i)?.[1]?.trim()||'తెలుగు జీవిత సత్యం';
  const screenRaw=(raw.match(/SCREEN:\s*([\s\S]*?)(?=\nHOOK:|\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const highlightWords=[...screenRaw.matchAll(/\*([^\s*]+)\*/g)].map(m=>m[1]);
  const screen=screenRaw.replace(/\*/g,'');
  const hook=(raw.match(/HOOK:\s*([\s\S]*?)(?=\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const mood=raw.match(/MOOD:\s*(.+)/i)?.[1]?.trim()||'quiet determination';
  const image=raw.match(/IMAGE_PROMPT:\s*([\s\S]*?)(?=\n$|$)/i)?.[1]?.trim()||'';
  return {title,screen,hook,mood,image,highlightWords};
}
async function verifyTelugu(q,model=PRIMARY_MODEL){
  const vp=`You are a strict native Telugu proofreader reviewing text someone else wrote. Check the three lines below WORD BY WORD. For each: (1) is every single word a real, standard Telugu word, not invented, misspelled or corrupted; (2) is the grammar completely natural; (3) do adjective-noun and noun-noun pairings make semantic sense; (4) are case markers and verb forms correct; (5) does the wording sound like natural modern Telugu rather than translated Telugu; (6) is the thought original and not a quotation, proverb or cliche. Be especially strict about words that look plausible but do not actually exist.
TITLE: ${q.title}
SCREEN: ${q.screen}
HOOK: ${q.hook}
Reply with EXACTLY two lines and nothing else:
CLEAN: yes or no
ISSUES: a short comma-separated list naming specific spelling, grammar, semantic or naturalness problems, or "none" if CLEAN is yes`;
  const raw=await groq(vp,model);
  const clean=/^CLEAN:\s*yes/im.test(raw)&&!/^CLEAN:\s*yes/im.test(raw.replace(/^CLEAN:\s*yes/im,''));
  const issues=raw.match(/ISSUES:\s*(.+)/i)?.[1]?.trim()||'';
  return {clean,issues};
}
function localTeluguSanity(q){
  const combined=`${q.title} ${q.screen} ${q.hook}`;
  const suspicious=['ఎర్పు','పుష్పం పూలు','విజయం పూలు','వేడి మార్గం','సులభంగా మారుతుంది'];
  const hits=suspicious.filter(x=>combined.includes(x));
  return hits.length?{ok:false,issues:`Suspicious Telugu phrasing: ${hits.join(', ')}`}:{ok:true,issues:''};
}
async function makeQuote(){
  const themes=['కష్టపడితే వచ్చే ఫలితం','వైఫల్యం నుంచి నేర్చుకోవడం','ఆత్మవిశ్వాసం','సహనం మరియు ఓర్పు','లక్ష్యం వైపు ప్రయాణం','మార్పుతో వచ్చే కొత్త బలం','చిన్న ప్రయత్నం పెద్ద ఫలితం','గెలుపు వెనుక దాగి ఉన్న కష్టం','ఎక్కువ నమ్మకం పెట్టుకోవడం వల్ల వచ్చే నష్టం మరియు నిజమైన నమ్మకం ఎలా ఉండాలి','కష్టాల వెనుక దాగి ఉన్న నిజమైన శక్తి','కాలం నేర్పే పాఠాలు','నిశ్శబ్దంగా శ్రమపడటం, ఫలితం తనంతట తానే మాట్లాడటం','డబ్బు మరియు బంధాల మధ్య నిజమైన విలువ'];
  const theme=themes[state().runCount%themes.length];
  const prompt=`Create ONE completely original motivational life-wisdom quote for a YouTube Short, in native Telugu. Theme: ${theme}.
TITLE: 2-4 word Telugu phrase, grammatically complete, standard spelling, entirely Telugu script.
SCREEN: exactly 16-36 words, entirely native Telugu script, natural modern Telugu, wise, mature, simple and memorable. Do not write a slogan. Use 2-3 connected clauses and proper punctuation. End with a period, exclamation or ellipsis. Do not use English letters, hashtags, names of real people, existing proverbs, quotations, song/movie lines, scriptures, factual claims, statistics, health claims, money promises or guarantees. Wrap ONE semantically important full word from each clause in *asterisks*.
HOOK: 4-20 words, entirely Telugu script, curiosity-driven, ending with ? or !, and not copied from SCREEN.
MOOD: 2-4 English mood words only.
IMAGE_PROMPT: one detailed English prompt for one cinematic 9:16 photograph matching the quote, with no text, watermark, collage or recognizable public figure.
Before answering, silently proofread every Telugu word for real dictionary usage, spelling, case markers, verb agreement, semantic pairings, natural idiom, originality and punctuation. If a phrase sounds translated from English, rewrite it into natural Telugu.
Return exactly five lines: TITLE: ...\nSCREEN: ...\nHOOK: ...\nMOOD: ...\nIMAGE_PROMPT: ...`;
  const ATTEMPTS=6;
  for(let i=1;i<=ATTEMPTS;i++){
    const model=i<=3?PRIMARY_MODEL:FALLBACK_MODEL;
    try{
      const q=parse(await groq(prompt+(i>1?'\nPrevious attempt failed validation. Write a completely new thought and hook; do not reuse any phrase or wording from the previous attempt. Keep the Telugu natural and error-free.':''),model));
      const basicOk=validQuote(q.screen)&&validTitle(q.title)&&validHook(q.hook)&&q.image&&!isDuplicate(q.title,q.screen,q.image);
      const local=basicOk?localTeluguSanity(q):{ok:false,issues:'basic validation failed'};
      const verify=basicOk&&local.ok?await verifyTelugu(q,model):null;
      const ok=basicOk&&local.ok&&verify?.clean;
      log(`Quote attempt ${i} [${model}]: title="${q.title}" (${countWords(q.title)}w), screen=${countWords(q.screen)}w, hook=${countWords(q.hook)}w, valid=${ok}${!local.ok?` (local: ${local.issues})`:''}${verify&&!verify.clean?` (verify: ${verify.issues})`:''}`);
      if(ok) return q;
    }catch(e){
      log(`Quote attempt ${i} [${model}] errored, moving on: ${e.message}`);
    }
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
function splitChunks(words){
  const chunks=[];
  for(let i=0;i<words.length;i+=CHUNK_WORDS) chunks.push(words.slice(i,i+CHUNK_WORDS));
  if(chunks.length>1&&chunks[chunks.length-1].length===1){
    const last=chunks.pop();chunks[chunks.length-1]=chunks[chunks.length-1].concat(last);
  }
  return chunks;
}
function normalizeWord(w){return String(w||'').replace(/^[,.;:!?"'…]+|[,.;:!?"'…]+$/g,'');}
function pickHighlightIndex(chunkWords,highlightWords=[]){
  const marked=highlightWords.map(normalizeWord).filter(Boolean);
  return chunkWords.findIndex(w=>{const nw=normalizeWord(w);return marked.some(m=>nw.includes(m)||m.includes(nw));});
}
const GRAPHEME_SEGMENTER=new Intl.Segmenter('te',{granularity:'grapheme'});
function graphemes(s){return Array.from(GRAPHEME_SEGMENTER.segment(s),seg=>seg.segment);}
function chunkFrameInner(wordGraphemes,highlightIdx,revealed){
  let remaining=revealed;
  const parts=[];
  for(let wi=0;wi<wordGraphemes.length&&remaining>0;wi++){
    const g=wordGraphemes[wi];
    const take=Math.min(remaining,g.length);
    if(take<=0)continue;
    const cls=wi===highlightIdx?'hi':'w';
    parts.push(`<span class="${cls}">${escapeHtml(g.slice(0,take).join(''))}</span>`);
    remaining-=take;
  }
  return parts.join(' ');
}
function chunkHtmlPage(inner,topLabel){
  const topHtml=topLabel?`<div class="top">${escapeHtml(topLabel)}</div>`:'';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'TeluguFont';src:url('file://${TELUGU_FONT}');}
    html,body{margin:0;padding:0;width:1080px;height:1920px;background:transparent;}
    .box{position:absolute;left:40px;top:560px;width:1000px;height:800px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 40px;}
    .txt{font-family:'TeluguFont',sans-serif;font-size:58px;font-weight:700;line-height:1.55;color:#fff;text-align:center;text-shadow:0 0 16px rgba(0,0,0,.55);-webkit-text-stroke:.8px #000;}
    .w,.hi{display:inline;}
    .hi{color:#ffd84d;}
    .top{position:absolute;top:190px;left:60px;width:960px;text-align:center;font-family:Arial,sans-serif;font-weight:700;font-size:42px;letter-spacing:1px;color:#fff;text-shadow:0 0 12px rgba(0,0,0,.55);-webkit-text-stroke:.8px #000;}
  </style></head><body><div class="top">${topHtml.replace(/^<div class="top">|<\/div>$/g,'')}</div><div class="box"><div class="txt">${inner}</div></div></body></html>`;
}
async function renderChunkSequence(quote,highlightWords,topLabel){
  fs.mkdirSync(FRAMES_DIR,{recursive:true});
  const words=quote.trim().split(/\s+/);
  const chunks=splitChunks(words);
  const timeline=[];
  const browser=await puppeteer.launch({headless:'new',executablePath:CHROME_PATH,args:['--no-sandbox','--disable-setuid-sandbox']});
  const page=await browser.newPage();await page.setViewport({width:1080,height:1920,deviceScaleFactor:1});
  try{
    let priorHtml='';
    for(let ci=0;ci<chunks.length;ci++){
      const cw=chunks[ci];
      const highlightIdx=pickHighlightIndex(cw,highlightWords);
      const wordGraphemes=cw.map(graphemes);
      const totalGraphemes=wordGraphemes.reduce((n,g)=>n+g.length,0);
      const stepCount=Math.min(Math.ceil(TYPE_BUDGET_SECONDS/TYPE_STEP_SECONDS),totalGraphemes);
      const revealCounts=[];
      for(let s=1;s<=stepCount;s++) revealCounts.push(Math.min(totalGraphemes,Math.ceil(totalGraphemes*s/stepCount)));
      revealCounts.push(totalGraphemes);
      const isLastChunk=ci===chunks.length-1;
      for(let si=0;si<revealCounts.length;si++){
        const currentHtml=chunkFrameInner(wordGraphemes,highlightIdx,revealCounts[si]);
        const inner=priorHtml?`${priorHtml} ${currentHtml}`:currentHtml;
        await page.setContent(chunkHtmlPage(inner,topLabel),{waitUntil:'load'});
        await page.evaluate(()=>document.fonts.ready);
        const p=path.join(FRAMES_DIR,`c${String(ci).padStart(3,'0')}_${si}.png`);
        await page.screenshot({path:p,omitBackground:true});
        const isLastStep=si===revealCounts.length-1;
        let duration;
        if(isLastStep){
          const typedSeconds=(revealCounts.length-1)*TYPE_STEP_SECONDS;
          duration=Math.max(CHUNK_HOLD_SECONDS-typedSeconds,TYPE_STEP_SECONDS)+(isLastChunk?TAIL_PAD_SECONDS:0);
        }else duration=TYPE_STEP_SECONDS;
        timeline.push({path:p,duration});
      }
      priorHtml=currentHtml=chunkFrameInner(wordGraphemes,highlightIdx,totalGraphemes);
    }
  }finally{await browser.close();}
  const lines=[];for(const f of timeline){lines.push(`file '${f.path}'`);lines.push(`duration ${f.duration.toFixed(3)}`);}lines.push(`file '${timeline[timeline.length-1].path}'`);
  const listFile=path.join(FRAMES_DIR,'list.txt');fs.writeFileSync(listFile,lines.join('\n'),'utf8');
  const totalSeconds=timeline.reduce((s,f)=>s+f.duration,0);return {listFile,totalSeconds};
}
async function render(image,quote,highlightWords=[],topLabel=''){
  const out=path.join(WORK_DIR,'output.mp4');
  const {listFile,totalSeconds}=await renderChunkSequence(quote,highlightWords,topLabel);
  const frameCount=Math.round(totalSeconds*25);const zoomStep=(0.08/frameCount).toFixed(6);
  const fc=`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+${zoomStep},1.08)':d=${frameCount}:s=1080x1920:fps=25[bg];[bg][2:v]overlay=0:0:format=auto[v];[1:a]volume=-18dB,afade=t=in:st=0:d=0.5[a]`;
  execSync(`ffmpeg -y -loop 1 -i "${image}" -stream_loop -1 -i "${BGM_FILE}" -f concat -safe 0 -i "${listFile}" -filter_complex "${fc}" -map "[v]" -map "[a]" -t ${totalSeconds.toFixed(2)} -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "${out}"`,{stdio:'inherit'});
  return out;
}
function buildDescription(hook){
  const hashtags='#TeluguQuotes #JeevithaSatyalu #TeluguMotivation #LifeWisdom #TeluguShorts #MotivationalQuotes #InspirationalQuotes #TeluguStatus #Shorts';
  return `${hook}\n\n✨ ప్రతిరోజూ ఒక కొత్త జీవిత సత్యం కోసం ఈ ఛానల్‌ని ఫాలో అవ్వండి.\nమీకు ఈ మాట నచ్చిందా? కామెంట్ చేసి చెప్పండి 💬\n\n${hashtags}`;
}
async function upload(video,title,hook){
  const auth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET);auth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const yt=google.youtube({version:'v3',auth});
  const r=await yt.videos.insert({part:['snippet','status'],requestBody:{snippet:{title:title.slice(0,95),description:buildDescription(hook),tags:['telugu quotes','telugu motivational quotes','life wisdom shorts','telugu shorts','self improvement','జీవిత సత్యాలు','motivational quotes','inspirational quotes','telugu status'],categoryId:'27'},status:{privacyStatus:'private',selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(video)}});
  const url=`https://www.youtube.com/watch?v=${r.data.id}`;const studioUrl=`https://studio.youtube.com/video/${r.data.id}/edit`;
  log(`Uploaded as PRIVATE (pending your review): ${url}`);
  const review=`## Review required before publishing\n\n- Title: ${title}\n- Watch (private): ${url}\n- Edit in Studio: ${studioUrl}\n\nCheck the Telugu text, image and audio, then set visibility to Public yourself in YouTube Studio to publish.`;
  fs.mkdirSync(WORK_DIR,{recursive:true});fs.writeFileSync(REVIEW_FILE,review,'utf8');
}
async function main(){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  for(const [n,v] of Object.entries({GROQ_API_KEY,YT_CLIENT_ID,YT_CLIENT_SECRET,YT_REFRESH_TOKEN}))if(!v)throw new Error(`${n} is missing`);
  if(!fs.existsSync(BGM_FILE))throw new Error(`Bundled BGM file missing: ${BGM_FILE}`);
  log('Run: quote (Telugu script) + ONE full-screen matching image + fixed channel BGM. NO VOICE. Uploads PRIVATE for review.');
  const q=await makeQuote();log(`SCREEN (${countWords(q.screen)} words): ${q.screen}`);log(`HOOK: ${q.hook}`);log(`IMAGE: ${q.image}`);log(`HIGHLIGHT WORDS: ${(q.highlightWords||[]).join(', ')||'(none marked)'}`);
  const topLabel=pickTopLabel(q.mood);log(`TOP LABEL: ${topLabel}`);
  const image=await makeImage(q.image);
  const video=await render(image,q.screen,q.highlightWords,topLabel);
  const titleWithEmoji=`${pickEmoji(q.mood)} ${q.title}`;
  await upload(video,titleWithEmoji,q.hook);
  saveState(q.title,q.screen,q.image);
  log('Done. Waiting on your manual review/publish.');
}
main().catch(e=>{console.error('FAILED:',e.stack||e);process.exit(1);});
