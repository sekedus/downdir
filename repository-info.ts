import authenticatedFetch from './authenticated-fetch.js';

function cleanUrl(url: string) {
	return url
		.replace(/[/]{2,}/, '/') // Drop double slashes
		.replace(/[/]$/, ''); // Drop last trailing slash
}

export function getRepositoryPreview(url: string):
| {error: 'NOT_A_REPOSITORY' | 'NOT_A_DIRECTORY'}
| {user: string; repository: string; parts: string[]} {
	const [, user, repository, ...restPathParts] = cleanUrl(
		decodeURIComponent(new URL(url).pathname),
	).split('/');
	const type = restPathParts[0];

	if (!user || !repository) {
		return {error: 'NOT_A_REPOSITORY'};
	}

	if (type && type !== 'tree') {
		return {error: 'NOT_A_DIRECTORY'};
	}

	const parts = type === 'tree' ? restPathParts.slice(1) : [];

	return {
		user,
		repository,
		parts,
	};
}

type BranchCache = Record<string, Record<string, {branches: string[]; fetchedAt: number}>>;

function readBranchCache(): BranchCache {
	try {
		const parsed = JSON.parse(globalThis.localStorage?.getItem('downdir_branches') ?? '{}') as BranchCache;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function setCachedBranchNames(user: string, repo: string, branches: string[]) {
	try {
		const cache = readBranchCache();
		cache[user] ??= {};
		cache[user][repo] = {branches, fetchedAt: Date.now()};
		globalThis.localStorage?.setItem('downdir_branches', JSON.stringify(cache));
	} catch {
		// Ignore cache write failures (private mode, quota, etc.)
	}
}

function findBestBranchMatch(joined: string, names: string[]): string | undefined {
	let bestMatch: string | undefined;
	for (const name of names) {
		if ((joined === name || joined.startsWith(`${name}/`)) && (!bestMatch || name.length > bestMatch.length)) {
			bestMatch = name;
		}
	}

	return bestMatch;
}

function toParseResult(user: string, repo: string, joined: string, bestMatch: string) {
	const directory = joined === bestMatch ? '' : joined.slice(bestMatch.length + 1);
	return {
		gitReference: bestMatch,
		directory,
		...(directory === '' ? {downloadUrl: `https://codeload.github.com/${user}/${repo}/legacy.zip/refs/heads/${bestMatch}`} : {}),
	};
}

async function parsePath(
	user: string,
	repo: string,
	parts: string[],
): Promise<{gitReference: string; directory: string; downloadUrl?: string} | void> {
	const joined = parts.join('/');

	// Get cached branch names if available and not expired. Cache is valid for 30 minutes.
	const cacheTtl = 30 * 60 * 1000;
	const cacheEntry = readBranchCache()[user]?.[repo];
	let cached: string[] | undefined;
	if (cacheEntry && Array.isArray(cacheEntry.branches) && typeof cacheEntry.fetchedAt === 'number' && Date.now() - cacheEntry.fetchedAt <= cacheTtl) {
		cached = cacheEntry.branches;
	}

	if (cached) {
		const bestMatch = findBestBranchMatch(joined, cached);
		if (bestMatch) {
			return toParseResult(user, repo, joined, bestMatch);
		}

		// Fully cached list with no match: the branch doesn't exist. A
		// page-sized list may be truncated, so re-fetch in that case.
		if (cached.length % 100 !== 0) {
			return;
		}
	}

	const names: string[] = [];
	let page = 1;
	let hasMorePages = true;
	while (hasMorePages) {
		// eslint-disable-next-line no-await-in-loop -- Fetch next page only when needed
		const response = await authenticatedFetch(`https://api.github.com/repos/${user}/${repo}/branches?per_page=100&page=${page}`);

		// eslint-disable-next-line no-await-in-loop -- Fetch next page only when needed
		const branches = await response.json() as Array<{name: string}>;
		for (const {name} of branches) {
			names.push(name);
		}

		// Longest match wins
		const bestMatch = findBestBranchMatch(joined, branches.map(branch => branch.name));
		if (bestMatch) {
			setCachedBranchNames(user, repo, names);
			return toParseResult(user, repo, joined, bestMatch);
		}

		if (branches.length < 100) {
			hasMorePages = false;
		} else {
			page++;
		}
	}

	setCachedBranchNames(user, repo, names);
}

export async function isMainTree(url: string): Promise<boolean> {
	const repoPreview = getRepositoryPreview(url);
	if ('error' in repoPreview) {
		return false;
	}

	const {user, repository, parts} = repoPreview;
	if (parts.length === 0) {
		return true;
	}

	const parsedPath = await parsePath(user, repository, parts);
	if (!parsedPath) {
		return false;
	}

	return parsedPath.directory === '';
}

export async function getRepositoryInfo(
	repositoryInfo: {user: string; repository: string; parts: string[]},
): Promise<
	| {error: string}
	| {
		user: string;
		repository: string;
		gitReference: string;
		directory: string;
		downloadUrl?: string;
		isPrivate: boolean;
	}
	> {
	const {user, repository, parts} = repositoryInfo;

	const repoInfoResponse = await authenticatedFetch(
		`https://api.github.com/repos/${user}/${repository}`,
	);

	if (repoInfoResponse.status === 404) {
		return {error: 'REPOSITORY_NOT_FOUND'};
	}

	const {private: isPrivate, default_branch: defaultBranch} = await repoInfoResponse.json() as {
		private: boolean;
		default_branch: string;
	};

	if (parts.length < 2) {
		const gitReference = parts[0] ?? defaultBranch;
		return {
			user,
			repository,
			gitReference,
			directory: '',
			isPrivate,
			downloadUrl: `https://codeload.github.com/${user}/${repository}/legacy.zip/refs/heads/${gitReference}`,
		};
	}

	const parsedPath = await parsePath(user, repository, parts);
	if (!parsedPath) {
		return {error: 'BRANCH_NOT_FOUND'};
	}

	return {
		user,
		repository,
		isPrivate,
		...parsedPath,
	};
}
