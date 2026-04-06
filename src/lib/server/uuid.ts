import { randomBytes } from 'crypto';

function bytesToHex(bytes: Uint8Array) {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// UUID v7 generator compatible with Node/Vercel runtime.
export function generateUuidV7(): string {
	const timestamp = BigInt(Date.now());
	const random = randomBytes(10);

	const timeHex = timestamp.toString(16).padStart(12, '0');
	const randA = ((random[0] << 8) | random[1]) & 0x0fff;
	const randB = Uint8Array.from(random.slice(2, 10));

	// RFC 9562 variant bits (10xxxxxx)
	randB[0] = (randB[0] & 0x3f) | 0x80;

	return [
		timeHex.slice(0, 8),
		timeHex.slice(8, 12),
		`7${randA.toString(16).padStart(3, '0')}`,
		bytesToHex(randB.slice(0, 2)),
		bytesToHex(randB.slice(2, 8))
	].join('-');
}
