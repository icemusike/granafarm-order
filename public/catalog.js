/* GranaFarm, catalogul de produse. Randează grila de ansamblu și
   secțiunile de soi din datele de mai jos. Folosește fotografiile reale ale
   soiurilor din /images/products/. */

const VARIETIES = [
  { name: 'De Grădină', origin: 'Soi românesc', size: 'Calibru mare', img: '/images/products/de_gradina.png',
    lead: 'Roșia copilăriei: fruct mare, ușor turtit, cu pulpă suculentă și parfum intens de grădină. Soiul care dă gustul autentic, „de altădată”, imposibil de găsit în comerțul de masă.',
    taste: 'Dulce-acrișor echilibrat, aromă intensă', texture: 'Pulpă suculentă, zemoasă, coajă fină',
    tags: ['Salate', 'Roșii umplute', 'Platouri cu felii'] },
  { name: 'Roz Dov', origin: 'Soi bulgăresc', size: 'Calibru mare', img: '/images/products/roz_dov.png',
    lead: 'Roșie roz de tradiție bulgărească, cu fruct mare în formă de inimă. Pulpa densă și dulceața pronunțată, cu foarte puțină aciditate, o fac una dintre cele mai apreciate roșii de masă.',
    taste: 'Dulce, blând, aciditate foarte scăzută', texture: 'Pulpă densă, cărnoasă, coajă subțire',
    tags: ['Felii generoase', 'Salate', 'Sandvișuri'] },
  { name: 'Inimă de Bou', origin: 'Soi bulgăresc', size: 'Calibru mare', img: '/images/products/inima_de_bou.png',
    lead: 'Fruct cordiform impunător, cu pulpă plină și foarte puține semințe. Feliile își păstrează forma perfect în farfurie, roșia de referință pentru bucătăriile care lucrează cu produse premium.',
    taste: 'Dulce, plin, cu note fine de fruct copt', texture: 'Untoasă, cărnoasă, aproape fără semințe',
    tags: ['Caprese', 'Carpaccio de roșii', 'Salate premium'] },
  { name: 'Inimă de Albagena', origin: 'Soi olandez', size: 'Calibru mare', img: '/images/products/inima_de_albagena.png',
    lead: 'Varianta olandeză a inimii de bou: fructe striate, uniforme ca mărime, cu aceeași pulpă bogată. Alegerea sigură când ai nevoie de calitate constantă, livrare după livrare.',
    taste: 'Dulce echilibrat, aromă curată de roșie', texture: 'Fermă, cărnoasă, felii care nu se desfac',
    tags: ['Platouri', 'Salate', 'Bruschete'] },
  { name: 'Roz Rose', origin: 'Soi sârbesc', size: 'Calibru mediu', img: '/images/products/Roz_rose.png',
    lead: 'Roșie roz rotundă din tradiția sârbească, de calibru mediu. Suculentă și parfumată, cu un echilibru fin între dulceață și prospețime, versatilă în orice bucătărie.',
    taste: 'Dulce-proaspăt, aromă delicată de roz', texture: 'Suculentă, coajă fină, felii uniforme',
    tags: ['Salate', 'Sandvișuri', 'Gazpacho'] },
  { name: 'De Buzău', origin: 'Soi românesc', size: 'Calibru mediu', img: '/images/products/de_buzau.png',
    lead: 'Soi românesc creat la Buzău, cu fructe rotunde, ferme și productive. Pulpa densă, cu puține semințe și gust clasic, ușor acrișor, îl face ideal pentru gătit, de la ciorbe la sosuri.',
    taste: 'Clasic, echilibrat, cu aciditate plăcută', texture: 'Pulpă densă, fermă, puține semințe',
    tags: ['Sosuri & passata', 'Bulion', 'Ciorbe'] },
  { name: 'Negre de Crimeea', origin: 'Hibrid', size: 'Calibru mic', img: '/images/products/negre_de_crimeea.png',
    lead: 'Culoare vișinie-închisă, spre negru, și un gust care nu seamănă cu nimic altceva: intens, dulce, cu o notă fină afumată. Roșia care transformă o farfurie simplă într-una memorabilă.',
    taste: 'Intens, dulce, cu notă ușor afumată', texture: 'Moale, suculentă, se servește proaspătă',
    tags: ['Salate gourmet', 'Tartine', 'Decor de farfurie'] },
  { name: 'Tolstoi', origin: 'Hibrid olandez', size: 'Calibru mic', img: '/images/products/tolstoi.png',
    lead: 'Hibrid olandez de ciorchine, cu fructe rotunde, perfect calibrate. Fermitatea și feliile uniforme îl fac soiul de lucru al bucătăriilor rapide, aceeași roșie, în fiecare zi.',
    taste: 'Viu, echilibrat, prospețime constantă', texture: 'Fermă, felii care nu înmoaie chifla',
    tags: ['Burgeri', 'Sandvișuri', 'Mic dejun'] },
  { name: 'Roma', origin: 'Soi italian', size: 'Calibru mediu', img: '/images/products/roma.png',
    lead: 'Prunișoara italiană clasică: alungită, cu pulpă densă, foarte puține semințe și puțină apă. Se reduce rapid și dă sosuri concentrate, cu culoare bogată, standardul pentru pizza și passata.',
    taste: 'Dulceag, concentrat, aciditate joasă', texture: 'Densă, uscată, aproape fără semințe',
    tags: ['Sos & pizza', 'Passata', 'Roșii confiate'] },
];

// Legumele din seră, prezentate ca și soiurile de roșii, cu fotografii reale.
const VEGGIES = [
  { name: 'Ardei capia', origin: 'Legume din seră', size: 'Dulce · cărnos', img: '/images/products/ardei_capia.png',
    lead: 'Ardei alungit, roșu intens, cu pulpă groasă și dulce. Copt pe flacără sau grătar își dezvăluie toată aroma, vedeta zacuștilor și a salatelor de ardei copți.',
    taste: 'Dulce, intens, fără iuțeală', texture: 'Pulpă groasă, cărnoasă, coajă care se decojește ușor',
    tags: ['Ardei copți', 'Zacuscă', 'Salate'] },
  { name: 'Ardei gras alb', origin: 'Legume din seră', size: 'Crocant · versatil', img: '/images/products/ardei_gras_alb.png',
    lead: 'Ardei gras alb-gălbui, crocant și suculent, cu gust blând. La fel de bun proaspăt în salate, umplut la cuptor sau călit în mâncăruri.',
    taste: 'Blând, proaspăt, ușor dulceag', texture: 'Crocantă, suculentă, pereți groși',
    tags: ['Salate', 'Ardei umpluți', 'Gătit'] },
  { name: 'Ardei gogoșari', origin: 'Legume din seră', size: 'Dulce · aromat', img: '/images/products/gogosar_rosu.png',
    lead: 'Gogoșari roșii, rotunzi și zemoși, cu aromă dulce inconfundabilă. Clasicul murăturilor românești și al salatelor de toamnă.',
    taste: 'Dulce, aromat, ușor picant la coadă', texture: 'Cărnoasă, densă, perfectă pentru murat',
    tags: ['Murături', 'Salate', 'Conserve'] },
  { name: 'Castraveți cornișon', origin: 'Legume din seră', size: 'Mici · crocanți', img: '/images/products/castraveti_cornison.png',
    lead: 'Castraveți mici, fermi și crocanți, culeși la dimensiunea perfectă. Ideali pentru murat la borcan, dar la fel de buni proaspeți, în salate.',
    taste: 'Proaspăt, verde, fără amăreală', texture: 'Crocantă, fermă, semințe mici',
    tags: ['Murături', 'Salate', 'Gustări'] },
  { name: 'Vinete de grădină', origin: 'Legume din seră', size: 'Coapte pe rând', img: '/images/products/vinete_de_gradina.png',
    lead: 'Vinete lucioase, cu pulpă albă și cremoasă, fără gust amar. Coapte pe jar dau salata de vinete de altădată; excelente și la grătar sau în ghiveci.',
    taste: 'Blând, cremos, fără amăreală', texture: 'Pulpă fină, mătăsoasă după coacere',
    tags: ['Salată de vinete', 'Grătar', 'Ghiveci'] },
  { name: 'Fasole verde lată', origin: 'Legume din grădină', size: 'Fragedă · fără ață', img: '/images/products/fasole_verde_lata.png',
    lead: 'Păstăi late, galbene-untoase, culese tinere, fragede și fără ață. Baza mâncării de fasole scăzute, dar la fel de bune ca garnitură cu usturoi.',
    taste: 'Dulceag, fin, gust de unt', texture: 'Fragedă, se topește la gătit',
    tags: ['Mâncare de fasole', 'Garnituri', 'Salate calde'] },
  { name: 'Ceapă verde', origin: 'Legume din grădină', size: 'Legături proaspete', img: '/images/products/ceapa_verde.png',
    lead: 'Legături de ceapă verde crocantă, cu bulb alb și frunze fragede. Nelipsită lângă brânză și roșii, în salate sau presărată peste orice mâncare.',
    taste: 'Proaspăt, ușor iute, aromat', texture: 'Crocantă, suculentă',
    tags: ['Salate', 'Garnituri', 'Mic dejun'] },
  { name: 'Cartofi roz', origin: 'Legume din grădină', size: 'Coajă subțire', img: '/images/products/cartofi_roz.png',
    lead: 'Cartofi cu coajă roz-trandafirie și miez gălbui, fermi la fiert. Nu se sfărâmă, perfecți pentru salate, cartofi noi cu mărar sau la cuptor.',
    taste: 'Plin, ușor dulceag', texture: 'Fermă la fiert, cremoasă la copt',
    tags: ['Salate de cartofi', 'La cuptor', 'Garnituri'] },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// grila de ansamblu (4 · privire de ansamblu)
document.getElementById('ov-grid').innerHTML = VARIETIES.map((v) => `
  <div class="ov-card">
    <img class="variety-photo" src="${esc(v.img)}" alt="Roșii ${esc(v.name)}" loading="lazy">
    <div>
      <div class="ov-name">${esc(v.name)}</div>
      <div class="ov-tag">${esc(v.origin.replace('Soi ', ''))} · ${esc(v.size.replace('Calibru ', ''))}</div>
    </div>
  </div>`).join('');

// blocurile de prezentare, folosite atât pentru soiuri de roșii, cât și
// pentru legume
function varietySectionsHtml(list, altPrefix) {
  return list.map((v) => `
  <section class="variety">
    <div class="variety-in">
      <div class="variety-visual"><img class="variety-photo" src="${esc(v.img)}" alt="${esc(altPrefix)} ${esc(v.name)}" loading="lazy"></div>
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
}

// secțiunile de soi (5..13)
document.getElementById('varieties').innerHTML = varietySectionsHtml(VARIETIES, 'Roșii');

// legumele din seră
document.getElementById('veggies').innerHTML = varietySectionsHtml(VEGGIES, '');
