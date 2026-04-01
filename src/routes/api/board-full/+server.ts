import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getFullBoard, rdb, UserConnector } from '$lib/server/redisConnector';
import { canEditBoard, canManageBoard, requireBoardAccess } from '$lib/server/boardAccess';

type UUID = string;
type MemberRole = 'owner' | 'editor' | 'viewer';

export const GET: RequestHandler = async ({ url }) => {
	const boardId = url.searchParams.get('boardId');
	const userId = url.searchParams.get('userId');

	if (!boardId) {
		throw error(400, 'boardId required');
	}
	if (!userId) {
		throw error(400, 'userId required');
	}

	const { role, board } = await requireBoardAccess(boardId as UUID, userId, 'view');

	const full = await getFullBoard(boardId as UUID);
	if (!full) {
		throw error(404, 'Board not found');
	}
	const lists = await Promise.all(
		full.lists.map(async (list) => {
			const cards = await Promise.all(
				(list.cards ?? []).map(async (card) => {
					const [tagIds, assignees, dueDateRaw, descriptionRaw] = await Promise.all([
						rdb.smembers(`card:${card.uuid}:tags`),
						rdb.smembers(`card:${card.uuid}:assignees`),
						rdb.hget(`card:${card.uuid}`, 'dueDate'),
						rdb.hget(`card:${card.uuid}`, 'description')
					]);
					const tagNames: string[] = [];

					for (const tagId of tagIds) {
						const tagHash = await rdb.hgetall(`tag:${tagId}`);
						if (tagHash && tagHash.name) {
							tagNames.push(String(tagHash.name));
						}
					}

					return {
						uuid: card.uuid,
						title: card.name,
						description: String(descriptionRaw ?? card.description ?? ''),
						dueDate: String(dueDateRaw ?? ''),
						assignees: assignees.map((assignee) => String(assignee)),
						order: card.order,
						completed: card.completed ?? false,
						tags: tagNames
					};
				})
			);

			return {
				uuid: list.uuid,
				name: list.name,
				order: list.order,
				cards
			};
		})
	);

	const editorSet = new Set((board.editors ?? []).filter((memberId) => memberId !== board.owner));
	const viewerSet = new Set((board.viewers ?? []).filter((memberId) => memberId !== board.owner));
	for (const editorId of editorSet) {
		viewerSet.delete(editorId);
	}

	const memberEntries = [
		{ userId: board.owner, role: 'owner' as MemberRole },
		...Array.from(editorSet).map((memberId) => ({
			userId: memberId,
			role: 'editor' as MemberRole
		})),
		...Array.from(viewerSet).map((memberId) => ({ userId: memberId, role: 'viewer' as MemberRole }))
	];

	const members = await Promise.all(
		memberEntries.map(async (entry) => {
			const user = await UserConnector.get(entry.userId as UUID);
			return {
				userId: entry.userId,
				role: entry.role,
				username: user?.username ?? '',
				email: user?.email ?? ''
			};
		})
	);

	return json({
		board: {
			id: full.board.uuid,
			name: full.board.name,
			role,
			canEdit: canEditBoard(role),
			canManage: canManageBoard(role),
			members
		},
		lists
	});
};
