const ENV_KEYS = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
  measurementId: "FIREBASE_MEASUREMENT_ID",
};

export default async () => {
  const firebaseConfig = Object.fromEntries(
    Object.entries(ENV_KEYS)
      .map(([key, envName]) => [key, process.env[envName]])
      .filter(([, value]) => Boolean(value)),
  );

  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter((key) => !firebaseConfig[key]);
  if (missing.length) {
    return new Response(JSON.stringify({ error: "Firebase não configurado no Netlify." }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response(JSON.stringify({ firebaseConfig }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};
