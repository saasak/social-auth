import { SocialNetwork, SocialConn, type Tokens, AuthCallback } from "./SocialNetwork";
import fetch from 'node-fetch'

type FacebookPost = {
	created_time: number;
	permalink_url: string;
	full_picture: string;
	message: string;
	id: string;
};

export class Facebook extends SocialNetwork implements SocialConn {
	async getAuthorizeUrl(stateObj: Record<string, string>) {
		const baseUrl = 'https://www.facebook.com/v16.0/dialog/oauth';
		const state = SocialNetwork.cipherState(stateObj);
		const verifier = this.generateVerifier(128);
		const params = {
			client_id: this.creds.client_id,
			redirect_uri: this.creds.redirect_uri,
			scope: (this.scope ?? ['email', 'public_profile', 'user_posts']).join(','),
			response_type: 'code',
			state
		};

		await this.saveState({ state, verifier })

		return {
			url: this.buildUrl(baseUrl, params),
			state,
			verifier,
		}
	}

	async getAuthTokens(authResponse: AuthCallback): Promise<Tokens> {
		const { code } = await this.checkAuthResponse(authResponse)

		const shortLiveTokenUrl = 'https://graph.facebook.com/v16.0/oauth/access_token';
		const shortLiveTokenParams = {
			client_id: this.creds.client_id,
			client_secret: this.creds.client_secret,
			redirect_uri: this.creds.redirect_uri,
			code
		};

		const shortLiveToken = await fetch(this.buildUrl(shortLiveTokenUrl, shortLiveTokenParams))
			.then((res) => res.ok ? res.json() : null)
			.then((res) => res ? (res as Tokens).access_token : null)
			.catch(() => null)

		if (!shortLiveToken) {
			throw new Error('Impossible to get short live token')
		}

		const longLiveTokenUrlBase = 'https://graph.facebook.com/v16.0/oauth/access_token';
		const longLiveTokenUrlParams = {
			client_id: this.creds.client_id,
			client_secret: this.creds.client_secret,
			grant_type: 'fb_exchange_token',
			fb_exchange_token: shortLiveToken
		};

		const longLiveToken = await fetch(this.buildUrl(longLiveTokenUrlBase, longLiveTokenUrlParams))
			.then((res) => res.ok ? res.json() : null)
			.catch(() => null)

		if (!longLiveToken) {
			throw new Error('Impossible to get a long live token')
		}

		return {
			access_token: (longLiveToken as Tokens).access_token
		};
	}

	async refreshAuthTokens(oldTokens: Tokens) {
		const baseUrl = 'https://graph.facebook.com/v16.0/oauth/access_token';
		const params = {
			client_id: this.creds.client_id,
			client_secret: this.creds.client_secret,
			redirect_uri: this.creds.redirect_uri,
			grant_type: 'fb_exchange_token',
			fb_exchange_token: oldTokens.access_token
		};

		const response = await fetch(this.buildUrl(baseUrl, params), { method: 'POST' })
			.then(res => res.ok ? res.json() : null)
			.catch(() => null);

		if (!response) {
			throw new Error('Impossible to get a refresh token')
		}

		return {
			access_token: (response as Tokens).access_token,
			refreshed_at: new Date()
		};
	}

	async fetchPosts(tokens: Tokens, opts?: { since: string }) {
		if (!tokens?.access_token) {
			throw new Error('Missing access token')
		}

		const baseUrl = `https://graph.facebook.com/v16.0/me/posts`;
		const params = {
			access_token: tokens.access_token,
			fields: 'full_picture,permalink_url,created_time,message',
			limit: '100',
			...(opts?.since ? { since: opts.since } : {})
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
		.catch(() => []);

		return posts.map((p) => this.mapPosts(p));
	}

	mapPosts(post: FacebookPost) {
		return {
			ext_id: post.id,
			photo_url: post.full_picture ?? '',
			type: post.full_picture ? 'IMAGE' : 'TEXT',
			post_url: post.permalink_url ?? '',
			text: post.message ?? '',
			date: new Date(post.created_time),
		};
	}
}
