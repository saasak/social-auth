import {
	encodeBase64,
	SocialNetwork,
	SocialConn,
	type Tokens
} from "./SocialNetwork";
import fetch from 'node-fetch'

type TwitterPost = {
	text: string;
	created_at: string;
	id: string;
};

export class Twitter extends SocialNetwork implements SocialConn {
	async getAuthorizeUrl(obj?: Record<string, string>) {
		const baseUrl = 'https://twitter.com/i/oauth2/authorize';
		const state = SocialNetwork.cipherState(obj ?? {});
		const verifier = this.getCodeChallengeFromVerifier();
		const params = {
			client_id: this.creds.client_id,
			redirect_uri: this.creds.redirect_uri,
			scope: (this.scope ?? ['tweet.read', 'users.read','offline.access']).join(' '),
			response_type: 'code',
			code_challenge: verifier,
			code_challenge_method: 'plain',
			state
		};

		await this.saveState({ state, verifier })

		return this.buildUrl(baseUrl, params)
	}

	async getAuthTokens({ code, state }: { code: string, state: string }) {
		const basic = SocialNetwork.toBase64([this.creds.client_id, this.creds.client_secret]);
		const shortLiveTokenUrl = 'https://api.twitter.com/2/oauth2/token';
		const shortLiveTokenParams = {};

		const { verifier, state: savedState } = await this.getState(state)

		if (!verifier) {
			throw new Error('No code challenge verifier found')
		}

		if (state !== savedState) {
			throw new Error('Invalid state')
		}

		const urlEncoded = new URLSearchParams();
		urlEncoded.append('client_id', this.creds.client_id);
		urlEncoded.append('client_secret', this.creds.client_secret);
		urlEncoded.append('grant_type', 'authorization_code');
		urlEncoded.append('redirect_uri', this.creds.redirect_uri);
		urlEncoded.append('code', code);
		urlEncoded.append('code_verifier', verifier);

		const response = await fetch(
			this.buildUrl(shortLiveTokenUrl, shortLiveTokenParams), {
				method: 'POST',
				body: urlEncoded,
				headers: {
					Authorization: `Basic ${basic}`,
					'Content-Type': 'application/x-www-form-urlencoded'
				}
			})
			.then(async (res) => res.ok ? res.json() : null)
			.catch(() => null);

		if (!response) {
			throw new Error('Call to fetch an access token failed')
		}

		const { access_token, refresh_token } = response as Tokens;
		return {
			access_token,
			refresh_token,
			user_id: this.creds.user_id,
			state: SocialNetwork.decipherState(state)
		};
	}

	async refreshAuthTokens(oldTokens: Tokens) {
		if (!oldTokens?.refresh_token) {
			throw new Error('A refresh token is needed in order to refresh access_token')
		}

		const basic = encodeBase64([this.creds.client_id, this.creds.client_secret].join(':'));
		const shortLiveTokenUrl = 'https://api.twitter.com/2/oauth2/token';
		const shortLiveTokenParams = {};
		const formData = new URLSearchParams();
		formData.append('client_id', this.creds.client_id);
		formData.append('refresh_token', oldTokens.refresh_token);
		formData.append('grant_type', 'refresh_token');

		const response = await fetch(this.buildUrl(shortLiveTokenUrl, shortLiveTokenParams), {
			method: 'POST',
			body: formData,
			headers: {
				Authorization: `Basic ${basic}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			}
		}).then((res) => (res.ok ? res.json() : null));

		if (!response) {
			throw new Error('Impossible to refresh tokens')
		}

		const { access_token, refresh_token } = response as Tokens;
		return { access_token, refresh_token, refreshed_at: new Date() };
	}

	async fetchPosts(tokens: Tokens, opts: { since?: string, userId: string }) {
		if (!tokens?.access_token || !opts.userId) {
			throw new Error('Token are mandatory for fetching a user timeline')
		}

		const baseUrl = `https://api.twitter.com/2/users/${opts.userId}/tweets`;
		const params = {
			max_results: '100',
			'tweet.fields': 'lang,author_id,created_at',
			...(opts?.since ? { start_time: opts.since } : {})
		};

		const posts = await fetch(this.buildUrl(baseUrl, params), {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${tokens.access_token}`,
				Accept: 'application/json'
			}
		})
		.then((res) => (res.ok ? res.json() : null))
		.then((res) => (res ? (res as { data?: any[] }).data ?? [] : []))

		return posts.map((p) => this.mapPost(p));
	}

	mapPost(post: TwitterPost) {
		return {
			ext_id: post.id,
			photo_url: '',
			type: '',
			post_url: '',
			text: post.text,
			date: new Date(post.created_at),
		};
	}
}
