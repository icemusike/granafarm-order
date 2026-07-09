# GranaFarm — Aplicație de comenzi legume 🥬

Aplicație web simplă prin care clienții (restaurante, magazine alimentare, distribuitori angro, persoane fizice) pot plasa comenzi de legume proaspete direct de la seră, iar proprietarul le poate gestiona dintr-un panou de administrare.

Totul este în limba română.

## Funcționalități

### Pentru clienți — pagina principală (`/`)
- Catalog de produse cu prețuri și unități de măsură (kg, bucată, legătură)
- Alegerea cantității pentru fiecare produs, cu sumar și total calculat automat
- Formular cu date de contact și livrare: nume, firmă, tip client, telefon, email, localitate, adresă de livrare, data dorită de livrare, observații
- Confirmare cu număr de comandă după trimitere

### Pentru proprietar — panoul de administrare (`/admin`)
- Protejat cu parolă
- Statistici: comenzi noi, comenzi primite azi, valoarea comenzilor în lucru
- Lista comenzilor cu filtrare după status și detalii complete (produse, cantități, date de livrare, telefon apelabil)
- Schimbarea statusului fiecărei comenzi: **Nouă → Confirmată → În livrare → Livrată** (sau Anulată)
- Gestionarea catalogului: adăugare / modificare / ștergere produse, actualizare prețuri, marcarea produselor ca indisponibile

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

Comenzile și produsele sunt salvate în fișierul `data/db.json` (creat automat la prima pornire, cu un catalog inițial de legume: roșii, castraveți, ardei, vinete, dovlecei, verdețuri etc.). Pentru backup este suficient să copiați acest fișier.

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
