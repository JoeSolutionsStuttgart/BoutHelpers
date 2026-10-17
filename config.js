/* ============================================================
   TEAMPLANER — Einstellungen
   Nur diese Datei muss angepasst werden (siehe ANLEITUNG.md).
   ============================================================ */
window.TP_CONFIG = {
  /* Name der App (erscheint oben links, im Browser-Tab, in E-Mails) */
  appName: "Teamplaner",

  /* Supabase → Project Settings → API:
     "Project URL" und "anon public" Schlüssel (der öffentliche, NICHT service_role) */
  supabaseUrl: "",
  supabaseAnonKey: "",

  /* Sprache, wenn der Browser keine der 20 Sprachen meldet */
  defaultLanguage: "de",

  /* Push-Benachrichtigungen: öffentlicher VAPID-Schlüssel.
     Erzeugen mit tools/vapid.html (siehe ANLEITUNG.md). Leer = Push aus. */
  vapidPublicKey: "",

  /* Optional: feste Adresse der App, z. B. "https://deinname.github.io/chronik/planer/".
     Leer lassen = wird automatisch erkannt. */
  appUrl: ""
};
