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

const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();

function getGroqUrl() {
  return ['https:', '', ['api', 'groq', 'com'].join('.'), 'openai', 'v1'].join('/');
}

async function getAvailableModels() {
  try {
    const r = await fetch(getGroqUrl() + '/models', {
      headers: { 'Authorization': 'Bearer ' + GROQ_API_KEY }
    });
    const d = await r.json();
    if (d && Array.isArray(d.data)) {
      return d.data.map(m => m.id);
    }
  } catch (e) {}
  return [];
}

async function pickModel(needVision) {
  const models = await getAvailableModels();
  if (needVision) {
    const vPrefs = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'llama-3.2-90b-vision-preview',
      'llama-3.2-11b-vision-preview'
    ];
    const foundV = vPrefs.find(p => models.includes(p)) || models.find(m => m.includes('vision') || m.includes('llama-4'));
    return foundV || null;
  }
  const tPrefs = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3-32b',
    'qwen-qwq-32b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it'
  ];
  const foundT = tPrefs.find(p => models.includes(p)) || models.find(m => !m.includes('whisper') && !m.includes('guard') && !m.includes('tts'));
  return foundT || 'llama-3.1-8b-instant';
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!GROQ_API_KEY.startsWith('gsk_')) {
      return res.status(400).json({ error: 'Render Environment mein GROQ_API_KEY save nahi hai.' });
    }
    const messages = (req.body && Array.isArray(req.body.messages)) ? req.body.messages : [];
    const uploadedImage = (req.body && req.body.image) ? req.body.image : null;
    if (messages.length === 0 && !uploadedImage) {
      return res.status(400).json({ error: 'Please type a message or upload a photo.' });
    }

    const activeModel = await pickModel(Boolean(uploadedImage));
    if (uploadedImage && !activeModel) {
      return res.status(400).json({ error: 'Aapke Groq account mein abhi Photo Vision model enabled nahi hai. ://groq.com -> Settings -> Limits mein vision model enable karein, ya abhi text chat aur Photo generator use karein!' });
    }

    const systemPrompt = 'You are SKY clouded, a helpful AI assistant. Reply in the exact same language and script as the user (Hinglish, Hindi, or English). Keep answers clear, direct, and well-structured without markdown tables or horizontal lines.';
    const recent = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
    if (uploadedImage && recent.length > 0) {
      const lastMsg = recent.at(-1);
      lastMsg.content = [
        { type: 'text', text: lastMsg.content || 'Describe this photo.' },
        { type: 'image_url', image_url: { url: uploadedImage } }
      ];
    }

    const response = await fetch(getGroqUrl() + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: JSON.stringify({ model: activeModel, temperature: 0.4, messages: [{ role: 'system', content: systemPrompt }, ...recent] })
    });
    const data = await response.json();
    const answer = data && data.choices && data.choices.at(0) && data.choices.at(0).message ? data.choices.at(0).message.content : null;
    if (!answer) return res.status(500).json({ error: (data.error && data.error.message) || 'AI busy, try again.' });
    res.json({ answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/image', async (req, res) => {
  try {
    const prompt = (req.body && req.body.prompt) ? req.body.prompt.trim() : '';
    if (!prompt) return res.status(400).json({ error: 'Please describe the image first.' });
    let englishPrompt = prompt;
    if (GROQ_API_KEY.startsWith('gsk_')) {
      try {
        const tModel = await pickModel(false);
        const gRes = await fetch(getGroqUrl() + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
          body: JSON.stringify({
            model: tModel,
            temperature: 0.2,
            messages: [
              { role: 'system', content: 'Translate to a concise English image prompt under 30 words. Output ONLY the prompt.' },
              { role: 'user', content: prompt }
            ]
          })
        });
        const gData = await gRes.json();
        const tr = gData && gData.choices && gData.choices.at(0) && gData.choices.at(0).message ? gData.choices.at(0).message.content.trim() : '';
        if (tr) englishPrompt = tr;
      } catch (e) {}
    }

    const imgHost = ['image', 'pollinations', 'ai'].join('.');
    const remoteUrl = ['https:', '', imgHost, 'prompt', encodeURIComponent(englishPrompt)].join('/') + '?width=768&height=820&model=flux&nologo=true&seed=' + Math.floor(Math.random() * 100000);
    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) return res.status(500).json({ error: 'Image server busy, try again.' });
    const arrayBuf = await imgRes.arrayBuffer();
    res.json({ imageUrl: 'data:image/jpeg;base64,' + Buffer.from(arrayBuf).toString('base64') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/edit-photo', async (req, res) => {
  try {
    const image = (req.body && req.body.image) ? req.body.image : '';
    const instruction = (req.body && req.body.prompt) ? req.body.prompt.trim() : 'Make it cinematic';
    if (!image) return res.status(400).json({ error: 'Please upload a photo first.' });
    const vModel = await pickModel(true);
    let editedPrompt = instruction;
    if (vModel) {
      const vRes = await fetch(getGroqUrl() + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
        body: JSON.stringify({
          model: vModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: 'Describe the subject of the image applying this edit in ONE English prompt under 40 words. Output ONLY the prompt.' },
            { role: 'user', content: [{ type: 'text', text: 'Edit: ' + instruction }, { type: 'image_url', image_url: { url: image } }] }
          ]
        })
      });
      const vData = await vRes.json();
      const ep = vData && vData.choices && vData.choices.at(0) && vData.choices.at(0).message ? vData.choices.at(0).message.content.trim() : '';
      if (ep) editedPrompt = ep;
    }
    const imgHost = ['image', 'pollinations', 'ai'].join('.');
    const remoteUrl = ['https:', '', imgHost, 'prompt', encodeURIComponent(editedPrompt)].join('/') + '?width=768&height=820&model=flux&nologo=true&seed=' + Math.floor(Math.random() * 100000);
    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) return res.status(500).json({ error: 'Editor busy, try again.' });
    const arrayBuf = await imgRes.arrayBuffer();
    res.json({ imageUrl: 'data:image/jpeg;base64,' + Buffer.from(arrayBuf).toString('base64') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('SKY clouded live on port ' + PORT);
});
