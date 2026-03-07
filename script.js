// DATABASE (IndexedDB)

let db;
const DB_NAME = 'nutriscan_db', DB_VERSION = 1, STORE = 'scans';

function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const store = e.target.result.createObjectStore(STORE, { keyPath: 'barcode' });
      store.createIndex('scannedAt', 'scannedAt', { unique: false });
    };
    req.onsuccess = e => { db = e.target.result; res(); };
    req.onerror   = () => rej(req.error);
  });
}
function saveToDB(record) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
function getAllScans() {
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('scannedAt').getAll();
    req.onsuccess = () => res(req.result.reverse());
    req.onerror   = () => rej(req.error);
  });
}
function clearDB() {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

// UI REFS

let html5QrCode, isScanning = false;
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const scanLine     = document.getElementById('scan-line');
const resultCard   = document.getElementById('result-card');
const startBtn     = document.getElementById('start-btn');
const stopBtn      = document.getElementById('stop-btn');
const torchBtn     = document.getElementById('torch-btn');
const idleState    = document.getElementById('idle-state');
const historyPanel = document.getElementById('history-panel');

// CAMERA

let torchOn = false;

function startCamera() {
  if (isScanning) return;
  html5QrCode = new Html5Qrcode('reader', { verbose: false });

  startBtn.style.display   = 'none';
  document.getElementById('upload-btn').style.display = 'none';
  stopBtn.style.display    = 'inline-block';
  torchBtn.style.display   = 'inline-block';
  idleState.style.display  = 'none';
  scanLine.style.display   = 'block';
  torchOn = false;
  torchBtn.innerText = '🔦';
  setStatus('Point camera at barcode…', 'active');

  const readerEl = document.getElementById('reader');
  const w = readerEl.offsetWidth  || 320;
  const h = readerEl.offsetHeight || 320;

  const boxW = Math.floor(w * 0.88);
  const boxH = Math.floor(h * 0.60);

  const config = {
    fps: 15,
    qrbox: { width: boxW, height: boxH },
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
    ],
    disableFlip: true,
    videoConstraints: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    }
  };

  html5QrCode.start(
    { facingMode: { ideal: 'environment' } },
    config,
    (decodedText) => {
      if (!isScanning) return;
      stopCamera();
      setStatus('Code detected! Fetching…', 'loading');
      fetchProduct(decodedText.trim());
    },
    () => {}
  ).then(() => {
    isScanning = true;
  }).catch(err => {
    console.error('Camera error:', err);
    setStatus('Camera error — check permissions', 'error');
    resetCameraUI();
  });
}

function toggleTorch() {
  if (!html5QrCode || !isScanning) return;
  torchOn = !torchOn;
  html5QrCode.applyVideoConstraints({
    advanced: [{ torch: torchOn }]
  }).then(() => {
    torchBtn.innerText = torchOn ? '🔆' : '🔦';
  }).catch(() => {
    showToast('Torch not supported on this device');
    torchOn = false;
  });
}

function stopCamera() {
  isScanning = false;
  torchOn = false;
  if (html5QrCode) {
    html5QrCode.stop()
      .then(() => { html5QrCode.clear(); html5QrCode = null; })
      .catch(() => { html5QrCode = null; });
  }
  resetCameraUI();
}

function resetCameraUI() {
  startBtn.style.display   = 'inline-block';
  document.getElementById('upload-btn').style.display = 'inline-block';
  stopBtn.style.display    = 'none';
  torchBtn.style.display   = 'none';
  torchBtn.innerText       = '🔦';
  scanLine.style.display   = 'none';
  idleState.style.display  = 'flex';
}

function setStatus(msg, state) {
  statusText.innerText = msg;
  statusDot.className  = 'status-dot' + (state ? ' ' + state : '');
}

// MULTI-API FETCH

async function fetchProduct(barcode) {
  setStatus('Fetching product…', 'loading');
  resultCard.style.display = 'none';

  const product = await tryAllAPIs(barcode);
  if (!product) {
    setStatus('Not found: ' + barcode, 'error');
    showToast('Product not found in any database');
    return;
  }

  displayProduct(product, barcode);
  await saveToDB({ ...product, barcode, scannedAt: Date.now() });
  setStatus('Analysis complete ✓', 'success');

  runAIAnalysis(product);
}

async function tryAllAPIs(barcode) {
  const FIELDS = 'product_name,generic_name,brands,image_front_url,image_url,nutriments,nutriscore_grade,nutrition_grade_fr,nova_group,allergens_tags,ingredients_text,ingredients_tags';

  // 1) OFF global v2
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=${FIELDS}`);
    const d = await r.json();
    if (d.status === 1 && d.product) return parseOFF(d.product, 'Open Food Facts');
  } catch(e) {}

  // 2) OFF India v2
  try {
    const r = await fetch(`https://in.openfoodfacts.org/api/v2/product/${barcode}?fields=${FIELDS}`);
    const d = await r.json();
    if (d.status === 1 && d.product) return parseOFF(d.product, 'OFF India');
  } catch(e) {}

  // 3) OFF global v0 fallback
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const d = await r.json();
    if (d.status === 1 && d.product) return parseOFF(d.product, 'Open Food Facts');
  } catch(e) {}

  // 4) Open Beauty Facts
  try {
    const r = await fetch(`https://world.openbeautyfacts.org/api/v0/product/${barcode}.json`);
    const d = await r.json();
    if (d.status === 1 && d.product) return parseOFF(d.product, 'Open Beauty Facts');
  } catch(e) {}

  // 5) Open Products Facts
  try {
    const r = await fetch(`https://world.openproductsfacts.org/api/v0/product/${barcode}.json`);
    const d = await r.json();
    if (d.status === 1 && d.product) return parseOFF(d.product, 'Open Products Facts');
  } catch(e) {}

  // 6) UPC Item DB
  try {
    const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
    const d = await r.json();
    if (d.code === 'OK' && d.items && d.items.length > 0) return parseUPCItemDB(d.items[0]);
  } catch(e) {}

  return null;
}

function parseOFF(p, source) {
  const n = p.nutriments || {};

  // Parse ingredients list
  let ingredientsList = [];
  if (p.ingredients_tags && p.ingredients_tags.length > 0) {
    ingredientsList = p.ingredients_tags
      .map(t => t.replace(/^en:/, '').replace(/-/g, ' ').trim())
      .filter(t => t.length > 1 && !t.match(/^\d/));
  } else if (p.ingredients_text) {
    ingredientsList = p.ingredients_text
      .split(/[,;]/)
      .map(t => t.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim())
      .filter(t => t.length > 1)
      .slice(0, 40);
  }

  return {
    name:         p.product_name || p.generic_name || 'Unknown Product',
    brand:        p.brands || '',
    image:        p.image_front_url || p.image_url || '',
    kcal:         n['energy-kcal_100g'] ?? n['energy-kcal'] ?? null,
    sugar:        n.sugars_100g ?? n.sugars ?? null,
    fat:          n.fat_100g ?? n.fat ?? null,
    salt:         n.salt_100g ?? n.salt ?? null,
    fiber:        n.fiber_100g ?? null,
    protein:      n.proteins_100g ?? null,
    nutriscore:   p.nutriscore_grade || p.nutrition_grade_fr || null,
    nova:         p.nova_group || null,
    allergens:    p.allergens_tags || [],
    ingredients:  ingredientsList,
    ingredientsRaw: p.ingredients_text || '',
    source
  };
}

function parseUPCItemDB(item) {
  return {
    name: item.title || 'Unknown Product', brand: item.brand || '',
    image: (item.images && item.images[0]) || '',
    kcal: null, sugar: null, fat: null, salt: null, fiber: null, protein: null,
    nutriscore: null, nova: null, allergens: [], ingredients: [], ingredientsRaw: '',
    source: 'UPC Item DB'
  };
}

// INGREDIENT CLASSIFICATION (local rules)

const BAD_INGREDIENTS = [
  'high fructose corn syrup','corn syrup','hydrogenated','partially hydrogenated',
  'trans fat','sodium nitrate','sodium nitrite','artificial color','artificial flavour',
  'artificial flavor','msg','monosodium glutamate','aspartame','saccharin','acesulfame',
  'bha','bht','tbhq','carrageenan','potassium bromate','brominated vegetable oil',
  'red 40','yellow 5','yellow 6','blue 1','blue 2','caramel color','palm oil',
  'refined flour','maida','refined sugar','white sugar'
];
const GOOD_INGREDIENTS = [
  'whole wheat','whole grain','oats','quinoa','brown rice','flaxseed','chia',
  'almond','walnut','cashew','olive oil','turmeric','ginger','garlic','spinach',
  'kale','broccoli','tomato','carrot','vitamin','calcium','iron','zinc','fibre',
  'fiber','protein','probiotic','prebiotic','green tea','blueberry','antioxidant'
];
const CAUTION_INGREDIENTS = [
  'sugar','glucose','fructose','dextrose','maltose','sucrose','syrup','starch',
  'modified starch','soy lecithin','sodium','salt','preservative','stabilizer',
  'emulsifier','thickener','acidity regulator','colour','color','flavour','flavor',
  'citric acid','phosphate','sulphate','sulfate','yeast extract','whey'
];

function classifyIngredient(name) {
  const n = name.toLowerCase();
  if (BAD_INGREDIENTS.some(b => n.includes(b))) return 'bad';
  if (GOOD_INGREDIENTS.some(g => n.includes(g))) return 'good';
  if (CAUTION_INGREDIENTS.some(c => n.includes(c))) return 'caution';
  return 'neutral';
}

// NUTRITION-BASED SCORING

function computeScore(product) {
  const { kcal, sugar, fat, salt, fiber, protein } = product;
  if (sugar == null && fat == null && kcal == null) return { score: null, grade: 'grey' };

  let pts = 100;
  if (kcal  != null) { if (kcal  > 500)  pts -= 25; else if (kcal  > 300)  pts -= 12; }
  if (sugar != null) { if (sugar > 22.5) pts -= 25; else if (sugar > 5)    pts -= 10; }
  if (fat   != null) { if (fat   > 17.5) pts -= 20; else if (fat   > 3)    pts -= 8;  }
  if (salt  != null) { if (salt  > 1.5)  pts -= 15; else if (salt  > 0.3)  pts -= 6;  }
  if (fiber   != null && fiber   > 3) pts += 8;
  if (protein != null && protein > 8) pts += 5;
  pts = Math.max(0, Math.min(100, pts));

  let grade = 'green', label = '✦ Healthy Choice';
  if (pts < 40)      { grade = 'red';    label = '✖ Avoid This'; }
  else if (pts < 65) { grade = 'yellow'; label = '◆ Moderate'; }
  return { score: pts, grade, label };
}

// DISPLAY

function displayProduct(p, barcode) {
  resultCard.style.display = 'block';

  document.getElementById('product-name').innerText  = p.name  || 'Unknown Product';
  document.getElementById('product-brand').innerText = p.brand || '';
  document.getElementById('source-badge').innerText  = p.source || '';

  const img = document.getElementById('product-img');
  img.src = p.image || 'https://via.placeholder.com/72x72/111812/5a7060?text=?';
  img.onerror = () => { img.src = 'https://via.placeholder.com/72x72/111812/5a7060?text=?'; };

  const fmt = v => v != null ? parseFloat(v).toFixed(1) : '—';
  document.getElementById('kcal-val').innerText  = p.kcal  != null ? Math.round(p.kcal) : '—';
  document.getElementById('sugar-val').innerText = fmt(p.sugar);
  document.getElementById('fat-val').innerText   = fmt(p.fat);
  document.getElementById('salt-val').innerText  = fmt(p.salt);

  // Verdict (nutrition-based)
  const { score, grade, label } = computeScore(p);
  document.getElementById('verdict-label').innerText  = label;
  document.getElementById('verdict-label').className  = 'verdict-label ' + grade;
  document.getElementById('verdict-score').innerText  = score != null ? score + '/100' : '—';
  document.getElementById('verdict-score').className  = 'verdict-score ' + grade;

  const badgesRow = document.getElementById('badges-row');
  const badgeParts = [];

  if (p.nutriscore) {
    const g = p.nutriscore.toUpperCase();
    badgeParts.push(
      `<div class="badge-item">
        <span class="badge-label">Nutri-Score</span>
        <div class="ns-badge ns-${g.toLowerCase()}">${g}</div>
      </div>`
    );
  }

  if (p.nova) {
    badgeParts.push(
      `<div class="badge-item">
        <span class="badge-label">NOVA Group</span>
        <div class="nova-badge nova-${p.nova}">${p.nova}</div>
      </div>`
    );
  }

  if (badgeParts.length > 0) {
    badgesRow.innerHTML = badgeParts.join('');
    badgesRow.style.display = 'flex';
  } else {
    badgesRow.style.display = 'none';
  }

  // Allergens
  const allergenRow = document.getElementById('allergens-row');
  const tags = (p.allergens || []).map(a => a.replace('en:', '').replace(/-/g, ' '));
  if (tags.length > 0) {
    allergenRow.style.display = 'block';
    allergenRow.innerHTML =
      '<span style="color:var(--muted);font-size:11px;margin-right:4px;">⚠ Contains:</span>' +
      tags.map(t => `<span class="allergen-tag">${t}</span>`).join('');
  } else {
    allergenRow.style.display = 'none';
  }

  // Ingredients
  displayIngredients(p);

  // Prepare AI section (will be populated by runAIAnalysis)
  const aiSection = document.getElementById('ai-section');
  const aiContent = document.getElementById('ai-content');
  const aiSpinner = document.getElementById('ai-spinner');
  aiSection.style.display = 'block';
  aiSpinner.classList.add('active');
  aiContent.innerHTML = '<div class="ai-loading">Analyzing ingredients with AI…</div>';

  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function displayIngredients(p) {
  const section = document.getElementById('ingredients-section');
  const rawDiv  = document.getElementById('ingredients-raw');
  const tagsDiv = document.getElementById('ingredients-tags');
  const countEl = document.getElementById('ingredient-count');

  const list = p.ingredients || [];
  const raw  = p.ingredientsRaw || '';

  if (list.length === 0 && !raw) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  // Show raw text (truncated)
  if (raw) {
    const truncated = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
    rawDiv.innerText = truncated;
  } else {
    rawDiv.style.display = 'none';
  }

  // Render classified tags
  if (list.length > 0) {
    countEl.innerText = list.length + ' ingredients';
    tagsDiv.innerHTML = list.map(ing => {
      const cls = classifyIngredient(ing);
      const icons = { good: '✓', neutral: '·', caution: '!', bad: '✕' };
      return `<span class="ing-tag ${cls}" title="${ing}">${icons[cls]} ${ing}</span>`;
    }).join('');
  } else {
    countEl.style.display = 'none';
  }
}

// AI ANALYSIS via Claude API

async function runAIAnalysis(product) {
  const aiContent = document.getElementById('ai-content');
  const aiSpinner = document.getElementById('ai-spinner');

  const ingredientsList = product.ingredients && product.ingredients.length > 0
    ? product.ingredients.join(', ')
    : product.ingredientsRaw || null;

  const nutritionInfo = [
    product.kcal  != null ? `Calories: ${Math.round(product.kcal)} kcal/100g` : null,
    product.sugar != null ? `Sugar: ${product.sugar}g/100g` : null,
    product.fat   != null ? `Fat: ${product.fat}g/100g` : null,
    product.salt  != null ? `Salt: ${product.salt}g/100g` : null,
    product.fiber != null ? `Fiber: ${product.fiber}g/100g` : null,
    product.protein != null ? `Protein: ${product.protein}g/100g` : null,
  ].filter(Boolean).join(', ');

  if (!ingredientsList && !nutritionInfo) {
    aiSpinner.classList.remove('active');
    aiContent.innerHTML = '<div class="ai-error">Not enough data available for AI analysis.</div>';
    return;
  }

  const prompt = `You are a nutrition and food science expert. Analyze this food product and give a concise health assessment.

Product: ${product.name}${product.brand ? ' by ' + product.brand : ''}
${nutritionInfo ? 'Nutrition (per 100g): ' + nutritionInfo : ''}
${ingredientsList ? 'Ingredients: ' + ingredientsList : ''}
${product.nova ? 'NOVA processing group: ' + product.nova : ''}

Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text):
{
  "score": <integer 0-100 based on ingredient quality and nutrition>,
  "summary": "<2-3 sentence plain English health summary>",
  "flags": [
    {"type": "positive|warning|negative", "icon": "<single emoji>", "text": "<short observation>"},
    {"type": "positive|warning|negative", "icon": "<single emoji>", "text": "<short observation>"},
    {"type": "positive|warning|negative", "icon": "<single emoji>", "text": "<short observation>"}
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content.map(c => c.text || '').join('').trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    aiSpinner.classList.remove('active');

    const grade = result.score >= 65 ? 'green' : result.score >= 40 ? 'yellow' : 'red';

    const flagsHTML = (result.flags || []).map(f =>
      `<div class="ai-flag ${f.type}">
        <span class="ai-flag-icon">${f.icon}</span>
        <span>${f.text}</span>
      </div>`
    ).join('');

    aiContent.innerHTML = `
      <div class="ai-summary">${result.summary}</div>
      ${flagsHTML ? '<div class="ai-flags">' + flagsHTML + '</div>' : ''}
      <div class="ai-score-bar">
        <div class="ai-score-label">AI Ingredient Health Score</div>
        <div class="ai-score-track">
          <div class="ai-score-fill ${grade}" id="ai-fill" style="width:0%"></div>
        </div>
        <div class="ai-score-nums"><span>0</span><span>50</span><span>100</span></div>
        <div class="ai-score-val ${grade}">${result.score}<span style="font-size:14px;font-weight:400;color:var(--muted)">/100</span></div>
      </div>`;

    // Animate bar
    setTimeout(() => {
      const fill = document.getElementById('ai-fill');
      if (fill) fill.style.width = result.score + '%';
    }, 100);

  } catch (err) {
    console.error('AI analysis error:', err);
    aiSpinner.classList.remove('active');
    aiContent.innerHTML = '<div class="ai-error">AI analysis unavailable. Showing nutrition-based score only.</div>';
  }
}

// IMAGE UPLOAD & SCAN

function triggerUpload() {
  // Stop camera if running
  if (isScanning) stopCamera();
  document.getElementById('file-input').value = '';
  document.getElementById('file-input').click();
}

async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const preview = showImagePreview(file);
  setStatus('Reading barcode from image…', 'loading');
  resultCard.style.display = 'none';
  document.getElementById('start-btn').style.display  = 'none';
  document.getElementById('upload-btn').style.display = 'none';

  // Use a fresh dedicated div — never the live camera reader
  const imgReaderId = 'img-reader';
  let scanner = null;

  try {
    scanner = new Html5Qrcode(imgReaderId, { verbose: false });

    // scanFile returns the decoded string directly
    const decodedText = await scanner.scanFile(file, false);

    if (preview && preview.remove) preview.remove();
    setStatus('Barcode found! Fetching…', 'loading');
    fetchProduct(decodedText.trim());

  } catch (err) {
    console.warn('scanFile failed, trying canvas fallback…', err);

    try {
      const blob = await resizeImageForScan(file);
      if (!scanner) scanner = new Html5Qrcode(imgReaderId, { verbose: false });
      const decodedText = await scanner.scanFile(blob, false);

      if (preview && preview.remove) preview.remove();
      setStatus('Barcode found! Fetching…', 'loading');
      fetchProduct(decodedText.trim());

    } catch (err2) {
      console.error('Both scan attempts failed:', err2);
      if (preview && preview.remove) preview.remove();
      setStatus('No barcode found in image', 'error');
      showToast('No barcode detected — try better lighting or a closer shot');
    }
  } finally {
    if (scanner) {
      try { scanner.clear(); } catch(e) {}
    }
    document.getElementById('start-btn').style.display  = 'inline-block';
    document.getElementById('upload-btn').style.display = 'inline-block';
  }
}

function resizeImageForScan(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);

      const MAX = 1200;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      ctx.drawImage(img, 0, 0, w, h);

      ctx.globalCompositeOperation = 'multiply';

      canvas.toBlob(blob => {
        if (blob) resolve(new File([blob], 'scan.jpg', { type: 'image/jpeg' }));
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/jpeg', 0.95);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

function showImagePreview(file) {
  const scannerBox = document.querySelector('.scanner-box');
  idleState.style.display = 'none';

  // Remove any old preview
  const old = scannerBox.querySelector('.img-preview-wrap');
  if (old) old.remove();

  const wrap = document.createElement('div');
  wrap.className = 'img-preview-wrap';

  const img = document.createElement('img');
  img.src = URL.createObjectURL(file);
  img.onload = () => URL.revokeObjectURL(img.src);

  const label = document.createElement('div');
  label.className = 'img-preview-label';
  label.innerText = 'Scanning for barcode…';

  wrap.appendChild(img);
  wrap.appendChild(label);
  scannerBox.appendChild(wrap);

  // Pulse the label
  let dots = 0;
  wrap._interval = setInterval(() => {
    dots = (dots + 1) % 4;
    label.innerText = 'Scanning for barcode' + '.'.repeat(dots);
  }, 400);

  // Cleanup helper
  wrap.remove = function() {
    clearInterval(this._interval);
    if (this.parentNode) this.parentNode.removeChild(this);
    idleState.style.display = 'flex';
  };

  return wrap;
}

// HISTORY
async function toggleHistory() {
  const showing = historyPanel.style.display === 'block';
  if (!showing) { await renderHistory(); historyPanel.style.display = 'block'; }
  else historyPanel.style.display = 'none';
}

async function renderHistory() {
  const list  = document.getElementById('history-list');
  const scans = await getAllScans();
  if (scans.length === 0) {
    list.innerHTML = '<div class="empty-history">No scans yet.<br>Scan a product to get started.</div>';
    return;
  }
  list.innerHTML = scans.map(s => {
    const { grade } = computeScore(s);
    const date = new Date(s.scannedAt).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    return `<div class="history-item" onclick='displayProduct(${JSON.stringify(s)}, "${s.barcode}"); historyPanel.style.display="none"'>
      <img class="hi-img" src="${s.image||''}" onerror="this.src='https://via.placeholder.com/42x42/111812/5a7060?text=?'" alt="">
      <div class="hi-info">
        <div class="hi-name">${s.name || s.barcode}</div>
        <div class="hi-meta">${s.brand ? s.brand + ' · ' : ''}${date}</div>
      </div>
      <div class="hi-dot ${grade}"></div>
    </div>`;
  }).join('');
}

async function clearHistory() {
  if (!confirm('Clear all scan history?')) return;
  await clearDB();
  document.getElementById('history-list').innerHTML = '<div class="empty-history">History cleared.</div>';
  showToast('History cleared');
}

// TOAST + INIT

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

initDB().catch(console.error);