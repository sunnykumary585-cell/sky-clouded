const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Paste your Groq API key (gsk_...) below
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

function getGroqBaseUrl() {
  const host = ['api', 'groq', 'com'].join('.');
  return ['https:', '', host, 'openai', 'v1'].join('/');
}

async function pickGroqModel(baseUrl, needVision) {
  let fallback = needVision ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'openai/gpt-oss-120b';
  try {
    const mRes = await fetch(baseUrl + '/models', {
      headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY }
    });
    const mData = await mRes.json();
    if (mData && Array.isArray(mData.data)) {
      if (needVision) {
        const vPrefs = [
          'meta-llama/llama-4-scout-17b-16e-instruct',
          'meta-llama/llama-4-maverick-17b-128e-instruct'
        ];
        const vFound = vPrefs.find(p => mData.data.some(m => m.id === p)) ||
          mData.data.find(m => m.id.includes('llama-4') || m.id.includes('vision'));
        if (vFound) return vFound.id || vFound;
      } else {
        const tPrefs = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
        const tFound = tPrefs.find(p => mData.data.some(m => m.id === p));
        if (tFound) return tFound;
      }
    }
  } catch (e) {}
  return fallback;
}

// 1. AI Chat + Uploaded Photo Q&A / Thanks / Captions
app.post('/api/chat', async (req, res) => {
  try {
    const messages = (req.body && Array.isArray(req.body.messages)) ? req.body.messages : [];
    const uploadedImage = (req.body && req.body.image) ? req.body.image : null;

    if (messages.length === 0 && !uploadedImage) {
      return res.status(400).json({ error: 'Please type a message or upload a photo first.' });
    }

    if (GROQ_API_KEY === 'YAHAN_APNI_GROQ_KEY_DAALEIN' || !GROQ_API_KEY.startsWith('gsk_')) {
      return res.status(400).json({ error: 'Please paste your valid gsk_ Groq API key in server.js.' });
    }

    const baseUrl = getGroqBaseUrl();
    const activeModel = await pickGroqModel(baseUrl, Boolean(uploadedImage));

    const systemPrompt = [
      'You are SKY clouded, a world-class AI assistant.',
      '1. LANGUAGE & SCRIPT: Always match the user\'s exact language and script (Hinglish in English letters if user uses Hinglish, English if user uses English, Devanagari Hindi if user uses Devanagari).',
      '2. PHOTO Q&A & THANKS/CAPTIONS: If the user uploads an image, analyze it carefully. Answer any question about the photo, solve problems shown in it, or write heartfelt Thank You notes, wishes, or social media captions based on the photo.',
      '3. LETTERS & APPLICATIONS: Write standard Indian formal applications starting directly with "To," followed by "The Warden," and the hostel/college name. NEVER put "[Your Name]" above "To,". Write smooth, concise paragraphs with no bullet points inside a letter.',
      '4. GENERAL ANSWERS: Start with one short **bold** direct answer line, then use short headings (### Heading) and clean bullet points (• Point). Never use tables (|) or horizontal lines (---).'
    ].join(' ');

    const recent = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));

    if (uploadedImage && recent.length > 0) {
      const lastMsg = recent.at(-1);
      lastMsg.content = [
        { type: 'text', text: lastMsg.content || 'Describe this photo in detail.' },
        { type: 'image_url', image_url: { url: uploadedImage } }
      ];
    }

    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: activeModel,
        temperature: 0.35,
        messages: [
          { role: 'system', content: systemPrompt },
          ...recent
        ]
      })
    });

    const data = await response.json();
    const firstChoice = data && data.choices ? data.choices.at(0) : null;
    const answer = firstChoice && firstChoice.message ? firstChoice.message.content : null;

    if (!answer) {
      const errMsg = (data && data.error && data.error.message) ? data.error.message : 'Unable to get response.';
      return res.status(500).json({ error: errMsg });
    }

    res.json({ answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Prompt se Nayi AI Photo Banane ka Route
app.post('/api/image', async (req, res) => {
  try {
    const prompt = (req.body && req.body.prompt) ? req.body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ error: 'Please describe the image first.' });
    }

    let englishPrompt = prompt;
    try {
      const baseUrl = getGroqBaseUrl();
      const gRes = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + GROQ_API_KEY
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: 'Convert the user request (which may be in Hindi, Hinglish, or English) into a clear, detailed English image generation prompt (under 35 words). Pay strict attention to gender (boy/girl/man/woman), Indian context if implied, setting, and action. Output ONLY the English prompt text, nothing else.'
            },
            { role: 'user', content: prompt }
          ]
        })
      });
      const gData = await gRes.json();
      const translated = gData && gData.choices && gData.choices.at(0) && gData.choices.at(0).message
        ? gData.choices.at(0).message.content.trim()
        : '';
      if (translated) englishPrompt = translated;
    } catch (e) {}

    const imgHost = ['image', 'pollinations', 'ai'].join('.');
    const seed = Math.floor(Math.random() * 100000);
    const remoteUrl = ['https:', '', imgHost, 'prompt', encodeURIComponent(englishPrompt)].join('/') +
      '?width=768&height=820&model=flux&nologo=true&enhance=false&seed=' + seed;

    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) {
      return res.status(500).json({ error: 'Image server busy, please try again.' });
    }
    const arrayBuf = await imgRes.arrayBuffer();
    const base64Img = 'data:image/jpeg;base64,' + Buffer.from(arrayBuf).toString('base64');

    res.json({ imageUrl: base64Img });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Uploaded Photo ko AI se Edit / Thanks Card / Redesign karne ka Route
app.post('/api/edit-photo', async (req, res) => {
  try {
    const image = (req.body && req.body.image) ? req.body.image : '';
    const instruction = (req.body && req.body.prompt) ? req.body.prompt.trim() : 'Make it look cinematic and studio quality';

    if (!image) {
      return res.status(400).json({ error: 'Please upload a photo first.' });
    }

    const baseUrl = getGroqBaseUrl();
    const visionModel = await pickGroqModel(baseUrl, true);

    const vRes = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: visionModel,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: 'Look at the uploaded photo and carefully describe the main subject (person age, gender, face, clothing, pose, objects) while applying the user\'s requested edit, background change, or greeting/thanks card design. Write ONE detailed English image generation prompt (under 45 words). Output ONLY the prompt.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'User edit request: ' + instruction },
              { type: 'image_url', image_url: { url: image } }
            ]
          }
        ]
      })
    });

    const vData = await vRes.json();
    const editedPrompt = vData && vData.choices && vData.choices.at(0) && vData.choices.at(0).message
      ? vData.choices.at(0).message.content.trim()
      : instruction;

    const imgHost = ['image', 'pollinations', 'ai'].join('.');
    const seed = Math.floor(Math.random() * 100000);
    const remoteUrl = ['https:', '', imgHost, 'prompt', encodeURIComponent(editedPrompt)].join('/') +
      '?width=768&height=820&model=flux&nologo=true&enhance=false&seed=' + seed;

    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) {
      return res.status(500).json({ error: 'Image editor server busy, please try again.' });
    }
    const arrayBuf = await imgRes.arrayBuffer();
    const base64Img = 'data:image/jpeg;base64,' + Buffer.from(arrayBuf).toString('base64');

    res.json({ imageUrl: base64Img });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('⚡ SKY clouded Server running on port ' + PORT);
});