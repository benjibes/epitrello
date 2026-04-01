import type { RequestHandler } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const defaultRedirectUri = 'http://localhost:5173/auth/microsoft/callback';
const stateCookieName = 'oauth_microsoft_state';

const isSecureRequest = (url: URL, request: Request) => {
	const forwardedProto = request.headers.get('x-forwarded-proto');
	if (forwardedProto) {
		return forwardedProto.split(',')[0]?.trim() === 'https';
	}

	return url.protocol === 'https:';
};

export const GET: RequestHandler = async ({ url, request, cookies }) => {
	const clientId = env.MICROSOFT_CLIENT_ID;
	const redirectUri = env.MICROSOFT_REDIRECT_URI ?? defaultRedirectUri;

	if (!clientId) {
		console.error('Microsoft OAuth mal configuré: MICROSOFT_CLIENT_ID manquant');
		throw error(500, 'Microsoft OAuth is not configured correctly');
	}

	const tenantId = env.MICROSOFT_TENANT_ID ?? 'common';

	const state = crypto.randomUUID();
	cookies.set(stateCookieName, state, {
		httpOnly: true,
		path: '/',
		maxAge: 60 * 10,
		sameSite: 'lax',
		secure: isSecureRequest(url, request)
	});

	const authorizeUrl = new URL(
		`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`
	);

	authorizeUrl.searchParams.set('client_id', clientId);
	authorizeUrl.searchParams.set('response_type', 'code');
	authorizeUrl.searchParams.set('redirect_uri', redirectUri);
	authorizeUrl.searchParams.set('response_mode', 'query');
	authorizeUrl.searchParams.set('scope', 'openid profile email User.Read');
	authorizeUrl.searchParams.set('state', state);

	throw redirect(302, authorizeUrl.toString());
};
