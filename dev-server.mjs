import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);

async function readEnvFile() {
  const source = await readFile(path.join(root, ".env"), "utf8");
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return [];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

function configResponse(env) {
  const names = {
    apiKey: "FIREBASE_API_KEY",
    authDomain: "FIREBASE_AUTH_DOMAIN",
    projectId: "FIREBASE_PROJECT_ID",
    storageBucket: "FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
    appId: "FIREBASE_APP_ID",
    measurementId: "FIREBASE_MEASUREMENT_ID",
  };
  const firebaseConfig = Object.fromEntries(
    Object.entries(names).filter(([, envName]) => env[envName]).map(([key, envName]) => [key, env[envName]]),
  );
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  if (required.some((key) => !firebaseConfig[key]))
    return Response.json({ error: "Configuração Firebase incompleta no .env." }, { status: 503 });
  return Response.json({ firebaseConfig }, { headers: { "cache-control": "no-store" } });
}

const contentTypes = {
  "/": "text/html; charset=utf-8",
  "/index.html": "text/html; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (request.method !== "GET") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Método não permitido");
    return;
  }
  if (pathname === "/.netlify/functions/firebase-config") {
    try {
      const result = configResponse(await readEnvFile());
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "Não foi possível ler o arquivo .env local." }));
    }
    return;
  }
  const contentType = contentTypes[pathname];
  if (!contentType) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Não encontrado");
    return;
  }
  try {
    const body = await readFile(path.join(root, pathname === "/" ? "index.html" : pathname.slice(1)));
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Não encontrado");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`App local: http://localhost:${port}\n`);
});
