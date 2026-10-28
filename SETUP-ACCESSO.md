# Milionario — accesso riservato

Come funziona dopo la modifica:

```
browser ──► Cloudflare Access (email + codice) ──► Cloudflare Pages
                                                   ├─ index.html
                                                   └─ /api/sheet ──(account di servizio)──► Google Sheet privato
```

- La pagina sta in `public/index.html`; non legge più il foglio direttamente ma lo chiede a `/api/sheet` (`functions/api/sheet.js`).
- `/api/sheet` risponde solo se la richiesta ha superato Cloudflare Access (verifica il token di Access).
- Il foglio non è più "chiunque abbia il link": lo vede solo l'account di servizio (e chi lo condividi tu).
- Nessuna chiave sta nel codice: sono tutte nei Secret di Cloudflare.

Fai i passi **in quest'ordine**: il foglio diventa privato solo alla fine, quando il nuovo sito funziona già.

---

## 1. Google: account di servizio (≈10 min)

1. Vai su <https://console.cloud.google.com/> → in alto **Seleziona progetto → Nuovo progetto** → nome `milionario` → Crea.
2. Menu **API e servizi → Libreria** → cerca **Google Sheets API** → **Abilita**.
3. Menu **IAM e amministrazione → Account di servizio → Crea account di servizio**
   - nome `milionario-reader` → Crea e continua → **nessun ruolo** → Fine.
4. Apri l'account appena creato → scheda **Chiavi → Aggiungi chiave → Crea nuova chiave → JSON → Crea**.
   Si scarica un file `.json`: **è una chiave segreta**. Non metterla nel repository, non mandarla per email/chat.
5. Copia l'email dell'account (tipo `milionario-reader@milionario-xxxx.iam.gserviceaccount.com`).
6. Apri il Google Sheet → **Condividi** → incolla quell'email → ruolo **Visualizzatore** → togli la spunta "Invia notifica" → Condividi.
   (Per ora **non** togliere ancora "Chiunque abbia il link".)

## 2. Cloudflare Pages: pubblicare il sito (≈10 min)

1. Crea un account gratuito su <https://dash.cloudflare.com/sign-up>.
2. **Workers e Pages → Crea → Pages → Connetti a Git** → autorizza GitHub → scegli il repository `milionario`.
3. Impostazioni build:
   - Preimpostazione framework: **Nessuna**
   - Comando di build: *(vuoto)*
   - Directory di output della build: `public`
   - Ramo di produzione: `main`
4. **Salva e distribuisci**. L'indirizzo sarà tipo `https://milionario.pages.dev` (annotalo).
   In questo momento il sito mostrerà un errore di configurazione: è normale, mancano i passi 3 e 4.

## 3. Cloudflare Access: chi può entrare (≈10 min)

1. Nel dashboard Cloudflare apri **Zero Trust** (menu a sinistra). La prima volta:
   - scegli il nome del team (es. `giancarlo`) → il dominio del team sarà `giancarlo.cloudflareaccess.com`;
   - scegli il piano **Free** (fino a 50 utenti). Potrebbe chiedere una carta anche per il piano gratuito: non addebita nulla.
2. **Impostazioni → Autenticazione → Metodi di accesso**: verifica che ci sia **One-time PIN** (codice via email).
3. **Accesso → Applicazioni → Aggiungi un'applicazione → Self-hosted**:
   - Nome: `Milionario`
   - Dominio: `milionario.pages.dev` (quello del passo 2.4)
   - aggiungi un secondo dominio: `*.milionario.pages.dev` (protegge anche le anteprime)
   - Durata sessione: 24 ore (o quello che preferisci)
4. Policy: nome `Ammessi`, azione **Allow**, regola **Include → Emails** → inserisci la tua email e quelle delle persone che vuoi far entrare. Salva.
5. Riapri l'applicazione → scheda **Panoramica/Overview** → copia **Application Audience (AUD) Tag**.

Per far entrare o togliere qualcuno in futuro: modifichi solo la lista email di questa policy.

## 4. Collegare le chiavi (≈5 min)

In **Workers e Pages → milionario → Impostazioni → Variabili e segreti**, ambiente **Produzione**, aggiungi tutte come tipo **Secret**:

| Nome | Valore |
|---|---|
| `SHEET_ID` | l'ID del foglio (la parte dell'URL tra `/d/` e `/edit`) |
| `GOOGLE_SA_EMAIL` | l'email dell'account di servizio (passo 1.5) |
| `GOOGLE_SA_PRIVATE_KEY` | dal file JSON, il valore di `private_key` (da `-----BEGIN PRIVATE KEY-----` a `-----END PRIVATE KEY-----\n` compresi) |
| `ACCESS_TEAM_DOMAIN` | es. `giancarlo.cloudflareaccess.com` (senza `https://`) |
| `ACCESS_AUD` | il tag AUD del passo 3.5 |

**Non** aggiungerle all'ambiente *Anteprima/Preview*: così le anteprime non possono mai leggere il foglio.

Poi **Distribuzioni → ultima distribuzione → ⋯ → Riprova distribuzione** (serve per caricare i Secret).
Dopo, cancella il file `.json` scaricato dal PC (e dal Cestino).

## 5. Prova

1. Apri una finestra in incognito → `https://milionario.pages.dev` → deve chiederti l'email → arriva un codice → entri e vedi i grafici.
2. In incognito prova con un'email **non** in lista → non deve arrivare nessun accesso.
3. In incognito, senza fare login, apri `https://milionario.pages.dev/api/sheet` → deve chiedere il login, non mostrare dati.

## 6. Rendere privato il foglio (e provare che il sito lo legge ancora)

Finché il foglio è pubblico la prova del passo 5 non dimostra che l'account di servizio funziona: questa sì.

1. **Google Sheet → File → Condividi → Pubblica sul web**: se risulta pubblicato, **Interrompi pubblicazione**.
   (È un'impostazione separata dal link: se resta attiva, il foglio è leggibile da chiunque anche "con restrizioni".)
2. **Google Sheet → Condividi → Accesso generale → "Con restrizioni"** (non più "Chiunque abbia il link").
   Nella stessa finestra controlla le persone con accesso e togli chi non serve più.
3. Ricarica `https://milionario.pages.dev`: i dati devono esserci ancora (ora li legge solo l'account di servizio).
   Se compare "Google Sheets ha risposto 401/403/302": controlla il passo 1.6 (foglio condiviso con l'account di servizio).
   In emergenza puoi rimettere temporaneamente "Chiunque abbia il link" mentre si sistema.
4. In incognito apri il vecchio link del foglio: deve chiedere il login Google.

## 7. Chiudere GitHub Pages

1. **GitHub → repository milionario → Settings → Pages** → disattiva GitHub Pages (*Unpublish site*).
2. **GitHub → Settings → General → Danger Zone → Change visibility → Private**.
3. Verifica: `https://giancarlosacchi.github.io/milionario/` non deve più aprirsi; `https://milionario.pages.dev` funziona ancora.

Note:
- Nella cronologia del repository resta il vecchio ID del foglio: dopo i passi 6.1 e 6.2 non serve più a nulla senza autorizzazione.
  I dati che erano leggibili mentre il foglio era pubblico vanno considerati già visti da chi aveva il link.
