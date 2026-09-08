// Gestionnaire de connexions IA pour Cyber Hive.
// OAuth 2.1 + PKCE, clés API, MCP, et routage multi-provider.
// Inspiré de GitHub MCP Server (OAuth 2.1), AutoPentest-MCP, Zen-AI-Pentest.

import type {
  AuthMethod,
  CapacitesProvider,
  ConfigConnexionIA,
  ConnexionIA,
  MessageIA,
  OutilFunctionCall,
  ProviderIA,
  RequeteIA,
  ReponseIA,
  TokenOAuth,
} from './connection-types';
import { CONFIG_CONNEXION_DEFAUT } from './connection-types';
import { obtenirProvider, listerProviders } from './provider-registry';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Utilitaires OAuth 2.1 + PKCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Génère un code verifier PKCE (43-128 chars aléatoires). */
export function genererCodeVerifier(): string {
  const bytes = new Uint8Array(96);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Dérive le code challenge PKCE (S256) à partir du verifier. */
export async function genererCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Génère un state aléatoire pour CSRF protection. */
export function genererState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Encode en base64url (sans padding). */
function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Gestionnaire de connexions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class GestionnaireConnexions {
  private connexions = new Map<string, ConnexionIA>();
  private config: ConfigConnexionIA;
  private pkceStore = new Map<string, { verifier: string; providerId: string }>();

  constructor(config?: Partial<ConfigConnexionIA>) {
    this.config = { ...CONFIG_CONNEXION_DEFAUT, ...config };
  }

  // ─── OAuth 2.1 + PKCE ───────────────────────────────────────────────────

  /**
   * Construit l'URL d'autorisation OAuth 2.1 pour un provider.
   * Retourne l'URL à ouvrir dans le navigateur + le state pour vérifier le callback.
   */
  async demarrerOAuth(
    providerId: string,
    redirectUri?: string,
  ): Promise<{ url: string; state: string } | { erreur: string }> {
    const provider = obtenirProvider(providerId);
    if (!provider) return { erreur: `Provider inconnu: ${providerId}` };
    if (!provider.methodesAuth.includes('oauth2')) {
      return { erreur: `${provider.nom} ne supporte pas OAuth` };
    }
    if (!provider.urlOAuth || !provider.clientId) {
      return { erreur: `${provider.nom}: OAuth non configuré (clientId manquant)` };
    }

    const verifier = genererCodeVerifier();
    const challenge = await genererCodeChallenge(verifier);
    const state = genererState();
    const redirect = redirectUri ?? this.config.redirectUri;

    this.pkceStore.set(state, { verifier, providerId });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: redirect,
      scope: (provider.scopes ?? []).join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return { url: `${provider.urlOAuth}?${params.toString()}`, state };
  }

  /**
   * Traite le callback OAuth : échange le code d'autorisation contre un token.
   */
  async traiterCallback(
    code: string,
    state: string,
  ): Promise<ConnexionIA | { erreur: string }> {
    const pkce = this.pkceStore.get(state);
    if (!pkce) return { erreur: 'State invalide ou expiré' };
    this.pkceStore.delete(state);

    const provider = obtenirProvider(pkce.providerId);
    if (!provider || !provider.urlToken) {
      return { erreur: 'Provider ou URL de token manquant' };
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: provider.clientId ?? '',
        code_verifier: pkce.verifier,
        redirect_uri: this.config.redirectUri,
      });

      const resp = await fetch(provider.urlToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return { erreur: `Token exchange failed (${resp.status}): ${text}` };
      }

      const data = await resp.json();
      const token: TokenOAuth = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenType: 'Bearer',
        expireLe: Date.now() + (data.expires_in ?? 3600) * 1000,
        scope: data.scope,
      };

      return this.creerConnexion(pkce.providerId, 'oauth2', { token });
    } catch (err) {
      return { erreur: `Erreur OAuth: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ─── Clé API ────────────────────────────────────────────────────────────

  /**
   * Connecte un provider via clé API.
   */
  connecterCleApi(providerId: string, cleApi: string): ConnexionIA | { erreur: string } {
    const provider = obtenirProvider(providerId);
    if (!provider) return { erreur: `Provider inconnu: ${providerId}` };
    if (!provider.methodesAuth.includes('api-key') && !provider.methodesAuth.includes('bearer')) {
      return { erreur: `${provider.nom} ne supporte pas les clés API` };
    }
    return this.creerConnexion(providerId, 'api-key', { cleApi });
  }

  // ─── MCP ────────────────────────────────────────────────────────────────

  /**
   * Connecte un serveur MCP externe.
   */
  connecterMcp(providerId: string, url: string): ConnexionIA | { erreur: string } {
    const provider = obtenirProvider(providerId);
    if (!provider) return { erreur: `Provider inconnu: ${providerId}` };
    if (!provider.methodesAuth.includes('mcp')) {
      return { erreur: `${provider.nom} ne supporte pas MCP` };
    }
    return this.creerConnexion(providerId, 'mcp', { urlMcp: url });
  }

  // ─── Local (Ollama) ─────────────────────────────────────────────────────

  /**
   * Connecte un provider local (pas d'authentification).
   */
  connecterLocal(providerId: string): ConnexionIA | { erreur: string } {
    const provider = obtenirProvider(providerId);
    if (!provider) return { erreur: `Provider inconnu: ${providerId}` };
    if (provider.type !== 'local') return { erreur: `${provider.nom} n'est pas un provider local` };
    return this.creerConnexion(providerId, 'none', {});
  }

  // ─── Gestion des connexions ─────────────────────────────────────────────

  /** Crée et enregistre une connexion. */
  private creerConnexion(
    providerId: string,
    methode: AuthMethod,
    data: Partial<ConnexionIA>,
  ): ConnexionIA {
    const connexion: ConnexionIA = {
      id: `${providerId}-${Date.now()}`,
      providerId,
      statut: 'connecte',
      methode,
      connecteAt: Date.now(),
      requetes: 0,
      ...data,
    };
    this.connexions.set(connexion.id, connexion);
    return connexion;
  }

  /** Déconnecte une connexion. */
  deconnecter(connexionId: string): void {
    const c = this.connexions.get(connexionId);
    if (c) {
      c.statut = 'deconnecte';
      this.connexions.delete(connexionId);
    }
  }

  /** Retourne toutes les connexions actives. */
  listerConnexions(): ConnexionIA[] {
    return [...this.connexions.values()].filter((c) => c.statut === 'connecte');
  }

  /** Vérifie si un provider est connecté. */
  estConnecte(providerId: string): boolean {
    return [...this.connexions.values()].some(
      (c) => c.providerId === providerId && c.statut === 'connecte',
    );
  }

  /** Récupère la connexion d'un provider. */
  obtenirConnexion(providerId: string): ConnexionIA | undefined {
    return [...this.connexions.values()].find(
      (c) => c.providerId === providerId && c.statut === 'connecte',
    );
  }

  // ─── Refresh token ──────────────────────────────────────────────────────

  /**
   * Rafraîchit un token OAuth expiré.
   */
  async rafraichirToken(connexionId: string): Promise<boolean> {
    const c = this.connexions.get(connexionId);
    if (!c?.token?.refreshToken) return false;

    const provider = obtenirProvider(c.providerId);
    if (!provider?.urlToken) return false;

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: c.token.refreshToken,
        client_id: provider.clientId ?? '',
      });

      const resp = await fetch(provider.urlToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!resp.ok) return false;

      const data = await resp.json();
      c.token = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? c.token.refreshToken,
        tokenType: 'Bearer',
        expireLe: Date.now() + (data.expires_in ?? 3600) * 1000,
        scope: data.scope,
      };
      return true;
    } catch {
      c.statut = 'expire';
      return false;
    }
  }

  /** Vérifie et rafraîchit les tokens expirés (si auto-refresh activé). */
  async verifierTokens(): Promise<void> {
    if (!this.config.autoRefresh) return;
    const maintenant = Date.now();
    for (const c of this.connexions.values()) {
      if (c.token && c.token.expireLe < maintenant + 60_000) {
        await this.rafraichirToken(c.id);
      }
    }
  }

  // ─── Envoi de requêtes IA ───────────────────────────────────────────────

  /**
   * Envoie une requête à un provider IA connecté.
   * Supporte: LLMs (Claude, OpenAI, Gemini, DeepSeek, Grok), local (Ollama).
   */
  async envoyerRequete(req: RequeteIA): Promise<ReponseIA> {
    const connexion = this.obtenirConnexion(req.providerId);
    if (!connexion) {
      return { providerId: req.providerId, content: '', erreur: 'Provider non connecté' };
    }

    const provider = obtenirProvider(req.providerId);
    if (!provider) {
      return { providerId: req.providerId, content: '', erreur: 'Provider inconnu' };
    }

    // Vérifier le token
    if (connexion.token && connexion.token.expireLe < Date.now()) {
      const ok = await this.rafraichirToken(connexion.id);
      if (!ok) {
        return { providerId: req.providerId, content: '', erreur: 'Token expiré, refresh échoué' };
      }
    }

    connexion.requetes++;
    const debut = Date.now();

    try {
      // Router selon le provider
      switch (req.providerId) {
        case 'claude':
        case 'claude-code':
          return await this.reqAnthropic(provider, connexion, req, debut);
        case 'openai':
        case 'codex':
          return await this.reqOpenAI(provider, connexion, req, debut);
        case 'gemini':
          return await this.reqGemini(provider, connexion, req, debut);
        case 'deepseek':
          return await this.reqDeepSeek(provider, connexion, req, debut);
        case 'grok':
          return await this.reqGrok(provider, connexion, req, debut);
        case 'ollama':
          return await this.reqOllama(provider, connexion, req, debut);
        default:
          // MCP providers: pas de génération directe
          if (provider.type === 'mcp-server') {
            return {
              providerId: req.providerId,
              content: '',
              erreur: 'Provider MCP: utilisez appelerOutilMcp() pour interagir',
            };
          }
          return { providerId: req.providerId, content: '', erreur: 'Provider non supporté' };
      }
    } catch (err) {
      connexion.derniereErreur = err instanceof Error ? err.message : String(err);
      return {
        providerId: req.providerId,
        content: '',
        erreur: connexion.derniereErreur,
      };
    }
  }

  // ─── Adaptateurs par provider ───────────────────────────────────────────

  /** Anthropic (Claude, Claude Code). */
  private async reqAnthropic(
    provider: ProviderIA,
    c: ConnexionIA,
    req: RequeteIA,
    debut: number,
  ): Promise<ReponseIA> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (c.token) headers['Authorization'] = `Bearer ${c.token.accessToken}`;
    if (c.cleApi) headers['x-api-key'] = c.cleApi;

    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: req.outils?.map((o) => ({
        name: o.name,
        description: o.description,
        input_schema: o.parameters,
      })),
    };

    const resp = await fetch(`${provider.urlBase}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { providerId: req.providerId, content: '', erreur: `Anthropic ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    return {
      providerId: req.providerId,
      content: data.content?.map((b: { text?: string }) => b.text ?? '').join('') ?? '',
      tokensInput: data.usage?.input_tokens,
      tokensOutput: data.usage?.output_tokens,
      latenceMs: Date.now() - debut,
    };
  }

  /** OpenAI (GPT-4/5, Codex). */
  private async reqOpenAI(
    provider: ProviderIA,
    c: ConnexionIA,
    req: RequeteIA,
    debut: number,
  ): Promise<ReponseIA> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (c.token) headers['Authorization'] = `Bearer ${c.token.accessToken}`;
    if (c.cleApi) headers['Authorization'] = `Bearer ${c.cleApi}`;

    const body = {
      model: 'gpt-4o',
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: req.outils?.map((o) => ({
        type: 'function',
        function: { name: o.name, description: o.description, parameters: o.parameters },
      })),
    };

    const resp = await fetch(`${provider.urlBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { providerId: req.providerId, content: '', erreur: `OpenAI ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    return {
      providerId: req.providerId,
      content: data.choices?.[0]?.message?.content ?? '',
      tokensInput: data.usage?.prompt_tokens,
      tokensOutput: data.usage?.completion_tokens,
      latenceMs: Date.now() - debut,
    };
  }

  /** Google Gemini. */
  private async reqGemini(
    provider: ProviderIA,
    c: ConnexionIA,
    req: RequeteIA,
    debut: number,
  ): Promise<ReponseIA> {
    const key = c.cleApi ?? c.token?.accessToken;
    const url = `${provider.urlBase}/models/gemini-1.5-pro:generateContent?key=${key}`;

    const body = {
      contents: req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxTokens ?? 4096,
      },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { providerId: req.providerId, content: '', erreur: `Gemini ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    return {
      providerId: req.providerId,
      content: data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '',
      latenceMs: Date.now() - debut,
    };
  }

  /** DeepSeek. */
  private async reqDeepSeek(
    provider: ProviderIA,
    c: ConnexionIA,
    req: RequeteIA,
    debut: number,
  ): Promise<ReponseIA> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.cleApi}`,
    };

    const body = {
      model: 'deepseek-chat',
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    const resp = await fetch(`${provider.urlBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { providerId: req.providerId, content: '', erreur: `DeepSeek ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    return {
      providerId: req.providerId,
      content: data.choices?.[0]?.message?.content ?? '',
      tokensInput: data.usage?.prompt_tokens,
      tokensOutput: data.usage?.completion_tokens,
      latenceMs: Date.now() - debut,
    };
  }

  /** Grok (xAI). */
  private async reqGrok(
    provider: ProviderIA,
    c: ConnexionIA,
    req: RequeteIA,
    debut: number,
  ): Promise<ReponseIA> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.cleApi}`,
    };

    const body = {
      model: 'grok-2-latest',
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    const resp = await fetch(`${provider.urlBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { providerId: req.providerId, content: '', erreur: `Grok ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    return {
      providerId: req.providerId,
      content: data.choices?.[0]?.message?.content ?? '',
      latenceMs: Date.now() - debut,
    };
  }

  /** Ollama (local). */
  private async reqOllama(
    provider: ProviderIA,
    c: ConnexionIA,
    req: RequeteIA,
    debut: number,
  ): Promise<ReponseIA> {
    const body = {
      model: 'llama3.2',
      stream: false,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      options: {
        temperature: req.temperature ?? 0.7,
        num_predict: req.maxTokens ?? 4096,
      },
    };

    const resp = await fetch(`${provider.urlBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { providerId: req.providerId, content: '', erreur: `Ollama ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    return {
      providerId: req.providerId,
      content: data.message?.content ?? '',
      latenceMs: Date.now() - debut,
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Factory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Crée une instance du gestionnaire de connexions. */
export function creerGestionnaireConnexions(
  config?: Partial<ConfigConnexionIA>,
): GestionnaireConnexions {
  return new GestionnaireConnexions(config);
}