'use strict';
/* =========================================================
   Cap sur l'Espace — script principal
   0. Outils            1. Profil & préférences (localStorage)
   2. Navigation        3. Musique d'ambiance
   4. Carte interactive 5. Drag & Drop
   6. Quiz              7. Pendu
   8. Démarrage
   ========================================================= */

/* ---------- 0. OUTILS ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// localStorage protégé (peut être bloqué par le navigateur)
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignoré */ } },
  getJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  setJSON(k, v) { ls.set(k, JSON.stringify(v)); }
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignoré */ } }
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const getPseudo = () => ls.get('pseudo') || 'astronaute';

function setMsg(el, text, type = '') {
  el.textContent = text;
  el.className = 'msg' + (type ? ' ' + type : '');
}

/* ---------- 1. PROFIL & PRÉFÉRENCES ---------- */
/* Clés localStorage : nom, prenom, pseudo, age, volume, position,
   scorePendu, theme, luminosite */
const dlg = $('#profileDialog');

function hasProfile() {
  return ['nom', 'prenom', 'pseudo', 'age'].every(k => ls.get(k));
}

function renderProfile() {
  $('#pPrenom').textContent = ls.get('prenom') || '—';
  $('#pNom').textContent = ls.get('nom') || '—';
  $('#pPseudo').textContent = ls.get('pseudo') || '—';
  $('#pAge').textContent = ls.get('age') ? ls.get('age') + ' ans' : '—';
  $('#helloPseudo').textContent = getPseudo();
  const pos = ls.getJSON('position');
  $('#pPos').textContent = pos ? `${pos.lat.toFixed(2)}°, ${pos.lng.toFixed(2)}°` : 'non partagée';
}

function openProfile(first) {
  $('#f-prenom').value = ls.get('prenom') || '';
  $('#f-nom').value = ls.get('nom') || '';
  $('#f-pseudo').value = ls.get('pseudo') || '';
  $('#f-age').value = ls.get('age') || '';
  $('#profileErr').textContent = '';
  dlg.dataset.first = first ? '1' : '';
  $('#profileCancel').hidden = !!first;
  if (!dlg.open) dlg.showModal();
}

// Au premier chargement, la fenêtre ne peut pas être fermée avec Échap
dlg.addEventListener('cancel', e => { if (dlg.dataset.first) e.preventDefault(); });
$('#profileCancel').addEventListener('click', () => dlg.close());
$('#profileBtn').addEventListener('click', () => openProfile(false));

$('#profileForm').addEventListener('submit', e => {
  e.preventDefault();
  const prenom = $('#f-prenom').value.trim();
  const nom = $('#f-nom').value.trim();
  const pseudo = $('#f-pseudo').value.trim();
  const age = $('#f-age').value.trim();
  const err = $('#profileErr');

  if (!prenom || !nom || !pseudo) { err.textContent = 'Merci de remplir tous les champs.'; return; }
  if (!/^\d+$/.test(age) || +age < 1 || +age > 120) {
    err.textContent = "L'âge doit être un nombre entier entre 1 et 120.";
    return;
  }
  const first = !!dlg.dataset.first;
  ls.set('prenom', prenom); ls.set('nom', nom); ls.set('pseudo', pseudo); ls.set('age', age);
  dlg.dataset.first = '';
  dlg.close();
  renderProfile();
  if (first) askGeolocation();
});

/* Thème sombre / clair */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#themeBtn').textContent = t === 'dark' ? '🌙' : '☀️';
  ls.set('theme', t);
}
$('#themeBtn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* Luminosité : un calque noir plus ou moins opaque */
function applyBrightness(v) {
  v = Math.min(100, Math.max(40, Number(v) || 100));
  $('#dim').style.opacity = String((100 - v) / 100);
  $('#brightness').value = v;
  ls.set('luminosite', v);
}
$('#brightness').addEventListener('input', e => applyBrightness(e.target.value));

/* Géolocalisation (si autorisée) */
function askGeolocation() {
  const status = $('#geoStatus');
  if (!('geolocation' in navigator)) { status.textContent = 'Géolocalisation non disponible.'; return; }
  status.textContent = 'Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    p => {
      ls.setJSON('position', { lat: p.coords.latitude, lng: p.coords.longitude });
      status.textContent = 'Position enregistrée ✔';
      renderProfile();
      showUserMarker(true);
    },
    () => { status.textContent = 'Position non autorisée (ce n\'est pas grave !).'; },
    { timeout: 10000 }
  );
}

/* ---------- 2. NAVIGATION ---------- */
const VIEWS = ['accueil', 'carte', 'classe', 'mission', 'pendu'];

function showView(name) {
  if (!VIEWS.includes(name)) name = 'accueil';
  VIEWS.forEach(v => { $('#view-' + v).hidden = v !== name; });
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  try { history.replaceState(null, '', '#' + name); } catch { /* ignoré */ }
  window.scrollTo({ top: 0 });
  if (name === 'carte') initMap();
}
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) showView(b.dataset.view);
});
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (g) { e.preventDefault(); showView(g.dataset.goto); }
});

/* ---------- 3. MUSIQUE D'AMBIANCE ---------- */
/* Lit assets/vangelis.mp3. Si le fichier est absent, une ambiance
   synthétique (Web Audio) prend le relais pour que les boutons fonctionnent. */
const Music = (() => {
  const audio = new Audio('assets/vangelis.mp3');
  audio.loop = true;
  audio.preload = 'none';
  let fileOk = true, mode = 'file', playing = false, muted = false;
  let volume = parseFloat(ls.get('volume'));
  if (Number.isNaN(volume)) volume = 0.5;
  let ctx = null, master = null;

  const level = () => (muted ? 0 : volume);

  function applyVolume() {
    audio.volume = level();
    if (master) master.gain.setTargetAtTime(level() * 0.6, ctx.currentTime, 0.05);
  }

  function startSynth() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = level() * 0.6;
      master.connect(ctx.destination);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 1000;
      lowpass.connect(master);
      [110, 164.81, 220, 277.18, 329.63, 440].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = i % 2 ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        osc.detune.value = (i - 2) * 4;
        const g = ctx.createGain();
        g.gain.value = 0.1;
        const lfo = ctx.createOscillator();      // respiration lente
        lfo.frequency.value = 0.05 + i * 0.03;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.07;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        osc.connect(g);
        g.connect(lowpass);
        osc.start();
        lfo.start();
      });
    }
    ctx.resume();
  }

  async function play() {
    if (fileOk) {
      try { await audio.play(); mode = 'file'; playing = true; return; }
      catch (e) {
        if (e && e.name === 'NotAllowedError') return;
        fileOk = false;                           // fichier introuvable → synthé
      }
    }
    startSynth();
    mode = 'synth';
    playing = true;
  }
  function pause() {
    if (mode === 'file') audio.pause(); else if (ctx) ctx.suspend();
    playing = false;
  }
  function stop() {
    if (mode === 'file') { audio.pause(); audio.currentTime = 0; } else if (ctx) ctx.suspend();
    playing = false;
  }
  function setVolume(v) { volume = v; muted = false; ls.set('volume', v); applyVolume(); }
  function toggleMute() { muted = !muted; applyVolume(); return muted; }

  audio.volume = level();
  return {
    play, pause, stop, setVolume, toggleMute,
    get playing() { return playing; },
    get mode() { return mode; },
    get muted() { return muted; },
    get volume() { return volume; }
  };
})();

function renderMusic() {
  $('#musicToggle').textContent = Music.playing ? '⏸' : '▶';
  $('#musicMute').textContent = Music.muted || Music.volume === 0 ? '🔇' : '🔊';
  let txt = 'En pause';
  if (Music.playing) {
    txt = Music.mode === 'file'
      ? 'Lecture : assets/vangelis.mp3'
      : 'assets/vangelis.mp3 introuvable → ambiance synthétique de secours';
  }
  $('#musicStatus').textContent = txt;
}
$('#musicToggle').addEventListener('click', async () => {
  if (Music.playing) 
    Music.pause(); 
  else 
    await Music.play();
  renderMusic();
});
$('#musicStop').addEventListener('click', () => { Music.stop(); renderMusic(); });
$('#musicMute').addEventListener('click', () => { Music.toggleMute(); renderMusic(); });
$('#volume').addEventListener('input', e => { Music.setVolume(parseFloat(e.target.value)); renderMusic(); });
$('#missionVideo source').addEventListener('error', () => { $('#videoHint').hidden = false; });

/* ---------- 4. CARTE INTERACTIVE ---------- */
const SITES = [
  { name: 'Centre spatial Kennedy', country: 'États-Unis (Floride)', lat: 28.5729, lng: -80.6490, desc: 'Base de lancement des missions Apollo et des navettes spatiales.' },
  { name: 'Johnson Space Center', country: 'États-Unis (Houston)', lat: 29.5518, lng: -95.0970, desc: 'Centre de contrôle des vols habités de la NASA.' },
  { name: 'Centre spatial guyanais', country: 'France (Kourou)', lat: 5.2322, lng: -52.7693, desc: "Port spatial de l'Europe : décollage d'Ariane et de Vega." },
  { name: 'Cité de l\'espace', country: 'France (Toulouse)', lat: 43.5864, lng: 1.4934, desc: "Parc de découverte consacré à l'exploration spatiale." },
  { name: 'ESTEC (ESA)', country: 'Pays-Bas (Noordwijk)', lat: 52.2182, lng: 4.4203, desc: "Principal centre technique de l'Agence spatiale européenne." },
  { name: 'Cosmodrome de Baïkonour', country: 'Kazakhstan', lat: 45.9650, lng: 63.3050, desc: 'Premier cosmodrome du monde : Spoutnik et Gagarine y ont décollé.' },
  { name: 'Satish Dhawan', country: 'Inde (Sriharikota)', lat: 13.7199, lng: 80.2304, desc: "Site de lancement de l'agence spatiale indienne (ISRO)." },
  { name: 'Jiuquan', country: 'Chine', lat: 40.9606, lng: 100.2984, desc: 'Cosmodrome des vols habités chinois.' },
  { name: 'Tanegashima', country: 'Japon', lat: 30.4000, lng: 130.9700, desc: "Centre spatial japonais, sur une île du sud du pays." },
  { name: 'Observatoire du Paranal', country: 'Chili', lat: -24.6272, lng: -70.4045, desc: 'Abrite le Very Large Telescope, au cœur du désert d\'Atacama.' },
  { name: 'Mauna Kea', country: 'États-Unis (Hawaï)', lat: 19.8206, lng: -155.4681, desc: "Sommet à plus de 4 000 m couvert d'observatoires astronomiques." }
];

let map = null, userMarker = null;

function initMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 60); return; }
  const box = $('#map');
  if (typeof L === 'undefined') {
    box.innerHTML = '<p class="hint" style="padding:1rem">La carte (Leaflet) n\'a pas pu être chargée : vérifie ta connexion internet.</p>';
    return;
  }
  map = L.map('map', { worldCopyJump: true }).setView([25, 10], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const icon = L.divIcon({ className: 'rocket-pin', html: '🚀', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
  SITES.forEach(s => {
    s.marker = L.marker([s.lat, s.lng], { icon, title: s.name }).addTo(map);
    const pop = document.createElement('div');
    const b = document.createElement('b'); b.textContent = s.name;
    const c = document.createElement('i'); c.textContent = s.country;
    const d = document.createElement('span'); d.textContent = s.desc;
    pop.append(b, document.createElement('br'), c, document.createElement('br'), d);
    s.marker.bindPopup(pop);
  });
  showUserMarker(false);
  setTimeout(() => map.invalidateSize(), 60);
}

function showUserMarker(fly) {
  const pos = ls.getJSON('position');
  if (!map || !pos || typeof L === 'undefined') return;
  if (userMarker) map.removeLayer(userMarker);
  const icon = L.divIcon({ className: 'rocket-pin', html: '📍', iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26] });
  userMarker = L.marker([pos.lat, pos.lng], { icon }).addTo(map).bindPopup(`Tu es ici, ${getPseudo()} !`);
  if (fly) map.flyTo([pos.lat, pos.lng], 5);
}

function buildSiteChips() {
  const list = $('#siteList');
  SITES.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = s.name;
    b.addEventListener('click', () => {
      initMap();
      if (map && s.marker) { map.flyTo([s.lat, s.lng], 6); s.marker.openPopup(); }
    });
    list.appendChild(b);
  });
}
$('#geoBtn').addEventListener('click', askGeolocation);

/* ---------- 5. DRAG & DROP « Classe le ciel » ---------- */
// Illustrations simples dessinées en SVG (originales, sans fichier externe)
const SVG = {
  mars: `<svg viewBox="0 0 100 100"><defs><radialGradient id="g-mars" cx="35%" cy="30%"><stop offset="0" stop-color="#ffa070"/><stop offset="1" stop-color="#8a2a10"/></radialGradient></defs>
    <circle cx="50" cy="50" r="36" fill="url(#g-mars)"/><circle cx="38" cy="44" r="5" fill="#0003"/><circle cx="60" cy="60" r="7" fill="#0002"/><circle cx="55" cy="35" r="3" fill="#0003"/>
    <ellipse cx="50" cy="18" rx="12" ry="4" fill="#fff" opacity=".8"/></svg>`,
  jupiter: `<svg viewBox="0 0 100 100"><defs><radialGradient id="g-jup" cx="35%" cy="30%"><stop offset="0" stop-color="#f6e0c0"/><stop offset="1" stop-color="#b9824f"/></radialGradient><clipPath id="c-jup"><circle cx="50" cy="50" r="38"/></clipPath></defs>
    <circle cx="50" cy="50" r="38" fill="url(#g-jup)"/>
    <g clip-path="url(#c-jup)"><rect x="0" y="26" width="100" height="7" fill="#a5663a" opacity=".6"/><rect x="0" y="42" width="100" height="9" fill="#8c5330" opacity=".55"/><rect x="0" y="60" width="100" height="6" fill="#a5663a" opacity=".6"/><rect x="0" y="72" width="100" height="5" fill="#8c5330" opacity=".5"/>
    <ellipse cx="62" cy="56" rx="8" ry="5" fill="#c4452b"/></g></svg>`,
  saturne: `<svg viewBox="0 0 100 100"><defs><radialGradient id="g-sat" cx="35%" cy="30%"><stop offset="0" stop-color="#fff0c2"/><stop offset="1" stop-color="#bd8c34"/></radialGradient></defs>
    <g transform="rotate(-18 50 50)"><ellipse cx="50" cy="50" rx="46" ry="12" fill="none" stroke="#e9d39a" stroke-width="5" opacity=".9"/>
    <circle cx="50" cy="50" r="27" fill="url(#g-sat)"/>
    <path d="M4 50 A46 12 0 0 0 96 50" fill="none" stroke="#e9d39a" stroke-width="5"/></g></svg>`,
  sirius: `<svg viewBox="0 0 100 100"><defs><radialGradient id="g-sir"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#cfe6ff"/><stop offset="1" stop-color="#5aa0ff" stop-opacity="0"/></radialGradient></defs>
    <circle cx="50" cy="50" r="46" fill="url(#g-sir)"/><path d="M50 4 L56 44 L96 50 L56 56 L50 96 L44 56 L4 50 L44 44Z" fill="#eaf4ff" opacity=".9"/><circle cx="50" cy="50" r="9" fill="#fff"/></svg>`,
  betelgeuse: `<svg viewBox="0 0 100 100"><defs><radialGradient id="g-bet"><stop offset="0" stop-color="#ffd27a"/><stop offset=".55" stop-color="#ff5a1f"/><stop offset="1" stop-color="#b00020" stop-opacity="0"/></radialGradient></defs>
    <circle cx="50" cy="50" r="46" fill="url(#g-bet)"/><circle cx="42" cy="44" r="7" fill="#ffe7a8" opacity=".6"/><circle cx="60" cy="58" r="9" fill="#ff8a3d" opacity=".5"/></svg>`,
  andromede: `<svg viewBox="0 0 100 100"><defs><radialGradient id="g-and"><stop offset="0" stop-color="#fff6d6"/><stop offset=".4" stop-color="#9e8bff"/><stop offset="1" stop-color="#2a1b78" stop-opacity="0"/></radialGradient></defs>
    <g transform="rotate(-28 50 50)"><ellipse cx="50" cy="50" rx="47" ry="17" fill="url(#g-and)"/>
    <ellipse cx="50" cy="50" rx="38" ry="12" fill="none" stroke="#cbbcff" stroke-width="1.5" opacity=".7"/><ellipse cx="50" cy="50" rx="28" ry="8" fill="none" stroke="#cbbcff" stroke-width="1.5" opacity=".7"/>
    <ellipse cx="50" cy="50" rx="8" ry="5" fill="#fff6d6"/></g></svg>`
};

const ITEMS = [
  { id: 'mars', name: 'Mars', zone: 'solaire',
    ok: 'Mars est la « planète rouge », 4e planète du Système solaire.',
    wrong: 'Non, Mars est une planète de notre Système solaire, pas un objet lointain !' },
  { id: 'jupiter', name: 'Jupiter', zone: 'solaire',
    ok: 'Jupiter est la plus grosse planète du Système solaire.',
    wrong: 'Non, Jupiter est une planète géante qui orbite autour de notre Soleil !' },
  { id: 'saturne', name: 'Saturne', zone: 'solaire',
    ok: 'Saturne est célèbre pour ses magnifiques anneaux.',
    wrong: 'Non, Saturne est une planète du Système solaire, pas un astre lointain !' },
  { id: 'sirius', name: 'Sirius', zone: 'audela',
    ok: "Sirius est l'étoile la plus brillante du ciel nocturne, à environ 8,6 années-lumière.",
    wrong: 'Non, Sirius est une étoile lointaine, pas une planète !' },
  { id: 'betelgeuse', name: 'Bételgeuse', zone: 'audela',
    ok: "Bételgeuse est une supergéante rouge de la constellation d'Orion, à des centaines d'années-lumière.",
    wrong: 'Non, Bételgeuse est une étoile géante située très loin du Système solaire !' },
  { id: 'andromede', name: 'Andromède', zone: 'audela',
    ok: "La galaxie d'Andromède se trouve à environ 2,5 millions d'années-lumière.",
    wrong: 'Non, Andromède est une galaxie entière, à des millions d\'années-lumière !' }
];

const dnd = { placed: 0, errors: 0, selected: null };

function buildDnd() {
  const pool = $('#pool');
  pool.innerHTML = '';
  $$('.drops').forEach(d => { d.innerHTML = ''; });
  dnd.placed = 0; dnd.errors = 0; dnd.selected = null;
  updateDndCounters();
  setMsg($('#dndMsg'), '');

  shuffle(ITEMS).forEach(it => {
    const el = document.createElement('div');
    el.className = 'obj';
    el.id = 'obj-' + it.id;
    el.draggable = true;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = SVG[it.id] + `<span>${it.name}</span>`;
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', it.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('click', () => selectObj(it.id));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectObj(it.id); }
    });
    pool.appendChild(el);
  });
}

function updateDndCounters() {
  $('#dndErr').textContent = dnd.errors;
  $('#dndOk').textContent = dnd.placed;
}

function selectObj(id) {
  const el = $('#obj-' + id);
  if (!el || el.classList.contains('placed')) return;
  $$('.obj.selected').forEach(o => o.classList.remove('selected'));
  if (dnd.selected === id) { dnd.selected = null; return; }
  dnd.selected = id;
  el.classList.add('selected');
}

function placeObj(id, zoneKey) {
  const it = ITEMS.find(i => i.id === id);
  const el = $('#obj-' + id);
  if (!it || !el || el.classList.contains('placed')) return;
  el.classList.remove('selected');
  dnd.selected = null;

  if (it.zone === zoneKey) {
    el.classList.add('placed');
    el.draggable = false;
    $(`.zone[data-zone="${zoneKey}"] .drops`).appendChild(el);
    dnd.placed++;
    updateDndCounters();
    if (dnd.placed === ITEMS.length) {
      const bilan = dnd.errors === 0 ? 'sans aucune erreur' : `avec ${dnd.errors} erreur${dnd.errors > 1 ? 's' : ''}`;
      setMsg($('#dndMsg'), `🎉 Bravo ! ${getPseudo()}, tu as classé les 6 objets ${bilan}.`, 'ok');
    } else {
      setMsg($('#dndMsg'), '✅ Correct ! ' + it.ok, 'ok');
    }
  } else {
    dnd.errors++;
    updateDndCounters();
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 500);
    setMsg($('#dndMsg'), '❌ ' + it.wrong, 'bad');
  }
}

$$('.zone').forEach(zone => {
  const key = zone.dataset.zone;
  zone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('over'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    placeObj(e.dataTransfer.getData('text/plain'), key);
  });
  // Alternative tactile / clavier : sélectionner l'objet puis la zone
  zone.addEventListener('click', e => { if (dnd.selected && !e.target.closest('.obj')) placeObj(dnd.selected, key); });
  zone.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && dnd.selected) { e.preventDefault(); placeObj(dnd.selected, key); }
  });
});
$('#dndReset').addEventListener('click', buildDnd);

/* ---------- 6. QUIZ « Mission Astronaute » ---------- */
const QUESTIONS = [
  { q: 'Quelle est la planète la plus proche du Soleil ?', good: 'Mercure', bad: ['Vénus', 'Mars', 'La Terre'],
    why: 'Mercure orbite à environ 58 millions de km du Soleil.' },
  { q: 'Sur la Lune, ton poids serait environ…', good: 'six fois plus faible que sur Terre', bad: ['identique à celui sur Terre', 'deux fois plus grand', 'nul'],
    why: 'La gravité lunaire vaut environ 1/6 de la gravité terrestre : on y fait de grands bonds !' },
  { q: "Pourquoi les astronautes flottent-ils dans l'ISS ?", good: 'Ils sont en chute libre permanente autour de la Terre', bad: ["Il n'y a plus de gravité là-haut", "L'air de la station les soulève", 'Des aimants les attirent vers le plafond'],
    why: "À 400 km d'altitude, la gravité reste forte (près de 90 %) : la station et ses occupants tombent ensemble en orbite." },
  { q: 'Qui fut le premier humain dans l\'espace (1961) ?', good: 'Youri Gagarine', bad: ['Neil Armstrong', 'Buzz Aldrin', 'Thomas Pesquet'],
    why: 'Youri Gagarine a fait le tour de la Terre à bord de Vostok 1, le 12 avril 1961.' },
  { q: "En quelle année Apollo 11 a-t-elle posé des hommes sur la Lune ?", good: '1969', bad: ['1961', '1972', '1981'],
    why: 'Neil Armstrong et Buzz Aldrin ont marché sur la Lune le 20 juillet 1969.' },
  { q: 'Quelle est la plus grosse planète du Système solaire ?', good: 'Jupiter', bad: ['Saturne', 'Neptune', 'La Terre'],
    why: "Jupiter est si grosse qu'elle pourrait contenir plus de 1 000 Terres." },
  { q: "À quelle altitude orbite environ la Station spatiale internationale ?", good: '400 km', bad: ['40 km', '4 000 km', '40 000 km'],
    why: 'L\'ISS fait le tour de la Terre en environ 90 minutes, à environ 400 km d\'altitude.' },
  { q: "D'où décolle la fusée européenne Ariane ?", good: 'De Kourou, en Guyane', bad: ['De Cap Canaveral', 'De Baïkonour', 'De Toulouse'],
    why: 'Kourou est proche de l\'équateur : la rotation de la Terre y donne un coup de pouce aux lancements (retrouve-le sur la carte !).' }
];

const quiz = { order: [], i: 0, score: 0, locked: false };

function startQuiz() {
  quiz.order = shuffle(QUESTIONS);
  quiz.i = 0; quiz.score = 0; quiz.locked = false;
  $('#qBody').hidden = false;
  $('#qEnd').hidden = true;
  const last = ss.get('missionScore');
  $('#qLast').textContent = last !== null ? `Dernier score de la session : ${last}%` : '';
  showQuestion();
}

function showQuestion() {
  const total = quiz.order.length;
  const item = quiz.order[quiz.i];
  quiz.locked = false;
  $('#qCount').textContent = `Question ${quiz.i + 1} / ${total}`;
  $('#qBar').style.width = (quiz.i / total * 100) + '%';
  $('#qText').textContent = item.q;
  setMsg($('#qFeedback'), '');
  $('#qNext').hidden = true;
  const box = $('#qOptions');
  box.innerHTML = '';
  shuffle([item.good, ...item.bad]).forEach(text => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt'; b.textContent = text;
    b.addEventListener('click', () => answer(b, text === item.good, item));
    box.appendChild(b);
  });
}

function answer(btn, correct, item) {
  if (quiz.locked) return;
  quiz.locked = true;
  $$('.opt').forEach(o => { o.disabled = true; if (o.textContent === item.good) o.classList.add('good'); });
  if (correct) {
    quiz.score++;
    setMsg($('#qFeedback'), '✅ Bonne réponse ! ' + item.why, 'ok');
  } else {
    btn.classList.add('wrong');
    setMsg($('#qFeedback'), '❌ Pas tout à fait. ' + item.why, 'bad');
  }
  const lastQ = quiz.i === quiz.order.length - 1;
  $('#qNext').textContent = lastQ ? 'Voir mon résultat 🚀' : 'Question suivante →';
  $('#qNext').hidden = false;
}

function endQuiz() {
  const total = quiz.order.length;
  const pct = Math.round(quiz.score / total * 100);
  ss.set('missionScore', String(pct));              // stockage dans le sessionStorage
  ss.set('missionDetail', `${quiz.score}/${total}`);
  $('#qBar').style.width = '100%';
  $('#qBody').hidden = true;
  $('#qEnd').hidden = false;
  $('#qCount').textContent = 'Mission terminée';
  $('#qEndMsg').textContent = `Bravo ${getPseudo()}, tu as réussi ${pct}% de ta mission !`;
  let sub = `${quiz.score} bonne${quiz.score > 1 ? 's' : ''} réponse${quiz.score > 1 ? 's' : ''} sur ${total}. `;
  sub += pct >= 80 ? 'Tout est prêt pour le décollage ! 🚀'
    : pct >= 50 ? 'Encore un peu d\'entraînement avant le décollage.'
    : 'Retourne à l\'entraînement, astronaute : tu peux refaire la mission !';
  $('#qEndSub').textContent = sub;
}

$('#qNext').addEventListener('click', () => {
  if (quiz.i === quiz.order.length - 1) endQuiz();
  else { quiz.i++; showQuestion(); }
});
$('#qRestart').addEventListener('click', startQuiz);

/* ---------- 7. PENDU ---------- */
const WORDS = ['PLANETE', 'FUSEE', 'ETOILE', 'GALAXIE', 'COMETE', 'LUNE', 'SOLEIL', 'ASTRONAUTE', 'SATELLITE', 'ORBITE'];
const MAX_ERRORS = 6;
const hang = { word: '', found: new Set(), errors: 0, over: false, lastWord: '' };

function buildKeyboard() {
  const kb = $('#hKeys');
  kb.innerHTML = '';
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'key'; b.textContent = letter; b.dataset.letter = letter;
    b.addEventListener('click', () => guess(letter));
    kb.appendChild(b);
  }
}

function renderWord() {
  const box = $('#hWord');
  box.innerHTML = '';
  [...hang.word].forEach(ch => {
    const s = document.createElement('span');
    s.textContent = hang.found.has(ch) || hang.over && hang.errors >= MAX_ERRORS ? ch : '_';
    box.appendChild(s);
  });
  box.setAttribute('aria-label', 'Mot à deviner : ' + [...hang.word].map(ch => hang.found.has(ch) ? ch : 'lettre cachée').join(' '));
}

function startHangman() {
  let pool = WORDS.filter(w => w !== hang.lastWord);
  hang.word = pool[Math.floor(Math.random() * pool.length)];
  hang.lastWord = hang.word;
  hang.found = new Set(); hang.errors = 0; hang.over = false;
  $$('#rocket [id^="rk-"]').forEach(p => p.classList.remove('gone'));
  $$('.key').forEach(k => { k.disabled = false; k.classList.remove('hit', 'miss'); });
  $('#hLeft').textContent = MAX_ERRORS;
  setMsg($('#hMsg'), '');
  renderWord();
}

function guess(letter) {
  if (hang.over) return;
  const key = $(`.key[data-letter="${letter}"]`);
  if (!key || key.disabled) return;
  key.disabled = true;                                  // le bouton cliqué est désactivé

  if (hang.word.includes(letter)) {
    hang.found.add(letter);
    key.classList.add('hit');
  } else {
    hang.errors++;
    key.classList.add('miss');
    const part = $('#rk-' + hang.errors);               // une partie de la fusée disparaît
    if (part) part.classList.add('gone');
    $('#hLeft').textContent = MAX_ERRORS - hang.errors;
  }

  const won = [...hang.word].every(ch => hang.found.has(ch));
  const lost = hang.errors >= MAX_ERRORS;
  if (won || lost) endHangman(won);
  else renderWord();
}

function endHangman(won) {
  hang.over = true;
  $$('.key').forEach(k => { k.disabled = true; });
  renderWord();
  if (won) setMsg($('#hMsg'), `🎉 Bravo ${getPseudo()} !`, 'ok');
  else setMsg($('#hMsg'), `💥 Perdu ! Le mot était : ${hang.word}`, 'bad');
  ls.setJSON('scorePendu', {
    resultat: won ? 'gagné' : 'perdu',
    erreurs: hang.errors,
    mot: hang.word,
    date: new Date().toLocaleString('fr-FR')
  });
  renderLastHangman();
}

function renderLastHangman() {
  const s = ls.getJSON('scorePendu');
  $('#hLast').textContent = s
    ? `Dernier score : ${s.resultat} (${s.erreurs} erreur${s.erreurs > 1 ? 's' : ''}) — ${s.mot}`
    : 'Pas encore de partie jouée';
}

$('#hReplay').addEventListener('click', startHangman);
// Clavier physique (uniquement quand la vue Pendu est visible)
document.addEventListener('keydown', e => {
  if ($('#view-pendu').hidden || dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[a-zA-Z]$/.test(e.key)) guess(e.key.toUpperCase());
});

/* ---------- 8. DÉMARRAGE ---------- */
function buildStars() {
  const box = $('#starfield');
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('span');
    s.className = 'star';
    const size = (Math.random() * 2.2 + 0.8).toFixed(1);
    s.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;` +
      `width:${size}px;height:${size}px;animation-delay:${(Math.random() * 4).toFixed(2)}s;` +
      `animation-duration:${(2 + Math.random() * 3).toFixed(2)}s`;
    box.appendChild(s);
  }
}

function init() {
  buildStars();
  applyTheme(ls.get('theme') === 'light' ? 'light' : 'dark');
  applyBrightness(ls.get('luminosite') || 100);
  $('#volume').value = Music.volume;
  renderMusic();
  buildSiteChips();
  buildDnd();
  startQuiz();
  buildKeyboard();
  startHangman();
  renderLastHangman();
  renderProfile();
  showView((location.hash || '#accueil').slice(1));
  if (!hasProfile()) openProfile(true);               // 1er chargement : on demande l'identité
}
init();
