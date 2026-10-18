/* ============================================================
   TEAMPLANER — Einstellungen
   ============================================================ */
window.TP_CONFIG = {
  /* Name der App (erscheint oben links, im Browser-Tab, in E-Mails) */
  appName: "BoutHelper",
  appShortName: "BoutHelp",

  /* Supabase → Project Settings → API:
     "Project URL" und "anon public" Schlüssel (der öffentliche, NICHT service_role) */
  supabaseUrl: "https://azphvikveigncbiuzfyk.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6cGh2aWt2ZWlnbmNiaXV6ZnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyMjk3MDQsImV4cCI6MjEwNzgwNTcwNH0.onyE5iv9tQ6eQo0uB0oCblAQXXWiC61qdKXvDy5qoMk",

  /* Sprache, wenn der Browser keine der 20 Sprachen meldet */
  defaultLanguage: "de",

  /* Push-Benachrichtigungen: öffentlicher VAPID-Schlüssel.
     Erzeugen mit tools/vapid.html (siehe ANLEITUNG.md). Leer = Push aus. */
  vapidPublicKey: "BAnEwx8ylLqH3lMf2ZJFWxuovSk8ptka5RlozNxTqkBaPd1S2p4iXI7BIA316kfSf4bBOq7jBVVO6mkfgIep2oI",

  /* Optional: feste Adresse der App, z. B. "https://deinname.github.io/chronik/planer/".
     Leer lassen = wird automatisch erkannt. */
  appUrl: ""
};


