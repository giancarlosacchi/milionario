# Milionario — accesso riservato con password

Come funziona:

```
browser ──► milionario-1nh.pages.dev (Cloudflare Pages, gratis)
             ├─ functions/_middleware.js  chiede la password a ogni visita (pagina e dati)
             ├─ public/index.html         la dashboard
             └─ /api/sheet ──(account di servizio Google)──► Google Sheet privato
```

- Chi non conosce la password vede solo la pagina "Accesso riservato": niente grafici, niente dati.
- Dopo l'accesso il browser resta collegato per 14 giorni (pulsante **Esci** in fondo alla pagina per uscire).
- Il foglio non è più "chiunque abbia il link": lo legge solo l'account di servizio
  `milionario-reader@milionario-513011.iam.gserviceaccount.com` (Visualizzatore).
- Nessuna password o chiave sta nel codice: sono nei Secret di Cloudflare.
- Nessun costo e nessuna carta: Cloudflare Pages Free + Google Cloud (solo account di servizio).

## Variabili su Cloudflare

**Workers e Pages → milionario → Impostazioni → Variabili e segreti**, ambiente **Produzione**
(non aggiungerle all'ambiente Anteprima):

| Nome | Tipo | Valore |
|---|---|---|
| `SHEET_ID` | Testo | ID del foglio (la parte dell'URL tra `/d/` e `/edit`) |
| `GOOGLE_SA_EMAIL` | Testo | `milionario-reader@milionario-513011.iam.gserviceaccount.com` |
| `GOOGLE_SA_PRIVATE_KEY` | **Secret** | dal file JSON della chiave, il valore di `private_key` |
| `SITE_PASSWORD` | **Secret** | la password da dare a chi può entrare |

Dopo ogni modifica alle variabili: **Distribuzioni → ultima distribuzione → ⋯ → Riprova distribuzione**.

### Creare la chiave dell'account di servizio (una volta sola)

1. <https://console.cloud.google.com/iam-admin/serviceaccounts?project=milionario-513011> (account giancarlosacchi@gmail.com)
2. Clic su `milionario-reader` → scheda **Chiavi** → **Aggiungi chiave → Crea nuova chiave → JSON → Crea**.
3. Apri il file scaricato con Blocco note, copia il testo tra le virgolette dopo `"private_key":`
   (da `-----BEGIN PRIVATE KEY-----` a `-----END PRIVATE KEY-----\n`) e incollalo in `GOOGLE_SA_PRIVATE_KEY`.
4. Cancella il file `.json` dal PC e dal Cestino.

### Scegliere la password

- Usa una frase lunga, ad esempio 4 parole a caso con un numero: `cavallo-blu-tramonto-42` (non questa!).
  Più è lunga, più è difficile da indovinare a tentativi.
- **Per togliere l'accesso a tutti** (o se la password gira troppo): cambia `SITE_PASSWORD` e riprova la distribuzione.
  Tutti vengono buttati fuori e serve la password nuova.

## Chiudere le vecchie porte

Solo dopo aver verificato che il nuovo sito mostra i dati con la password:

1. **Google Sheet** (account giancarlosacchils@gmail.com, proprietario) → **File → Condividi → Pubblica sul web**:
   se è pubblicato, **Interrompi pubblicazione**.
2. **Condividi → Accesso generale → "Con restrizioni"**. Controlla anche le persone con accesso.
3. Ricarica il sito: i dati devono esserci ancora (ora li legge solo l'account di servizio).
4. **GitHub → milionario → Settings → Pages** → *Unpublish site*.
5. **GitHub → Settings → General → Change visibility → Private**.

Note:
- Nella cronologia del repository resta il vecchio ID del foglio: dopo i passi 1 e 2 non serve più a nulla.
  I dati letti mentre il foglio era pubblico vanno considerati già visti da chi aveva il link.
- L'app GitHub "Cloudflare Workers and Pages" ha accesso solo al repository `milionario`.
