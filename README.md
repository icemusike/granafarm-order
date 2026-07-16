# GranaFarm — Aplicație de comenzi legume 🥬

Aplicație web simplă prin care clienții (restaurante, magazine alimentare, distribuitori angro, persoane fizice) pot plasa comenzi de legume proaspete direct de la seră, iar proprietarul le poate gestiona dintr-un panou de administrare.

Totul este în limba română, optimizat pentru telefon și desktop.

## 🔗 Demo online

Versiunea demonstrativă rulează pe GitHub Pages: **https://icemusike.github.io/granafarm-order/**

Demo-ul folosește aceeași interfață, dar datele (comenzi, produse, facturi) se salvează doar în browserul curent (`demo/demo-api.js` înlocuiește serverul cu localStorage). Pentru comenzi reale, partajate între clienți și administrator, instalați versiunea cu server de mai jos.

## Funcționalități

### Pentru clienți — pagina principală (`/`)
- Catalog cu fotografii, căutare fără diferențe de diacritice, filtre pe categorii și secțiuni pliabile
- Stoc, disponibilitatea recoltei, ambalare, cantitate minimă și termen estimat afișate pentru fiecare produs
- Coș dedicat, păstrat în browser la reîncărcarea paginii și reconciliat cu prețurile și disponibilitatea curentă
- Livrare gratuită, oră-limită, zile lucrătoare și intervale selectabile
- Pin exact de livrare pe Google Maps (când este configurată cheia de browser)
- Checkout scurt, cu validare accesibilă direct lângă câmp și datele firmei afișate numai când sunt necesare
- **„Ține minte datele mele"**: la o comandă viitoare de pe același telefon/computer, formularul se completează automat cu datele anterioare (nume, firmă, CUI, telefon, email, adresă) — clientul poate șterge oricând datele salvate cu un link „Nu sunt eu"
- Bifă opțională „Vreau să primesc oferte prin email" (marketing)
- Confirmare imediată prin interfață și SMS/email, cu link privat pentru urmărirea statusului
- „Comandă din nou” pentru restaurante, magazine și clienți angro, folosind produsele și prețurile disponibile acum

### Pentru proprietar — panoul de administrare (`/admin`)
Protejat cu parolă, organizat pe secțiuni cu navigare:

- **📋 Comenzi** — lista comenzilor cu filtrare după status, detalii complete (produse, cantități, date de livrare, telefon apelabil), schimbarea statusului **Nouă → Confirmată → În livrare → Livrată** (sau Anulată)
- **👥 Clienți** — fișe CRM cu istoric, produse preferate, restanțe și notițe interne; o comandă nouă poate fi plasată direct pentru un client salvat, cu preț negociat pe produs și/sau discount procentual, iar comenzile primite anterior prin telefon/WhatsApp pot fi adăugate în modul istoric, cu dată din trecut, status Livrată și plată opțională
- **📊 Statistici** — total comenzi, valoare vânzări, comenzi primite azi, comenzi scadente (livrare azi sau depășită), cu grafice pe zile și filtrare pe interval: Azi, Ieri, Săptămâna/Luna aceasta sau trecută, interval personalizat, tot timpul (implicit: ultimele 7 zile)
- **🥕 Produse** — catalog cu categorii, descrieri, prețuri, unități de măsură și disponibilitate
- **🧾 Facturi** — emitere automată cu serie și numerotare, defalcare bază de impozitare + TVA, printare / salvare PDF din browser
- **⚙️ Configurare** — date firmă și facturare, configurare email (Postmark), marketing prin email (export CSV clienți abonați), șabloane SMS editabile
- **🔌 Integrări** — configurare Twilio (SMS) direct din panou, cu test de trimitere și jurnal complet

## Notificări SMS și email

- **Comandă nouă** → SMS + email către proprietar (se setează în Configurare → Date firmă)
- **Comandă confirmată** → SMS + email către client, trimise automat (o singură dată) când schimbați statusul în „Confirmată"

Textul mesajelor SMS este editabil din **Configurare → Șabloane SMS**, cu token-uri `{number} {name} {company} {total} {city} {phone} {deliveryDate}`.

Integrările se pot configura **fie din panoul de administrare** (Configurare → Email, Integrări → Twilio — recomandat, nu necesită redeploy), **fie prin variabile de mediu** pe host (utile ca fallback):

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxx TWILIO_AUTH_TOKEN=xxxxxxxx TWILIO_FROM=+40xxxxxxxxx npm start
```

Configurarea din panou are prioritate față de variabilele de mediu. Fără nimic configurat, SMS-urile și email-urile rulează în **mod simulat** — se scriu doar în jurnalele din panou, utile pentru testare. Numerele românești sunt normalizate automat la formatul internațional (07xx… → +407xx…).

## Facturare

Prețurile din catalog **includ TVA**. La emiterea facturii, aplicația defalcă automat baza de impozitare și TVA-ul conform cotei setate în „Date firmă" (implicit 11%). Facturile primesc serie + număr secvențial (ex. `GF-0001`), se pot deschide oricând din secțiunea „Facturi" și se printează sau se salvează ca PDF direct din browser.

## Instalare și pornire

Pentru harta de livrare, adaugă `GOOGLE_MAPS_BROWSER_API_KEY` în `.env` (sau din Admin → Integrări → Google Maps). Proiectul Google Cloud **trebuie să aibă Billing activ**; fără facturare apare `BillingNotEnabledMapError` / „Pagina nu poate încărca corect Google Maps". Activați Maps JavaScript API, Places API și Geocoding API, apoi restricționați cheia prin HTTP referrer la domeniul aplicației (plus `http://localhost:*` pentru dezvoltare).

Necesită [Node.js](https://nodejs.org) versiunea 18 sau mai nouă.

```bash
npm install
npm start
```

Aplicația pornește pe [http://localhost:3000](http://localhost:3000).

- Pagina de comandă: `http://localhost:3000/`
- Panoul de administrare: `http://localhost:3000/admin`

Testele de integrare pentru prețuri, reguli de livrare, notificare și urmărirea privată rulează cu:

```bash
npm test
```

### Parola de administrare

Parola implicită este **`granafarm2026`**. Pentru producție, setați-o prin variabila de mediu `ADMIN_PASSWORD`:

```bash
ADMIN_PASSWORD=parola-mea-secreta npm start
```

Portul se poate schimba cu variabila `PORT` (implicit 3000).

## Baza de date

Aplicația alege automat backend-ul de stocare:

- **PostgreSQL** — în producție, când variabila `DATABASE_URL` este setată. Datele (comenzi, facturi, produse, setări) sunt durabile și incluse în backup-urile bazei de date.
- **Fișier JSON local** (`data/db.json`) — pentru dezvoltare, când `DATABASE_URL` **nu** este setat. Potrivit doar pentru testare pe un singur calculator.

⚠️ **Nu folosiți modul fișier JSON în producție pe hosturi cloud** — discul acestora se șterge la fiecare repornire. În producție folosiți întotdeauna PostgreSQL.

Catalogul inițial (9 soiuri de roșii, legume, fructe, conserve din roșii, dulcețuri și siropuri, murături) se însămânțează automat la prima pornire, o singură dată. Dulcețurile și siropul de zmeură sunt incluse **fără preț confirmat** (indisponibile) — setați prețul și marcați-le ca disponibile din panoul de administrare.

## 🚀 Publicare în producție (Railway + PostgreSQL)

Pași (o singură dată, ~5 minute):

1. Asigurați-vă că repo-ul este pe GitHub.
2. Creați cont pe [railway.app](https://railway.app) și conectați-l cu GitHub.
3. **New Project → Deploy from GitHub repo** → alegeți `granafarm-order`. Railway citește `railway.json` și pornește serverul.
4. În proiect: **New → Database → Add PostgreSQL**. Railway creează baza de date și oferă automat variabila `DATABASE_URL`.
5. Legați baza de serviciul web: la serviciul `granafarm-order` → **Variables** → **New Variable → Add Reference** → alegeți `DATABASE_URL` din serviciul Postgres. (Pe Railway, referința se face de obicei automat în același proiect.)
6. Tot la **Variables**, adăugați:
   - `ADMIN_PASSWORD` = o parolă sigură aleasă de dumneavoastră (obligatorie).
   - `APP_BASE_URL` = adresa HTTPS publică a aplicației, fără `/` la final (recomandat pentru linkurile private de urmărire, ex. `https://comenzi.granafarm.ro`).
   - *(opțional, pentru SMS real)* `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
7. La serviciul web → **Settings → Networking → Generate Domain** pentru o adresă publică (ex. `granafarm-order-production.up.railway.app`). Gata de comenzi!

Costuri orientative pe Railway: consum măsurat, tipic ~5–10 $/lună pentru un trafic mic (server + Postgres). Există un credit lunar gratuit pentru început.

> **Verificare rapidă:** deschideți `https://ADRESA/healthz` — trebuie să răspundă `{"ok":true,"storage":"postgres"}`. Dacă apare `"storage":"json"`, înseamnă că `DATABASE_URL` nu este legat corect (datele NU ar fi durabile) — reveniți la pasul 5.

### Alternativă: Render (blueprint automat)

Repo-ul conține și `render.yaml`, care pe [render.com](https://render.com) creează serverul + baza PostgreSQL împreună: **New → Blueprint → alegeți repo-ul → Apply**. `DATABASE_URL` și `ADMIN_PASSWORD` se configurează automat.

Render și Railway oferă automat domeniul public aplicației. Dacă folosiți un domeniu propriu sau un VPS, setați explicit `APP_BASE_URL` pentru ca mesajele de confirmare să conțină linkul HTTPS corect de urmărire.

### Activarea SMS-urilor reale (Twilio)

1. Creați cont pe [twilio.com](https://www.twilio.com) și obțineți un număr care poate trimite SMS către România (sau un *Alphanumeric Sender ID* „GranaFarm”, acceptat în România).
2. Din consola Twilio luați **Account SID**, **Auth Token** și numărul expeditor.
3. Adăugați în Variables (Railway/Render):
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM` (format internațional, ex. `+40…`, sau sender ID-ul)
4. Serviciul repornește și SMS-urile devin reale. Setați telefonul dumneavoastră în panoul de administrare („Date firmă → Telefon proprietar”) ca să primiți alerte la comenzi noi.

Cost aproximativ: ~0,05–0,08 $ / SMS către România. Fără aceste variabile, aplicația rămâne în mod simulat (mesajele apar doar în jurnalul din panou).

### Domeniu propriu (opțional)

Railway: serviciul web → **Settings → Networking → Custom Domain**, adăugați ex. `comenzi.granafarm.ro` și urmați instrucțiunile DNS. Certificatul HTTPS este emis automat.

### Backup și restaurare

Pentru un export manual al bazei oricând (Railway oferă `DATABASE_URL` în Variables):

```bash
pg_dump "$DATABASE_URL" > backup-granafarm.sql
```

## Alte hosturi (Docker)

Repo-ul include un `Dockerfile`. Pe orice server/VPS cu PostgreSQL:

```bash
docker build -t granafarm .
docker run -d -p 3000:3000 \
  -e DATABASE_URL="postgres://user:parola@host:5432/granafarm" \
  -e ADMIN_PASSWORD="parola-sigura" \
  -e APP_BASE_URL="https://comenzi.granafarm.ro" \
  -e TWILIO_ACCOUNT_SID=... -e TWILIO_AUTH_TOKEN=... -e TWILIO_FROM=... \
  granafarm
```

## Structura proiectului

```
server.js               — serverul Express + rutele API
lib/storage.js          — alege backend-ul (Postgres sau JSON)
lib/storage-postgres.js — stocare PostgreSQL (producție)
lib/storage-json.js     — stocare fișier JSON (dezvoltare)
lib/seed.js             — catalogul și setările inițiale
public/                 — interfața (pagina de comandă, panou admin, stiluri, logo)
public/track.html       — pagina privată de urmărire și refacere a comenzii
public/images/products/ — fotografiile optimizate ale familiilor de produse
test/                   — teste de integrare cu stocare JSON izolată
demo/demo-api.js        — adaptor localStorage pentru demo-ul static (GitHub Pages)
railway.json           — configurație publicare Railway (recomandat)
render.yaml, Dockerfile — publicare pe Render / alte hosturi
data/db.json            — baza de date locală (doar dev, nu se versionează)
```
