// Loads GITHUB_TOKEN from `.env` (local) or system env so integration tests
// hitting api.github.com are authenticated and don't hit the unauthenticated rate limit.
import {readFileSync} from 'node:fs';
import process from 'node:process';

try {
	process.loadEnvFile?.();
} catch {}

// Fallback for Node versions without `process.loadEnvFile`: minimal `.env` parser.
// System env always wins over `.env`.
if (!process.env['GITHUB_TOKEN']) {
	try {
		const lines = readFileSync('.env', 'utf8').split('\n');
		for (const line of lines) {
			const match = /^\s*GITHUB_TOKEN\s*=\s*(.*)\s*$/.exec(line);
			if (match?.[1] && !process.env['GITHUB_TOKEN']) {
				process.env['GITHUB_TOKEN'] = match[1].trim().replaceAll(/^["']|["']$/g, '');
			}
		}
	} catch {}
}

const token = process.env['GITHUB_TOKEN']?.trim();
if (token && !globalThis.localStorage?.getItem?.('gh_token')) {
	const existing = globalThis.localStorage;
	if (existing?.setItem) {
		try {
			existing.setItem('gh_token', token);
		} catch {}
	} else {
		const storage: Storage = {
			length: 1,
			clear: () => undefined,
			getItem: (key: string) => key === 'gh_token' ? token : null,
			key: () => null,
			removeItem: () => undefined,
			setItem: () => undefined,
		};
		Object.defineProperty(globalThis, 'localStorage', {
			value: storage,
			configurable: true,
			writable: true,
		});
	}
}
