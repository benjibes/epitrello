import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const defaultRedirectUri = 'http://localhost:5173/auth/github/callback';
const stateCookieName = 'oauth_github_state';

const isSecureRequest = (url: URL, request: Request) => {
	const forwardedProto = request.headers.get('x-forwarded-proto');
	if (forwardedProto) {
		return forwardedProto.split(',')[0]?.trim() === 'https';
	}

	return url.protocol === 'https:';
};

export const GET: RequestHandler = async ({ url, request, cookies }) => {
	const clientId = env.GITHUB_CLIENT_ID;
	const redirectUri = env.GITHUB_REDIRECT_URI ?? defaultRedirectUri;
	if (!clientId) {
		console.error('GITHUB_CLIENT_ID manquant');
		throw redirect(302, '/login?error=github_config');
	}

	const state = crypto.randomUUID();
	cookies.set(stateCookieName, state, {
		httpOnly: true,
		path: '/',
		maxAge: 60 * 10,
		sameSite: 'lax',
		secure: isSecureRequest(url, request)
	});

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: 'read:user user:email',
		state
	});

	throw redirect(302, `https://github.com/login/oauth/authorize?${params.toString()}`);
};
