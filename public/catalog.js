/* GranaFarm — catalog de soiuri (roșii). Randează grila de ansamblu și
   secțiunile de soi din datele de mai jos. „Specimenele" sunt roșii desenate
   în CSS, colorate după soi (fotografiile nu sunt necesare). */

const VARIETIES = [
  { name: 'De Grădină', origin: 'Soi românesc', size: 'Calibru mare', hi: '#ff7a5c', mid: '#C4302B', lo: '#8f221d',
    lead: 'Roșia copilăriei: fruct mare, ușor turtit, cu pulpă suculentă și parfum intens de grădină. Soiul care dă gustul autentic, „de altădată”, imposibil de găsit în comerțul de masă.',
    taste: 'Dulce-acrișor echilibrat, aromă intensă', texture: 'Pulpă suculentă, zemoasă, coajă fină',
    tags: ['Salate', 'Roșii umplute', 'Platouri cu felii'] },
  { name: 'Roz Dov', origin: 'Soi bulgăresc', size: 'Calibru mare', hi: '#ff9db6', mid: '#E06A8B', lo: '#b24568',
    lead: 'Roșie roz de tradiție bulgărească, cu fruct mare în formă de inimă. Pulpa densă și dulceața pronunțată, cu foarte puțină aciditate, o fac una dintre cele mai apreciate roșii de masă.',
    taste: 'Dulce, blând, aciditate foarte scăzută', texture: 'Pulpă densă, cărnoasă, coajă subțire',
    tags: ['Felii generoase', 'Salate', 'Sandvișuri'] },
  { name: 'Inimă de Bou', origin: 'Soi bulgăresc', size: 'Calibru mare', hi: '#ff8570', mid: '#D24B5A', lo: '#993541',
    lead: 'Fruct cordiform impunător, cu pulpă plină și foarte puține semințe. Feliile își păstrează forma perfect în farfurie — roșia de referință pentru bucătăriile care lucrează cu produse premium.',
    taste: 'Dulce, plin, cu note fine de fruct copt', texture: 'Untoasă, cărnoasă, aproape fără semințe',
    tags: ['Caprese', 'Carpaccio de roșii', 'Salate premium'] },
  { name: 'Inimă de Albagena', origin: 'Soi olandez', size: 'Calibru mare', hi: '#ff7d63', mid: '#C0392B', lo: '#8a281f',
    lead: 'Varianta olandeză a inimii de bou: fructe striate, uniforme ca mărime, cu aceeași pulpă bogată. Alegerea sigură când ai nevoie de calitate constantă, livrare după livrare.',
    taste: 'Dulce echilibrat, aromă curată de roșie', texture: 'Fermă, cărnoasă, felii care nu se desfac',
    tags: ['Platouri', 'Salate', 'Bruschete'] },
  { name: 'Roz Rose', origin: 'Soi sârbesc', size: 'Calibru mediu', hi: '#ffa8c0', mid: '#DE7B9A', lo: '#b25876',
    lead: 'Roșie roz rotundă din tradiția sârbească, de calibru mediu. Suculentă și parfumată, cu un echilibru fin între dulceață și prospețime — versatilă în orice bucătărie.',
    taste: 'Dulce-proaspăt, aromă delicată de roz', texture: 'Suculentă, coajă fină, felii uniforme',
    tags: ['Salate', 'Sandvișuri', 'Gazpacho'] },
  { name: 'De Buzău', origin: 'Soi românesc', size: 'Calibru mediu', hi: '#ff6f54', mid: '#B83227', lo: '#84231b',
    lead: 'Soi românesc creat la Buzău, cu fructe rotunde, ferme și productive. Pulpa densă, cu puține semințe și gust clasic, ușor acrișor, îl face ideal pentru gătit — de la ciorbe la sosuri.',
    taste: 'Clasic, echilibrat, cu aciditate plăcută', texture: 'Pulpă densă, fermă, puține semințe',
    tags: ['Sosuri & passata', 'Bulion', 'Ciorbe'] },
  { name: 'Negre de Crimeea', origin: 'Hibrid', size: 'Calibru mic', hi: '#a35a4a', mid: '#6B2D2A', lo: '#43201f',
    lead: 'Culoare vișinie-închisă, spre negru, și un gust care nu seamănă cu nimic altceva: intens, dulce, cu o notă fină afumată. Roșia care transformă o farfurie simplă într-una memorabilă.',
    taste: 'Intens, dulce, cu notă ușor afumată', texture: 'Moale, suculentă, se servește proaspătă',
    tags: ['Salate gourmet', 'Tartine', 'Decor de farfurie'] },
  { name: 'Tolstoi', origin: 'Hibrid olandez', size: 'Calibru mic', hi: '#ff7a5f', mid: '#CE3B2E', lo: '#932921',
    lead: 'Hibrid olandez de ciorchine, cu fructe rotunde, perfect calibrate. Fermitatea și feliile uniforme îl fac soiul de lucru al bucătăriilor rapide — aceeași roșie, în fiecare zi.',
    taste: 'Viu, echilibrat, prospețime constantă', texture: 'Fermă, felii care nu înmoaie chifla',
    tags: ['Burgeri', 'Sandvișuri', 'Mic dejun'] },
  { name: 'Roma', origin: 'Soi italian', size: 'Calibru mediu', hi: '#ff8352', mid: '#D0432A', lo: '#96301d',
    lead: 'Prunișoara italiană clasică: alungită, cu pulpă densă, foarte puține semințe și puțină apă. Se reduce rapid și dă sosuri concentrate, cu culoare bogată — standardul pentru pizza și passata.',
    taste: 'Dulceag, concentrat, aciditate joasă', texture: 'Densă, uscată, aproape fără semințe',
    tags: ['Sos & pizza', 'Passata', 'Roșii confiate'] },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tomatoStyle = (v) => `--t-hi:${v.hi};--t:${v.mid};--t-lo:${v.lo}`;

// grila de ansamblu (4 · privire de ansamblu)
document.getElementById('ov-grid').innerHTML = VARIETIES.map((v) => `
  <div class="ov-card">
    <div class="tomato" style="${tomatoStyle(v)}"></div>
    <div>
      <div class="ov-name">${esc(v.name)}</div>
      <div class="ov-tag">${esc(v.origin.replace('Soi ', ''))} · ${esc(v.size.replace('Calibru ', ''))}</div>
    </div>
  </div>`).join('');

// secțiunile de soi (5..13)
document.getElementById('varieties').innerHTML = VARIETIES.map((v) => `
  <section class="variety">
    <div class="variety-in">
      <div class="variety-visual"><div class="tomato" style="${tomatoStyle(v)}"></div></div>
      <div class="variety-body">
        <div class="kicker">${esc(v.origin)} · ${esc(v.size)}</div>
        <h2>${esc(v.name)}</h2>
        <p class="lead">${esc(v.lead)}</p>
        <div class="specs">
          <div class="spec"><span class="k">Gust</span><span class="v">${esc(v.taste)}</span></div>
          <div class="spec"><span class="k">Textură</span><span class="v">${esc(v.texture)}</span></div>
        </div>
        <div class="tags">${v.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
    </div>
  </section>`).join('');
