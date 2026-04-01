import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { redirect, isRedirect } from '@sveltejs/kit';
import { UserConnector } from '$lib/server/redisConnector';
import type { UUID } from 'crypto';

const defaultRedirectUri = 'http://localhost:5173/auth/microsoft/callback';
const stateCookieName = 'oauth_microsoft_state';
const graphUserAgent = 'EpiTrello-OAuth/1.0';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const errorParam = url.searchParams.get('error');
	const state = url.searchParams.get('state');
	const expectedState = cookies.get(stateCookieName);

	cookies.delete(stateCookieName, { path: '/' });

	if (errorParam) {
		console.error('Microsoft callback avec ?error=', errorParam);
		throw redirect(302, '/login?error=microsoft_denied');
	}

	if (!state || !expectedState || state !== expectedState) {
		console.error('Microsoft callback avec state invalide', {
			hasState: Boolean(state),
			hasExpectedState: Boolean(expectedState)
		});
		throw redirect(302, '/login?error=microsoft_state');
	}

	if (!code) {
		console.error('Microsoft callback sans ?code');
		throw redirect(302, '/login?error=microsoft_code');
	}

	const clientId = env.MICROSOFT_CLIENT_ID;
	const clientSecret = env.MICROSOFT_CLIENT_SECRET;
	const tenantId = env.MICROSOFT_TENANT_ID ?? 'common';
	const redirectUri = env.MICROSOFT_REDIRECT_URI ?? defaultRedirectUri;

	if (!clientId || !clientSecret) {
		console.error('MICROSOFT_CLIENT_ID ou MICROSOFT_CLIENT_SECRET manquants');
		throw redirect(302, '/login?error=microsoft_config');
	}

	try {
		const tokenRes = await fetch(
			`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
					'User-Agent': graphUserAgent
				},
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: 'authorization_code',
					code,
					redirect_uri: redirectUri,
					scope: 'openid profile email User.Read'
				}).toString()
			}
		);

		if (!tokenRes.ok) {
			const body = await tokenRes.text();
			console.error('Microsoft token error', tokenRes.status, body);
			throw redirect(302, '/login?error=microsoft_token');
		}

		const tokenJson = (await tokenRes.json()) as {
			access_token?: string;
			scope?: string;
		};

		const accessToken = tokenJson.access_token;
		if (!accessToken) {
			console.error('Pas de access_token dans la réponse Microsoft', tokenJson);
			throw redirect(302, '/login?error=microsoft_token');
		}

		console.log('MS token OK, scopes:', tokenJson.scope);

		const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: 'application/json',
				'User-Agent': graphUserAgent
			}
		});

		if (!meRes.ok) {
			console.error('MS /me error', meRes.status, await meRes.text());
			throw redirect(302, '/login?error=microsoft_user');
		}

		const me = (await meRes.json()) as {
			id: string;
			displayName?: string;
			mail?: string;
			userPrincipalName?: string;
		};

		console.log('MS /me =', {
			id: me.id,
			displayName: me.displayName,
			mail: me.mail,
			userPrincipalName: me.userPrincipalName
		});

		const email = me.mail ?? me.userPrincipalName ?? '';
		if (!email) {
			console.error('Microsoft account sans email utilisable', me);
			throw redirect(302, '/login?error=microsoft_no_email');
		}

		const username = me.displayName ?? (email.includes('@') ? email.split('@')[0] : email);

		let user = await UserConnector.getByEmail(email);

		if (!user) {
			const newUuid = Bun.randomUUIDv7() as UUID;

			user = {
				uuid: newUuid,
				username,
				email,
				role: 'student',
				password_hash: '',
				profile_picture_url: '',
				boards: []
			};

			await UserConnector.save(user);
		}

		const safeUser = {
			id: user.uuid,
			email: user.email,
			name: user.username,
			role: user.role ?? 'student'
		};

		return new Response(
			`<script>
				localStorage.setItem('authToken', 'microsoft-' + Date.now());
				localStorage.setItem('user', ${JSON.stringify(JSON.stringify(safeUser))});
				window.location.href = '/u/${user.uuid}#profile';
			</script>`,
			{
				headers: {
					'Content-Type': 'text/html; charset=utf-8'
				}
			}
		);
	} catch (err) {
		if (isRedirect(err)) throw err;

		console.error('Unexpected Microsoft callback error', err);
		throw redirect(302, '/login?error=microsoft_internal');
	}
};
