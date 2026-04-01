const args = process.argv.slice(2);

if (args.includes('--help')) {
	console.log(`Usage: bun run ensure-admin -- <email> [--create]

Arguments:
  <email>     Email of the account to promote as admin

Options:
  --create    Create the account if it does not exist
  --help      Show this help message
`);
	process.exit(0);
}

const createIfMissing = args.includes('--create');
const emailArg = args.find((arg) => !arg.startsWith('-')) ?? '';
const email = emailArg.trim().toLowerCase();
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
	console.error('Missing REDIS_URL environment variable.');
	process.exit(1);
}

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
	console.error(
		'You must provide a valid email. Example: bun run ensure-admin -- admin@example.com'
	);
	process.exit(1);
}

const redis = new Bun.RedisClient(redisUrl);
const emailKey = `user_email:${email}`;
let userId = await redis.get(emailKey);

if (!userId) {
	if (!createIfMissing) {
		console.error(
			`No account found for ${email}. Re-run with --create to create and promote this account.`
		);
		process.exit(1);
	}

	const uuid = Bun.randomUUIDv7();
	const username = email.split('@')[0] || email;

	await redis.hset(`user:${uuid}`, {
		uuid,
		username,
		email,
		role: 'admin',
		password_hash: '',
		profile_picture_url: ''
	});
	await redis.set(emailKey, uuid);

	console.log(`Created new admin account: ${email} (${uuid})`);
	process.exit(0);
}

userId = String(userId);
const userHash = await redis.hgetall(`user:${userId}`);

if (!userHash || Object.keys(userHash).length === 0) {
	if (!createIfMissing) {
		console.error(
			`Email index exists for ${email}, but user:${userId} was not found. Re-run with --create to recreate it.`
		);
		process.exit(1);
	}

	const username = email.split('@')[0] || email;
	await redis.hset(`user:${userId}`, {
		uuid: userId,
		username,
		email,
		role: 'admin',
		password_hash: '',
		profile_picture_url: ''
	});
	await redis.set(emailKey, userId);
	console.log(`Recreated and promoted admin account: ${email} (${userId})`);
	process.exit(0);
}

await redis.hset(`user:${userId}`, { role: 'admin' });
console.log(`Promoted account to admin: ${email} (${userId})`);

export {};
