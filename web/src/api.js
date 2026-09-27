// Appels a l'API du portail (/api). Un 401 leve NonConnecte.

export class NonConnecte extends Error {}

export async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) throw new NonConnecte();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erreur API (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}
