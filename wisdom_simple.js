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
const FALLBACK_MODEL = 'openai/gpt-oss-20b'; // smaller sibling model, separate Groq rate-limit bucket
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const TITLE_MIN_WORDS = 1;
const TITLE_MAX_WORDS = 6;
const HOOK_MIN_WORDS = 4;
const HOOK_MAX_WORDS = 20;
const CHUNK_WORDS = 3; // words shown on screen together, fast-paced typography style
const CHUNK_HOLD_SECONDS = 1.8; // total time each chunk is on screen (typing + settled hold), 1.5-2s per request
const TYPE_STEP_SECONDS = 0.04; // one output frame (25fps) per typewriter step
const TYPE_BUDGET_SECONDS = 0.9; // max time spent typing a chunk before it settles for the rest of its hold
const TAIL_PAD_SECONDS = 0.6; // extra hold added after the last chunk so the video doesn't cut off abruptly
const TELUGU_RANGE = /[ఀ-౿]/;
const MOOD_EMOJI = [[/determin/i,'💪'],[/resilien/i,'🌊'],[/strength/i,'🔥'],[/hope/i,'🌅'],[/focus/i,'🎯'],[/calm/i,'🍃'],[/growth/i,'🌱'],[/courage|brave/i,'🦁']];
// Small English keyword + emoji pinned at the top of the frame throughout the video, distinct from the
// accumulating Telugu quote below it — same mood text driving pickEmoji(), just a second small map.
const MOOD_TOP_LABEL = [[/trust|betray/i,'MINDSET 🧠'],[/success|hard.?work|effort/i,'LIFE LESSON 💡'],[/time|patience/i,'TRUE WORDS ⏳'],[/silen|matur/i,'SILENT POWER 🤫'],[/money|wealth|relation/i,'REALITY OF LIFE 💯'],[/determin/i,'MINDSET 🧠'],[/resilien|strength/i,'INNER POWER 🔥'],[/hope/i,'NEW BEGINNING 🌅'],[/focus/i,'STAY FOCUSED 🎯'],[/calm/i,'STAY CALM 🍃'],[/growth/i,'KEEP GROWING 🌱'],[/courage|brave/i,'BE BRAVE 🦁']];
function pickTopLabel(mood){const hit=MOOD_TOP_LABEL.find(([re])=>re.test(mood||''));return hit?hit[1]:'LIFE LESSON 💡';}

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

async function sleep(ms){return new Promise(res=>setTimeout(res,ms));}
// The verification pass doubled Groq calls per attempt (generate + verify), which can trip Groq's
// free-tier tokens-per-minute limit mid-run. Retry on HTTP 429 using the wait time Groq reports
// instead of crashing the whole job.
async function groq(prompt,model=PRIMARY_MODEL,attempt=1){
  // The fallback model (openai/gpt-oss-20b) is a reasoning model that burns its whole completion
  // budget on hidden chain-of-thought before ever writing the actual answer — every fallback-model
  // call failed with finish_reason:"length" and empty content at the previous (unset -> ~2048 token)
  // default. A generous explicit cap leaves room for both the reasoning and the real output.
  const r=await get('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({model,temperature:.85,max_tokens:8192,messages:[{role:'user',content:prompt}]})});
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
  // The model wraps the one key/important word per clause in *asterisks* so the renderer knows which
  // word to visually highlight, instead of guessing (the old heuristic just picked the longest word).
  const highlightWords=[...screenRaw.matchAll(/\*([^\s*]+)\*/g)].map(m=>m[1]);
  const screen=screenRaw.replace(/\*/g,'');
  const hook=(raw.match(/HOOK:\s*([\s\S]*?)(?=\nMOOD:|\nIMAGE_PROMPT:|$)/i)?.[1]||'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
  const mood=raw.match(/MOOD:\s*(.+)/i)?.[1]?.trim()||'quiet determination';
  const image=raw.match(/IMAGE_PROMPT:\s*([\s\S]*?)(?=\n$|$)/i)?.[1]?.trim()||'';
  return {title,screen,hook,mood,image,highlightWords};
}
// A single generation call asking the model to "proofread itself" is not reliable enough — it still
// let a real invented word ("ఎర్పు" for "ఓర్పు") and a case-agreement error through. A separate
// verification call, with fresh eyes on already-generated text, catches more than self-editing
// during generation does.
async function verifyTelugu(q,model=PRIMARY_MODEL){
  const vp=`You are a strict native Telugu proofreader reviewing text someone else wrote. Check the three lines below WORD BY WORD. For each: (1) is every single word a real, standard, dictionary Telugu word — not invented, not a typo, not a corrupted spelling that merely looks plausible; (2) is the grammar (verb-noun case agreement, transitive vs intransitive verb usage, natural everyday idiom) completely correct; (3) does every adjective-noun and noun-noun pairing make real semantic sense together, even if every individual word is correctly spelled (e.g. "వేడి మార్గం" is wrong — "వేడి" is physical heat and cannot describe a metaphorical path); (4) does a two-noun compound carry the correct genitive marker (e.g. "విజయం పూలు" is wrong, missing genitive — must be "విజయపు పూలు").
TITLE: ${q.title}
SCREEN: ${q.screen}
HOOK: ${q.hook}
Reply with EXACTLY two lines and nothing else:
CLEAN: yes or no
ISSUES: a short comma-separated list naming any specific wrong/invented word or grammar mistake found, or "none" if CLEAN is yes`;
  const raw=await groq(vp,model);
  const clean=/^CLEAN:\s*yes/im.test(raw);
  const issues=raw.match(/ISSUES:\s*(.+)/i)?.[1]?.trim()||'';
  return {clean,issues};
}
async function makeQuote(){
  const themes=['kashtapadithe vache phalitham','vairalyam nunchi nerchukovadam','atma vishwasam','sahanam mariyu erpu','lakshyam vaipu prayanam','marpu tho vache kotha balam','chinna prayatnam pedda phalitham','gelupu venuka dagi unna kastam','ekkuva nammakam pettukovadam valla vache nastam mariyu nijamaina nammakam ela vundali','kashtala venuka dagi unna nijamaina shakthi parichayam','kalam nerpe pathamlu marevi kavu','nishabdanga shramapadatam, phalitham tanaga matladatam','dabbu mariyu bandhala madhya nijamaina viluva'];
  const theme=themes[state().runCount%themes.length];
  const prompt=`Create ONE completely original motivational life-wisdom quote for a YouTube Short, in the Telugu language. Theme: ${theme}.
TITLE: a short, grammatically complete, correctly spelled 2-4 word Telugu phrase that captures the quote's core idea, written entirely in native Telugu script. Double-check the spelling of every word before answering — for example "లక్ష్యం" (goal) must keep its "్యం" ending, do not drop it; and "ఓర్పు" (patience/endurance) must not be corrupted into the meaningless "ఎర్పు".
SCREEN: exactly 16-36 words, written ENTIRELY in native Telugu script (Unicode Telugu letters). Do NOT use English/Latin letters anywhere in this line, not even for names or filler. No hashtags. Do NOT quote or reference any real person, book, movie, song, scripture, or existing proverb — the thought must be entirely original. Do NOT make factual claims, statistics, or promises about health, money, or results. Natural Telugu, wise, mature, simple and memorable. Do not write a short slogan. Make one flowing thought with 2-3 connected clauses. Punctuate it properly like a real quote — use commas between clauses, a period (or exclamation mark for emotional emphasis) at the end, and an ellipsis "..." after the first clause where it creates a natural dramatic pause (do not overuse ellipsis, at most once). Wrap the single most emotionally/semantically important word of each clause in *asterisks* (e.g. "మార్పు రాకుండా *జీవితం* నిలిచిపోతుంది") so it can be visually highlighted — mark only ONE word per clause (roughly 3-4 marked words total across the whole line), never a whole phrase, never a grammatical filler word (postpositions, connectors), only the word that actually carries the meaning. Wrap the ENTIRE word including any case suffix attached to it — e.g. write "*పట్టుదలతో*" as one fully-wrapped word, never split it as "*పట్టుదల*తో".
HOOK: a short 4-20 word Telugu sentence, entirely in Telugu script, that teases the quote's idea WITHOUT repeating the SCREEN line word-for-word — phrase it as a curiosity-driven question or statement suitable as the opening line of a YouTube description.
Before finalizing, silently proofread TITLE, SCREEN and HOOK as a strict native Telugu editor would: verify every single word is a real, standard dictionary Telugu word (never a plausible-looking but non-existent or corrupted spelling — a word that is valid Telugu Unicode but does not actually exist in the language is still wrong), check subject-verb agreement, correct case markers (never attach an accusative "-ని/-ను" to a noun governed by an intransitive verb like పూయు/వికసించు/పెరుగు), transitive vs intransitive verb usage, and natural everyday idiom (e.g. prefer "ఎప్పుడైనా చూసారా" over the unnatural "ఎప్పుడూ చూసారా" in a question). Also check every adjective-noun and noun-noun pairing for real semantic sense, not just correct spelling — e.g. "వేడి మార్గం" (hot path) is wrong because "వేడి" (physical heat/temperature) cannot naturally describe a metaphorical path; and check that two nouns joined into a compound carry the correct genitive marker — "విజయం పూలు" is wrong (missing genitive), it must be "విజయపు పూలు" or "విజయ పుష్పాలు". Rewrite silently until every line reads completely natural, grammatically flawless Telugu using only real words and sensible word combinations before answering.
MOOD: give 2-4 English mood words only.
IMAGE_PROMPT: write one detailed English prompt for ONE full-screen 9:16 cinematic photograph that exactly matches the quote's emotion (e.g. determination, growth, quiet strength, new beginnings). Include subject, setting, lighting, atmosphere and emotion. No text, no watermark, no collage, no people's faces resembling real public figures.
Return exactly five lines: TITLE: ...\nSCREEN: ...\nHOOK: ...\nMOOD: ...\nIMAGE_PROMPT: ...`;
  const ATTEMPTS=6; // attempts 1-3 use the primary model, 4-6 switch to the fallback model
  for(let i=1;i<=ATTEMPTS;i++){
    const model=i<=3?PRIMARY_MODEL:FALLBACK_MODEL;
    try{
      const q=parse(await groq(prompt+(i>1?'\nPrevious attempt was invalid (it had English letters, a misspelled/incomplete title, an invented/non-dictionary word, a grammar mistake, wrong word count, a quoted/borrowed line, or repeated a quote already used on this channel before). Write a completely new 20-30 word original Telugu thought with a correctly spelled title and a fresh hook line, entirely in Telugu script, not a shorter version, and do not quote anyone.':''),model));
      const basicOk=validQuote(q.screen)&&validTitle(q.title)&&validHook(q.hook)&&q.image&&!isDuplicate(q.title,q.screen,q.image);
      const verify=basicOk?await verifyTelugu(q,model):null;
      const ok=basicOk&&verify.clean;
      log(`Quote attempt ${i} [${model}]: title="${q.title}" (${countWords(q.title)}w), screen=${countWords(q.screen)}w, hook=${countWords(q.hook)}w, valid=${ok}${verify&&!verify.clean?` (verify issues: ${verify.issues})`:''}`);
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
// Groups words into fast-cut chunks instead of one accumulating line. A trailing lone word is folded
// into the previous chunk so no chunk ever shows just a single orphan word.
function splitChunks(words){
  const chunks=[];
  for(let i=0;i<words.length;i+=CHUNK_WORDS) chunks.push(words.slice(i,i+CHUNK_WORDS));
  if(chunks.length>1&&chunks[chunks.length-1].length===1){
    const last=chunks.pop();
    chunks[chunks.length-1]=chunks[chunks.length-1].concat(last);
  }
  return chunks;
}
function normalizeWord(w){return String(w||'').replace(/^[,.;:!?"'…]+|[,.;:!?"'…]+$/g,'');}
// Only highlight a word the model itself marked as semantically important (see the *asterisk*
// instruction in the prompt). No fallback to a "longest word" guess anymore — that heuristic was
// exactly the wrong-word-gets-highlighted problem being fixed here, so a chunk with nothing marked
// in it just shows no highlight at all rather than a plausible-but-wrong one.
// Match is substring-based, not exact-equality: Telugu is agglutinative and the model sometimes
// wraps only the word's root/stem in asterisks with a case suffix glued on right after (e.g.
// "*పట్టుదల*తో" -> marked word "పట్టుదల", but the actual chunk word is "పట్టుదలతో") — an exact-equality
// match would silently fail to highlight that word at all.
function pickHighlightIndex(chunkWords,highlightWords=[]){
  const marked=highlightWords.map(normalizeWord).filter(Boolean);
  return chunkWords.findIndex(w=>{
    const nw=normalizeWord(w);
    return marked.some(m=>nw.includes(m)||m.includes(nw));
  });
}
// Segments by grapheme cluster (not JS string index) so a Telugu conjunct/matra is always revealed as
// one whole unit during the typewriter animation, never split mid-glyph.
const GRAPHEME_SEGMENTER=new Intl.Segmenter('te',{granularity:'grapheme'});
function graphemes(s){return Array.from(GRAPHEME_SEGMENTER.segment(s),seg=>seg.segment);}
// dim=true renders every word in a low-contrast gray regardless of highlight — used for already-typed
// chunks so viewer focus stays on the newest (bright) line instead of the whole accumulated paragraph
// competing for attention equally.
function chunkFrameInner(wordGraphemes,highlightIdx,revealed,dim=false){
  let remaining=revealed;
  const parts=[];
  for(let wi=0;wi<wordGraphemes.length&&remaining>0;wi++){
    const g=wordGraphemes[wi];
    const take=Math.min(remaining,g.length);
    if(take<=0)continue;
    const cls=dim?'done':(wi===highlightIdx?'hi':'w');
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
    .txt{font-family:'TeluguFont',sans-serif;font-size:58px;line-height:1.55;color:#fff;text-align:center;text-shadow:0 0 16px rgba(0,0,0,0.95),0 0 30px rgba(0,0,0,0.85),2px 3px 4px rgba(0,0,0,0.9);width:1000px;-webkit-text-stroke:2px rgba(0,0,0,0.85);}
    .hi{color:#FFD54A;text-shadow:0 0 18px rgba(255,213,74,0.9),0 0 34px rgba(255,213,74,0.6),2px 3px 4px rgba(0,0,0,0.9);}
    .done{color:#8d96a3;text-shadow:1px 2px 3px rgba(0,0,0,0.7);}
    .top{position:absolute;left:0;top:140px;width:1080px;text-align:center;font-family:'TeluguFont',sans-serif;font-size:42px;font-weight:700;letter-spacing:2px;color:#fff;text-shadow:0 0 14px rgba(0,0,0,0.95),2px 3px 4px rgba(0,0,0,0.9);-webkit-text-stroke:1.5px rgba(0,0,0,0.85);}
  </style></head><body>${topHtml}<div class="box"><div class="txt">${inner}</div></div></body></html>`;
}
// Renders each chunk as a typewriter reveal (grapheme by grapheme, frame-aligned) that settles into a
// held frame for the rest of CHUNK_HOLD_SECONDS, then moves on to the next chunk — but unlike the first
// version of this, completed chunks stay on screen (accumulating into the full quote, wrapping across
// lines) instead of being replaced. Total video length is however long the chunk timeline actually
// runs, not a fixed constant.
async function renderChunkSequence(quote,highlightWords=[],topLabel=''){
  if(!CHROME_PATH) throw new Error('No Chrome/Chromium binary found to render Telugu text');
  fs.rmSync(FRAMES_DIR,{recursive:true,force:true});
  fs.mkdirSync(FRAMES_DIR,{recursive:true});
  const chunks=splitChunks(stripEmoji(quote).trim().split(/\s+/));
  const wordGraphemesPerChunk=chunks.map(cw=>cw.map(w=>graphemes(w)));
  const highlightIdxPerChunk=chunks.map(cw=>pickHighlightIndex(cw,highlightWords));
  const browser=await puppeteer.launch({executablePath:CHROME_PATH,headless:true,args:['--no-sandbox','--disable-gpu']});
  const timeline=[];
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1080,height:1920});
    for(let ci=0;ci<chunks.length;ci++){
      const wordGraphemes=wordGraphemesPerChunk[ci];
      const highlightIdx=highlightIdxPerChunk[ci];
      const totalGraphemes=wordGraphemes.reduce((s,g)=>s+g.length,0);
      // every earlier chunk, fully typed and dimmed to gray so viewer focus stays on the newest line
      const priorHtml=wordGraphemesPerChunk.slice(0,ci).map((wg,i)=>chunkFrameInner(wg,highlightIdxPerChunk[i],wg.reduce((s,g)=>s+g.length,0),true)).join(' ');
      const maxSteps=Math.max(1,Math.floor(TYPE_BUDGET_SECONDS/TYPE_STEP_SECONDS));
      const stride=Math.max(1,Math.ceil(totalGraphemes/maxSteps));
      const revealCounts=[];
      for(let r=stride;r<totalGraphemes;r+=stride) revealCounts.push(r);
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
        }else{
          duration=TYPE_STEP_SECONDS;
        }
        timeline.push({path:p,duration});
      }
    }
  }finally{await browser.close();}
  const lines=[];
  for(const f of timeline){lines.push(`file '${f.path}'`);lines.push(`duration ${f.duration.toFixed(3)}`);}
  lines.push(`file '${timeline[timeline.length-1].path}'`); // concat demuxer quirk: last duration only counts if the file repeats once more
  const listFile=path.join(FRAMES_DIR,'list.txt');
  fs.writeFileSync(listFile,lines.join('\n'),'utf8');
  const totalSeconds=timeline.reduce((s,f)=>s+f.duration,0);
  return {listFile,totalSeconds};
}
async function render(image,quote,highlightWords=[],topLabel=''){
  const out=path.join(WORK_DIR,'output.mp4');
  const {listFile,totalSeconds}=await renderChunkSequence(quote,highlightWords,topLabel);
  const frameCount=Math.round(totalSeconds*25);
  // zoompan increment reaches the 1.08 cap exactly on the last frame instead of plateauing early, same
  // fix as before, just recomputed against the now-variable video length.
  const zoomStep=(0.08/frameCount).toFixed(6);
  const fadeOutStart=Math.max(totalSeconds-1,0).toFixed(2);
  // BGM loops (-stream_loop -1) since video length now varies with quote length instead of being fixed
  // at the bundled clip's 20s; volume/fade are applied fresh here against the real duration rather than
  // relying on the fades baked into the source file, which only matched the old fixed-length videos.
  const fc=`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+${zoomStep},1.08)':d=${frameCount}:s=1080x1920:fps=25[bg];[bg][2:v]overlay=0:0:format=auto[v];[1:a]volume=-18dB,afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=1[a]`;
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
