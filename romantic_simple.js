const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const WORK_DIR = path.join(__dirname, 'work');
const STATE_FILE = path.join(__dirname, 'last-article.json');
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const SHORT_DURATION = 12;

const THEMES = [
  'evariki cheppaleni prema', 'dooramaina vyakti gurthulu', 'oka mounamaina anubandham',
  'varshamlo gurthocche vyakti', 'kalisi gadipina chinna kshanam',
  'veedipoyina taruvatha migilina gurthulu', 'eduruchupu', 'manasulo dachukunna maata',
  'modati parichayam gurthu', 'malli kalavalani korika',
  'nishabdanga perigina anubandham', 'oka vyakti jeevithanni marchina vidhanam'
];

const FORBIDDEN = new Set([
  'a','an','and','are','best','beautiful','because','be','but','deep','distance','feeling','feelings',
  'first','forever','happy','heart','heartbeat','life','line','love','memories','memory','miss','missing',
  'my','relationship','sad','special','story','true','waiting','you','your','is','was','were','the','to',
  'of','in','on','for','with','from','this','that','me','mine','someone','one','side','long','old','night',
  'rain','sorry','firstlove','lifeline','romantic','quote'
]);

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { runCount: 0, usedTitles: [] };
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { runCount: Number(s.runCount || 0), usedTitles: s.usedTitles || [] };
  } catch (_) { return { runCount: 0, usedTitles: [] }; }
}
function saveState(title) {
  const s = loadState();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ runCount: s.runCount + 1, usedTitles: [...s.usedTitles, title].slice(-50), lastDate: new Date().toISOString() }, null, 2));
}
function countWords(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }
function forbiddenWords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  return [...new Set(words.filter(w => FORBIDDEN.has(w)))];
}
function clean(text) { return String(text || '').replace(/^\s*[A-Z_]+\s*:\s*/i, '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim(); }

async function callGroq(prompt) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature: 0.9, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('Groq returned no content: ' + JSON.stringify(data));
  return data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function parse(raw) {
  const get = key => raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'im'))?.[1]?.trim() || '';
  return {
    title: get('TITLE'),
    screen: clean(get('SCREEN')),
    imagePrompt: get('IMAGE_PROMPT'),
    bgmMood: get('BGM_MOOD'),
    bgmTempo: get('BGM_TEMPO'),
    bgmInstrument: get('BGM_INSTRUMENT')
  };
}

async function generateQuote(runCount, usedTitles) {
  const theme = THEMES[runCount % THEMES.length];
  const avoid = usedTitles.slice(-8).join(' | ');
  const prompt = `Create ONE completely original romantic Telugu thought for a 12-second YouTube Short.\nTHEME: ${theme}\n\nSCREEN: 16 to 36 words exactly. Natural Telugu vocabulary written only in English letters (Tenglish). Emotional, poetic, mature and deeply relatable. No English vocabulary, no hashtags, no CTA, no movie/song lyrics, no famous quote. Avoid these English words especially: love, heart, life, feeling, memory, miss, beautiful, special, forever, waiting, relationship, romantic, quote.\n\nIMAGE_PROMPT: Write a detailed English prompt for ONE full-screen 9:16 cinematic photographic image that visually expresses the exact emotion and situation of the SCREEN. The image must feel intimate, realistic and emotionally specific, not generic. No text, no letters, no watermark, no collage, no split screen.\n\nBGM_MOOD: Choose one precise mood such as tender longing, quiet heartbreak, warm nostalgia, hopeful reunion, peaceful affection, bittersweet remembrance.\nBGM_TEMPO: slow, medium-slow, or gentle-medium.\nBGM_INSTRUMENT: choose a minimal instrumental palette such as soft piano, piano and ambient pad, acoustic guitar and pad, felt piano and strings, or flute and piano.\n\nReturn exactly six lines:\nTITLE: short Tenglish title\nSCREEN: Tenglish quote\nIMAGE_PROMPT: English cinematic image prompt\nBGM_MOOD: precise mood\nBGM_TEMPO: tempo\nBGM_INSTRUMENT: instrumental palette\n\nPreviously used titles to avoid: ${avoid}`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const q = parse(await callGroq(prompt + `\nAttempt ${attempt}: generate a completely NEW thought.`));
    const n = countWords(q.screen);
    const bad = forbiddenWords(q.screen);
    if (n >= MIN_WORDS && n <= MAX_WORDS && !bad.length && q.imagePrompt && q.bgmMood && q.bgmTempo && q.bgmInstrument) {
      log(`Quote valid: ${n} words | mood=${q.bgmMood} | tempo=${q.bgmTempo} | instrument=${q.bgmInstrument}`);
      return q;
    }
    log(`Quote rejected: ${n} words; forbidden=${bad.join(', ')}`);
  }
  throw new Error('Could not generate a valid romantic quote.');
}

async function generateFullScreenImage(imagePrompt) {
  const enhanced = `${imagePrompt}, cinematic romantic photography, emotionally accurate, realistic human emotion, natural skin and lighting, shallow depth of field, subtle film grain, vertical 9:16 composition, subject positioned safely away from center text area, no text, no typography, no watermark, no logo`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=1080&height=1920&nologo=true`;
  const res = await fetchWithTimeout(url, {}, 60000);
  if (!res.ok) throw new Error(`AI image generation failed HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10000) throw new Error('Generated image is too small');
  const out = path.join(WORK_DIR, 'background.jpg');
  fs.writeFileSync(out, buf);
  log('Generated one full-screen emotion-matched AI image.');
  return out;
}

function writeWav(filePath, samples, sampleRate = 44100, channels = 2) {
  const dataSize = samples.length * 2;
  const b = Buffer.alloc(44 + dataSize);
  b.write('RIFF',0); b.writeUInt32LE(36+dataSize,4); b.write('WAVE',8); b.write('fmt ',12); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(channels,22); b.writeUInt32LE(sampleRate,24); b.writeUInt32LE(sampleRate*channels*2,28);
  b.writeUInt16LE(channels*2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(dataSize,40);
  for (let i=0;i<samples.length;i++) b.writeInt16LE(Math.max(-32768,Math.min(32767,samples[i])),44+i*2);
  fs.writeFileSync(filePath,b);
}

function moodSettings(mood) {
  const m = mood.toLowerCase();
  if (m.includes('heartbreak') || m.includes('sad') || m.includes('longing')) return { root:220, chords:[[220,261.63,329.63],[196,246.94,293.66],[174.61,220,261.63],[196,246.94,293.66]], melody:[329.63,293.66,261.63,246.94], pulse:0.28 };
  if (m.includes('nostalgia') || m.includes('remembrance') || m.includes('bittersweet')) return { root:196, chords:[[196,246.94,293.66],[174.61,220,261.63],[220,261.63,329.63],[196,246.94,293.66]], melody:[293.66,329.63,261.63,246.94], pulse:0.32 };
  if (m.includes('hope') || m.includes('reunion')) return { root:261.63, chords:[[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]], melody:[392,329.63,440,392], pulse:0.42 };
  return { root:261.63, chords:[[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]], melody:[392,329.63,261.63,329.63], pulse:0.35 };
}

function generateEmotionMatchedBGM(duration, mood, tempo, instrument, filePath) {
  const sr = 44100, total = Math.ceil(duration*sr), samples = new Int16Array(total*2), s = moodSettings(mood);
  const beat = tempo.toLowerCase().includes('slow') ? 2.4 : tempo.toLowerCase().includes('medium') ? 1.7 : 2.0;
  const chordLen = beat * 2;
  const pianoLike = instrument.toLowerCase().includes('piano');
  for (let i=0;i<total;i++) {
    const t=i/sr, chord=s.chords[Math.floor(t/chordLen)%s.chords.length], local=t%chordLen;
    const fade=Math.min(1,t/1.2,(duration-t)/1.0); let v=0;
    for (let n=0;n<chord.length;n++) {
      const f=chord[n], env=Math.exp(-2.8*local/chordLen), amp=(pianoLike?0.012:0.009);
      v += Math.sin(2*Math.PI*f*t)*amp*env;
      v += Math.sin(2*Math.PI*f*2*t)*(amp*0.18)*env;
    }
    const mi=Math.floor(t/beat)%s.melody.length, mf=s.melody[mi];
    const melLocal=t%beat, melEnv=Math.exp(-3.2*melLocal/beat);
    v += Math.sin(2*Math.PI*mf*t)*0.008*melEnv;
    v += Math.sin(2*Math.PI*s.root*t)*0.003;
    v += Math.sin(2*Math.PI*0.5*t)*s.pulse*0.002;
    v*=Math.max(0,Math.min(1,fade));
    const x=Math.round(v*32767); samples[i*2]=x; samples[i*2+1]=x;
  }
  writeWav(filePath,samples,sr,2); return filePath;
}

function wrapQuote(text, maxChars=30) {
  const words=text.split(/\s+/).filter(Boolean), lines=[]; let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(line&&next.length>maxChars){lines.push(line);line=word;}else line=next;}
  if(line)lines.push(line); return lines.join('\\n');
}

function buildVideo(imagePath, bgmPath, screenText) {
  const out=path.join(WORK_DIR,'output.mp4');
  const font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const textFile=path.join(WORK_DIR,'quote.txt'); fs.writeFileSync(textFile,wrapQuote(screenText),'utf8');
  const vf=[
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    `zoompan=z='min(zoom+0.0008,1.06)':d=${SHORT_DURATION*25}:s=1080x1920:fps=25`,
    'eq=contrast=1.03:saturation=1.05',
    'vignette=PI/7',
    `drawbox=x=55:y=620:w=iw-110:h=680:color=black@0.24:t=fill`,
    `drawtext=fontfile='${font}':textfile='${textFile}':fontcolor=white:fontsize=42:line_spacing=16:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.95:shadowx=2:shadowy=3`,
    `drawtext=fontfile='${font}':text='TELUGU ECHO':fontcolor=white@0.60:fontsize=20:x=(w-text_w)/2:y=h-70`,
    'fade=t=in:st=0:d=0.6',
    `fade=t=out:st=${SHORT_DURATION-0.7}:d=0.7`
  ].join(',');
  const cmd=`ffmpeg -y -loop 1 -i "${imagePath}" -i "${bgmPath}" -filter_complex "[1:a]volume=0.42,afade=t=in:st=0:d=1,afade=t=out:st=${SHORT_DURATION-1}:d=1[a]" -map 0:v -map "[a]" -vf "${vf}" -t ${SHORT_DURATION} -r 25 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "${out}"`;
  execSync(cmd,{stdio:'inherit'}); return out;
}

function sanitize(text,max){return String(text||'').replace(/[\x00-\x1F\x7F-\x9F]/g,'').slice(0,max).trim();}
async function upload(videoPath,title,description){
  const oauth=new google.auth.OAuth2(YT_CLIENT_ID,YT_CLIENT_SECRET); oauth.setCredentials({refresh_token:YT_REFRESH_TOKEN});
  const youtube=google.youtube({version:'v3',auth:oauth});
  const res=await youtube.videos.insert({part:['snippet','status'],requestBody:{snippet:{title:sanitize(title,95),description:sanitize(description,4900),tags:['telugu quotes','telugu romantic quotes','tenglish quotes','telugu shorts'],categoryId:'22'},status:{privacyStatus:'public',selfDeclaredMadeForKids:false}},media:{body:fs.createReadStream(videoPath)}});
  log(`Uploaded: https://www.youtube.com/watch?v=${res.data.id}`);
}

async function main(){
  fs.mkdirSync(WORK_DIR,{recursive:true});
  for(const [name,value] of Object.entries({GROQ_API_KEY,PEXELS_API_KEY,YT_CLIENT_ID,YT_CLIENT_SECRET,YT_REFRESH_TOKEN})) if(!value) throw new Error(`${name} is missing`);
  const state=loadState();
  const quote=await generateQuote(state.runCount,state.usedTitles);
  log(`SCREEN (${countWords(quote.screen)} words): ${quote.screen}`);
  log(`IMAGE: ${quote.imagePrompt}`);
  log(`BGM: ${quote.bgmMood} | ${quote.bgmTempo} | ${quote.bgmInstrument}`);
  const image=await generateFullScreenImage(quote.imagePrompt);
  const bgm=generateEmotionMatchedBGM(SHORT_DURATION,quote.bgmMood,quote.bgmTempo,quote.bgmInstrument,path.join(WORK_DIR,'romantic_bgm.wav'));
  const video=buildVideo(image,bgm,quote.screen);
  await upload(video,quote.title,`${quote.screen}\n\nOriginal romantic Telugu quote Short.\nEmotion-matched cinematic image and original instrumental BGM.`);
  saveState(quote.title); log('Done. No voice/TTS is used.');
}
main().catch(err=>{console.error('FAILED:',err.stack||err);process.exit(1);});
