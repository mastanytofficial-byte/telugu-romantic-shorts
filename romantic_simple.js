const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;

const WORK_DIR = path.join(__dirname, 'work');
const STATE_FILE = path.join(__dirname, 'last-article.json');
const CATEGORY = 'romantic_quote';
const MIN_WORDS = 16;
const MAX_WORDS = 36;
const FORBIDDEN = new Set([
  'a','an','and','are','best','beautiful','because','be','but','deep','distance',
  'feeling','feelings','first','forever','happy','heart','heartbeat','life','line',
  'love','memories','memory','miss','missing','my','relationship','sad','special',
  'story','true','waiting','you','your','is','was','were','the','to','of','in','on',
  'for','with','from','this','that','me','mine','someone','one','side','long','old',
  'night','rain','sorry','firstlove','lifeline','romantic','quote'
]);

const THEMES = [
  'evariki cheppaleni prema',
  'dooramaina vyakti gurthulu',
  'oka mounamaina anubandham',
  'varshamlo gurthocche vyakti',
  'kalisi gadipina chinna kshanam',
  'veedipoyina taruvatha migilina gurthulu',
  'eduruchupu',
  'manasulo dachukunna maata',
  'modati parichayam gurthu',
  'malli kalavalani korika',
  'nishabdanga perigina anubandham',
  'oka vyakti jeevithanni marchina vidhanam'
];

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { runCount: 0, usedTitles: [] };
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { runCount: Number(s.runCount || 0), usedTitles: s.usedTitles || [] };
  } catch (_) {
    return { runCount: 0, usedTitles: [] };
  }
}

function saveState(title) {
  const state = loadState();
  const usedTitles = [...state.usedTitles, title].slice(-50);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    runCount: state.runCount + 1,
    usedTitles,
    lastDate: new Date().toISOString()
  }, null, 2));
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function forbiddenWords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  return [...new Set(words.filter(w => FORBIDDEN.has(w)))];
}

function validate(screen, voice) {
  const problems = [];
  const n = countWords(screen);
  const bad = forbiddenWords(screen);
  if (n < MIN_WORDS || n > MAX_WORDS) problems.push(`SCREEN has ${n} words; required ${MIN_WORDS}-${MAX_WORDS}`);
  if (bad.length) problems.push(`SCREEN contains English words: ${bad.join(', ')}`);
  if (/[A-Za-z]/.test(voice)) problems.push('VOICE contains English/Latin letters');
  if (/#[^\s]+/.test(screen) || /#[^\s]+/.test(voice)) problems.push('hashtags are not allowed');
  return { valid: problems.length === 0, problems, wordCount: n };
}

function cleanScreen(text) {
  return String(text || '')
    .replace(/^(SCREEN|QUOTE)\s*:\s*/i, '')
    .replace(/#[^\s]+/g, '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVoice(text) {
  return String(text || '')
    .replace(/^(VOICE|SCRIPT)\s*:\s*/i, '')
    .replace(/#[^\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parse(raw) {
  const title = raw.match(/TITLE:\s*(.+)/i)?.[1]?.trim() || '';
  const screen = raw.match(/SCREEN:\s*([\s\S]*?)(?=\nVOICE:|\nIMAGE_QUERY:|$)/i)?.[1]?.trim() || '';
  const voice = raw.match(/VOICE:\s*([\s\S]*?)(?=\nIMAGE_QUERY:|$)/i)?.[1]?.trim() || '';
  const imageQuery = raw.match(/IMAGE_QUERY:\s*(.+)/i)?.[1]?.trim() || '';
  return { title, screen: cleanScreen(screen), voice: cleanVoice(voice), imageQuery };
}

async function callGroq(prompt) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.9,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('Groq returned no content: ' + JSON.stringify(data));
  return data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function generateQuote(runCount, usedTitles) {
  const theme = THEMES[runCount % THEMES.length];
  const recent = usedTitles.slice(-8).join(' | ');
  const base = `Create ONE completely original romantic Telugu thought for a 20–30 second YouTube Short.\n\nTHEME: ${theme}\n\nSCREEN RULES:\n- 16 to 36 words exactly.\n- Write ONLY Telugu vocabulary using English letters (Tenglish).\n- Do NOT use ANY English vocabulary, not even common words.\n- Never use words such as love, heart, life, first, feeling, memory, miss, beautiful, special, forever, true, waiting, relationship, story, romantic, quote, or any other English word.\n- The sentence must sound like natural spoken Telugu when read aloud.\n- Emotional, poetic, simple, mature and deeply relatable.\n- Make it feel like an original thought, not a copied lyric.\n- No movie lyrics, no song imitation, no famous quotes, no hashtags, no CTA.\n- Do not mention movies, actors, singers or songs.\n- End with a memorable emotional thought.\n\nVOICE RULES:\n- Express exactly the same idea as SCREEN.\n- Telugu script ONLY. Absolutely no Latin/English letters.\n- Natural spoken Telugu for Google Telugu TTS.\n- No hashtags and no CTA.\n\nIMAGE_QUERY:\n- Give 3 to 6 simple English visual-search words describing ONE cinematic background image that directly matches the quote.\n- The entire Short will use this ONE image only.\n- Examples: rainy window lonely person, sunset couple silhouette, handwritten letter night, empty street rain.\n\nReturn exactly four lines and nothing else:\nTITLE: short Tenglish title\nSCREEN: Tenglish quote\nVOICE: Telugu-script equivalent\nIMAGE_QUERY: English image search phrase`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    let prompt = base;
    if (attempt > 1) {
      prompt += `\n\nThe previous attempt failed validation. Generate a completely NEW quote. Do not repair it. Make SCREEN pure Tenglish Telugu vocabulary and VOICE pure Telugu script.\nPrevious titles to avoid: ${recent}`;
    }
    const parsed = parse(await callGroq(prompt));
    const result = validate(parsed.screen, parsed.voice);
    log(`Quote attempt ${attempt}: ${result.wordCount} words, valid=${result.valid}`);
    if (result.problems.length) log('Validation: ' + result.problems.join(' | '));
    if (result.valid && parsed.imageQuery) {
      return parsed;
    }
  }
  throw new Error('Could not generate a valid Tenglish romantic quote after 5 attempts.');
}

function escapeSSML(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function synthesizeTelugu(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const buffers = [];
  for (const sentence of (sentences.length ? sentences : [text])) {
    const res = await fetchWithTimeout(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { ssml: `<speak><s>${escapeSSML(sentence)}</s></speak>` },
        voice: { languageCode: 'te-IN', name: 'te-IN-Chirp3-HD-Achird' },
        audioConfig: { audioEncoding: 'LINEAR16' }
      })
    });
    const data = await res.json();
    if (!data.audioContent) throw new Error('Google TTS failed: ' + JSON.stringify(data.error || data));
    buffers.push(Buffer.from(data.audioContent, 'base64'));
  }
  const paths = [];
  for (let i = 0; i < buffers.length; i++) {
    const p = path.join(WORK_DIR, `tts_${i}.wav`);
    fs.writeFileSync(p, buffers[i]);
    paths.push(p);
  }
  if (paths.length === 1) return paths[0];
  const list = path.join(WORK_DIR, 'tts_list.txt');
  fs.writeFileSync(list, paths.map(p => `file '${p}'`).join('\n'));
  const out = path.join(WORK_DIR, 'voice.wav');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${list}" -c copy "${out}"`, { stdio: 'pipe' });
  return out;
}

function writeWav(filePath, samples, sampleRate = 44100, channels = 2) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28); buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i])), 44 + i * 2);
  fs.writeFileSync(filePath, buffer);
}

function generateOriginalBGM(duration, filePath) {
  const sr = 44100;
  const total = Math.ceil(duration * sr);
  const samples = new Int16Array(total * 2);
  const chords = [
    [261.63, 329.63, 392.00, 493.88],
    [220.00, 261.63, 329.63, 392.00],
    [174.61, 220.00, 261.63, 329.63],
    [196.00, 246.94, 293.66, 392.00]
  ];
  const chordLength = 4.0;
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const chord = chords[Math.floor(t / chordLength) % chords.length];
    const local = (t % chordLength) / chordLength;
    const fade = Math.min(1, t / 1.5, (duration - t) / 1.5);
    let value = 0;
    for (let n = 0; n < chord.length; n++) {
      const f = chord[n];
      const slow = 0.55 + 0.45 * Math.sin(2 * Math.PI * (0.07 + n * 0.01) * t);
      value += Math.sin(2 * Math.PI * f * t) * 0.018 * slow;
      value += Math.sin(2 * Math.PI * (f * 2) * t) * 0.004 * slow;
    }
    value += Math.sin(2 * Math.PI * 0.5 * t) * 0.006 * (1 - local);
    value *= Math.max(0, Math.min(1, fade));
    const s = Math.round(value * 32767);
    samples[i * 2] = s;
    samples[i * 2 + 1] = s;
  }
  writeWav(filePath, samples, sr, 2);
  return filePath;
}

async function fetchOneBackgroundImage(query) {
  const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=12&page=1&orientation=portrait`;
  try {
    const res = await fetchWithTimeout(pexelsUrl, { headers: { Authorization: PEXELS_API_KEY } });
    const data = await res.json();
    if (!data.photos?.length) throw new Error('No Pexels photos returned');
    const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
    const imageUrl = photo.src?.large2x || photo.src?.large || photo.src?.original;
    const imageRes = await fetchWithTimeout(imageUrl, {}, 30000);
    if (!imageRes.ok) throw new Error(`Image download HTTP ${imageRes.status}`);
    const buf = Buffer.from(await imageRes.arrayBuffer());
    if (buf.length < 5000) throw new Error('Downloaded image is too small');
    const out = path.join(WORK_DIR, 'background.jpg');
    fs.writeFileSync(out, buf);
    log(`Using ONE Pexels background image: ${query}`);
    return out;
  } catch (e) {
    log('Pexels image failed: ' + e.message + ' — trying Pollinations fallback.');
    const prompt = `${query}, cinematic romantic photography, realistic, soft light, vertical portrait, no text, no watermark`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=1365&nologo=true`;
    const res = await fetchWithTimeout(url, {}, 30000);
    if (!res.ok) throw new Error(`Pollinations image failed HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5000) throw new Error('Fallback image is too small');
    const out = path.join(WORK_DIR, 'background.jpg');
    fs.writeFileSync(out, buf);
    log('Using ONE Pollinations background image.');
    return out;
  }
}

function wrapQuote(text, maxChars = 30) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxChars) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function buildVideo(imagePath, voicePath, bgmPath, screenText) {
  const out = path.join(WORK_DIR, 'output.mp4');
  const font = path.join(__dirname, 'fonts', 'NotoSansTelugu-Bold.ttf');
  const fontFallback = path.join(__dirname, 'fonts', 'NotoSansTelugu-Regular.ttf');
  const fontPath = fs.existsSync(font) ? font : fontFallback;
  const textFile = path.join(WORK_DIR, 'quote.txt');
  fs.writeFileSync(textFile, wrapQuote(screenText), 'utf8');
  const duration = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${voicePath}"`).toString().trim()) + 0.4;
  const fd = duration.toFixed(2);
  const vf = [
    `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`,
    `zoompan=z='min(zoom+0.0015,1.10)':d=${Math.ceil(duration * 25)}:s=720x1280:fps=25`,
    'eq=contrast=1.04:saturation=1.08',
    'vignette=PI/6',
    'drawbox=x=0:y=0:w=iw:h=260:color=black@0.30:t=fill',
    'drawbox=x=0:y=ih-300:w=iw:h=300:color=black@0.20:t=fill',
    `drawtext=fontfile='${fontPath}':text='TELUGU ECHO':fontcolor=0xF7C948:fontsize=28:x=(w-text_w)/2:y=78:shadowcolor=black@0.7:shadowx=2:shadowy=2`,
    `drawbox=x=(iw-120)/2:y=126:w=120:h=3:color=0xF7C948@0.9:t=fill`,
    `drawbox=x=45:y=ih/2-245:w=iw-90:h=490:color=black@0.22:t=fill`,
    `drawtext=fontfile='${fontPath}':textfile='${textFile}':fontcolor=white:fontsize=38:line_spacing=13:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.9:shadowx=2:shadowy=3`,
    `drawtext=fontfile='${fontPath}':text='తెలుగు ఎకో':fontcolor=white@0.65:fontsize=17:x=(w-text_w)/2:y=h-65`,
    'fade=t=in:st=0:d=0.5',
    `fade=t=out:st=${Math.max(0, duration - 0.5).toFixed(2)}:d=0.5`
  ].join(',');

  const filter = `[2:a]volume=0.12,aloop=loop=-1:size=2e+09,atrim=0:${fd}[bgm];[1:a]volume=1.0[voice];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]`;
  const cmd = [
    'ffmpeg -y',
    `-loop 1 -i "${imagePath}"`,
    `-i "${voicePath}"`,
    `-i "${bgmPath}"`,
    `-filter_complex "${filter}"`,
    `-map 0:v -map "[a]"`,
    `-vf "${vf}"`,
    `-t ${fd}`,
    '-c:v libx264 -pix_fmt yuv420p',
    '-c:a aac -b:a 128k',
    '-shortest',
    `"${out}"`
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
  return out;
}

function sanitize(text, max) {
  return String(text || '').replace(/[\x00-\x1F\x7F-\x9F]/g, '').slice(0, max).trim();
}

async function upload(videoPath, title, description) {
  const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const safeTitle = sanitize(title || 'Telugu Romantic Quote', 95);
  const safeDescription = sanitize(description, 4900);
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: safeTitle,
        description: safeDescription,
        tags: ['telugu quotes','telugu romantic quotes','tenglish quotes','telugu shorts','romantic shorts'],
        categoryId: '22'
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    },
    media: { body: fs.createReadStream(videoPath) }
  });
  log(`Uploaded: https://www.youtube.com/watch?v=${res.data.id}`);
}

async function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  for (const [name, value] of Object.entries({ GROQ_API_KEY, GOOGLE_TTS_API_KEY, PEXELS_API_KEY, YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN })) {
    if (!value) throw new Error(`${name} is missing`);
  }

  const state = loadState();
  log(`Run #${state.runCount + 1}: romantic quote, one image, one original BGM.`);
  const quote = await generateQuote(state.runCount, state.usedTitles);
  log(`Title: ${quote.title}`);
  log(`SCREEN (${countWords(quote.screen)} words): ${quote.screen}`);
  log(`VOICE: ${quote.voice}`);
  log(`IMAGE_QUERY: ${quote.imageQuery}`);

  const imagePath = await fetchOneBackgroundImage(quote.imageQuery);
  const voicePath = await synthesizeTelugu(quote.voice);
  const voiceDuration = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${voicePath}"`).toString().trim());
  const bgmPath = generateOriginalBGM(voiceDuration + 0.6, path.join(WORK_DIR, 'romantic_bgm.wav'));
  const videoPath = buildVideo(imagePath, voicePath, bgmPath, quote.screen);

  await upload(videoPath, quote.title, `${quote.voice}\n\nOriginal romantic Telugu quote created for Telugu Echo.\nOne cinematic background image and original instrumental BGM are used.`);
  saveState(quote.title);
  log('Done.');
}

main().catch(err => {
  console.error('FAILED:', err.stack || err);
  process.exit(1);
});
