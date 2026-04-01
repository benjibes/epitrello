import type { IBoard } from '$lib/interfaces/IBoard';
import { BoardConnector, UserConnector, type UUID } from '$lib/server/redisConnector';
import { isAdminUser, isApeUser, isStudentUser } from '$lib/server/userRoles';

export type VisibleBoardRole = 'owner' | 'editor' | 'viewer';

export type VisibleBoardItem = {
	uuid: string;
	name: string;
	owner: string;
	ownerName: string;
	role: VisibleBoardRole;
};

type SharedBoardCandidate = {
	board: IBoard;
	role: VisibleBoardRole;
};

function getUserDisplayName(
	user: { username?: string; email?: string } | null | undefined,
	fallback: string
) {
	return user?.username?.trim() || user?.email?.trim() || fallback;
}

export async function getVisibleBoardsForUser(userId: UUID) {
	const user = await UserConnector.get(userId);
	if (!user) {
		return null;
	}

	const shouldIncludeGlobalBoards = isAdminUser(user) || isApeUser(user);
	const [ownedBoards, sharedBoards, allBoards] = await Promise.all([
		BoardConnector.getAllByOwnerId(userId),
		BoardConnector.getAllSharedByUserId(userId),
		shouldIncludeGlobalBoards ? BoardConnector.getAll() : Promise.resolve([])
	]);

	const filteredOwnedBoards = (ownedBoards ?? []).filter((board) => board.owner === userId);
	const filteredSharedBoards = (sharedBoards ?? []).filter((board) => board.owner !== userId);

	const allKnownBoards = [
		...filteredOwnedBoards,
		...filteredSharedBoards,
		...(shouldIncludeGlobalBoards ? allBoards : [])
	];

	const ownerIds = Array.from(new Set(allKnownBoards.map((board) => board.owner)));
	const ownerEntries = await Promise.all(
		ownerIds.map(async (ownerId) => [ownerId, await UserConnector.get(ownerId as UUID)] as const)
	);
	const ownerById = new Map(ownerEntries);
	const ownerNameById = new Map(
		ownerEntries.map(([ownerId, owner]) => [ownerId, getUserDisplayName(owner, 'Unknown')])
	);

	const sharedByBoardId = new Map<string, SharedBoardCandidate>();
	for (const board of filteredSharedBoards) {
		sharedByBoardId.set(board.uuid, {
			board,
			role: board.editors?.includes(userId) ? 'editor' : 'viewer'
		});
	}

	if (shouldIncludeGlobalBoards) {
		for (const board of allBoards) {
			if (board.owner === userId || sharedByBoardId.has(board.uuid)) {
				continue;
			}

			if (isAdminUser(user)) {
				sharedByBoardId.set(board.uuid, { board, role: 'owner' });
				continue;
			}

			const owner = ownerById.get(board.owner) ?? null;
			if (isApeUser(user) && isStudentUser(owner)) {
				sharedByBoardId.set(board.uuid, { board, role: 'editor' });
			}
		}
	}

	const ownerDisplayName = getUserDisplayName(user, 'You');
	const owned = filteredOwnedBoards.map((board) => ({
		uuid: board.uuid,
		name: board.name,
		owner: board.owner,
		ownerName: ownerDisplayName,
		role: 'owner' as const
	}));

	const shared = Array.from(sharedByBoardId.values()).map(({ board, role }) => ({
		uuid: board.uuid,
		name: board.name,
		owner: board.owner,
		ownerName: ownerNameById.get(board.owner) ?? 'Unknown',
		role
	}));

	return {
		user,
		ownedBoards: owned,
		sharedBoards: shared
	};
}
