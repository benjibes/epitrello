import { error } from '@sveltejs/kit';
import { BoardConnector, UserConnector, rdb, type UUID } from '$lib/server/redisConnector';
import { isAdminUser, isApeUser, isStudentUser } from '$lib/server/userRoles';

export type BoardAccessRole = 'owner' | 'editor' | 'viewer';
type AccessMode = 'view' | 'edit' | 'owner';

export function canViewBoard(role: BoardAccessRole | null) {
	return role !== null;
}

export function canEditBoard(role: BoardAccessRole | null) {
	return role === 'owner' || role === 'editor';
}

export function canManageBoard(role: BoardAccessRole | null) {
	return role === 'owner';
}

export async function resolveBoardRole(boardId: UUID, userId: string | null | undefined) {
	const board = await BoardConnector.get(boardId);
	if (!board) {
		throw error(404, 'Board not found');
	}

	if (!userId) {
		return { board, role: null as BoardAccessRole | null };
	}

	const requester = await UserConnector.get(userId as UUID);
	if (!requester) {
		return { board, role: null as BoardAccessRole | null };
	}

	if (isAdminUser(requester)) {
		return { board, role: 'owner' as BoardAccessRole };
	}

	if (board.owner === userId) {
		return { board, role: 'owner' as BoardAccessRole };
	}

	if (board.editors?.includes(userId)) {
		return { board, role: 'editor' as BoardAccessRole };
	}

	if (board.viewers?.includes(userId)) {
		return { board, role: 'viewer' as BoardAccessRole };
	}

	if (isApeUser(requester)) {
		const boardOwner = await UserConnector.get(board.owner as UUID);
		if (isStudentUser(boardOwner)) {
			return { board, role: 'editor' as BoardAccessRole };
		}
	}

	return { board, role: null as BoardAccessRole | null };
}

export async function requireBoardAccess(
	boardId: UUID,
	userId: string | null | undefined,
	mode: AccessMode,
	options: { allowLegacyWithoutUserId?: boolean } = {}
) {
	const { board, role } = await resolveBoardRole(boardId, userId);

	if (!userId) {
		if (options.allowLegacyWithoutUserId) {
			return { board, role: 'owner' as BoardAccessRole };
		}
		throw error(400, 'userId required');
	}

	const allowed =
		mode === 'view'
			? canViewBoard(role)
			: mode === 'edit'
				? canEditBoard(role)
				: canManageBoard(role);

	if (!allowed) {
		throw error(403, 'Forbidden');
	}

	return { board, role };
}

export async function getBoardIdFromList(listId: string) {
	const boardId = await rdb.hget(`list:${listId}`, 'board');
	return boardId ? String(boardId) : null;
}

export async function getBoardIdFromCard(cardId: string) {
	const listId = await rdb.hget(`card:${cardId}`, 'list');
	if (!listId) {
		return null;
	}

	return getBoardIdFromList(String(listId));
}
