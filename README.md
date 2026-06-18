📚 DOCUMENTAZIONE TECNICA: "La Porra del Mundial 2026" (Versione Aggiornata)
1. Panoramica del Progetto
Applicazione web "mobile-first" per la gestione di un fantacalcio/pronostici sui Mondiali 2026.
È una Single-Page App (SPA) scritta in Vanilla HTML, CSS e JavaScript all'interno di un unico file (index.html), senza framework esterni. Il backend è Serverless e si appoggia a Supabase (PostgreSQL) per il database e a Vercel per la sincronizzazione dei risultati reali.

2. File del Progetto
index.html: Contiene tutta la UI, il CSS, la logica Javascript e le chiamate dirette a Supabase tramite la libreria @supabase/supabase-js@2.

api/sync.js: Funzione serverless su Vercel. Si collega all'API di football-data.org e aggiorna automaticamente i risultati reali su Supabase ogni 90 secondi quando ci sono partite in corso.

3. Database e Sicurezza (Supabase)
Il frontend è considerato "non attendibile". Tutta la sicurezza è garantita lato database tramite Row Level Security (RLS) e funzioni RPC (Remote Procedure Calls) con SECURITY DEFINER.

Autenticazione: Nessuna email o password. L'accesso avviene tramite Nome e PIN (4-6 cifre).

Hashing del PIN: Il PIN non viaggia mai in chiaro. Viene convertito in un hash SHA-256 nel browser dell'utente prima di essere inviato al server.

Storage Avatar: Gli utenti possono caricare un'immagine di profilo. Il file index.html usa HTML5 Canvas per ridimensionare (max 300x300px) e comprimere (JPEG 80%) l'immagine prima di caricarla su Supabase Storage, risparmiando banda.

Prevenzione XSS: Tutti i dati testuali in output sul frontend passano per la funzione Javascript esc(s) che sanitizza i caratteri pericolosi.

4. Sistema di Punteggio e Classifica
I punti vengono assegnati solo quando la partita è finalizzata o in gioco (proiezione live):

5 Punti (Pleno): L'utente ha indovinato il risultato esatto (es. pronostica 2-1, finisce 2-1).

3 Punti (Segno): L'utente ha indovinato l'esito della partita (1X2) ma non il risultato esatto (es. pronostica 2-0, finisce 3-1).

0 Punti: Pronostico completamente errato.

5. Logiche di Business Speciali (Core Features)
A. L'Arbitro Intelligente (Filtri per Lega)
La funzione esPartidoPuntuable(p) nel frontend filtra visivamente le partite "di prova" (che non assegnano punti) in base al nome della porra in cui ci si trova:

Porre che includono "factorial": Tutte le partite precedenti a Giovedì 18 Giugno 2026, 18:00 CEST vengono annullate e marchiate come prova.

Porre che includono "bunker": Le prime 4 partite del torneo in ordine cronologico vengono annullate e marchiate come prova.

B. Gamification: La Fiamma (🔥) e la Forma
Grafico di Forma: Nel profilo, 5 quadrati colorati mostrano l'esito degli ultimi 5 pronostici (Oro = 5pt, Verde = 3pt, Rosso = 0pt). I colori cambiano in tempo reale anche se la partita è in "Live".

Racha de Fuego (🔥): L'algoritmo controlla gli ultimi 5 match giocati dall'utente. Se in tutti e 5 ha ottenuto un punteggio maggiore di zero (nessun errore totale), una fiamma animata appare accanto al suo nome nell'intestazione, nella classifica e nel profilo.

C. Pronostici "Extra" (Tabellone)
Ogni utente può salvare previsioni a lungo termine (Campione, Secondo, Terzo, Quarto, Pichichi, MVP) in un campo JSONB (extras).

Scadenza Assoluta: Il database Supabase blocca qualsiasi tentativo di salvataggio dopo il 18 Giugno 2026 alle 16:00 UTC (18:00 CEST) usando l'orologio atomico del server (now()), prevenendo trucchi tramite il cambio dell'ora sul telefono (Time-Spoofing).

Segreto: Le funzioni Supabase nascondono i pronostici Extra (e i pronostici delle partite future) agli altri utenti finché non scade il tempo limite.

6. UI/UX: Navigazione a Stack Modale
L'app non cambia mai pagina. Utilizza un sofisticato sistema di finestre modali sovrapposte (modalStack). Quando si naviga da una partita a un utente, il sistema crea una cronologia. Un pulsante "← Atrás" permette di retrocedere nel DOM senza chiudere l'interfaccia, simulando la navigazione nativa di uno smartphone con supporto alle History API (pulsante indietro del browser).

7. Funzioni Admin (Modalità Kiwi)
Gli utenti designati come amministratori (es. nome "kiwi") possono sbloccare un pannello nascosto inserendo un PIN di amministrazione per:

Sincronizzare manualmente i dati (chiamata a /api/sync).

Assegnare automaticamente i punti Extra a fine torneo basandosi sul tabellone.

Correggere risultati a mano.

Resettare il PIN di qualsiasi utente a "0000".

(Fine del Documento)

Istruzione per la prossima IA: Se mai avrai bisogno di riprendere in mano il progetto con un'altra IA, ti basterà fornirle questo testo e dirle: "Questa è l'architettura dell'app. Ti allego il codice attuale (index.html). Vorrei fare questa modifica: [tua richiesta]".
