import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

interface AuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id: string;
}

interface AuthFile {
  auth_mode: string;
  tokens: AuthTokens;
  last_refresh: string;
}

interface JWTPayload {
  exp: number;
  [key: string]: any;
}

export class CodexAuth {
  private authFilePath: string;

  constructor(authFilePath: string = '~/.codex/auth.json') {
    this.authFilePath = this.resolveHome(authFilePath);
  }

  async getToken(): Promise<{ accessToken: string; accountId: string }> {
    const authData = await this.readAuthFile();
    const payload = this.decodeJWT(authData.tokens.access_token);

    if (this.isTokenExpiringSoon(payload.exp)) {
      await this.refreshToken();
      const refreshedData = await this.readAuthFile();
      return {
        accessToken: refreshedData.tokens.access_token,
        accountId: refreshedData.tokens.account_id
      };
    }

    return {
      accessToken: authData.tokens.access_token,
      accountId: authData.tokens.account_id
    };
  }

  private async refreshToken(): Promise<void> {
    const authData = await this.readAuthFile();

    const response = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: authData.tokens.refresh_token,
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann'
      })
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Record<string, string>;

    authData.tokens.access_token = data.access_token;
    authData.tokens.refresh_token = data.refresh_token;
    authData.tokens.id_token = data.id_token;
    authData.last_refresh = new Date().toISOString();

    await this.writeAuthFile(authData);
  }

  private async readAuthFile(): Promise<AuthFile> {
    const content = await readFile(this.authFilePath, 'utf-8');
    return JSON.parse(content);
  }

  private async writeAuthFile(data: AuthFile): Promise<void> {
    await writeFile(this.authFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private decodeJWT(token: string): JWTPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  }

  private isTokenExpiringSoon(exp: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    return exp - now < 300;
  }

  private resolveHome(filepath: string): string {
    if (filepath.startsWith('~/')) {
      return join(homedir(), filepath.slice(2));
    }
    return filepath;
  }
}
