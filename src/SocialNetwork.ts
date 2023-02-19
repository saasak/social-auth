import { createHash, createCipheriv, createDecipheriv } from 'crypto'

export type StateVerif = {
	state: string
	verifier?: string
}

export type AuthCallback = {
	code: string
	state: string
}

export type Tokens = {
	access_token: string
	refresh_token?: string
	expires_in?: Date
	refreshed_at?: Date
}

export type Credentials = {
	client_id: string
	client_secret: string
	redirect_uri: string
	user_id?: string
}

export type Options = {
	creds: Credentials
	scope?: string[]
	saveState?: (obj: StateVerif) => Promise<void>
	getState?: (state: string) => Promise<StateVerif>
	saveTokens? : (tokens: Tokens) => Promise<void>
}

const STATE_SECRET = (
  process.env.SOCIAL_STATE_SECRET ?? 'super secret that needs to be set in env'
).slice(0, 32);
const STATE_IV = (process.env.SOCIAL_STATE_IV ?? 'fuck it i am fed up of this').slice(0, 16);
const STATE_ALGO = 'aes-256-cbc';

const inMemoryMap = new Map()
const defaultSaveState = async ({ state, verifier }: StateVerif) => {
	inMemoryMap.set(state, verifier)
}
const defaultGetState = async (state: string) => {
	if (!inMemoryMap.has(state)) {
		throw new Error('Error getting state')
	}

	return { state, verifier: inMemoryMap.get(state) }
}

export interface SocialConn {
	getAuthorizeUrl: (stateObj: Record<string, string>) => Promise<string>
	getAuthTokens: (authResponseParams: AuthCallback) => Promise<Tokens>
	refreshAuthTokens: (oldTokens: Tokens) => Promise<Tokens>
}

export abstract class SocialNetwork {
	public creds: Credentials
	public scope: string[] | undefined
	public saveState: ({ state, verifier }: StateVerif) => Promise<void>
	public getState: (state: string) => Promise<StateVerif>

	constructor(opts: Options) {
		this.creds = opts.creds
		this.scope = opts.scope
		this.saveState = opts.saveState ?? defaultSaveState
		this.getState = opts.getState ?? defaultGetState
	}

	buildUrl(
		base: string,
		params?: Record<string, string>
	): string {
		if (!params || !Object.keys(params)?.length) {
				return base;
		}

		return [
				base,
				Object.entries(params)
						.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
						.join('&')
		].join('?');
	}

	/* Stolen from https://raw.githubusercontent.com/PLhery/node-twitter-api-v2/master/src/client-mixins/oauth2.helper.ts */
	getCodeChallengeFromVerifier(len = 128) {
		const verifier = generateRandomString(len)
		return escapeBase64Url(createHash('sha256').update(verifier).digest('base64'));
	}

	static STATE_SECRET = STATE_SECRET
	static STATE_IV = STATE_IV

	static cipherState(obj: Record<string, string>) {
			const cipher = createCipheriv(STATE_ALGO, SocialNetwork.STATE_SECRET, SocialNetwork.STATE_IV);
			const objAsString = Object.entries(obj)
				.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
				.join('|')
			const text = `${objAsString}-${generateRandomString(32)}`;
			const cipheredText = cipher.update(text, 'utf-8', 'hex');

			return cipheredText + cipher.final('hex');
	}

	static decipherState(text: string): Record<string, string> {
			const decipher = createDecipheriv(STATE_ALGO, SocialNetwork.STATE_SECRET, SocialNetwork.STATE_IV);
			const partiallyDecrypted = decipher.update(text, 'hex', 'utf-8');
			const decrypted = partiallyDecrypted + decipher.final('utf-8');

			const [interesting] = decrypted.split('-');
			const allValues = interesting.split('|');

			return allValues.reduce((hash, str) => {
				const [key, value] = str.split('=')

				if (key && value) {
					hash[key] = decodeURIComponent(value)
				}

				return hash
			}, {} as Record<string, string>)
	}

	static toBase64(text: string[]) {
		return encodeBase64(text.join(':'))
	}
}

export function escapeBase64Url(str: string) {
	return str.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function encodeBase64(text: string) {
	return Buffer.from(text, 'utf-8').toString('base64');
}

export function generateRandomString(length: number) {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
	for (let i = 0; i < length; i++) {
			text += possible[Math.floor(Math.random() * possible.length)];
	}
	return text;
}
