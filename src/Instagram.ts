import {
	SocialNetwork,
	SocialConn,
	type Tokens,
	AuthCallback
} from "./SocialNetwork";
import fetch from 'node-fetch'
import FormData from 'form-data'

type InstagramPost = {
	media_type: string;
	permalink: string;
	media_url: string;
	caption?: string;
	timestamp: string;
	id: string;
};

export class Instagram extends SocialNetwork implements SocialConn {
	async getAuthorizeUrl(stateObj: Record<string, string>) {
		const baseUrl = 'https://api.instagram.com/oauth/authorize';
		const state = SocialNetwork.cipherState(stateObj);
		const verifier = this.generateVerifier(128);
		const params = {
			client_id: this.creds.client_id,
			redirect_uri: this.creds.redirect_uri,
			scope: (this.scope ?? ['user_profile','user_media']).join(','),
			response_type: 'code',
			state
		};

		await this.saveState({ state, verifier })
		return this.buildUrl(baseUrl, params)
	}

	async getAuthTokens(authResponse: AuthCallback) {
		const { code } = await this.checkAuthResponse(authResponse)

		const shortLiveTokenUrl = 'https://api.instagram.com/oauth/access_token';
		const shortLiveTokenParams = {};
		const formData = new FormData();
		formData.append('client_id', this.creds.client_id);
		formData.append('client_secret', this.creds.client_secret);
		formData.append('grant_type', 'authorization_code');
		formData.append('redirect_uri', this.creds.redirect_uri);
		formData.append('code', `${code}`);

		const url = this.buildUrl(shortLiveTokenUrl, shortLiveTokenParams);
		const shortLiveToken = await fetch(url, {
			method: 'POST',
			body: formData
		})
		.then(async (res) => res.ok ? res.json() : null)
		.then((res) => (res ? (res as Tokens).access_token : null));

		if (!shortLiveToken) {
			throw new Error('Impossible to get short live token')
		}

		const longLiveTokenUrlBase = 'https://graph.instagram.com/access_token';
		const longLiveTokenUrlParams = {
			grant_type: 'ig_exchange_token',
			client_secret: this.creds.client_secret,
			access_token: shortLiveToken
		};

		const longLiveToken = await fetch(this.buildUrl(longLiveTokenUrlBase, longLiveTokenUrlParams))
			.then((res) => (res.ok ? res.json() : null))
			.then((res) => (res ? (res as Tokens).access_token : null));

		if (!longLiveToken) {
			throw new Error('Impossible to get long live token')
		}

		return { access_token: longLiveToken };
	}

	async refreshAuthTokens(oldTokens: Tokens) {
		const baseUrl = 'https://graph.instagram.com/refresh_access_token';
		const params = {
			grant_type: 'ig_refresh_token',
			access_token: oldTokens.access_token
		};

		const response = await fetch(this.buildUrl(baseUrl, params))
			.then((res) => (res?.ok ? res.json() : null))
			.catch(() => null);

		if (!response) {
			throw new Error('Impossible to refresh token');
		}

		return {
			access_token: (response as Tokens).access_token,
			refreshed_at: new Date()
		};
	}

	async fetchPosts(tokens: Tokens, opts?: { since: string }) {
		if (!tokens.access_token) {
				return null;
		}

		const baseUrl = 'https://graph.instagram.com/me/media';
		const urlParams = {
			fields: 'media_type,permalink,media_url,caption,timestamp',
			access_token: tokens.access_token,
			limit: '100',
			...(opts?.since ? { since: opts.since } : {})
		};

		const posts = await fetch(this.buildUrl(baseUrl, urlParams))
			.then((res) => (res.ok ? res.json() : null))
			.then((res) => (res ? (res as { data?: any[] }).data ?? [] : []))
			.catch(() => []);

		return posts.map((p) => this.mapPosts(p));
	}

	mapPosts(post: InstagramPost) {
		return {
			ext_id: post.id,
			photo_url: post.media_url,
			type: post.media_type,
			post_url: post.permalink,
			text: post.caption ?? '',
			date: post.timestamp ? new Date(post.timestamp) : new Date()
		};
	}
}

