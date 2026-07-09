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

## Datele

Comenzile și produsele sunt salvate în fișierul `data/db.json` (creat automat la prima pornire, cu catalogul GranaFarm organizat pe categorii: 9 soiuri de roșii, legume, fructe, conserve din roșii, dulcețuri și siropuri, murături). Fiecare produs are categorie, descriere, unitate de măsură și preț, toate editabile din panoul de administrare. Pentru backup este suficient să copiați acest fișier.

Dulcețurile și siropul de zmeură sunt incluse în catalog **fără preț confirmat** (marcate ca indisponibile) — setați prețul dorit și marcați-le ca disponibile din panoul de administrare.

## Structura proiectului

```
server.js          — serverul Express + API + stocarea datelor
public/index.html  — pagina de comandă pentru clienți
public/app.js
public/admin.html  — panoul de administrare
public/admin.js
public/style.css   — stilurile comune
data/db.json       — baza de date (generată automat, nu se versionează)
```
