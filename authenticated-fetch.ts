function isGitHubApiUrl(url: string): boolean {
	try {
		const {hostname, pathname} = new URL(url);
		return hostname === 'api.github.com' || pathname.startsWith('/api/v3/');
	} catch {
		return false;
	}
}

export default async function authenticatedFetch(
	url: string,
	{signal, method}: {signal?: AbortSignal; method?: 'HEAD'} = {},
): Promise<Response> {
	const token = globalThis.localStorage?.getItem('gh_token');

	const response = await fetch(url, {
		method,
		signal,
		...(token && isGitHubApiUrl(url)
			? {
				headers: {
					// eslint-disable-next-line @typescript-eslint/naming-convention
					Authorization: `Bearer ${token}`,
				},
			}
			: {}),
	});

	switch (response.status) {
		case 401: {
			throw new Error('Invalid token');
		}

		case 403:
		case 429: {
			// See https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit
			if (response.headers.get('X-RateLimit-Remaining') === '0') {
				throw new Error('Rate limit exceeded');
			}

			break;
		}

		default:
	}

	return response;
}
