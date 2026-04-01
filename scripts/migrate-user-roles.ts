type UserRole = 'student' | 'ape' | 'admin';

const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
	console.log(`Usage: bun run migrate:user-roles [--dry-run]

Options:
  --dry-run   Show changes without writing to Redis
  --help      Show this help message
`);
	process.exit(0);
}

const dryRun = args.has('--dry-run');
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
	console.error('Missing REDIS_URL environment variable.');
	process.exit(1);
}

function normalizeRole(value: unknown): UserRole | null {
	if (typeof value !== 'string') {
		return null;
	}

	const role = value.trim().toLowerCase();
	if (role === 'student' || role === 'ape' || role === 'admin') {
		return role;
	}

	return null;
}

function resolveRoleFromLegacyData(userHash: Record<string, unknown>): UserRole {
	const explicitRole = normalizeRole(userHash.role);
	if (explicitRole) {
		return explicitRole;
	}

	const legacyAdmin = typeof userHash.admin === 'string' ? userHash.admin.trim().toLowerCase() : '';
	return legacyAdmin === 'yes' ? 'admin' : 'student';
}

const redis = new Bun.RedisClient(redisUrl);

const keys = await redis.keys('user:*');
const userKeys = keys.map((key) => String(key)).filter((key) => /^user:[^:]+$/.test(key));

let scanned = 0;
let updated = 0;

for (const userKey of userKeys) {
	let userHash: Record<string, unknown> | null = null;
	try {
		userHash = await redis.hgetall(userKey);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('WRONGTYPE')) {
			console.warn(`Skipping non-hash key: ${userKey}`);
			continue;
		}
		throw error;
	}

	if (!userHash || Object.keys(userHash).length === 0) {
		continue;
	}

	scanned += 1;
	const currentRole = normalizeRole(userHash.role);
	const targetRole = resolveRoleFromLegacyData(userHash);

	if (currentRole === targetRole) {
		continue;
	}

	updated += 1;
	const uuid = typeof userHash.uuid === 'string' ? userHash.uuid : userKey.slice('user:'.length);
	const note = dryRun ? '[dry-run] ' : '';
	console.log(`${note}${uuid}: ${currentRole ?? '(missing)'} -> ${targetRole}`);

	if (!dryRun) {
		await redis.hset(userKey, { role: targetRole });
	}
}

console.log(
	`Done. Scanned ${scanned} user(s), ${dryRun ? 'would update' : 'updated'} ${updated} user(s).`
);

export {};
