# GranaFarm — Aplicație de comenzi legume 🥬

Aplicație web simplă prin care clienții (restaurante, magazine alimentare, distribuitori angro, persoane fizice) pot plasa comenzi de legume proaspete direct de la seră, iar proprietarul le poate gestiona dintr-un panou de administrare.

Totul este în limba română, optimizat pentru telefon și desktop.

## 🔗 Demo online

Versiunea demonstrativă rulează pe GitHub Pages: **https://icemusike.github.io/granafarm-order/**

Demo-ul folosește aceeași interfață, dar datele (comenzi, produse, facturi) se salvează doar în browserul curent (`demo/demo-api.js` înlocuiește serverul cu localStorage). Pentru comenzi reale, partajate între clienți și administrator, instalați versiunea cu server de mai jos.

## Funcționalități

### Pentru clienți — pagina principală (`/`)
- Catalog de produse cu prețuri și unități de măsură (kg, bucată, legătură)
- Alegerea cantității pentru fiecare produs, cu sumar și total calculat automat, plus bară de coș fixă cu totalul
- Formular cu date de contact și livrare: nume, firmă, CUI (pentru factură), tip client, telefon, email, localitate, adresă de livrare, data dorită de livrare, observații
- Confirmare cu număr de comandă după trimitere

### Pentru proprietar — panoul de administrare (`/admin`)
- Protejat cu parolă
- Statistici: comenzi noi, comenzi primite azi, valoarea comenzilor în lucru
- Lista comenzilor cu filtrare după status și detalii complete (produse, cantități, date de livrare, telefon apelabil)
- Schimbarea statusului fiecărei comenzi: **Nouă → Confirmată → În livrare → Livrată** (sau Anulată)
- Gestionarea catalogului: adăugare / modificare / ștergere produse, actualizare prețuri, marcarea produselor ca indisponibile
- **Facturare**: emiterea facturii direct din comandă (serie și numerotare automată, defalcare bază de impozitare + TVA), listă cu toate facturile, printare / salvare ca PDF din browser
- **Date firmă** configurabile din panou: denumire, CUI, Reg. Com., adresă, IBAN, seria facturilor, cota TVA
- **Jurnal SMS** cu toate notificările trimise

## Notificări SMS

- **Comandă nouă** → SMS către proprietar (telefonul se setează în panoul de administrare, secțiunea „Date firmă")
- **Comandă confirmată** → SMS către client, trimis automat (o singură dată) când schimbați statusul în „Confirmată"

Trimiterea reală se face prin [Twilio](https://www.twilio.com). Fără credențiale, aplicația rulează în **mod simulat**: mesajele apar doar în jurnalul din panoul de administrare și în consolă — util pentru testare.

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxx \
TWILIO_AUTH_TOKEN=xxxxxxxx \
TWILIO_FROM=+40xxxxxxxxx \
npm start
```

Numerele românești sunt normalizate automat la formatul internațional (07xx… → +407xx…).

## Facturare

Prețurile din catalog **includ TVA**. La emiterea facturii, aplicația defalcă automat baza de impozitare și TVA-ul conform cotei setate în „Date firmă" (implicit 11%). Facturile primesc serie + număr secvențial (ex. `GF-0001`), se pot deschide oricând din secțiunea „Facturi" și se printează sau se salvează ca PDF direct din browser.

## Instalare și pornire

Necesită [Node.js](https://nodejs.org) versiunea 18 sau mai nouă.

```bash
npm install
npm start
```

Aplicația pornește pe [http://localhost:3000](http://localhost:3000).

- Pagina de comandă: `http://localhost:3000/`
- Panoul de administrare: `http://localhost:3000/admin`

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
   - *(opțional, pentru SMS real)* `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
7. La serviciul web → **Settings → Networking → Generate Domain** pentru o adresă publică (ex. `granafarm-order-production.up.railway.app`). Gata de comenzi!

Costuri orientative pe Railway: consum măsurat, tipic ~5–10 $/lună pentru un trafic mic (server + Postgres). Există un credit lunar gratuit pentru început.

> **Verificare rapidă:** deschideți `https://ADRESA/healthz` — trebuie să răspundă `{"ok":true,"storage":"postgres"}`. Dacă apare `"storage":"json"`, înseamnă că `DATABASE_URL` nu este legat corect (datele NU ar fi durabile) — reveniți la pasul 5.

### Alternativă: Render (blueprint automat)

Repo-ul conține și `render.yaml`, care pe [render.com](https://render.com) creează serverul + baza PostgreSQL împreună: **New → Blueprint → alegeți repo-ul → Apply**. `DATABASE_URL` și `ADMIN_PASSWORD` se configurează automat.

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
demo/demo-api.js        — adaptor localStorage pentru demo-ul static (GitHub Pages)
railway.json           — configurație publicare Railway (recomandat)
render.yaml, Dockerfile — publicare pe Render / alte hosturi
data/db.json            — baza de date locală (doar dev, nu se versionează)
```
