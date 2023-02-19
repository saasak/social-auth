import { createHash, createCipheriv, createDecipheriv } from 'crypto'

export type StateVerif = {
	state: string
	verifier?: string
}

export type AuthInit = {
	state: string,
	url: string,
	verifier: string
}

export type AuthCallback = {
	code: string
	givenState: string
	savedState?: string
	verifier?: string
}

export type OldTokens = {
	access_token: string
	refresh_token?: string
}

export type Tokens = {
	access_token: string
	refresh_token?: string
	expires_at?: Date
}

export type RefreshedTokens = {
	refreshed_at?: Date
} & Tokens

export type Credentials = {
	client_id: string
	client_secret: string
	redirect_uri: string
	user_id?: string
}

export type Options = {
	creds: Credentials
	scope?: string[]
}

const STATE_SECRET = (
  process.env.SOCIAL_STATE_SECRET ?? 'super secret that needs to be set in env'
).slice(0, 32);
const STATE_IV = (process.env.SOCIAL_STATE_IV ?? 'fuck it i am fed up of this').slice(0, 16);
const STATE_ALGO = 'aes-256-cbc';

export interface SocialConn {
	getAuthorizeUrl: (stateObj: Record<string, string>) => Promise<AuthInit>
	getAuthTokens: (authResponseParams: AuthCallback) => Promise<Tokens>
	refreshAuthTokens: (oldTokens: OldTokens) => Promise<RefreshedTokens>
}

export abstract class SocialNetwork {
	public creds: Credentials
	public scope: string[] | undefined

	public static inMemoryMap = new Map()
	public static STATE_SECRET = STATE_SECRET
	public static STATE_IV = STATE_IV

	constructor(opts: Options) {
		this.creds = opts.creds
		this.scope = opts.scope
	}

	async checkAuthResponse(authResponse: AuthCallback) {
		const savedStateAndVerifier = await this.getState(authResponse.givenState)
		const verifier = authResponse.verifier ?? savedStateAndVerifier.verifier
		const state = authResponse.savedState ?? savedStateAndVerifier.state

		if (!authResponse.code) {
			throw new Error('No code found')
		}

		if (!verifier) {
			throw new Error('No code challenge verifier found')
		}

		if (!authResponse.givenState || !state || state !== authResponse.givenState) {
			throw new Error('Invalid state')
		}

		return {
			state,
			verifier,
			code: authResponse.code
		}
	}

	async saveState({ state, verifier }: StateVerif) {
		SocialNetwork.inMemoryMap.set(state, verifier)
	}

	async getState(state: string) {
		if (!SocialNetwork.inMemoryMap.has(state)) {
			throw new Error('Error getting state')
		}

		return { state, verifier: SocialNetwork.inMemoryMap.get(state) }
	}

	buildUrl(base: string, params?: Record<string, string>) {
		return buildUrlWithParams(base, params)
	}

	generateVerifier(len = 128)	{
		return generateVerifierCode(len)
	}

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

export function buildUrlWithParams(
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
export function generateVerifierCode(len = 128) {
	const verifier = generateRandomString(len)
	return escapeBase64Url(createHash('sha256').update(verifier).digest('base64'));
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
