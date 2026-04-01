import { UserSchema, type IUser } from '$lib/interfaces/IUser';
import { BoardSchema, type IBoard, type ShareRole } from '$lib/interfaces/IBoard';
import { ListSchema, type IList } from '$lib/interfaces/IList';
import { TagSchema, type ITag } from '$lib/interfaces/ITag';
import { CardSchema, type ICard } from '$lib/interfaces/ICard';
export type UUID = string;

export const rdb = new Bun.RedisClient(process.env.REDIS_URL);

export class UserConnector {
	static async save(user: IUser) {
		await rdb.hset(`user:${user.uuid}`, {
			uuid: user.uuid,
			username: user.username,
			email: user.email,
			role: user.role,
			password_hash: user.password_hash ?? '',
			profile_picture_url: user.profile_picture_url ?? ''
		});

		if (user.email) {
			await rdb.set(`user_email:${user.email.toLowerCase()}`, user.uuid);
		}

		if (user.boards) {
			await Promise.all(user.boards.map((board) => rdb.sadd(`user:${user.uuid}:boards`, board)));
		}
	}

	static async get(userId: UUID): Promise<IUser | null> {
		const user_query = await rdb.hgetall(`user:${userId}`);

		if (!user_query || Object.keys(user_query).length === 0) {
			return null;
		}

		const user = UserSchema.parse(user_query);
		user.boards = await rdb.smembers(`user:${userId}:boards`);

		return user;
	}

	static async getAll(): Promise<IUser[]> {
		const keys = await rdb.keys('user:*');
		const userHashKeys = keys.filter((key) => /^user:[^:]+$/.test(String(key)));
		const users_query = await Promise.all(userHashKeys.map((key) => rdb.hgetall(key)));

		const users = users_query
			.filter((user) => user !== null && Object.keys(user).length > 0)
			.map((user) => UserSchema.parse(user));
		return await Promise.all(
			users.map(async (user) => {
				user.boards = await rdb.smembers(`user:${user.uuid}:boards`);
				return user;
			})
		);
	}

	static async getByEmail(email: string): Promise<IUser | null> {
		const uuid = await rdb.get(`user_email:${email.toLowerCase()}`);
		if (!uuid) return null;

		const user_query = await rdb.hgetall(`user:${uuid}`);
		if (!user_query) return null;

		const user = UserSchema.parse(user_query);
		user.boards = await rdb.smembers(`user:${user.uuid}:boards`);

		return user;
	}

	static async updateProfile(userId: UUID, updates: { username?: string }) {
		const payload: Record<string, string> = {};

		if (typeof updates.username === 'string') {
			payload.username = updates.username;
		}

		if (Object.keys(payload).length === 0) {
			return;
		}

		await rdb.hset(`user:${userId}`, payload);
	}

	static async updateRole(userId: UUID, role: IUser['role']) {
		await rdb.hset(`user:${userId}`, { role });
	}

	static async del(userId: UUID) {
		const user = await UserConnector.get(userId);
		const boards_query = await rdb.smembers(`user:${userId}:boards`);
		const sharedBoards_query = await rdb.smembers(`user:${userId}:shared_boards`);

		if (boards_query) {
			await Promise.all(boards_query.map((boardId) => BoardConnector.del(boardId as UUID)));
		}

		if (sharedBoards_query && sharedBoards_query.length > 0) {
			await Promise.all(
				sharedBoards_query.map((boardId) =>
					Promise.all([
						rdb.srem(`board:${boardId}:editors`, userId),
						rdb.srem(`board:${boardId}:viewers`, userId)
					])
				)
			);
		}

		await Promise.all([
			rdb.del(`user:${userId}`),
			rdb.del(`user:${userId}:boards`),
			rdb.del(`user:${userId}:shared_boards`),
			...(user?.email ? [rdb.del(`user_email:${user.email.toLowerCase()}`)] : [])
		]);
	}
}

export class BoardConnector {
	static async create(ownerId: UUID, name: string): Promise<UUID> {
		const uuid = Bun.randomUUIDv7();

		await rdb.hset(`board:${uuid}`, {
			uuid: uuid,
			name,
			owner: ownerId,
			background_image_url: '',
			theme: 'default',
			share_token: Bun.randomUUIDv7(),
			share_default_role: 'viewer'
		});

		await rdb.sadd(`user:${ownerId}:boards`, uuid);
		return uuid as UUID;
	}

	static async save(board: IBoard) {
		await rdb.hset(`board:${board.uuid}`, {
			uuid: board.uuid,
			name: board.name,
			owner: board.owner,
			background_image_url: board.background_image_url,
			theme: board.theme,
			share_token: board.share_token,
			share_default_role: board.share_default_role
		});

		if (board.editors) {
			await Promise.all(
				board.editors.map((editor) => rdb.sadd(`board:${board.uuid}:editors`, editor))
			);
		}
		if (board.viewers) {
			await Promise.all(
				board.viewers.map((viewer) => rdb.sadd(`board:${board.uuid}:viewers`, viewer))
			);
		}
		if (board.lists) {
			await Promise.all(board.lists.map((list) => rdb.sadd(`board:${board.uuid}:lists`, list)));
		}
	}

	static async get(boardId: UUID): Promise<IBoard | null> {
		const board_query = await rdb.hgetall(`board:${boardId}`);

		if (!board_query || Object.keys(board_query).length === 0) {
			return null;
		}

		const board = BoardSchema.parse(board_query);

		[board.editors, board.viewers, board.lists] = await Promise.all([
			rdb.smembers(`board:${boardId}:editors`),
			rdb.smembers(`board:${boardId}:viewers`),
			rdb.smembers(`board:${boardId}:lists`)
		]);

		return board;
	}

	static async getAll(): Promise<IBoard[]> {
		const keys = await rdb.keys('board:*');
		const boardHashKeys = keys.filter((key) => /^board:[^:]+$/.test(String(key)));
		const boardIds = boardHashKeys.map((key) => String(key).slice('board:'.length));
		const boards = await Promise.all(
			boardIds.map((boardId) => BoardConnector.get(boardId as UUID))
		);
		return boards.filter((board): board is IBoard => board !== null);
	}

	static async getAllByOwnerId(ownerUUID: UUID): Promise<IBoard[] | null> {
		const boards_query = await rdb.smembers(`user:${ownerUUID}:boards`);

		if (!boards_query || boards_query.length === 0) {
			return null;
		}

		return (
			await Promise.all(
				boards_query
					.filter((boardId) => boardId !== null)
					.map((boardId) => BoardConnector.get(boardId as UUID))
			)
		).filter((board) => board !== null);
	}

	static async getAllSharedByUserId(userUUID: UUID): Promise<IBoard[] | null> {
		const boards_query = await rdb.smembers(`user:${userUUID}:shared_boards`);

		if (!boards_query || boards_query.length === 0) {
			return null;
		}

		return (
			await Promise.all(
				boards_query
					.filter((boardId) => boardId !== null)
					.map((boardId) => BoardConnector.get(boardId as UUID))
			)
		).filter((board) => board !== null);
	}

	static async addUserToBoardRole(boardId: UUID, userId: UUID, role: ShareRole) {
		await rdb.srem(`board:${boardId}:editors`, userId);
		await rdb.srem(`board:${boardId}:viewers`, userId);

		if (role === 'editor') {
			await rdb.sadd(`board:${boardId}:editors`, userId);
		} else {
			await rdb.sadd(`board:${boardId}:viewers`, userId);
		}
		await rdb.sadd(`user:${userId}:shared_boards`, boardId);
	}

	static async removeUserFromBoard(boardId: UUID, userId: UUID) {
		await Promise.all([
			rdb.srem(`board:${boardId}:editors`, userId),
			rdb.srem(`board:${boardId}:viewers`, userId),
			rdb.srem(`user:${userId}:shared_boards`, boardId)
		]);
	}

	static async del(boardId: UUID) {
		const board = await BoardConnector.get(boardId);
		const lists_query = await rdb.smembers(`board:${boardId}:lists`);

		if (lists_query) {
			await Promise.all(lists_query.map((listId) => ListConnector.del(listId as UUID)));
		}

		if (board) {
			await Promise.all([
				rdb.srem(`user:${board.owner}:boards`, boardId),
				...(board.editors ?? []).map((editorId) =>
					rdb.srem(`user:${editorId}:shared_boards`, boardId)
				),
				...(board.viewers ?? []).map((viewerId) =>
					rdb.srem(`user:${viewerId}:shared_boards`, boardId)
				)
			]);
		}

		await Promise.all([
			rdb.del(`board:${boardId}`),
			rdb.del(`board:${boardId}:editors`),
			rdb.del(`board:${boardId}:viewers`),
			rdb.del(`board:${boardId}:lists`)
		]);
	}
}

export class ListConnector {
	static async create(boardId: UUID, name: string) {
		const uuid = Bun.randomUUIDv7();
		const existingListIds = await rdb.smembers(`board:${boardId}:lists`);
		const existingOrders = await Promise.all(
			existingListIds.map(async (listId) => {
				const rawOrder = await rdb.hget(`list:${listId}`, 'order');
				const parsed = Number.parseInt(String(rawOrder ?? ''), 10);
				return Number.isFinite(parsed) ? parsed : -1;
			})
		);
		const nextOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;

		await rdb.hset(`list:${uuid}`, {
			uuid,
			name,
			board: boardId,
			order: nextOrder
		});
		await rdb.sadd(`board:${boardId}:lists`, uuid);

		return uuid as UUID;
	}

	static async save(list: IList) {
		await rdb.hset(`list:${list.uuid}`, {
			uuid: list.uuid,
			name: list.name,
			board: list.board,
			order: list.order
		});

		if (list.cards) {
			await Promise.all(list.cards.map((cardId) => rdb.sadd(`list:${list.uuid}:cards`, cardId)));
		}
	}

	static async get(listId: UUID) {
		const list_query = await rdb.hgetall(`list:${listId}`);

		if (!list_query || Object.keys(list_query).length === 0) {
			return null;
		}

		const list = ListSchema.parse(list_query);
		list.cards = await rdb.smembers(`list:${listId}:cards`);

		return list;
	}

	static async del(listId: UUID) {
		const listData = await rdb.hgetall(`list:${listId}`);
		const boardId = listData?.board;
		const cards_query = await rdb.smembers(`list:${listId}:cards`);

		if (cards_query && cards_query.length > 0) {
			await Promise.all(cards_query.map((cardId) => CardConnector.del(cardId as UUID)));
		}

		const cleanupOps = [rdb.del(`list:${listId}`), rdb.del(`list:${listId}:cards`)];
		if (boardId) {
			cleanupOps.push(rdb.srem(`board:${boardId}:lists`, listId));
		}
		await Promise.all(cleanupOps);
	}
}

export class CardConnector {
	static async create(listId: UUID, name: string) {
		const uuid = Bun.randomUUIDv7();

		await rdb.hset(`card:${uuid}`, {
			uuid: uuid,
			name,
			list: listId,
			order: 0,
			description: '',
			date: '',
			completed: 0
		});

		return uuid;
	}

	static async save(card: ICard) {
		await rdb.hset(`card:${card.uuid}`, {
			uuid: card.uuid,
			list: card.list,
			name: card.name,
			description: card.description,
			order: card.order,
			date: card.date.toLocaleString(),
			checklist: JSON.stringify(card.checklist),
			completed: card.completed ? 1 : 0
		});

		if (card.tags) {
			await Promise.all(card.tags.map((tagId) => rdb.sadd(`card:${card.uuid}:tags`, tagId)));
		}
		if (card.assignees) {
			await Promise.all(
				card.assignees.map((assigneeId) => rdb.sadd(`card:${card.uuid}:assignees`, assigneeId))
			);
		}
	}

	static async get(cardId: UUID) {
		const card_query = await rdb.hgetall(`card:${cardId}`);

		if (!card_query || Object.keys(card_query).length === 0) {
			return null;
		}

		const card = CardSchema.parse(card_query);
		card.tags = await rdb.smembers(`card:${cardId}:tags`);

		return card;
	}

	static async getByListId(listId: UUID) {
		const cards_query = await rdb.smembers(`list:${listId}:cards`);
		const cards = await Promise.all(cards_query.map((cardId) => CardConnector.get(cardId as UUID)));

		return cards.sort((a, b) => {
			if (!a && !b) return 0;
			if (!a) return 1;
			if (!b) return -1;
			if (a.order !== b.order) return a.order - b.order;
			return a.uuid.localeCompare(b.uuid);
		});
	}

	static async del(cardId: UUID) {
		const cardData = await rdb.hgetall(`card:${cardId}`);
		const listId = cardData?.list;
		const tags_query = await rdb.smembers(`card:${cardId}:tags`);

		if (tags_query && tags_query.length > 0) {
			await Promise.all(tags_query.map((tagId) => TagConnector.del(tagId as UUID)));
		}
		await Promise.all([
			rdb.del(`card:${cardId}`),
			rdb.del(`card:${cardId}:assignees`),
			rdb.del(`card:${cardId}:tags`)
		]);

		if (listId) {
			await rdb.srem(`list:${listId}:cards`, cardId);
		}
	}
}

export class TagConnector {
	static async create(cardId: UUID, name: string, type: string, color: string) {
		const uuid = Bun.randomUUIDv7();

		await rdb.hset(`tag:${uuid}`, {
			uuid: uuid,
			card: cardId,
			name,
			type,
			color
		});

		await rdb.sadd(`card:${cardId}:tags`, uuid);

		return uuid;
	}

	static async save(tag: ITag) {
		await rdb.hset(`tag:${tag.uuid}`, {
			uuid: tag.uuid,
			card: tag.card,
			name: tag.name,
			type: tag.type,
			color: tag.color
		});

		await rdb.del(`tag:${tag.uuid}:attributes`);
		if (tag.attributes.length > 0) {
			await Promise.all(
				tag.attributes.map((attribute) => rdb.sadd(`tag:${tag.uuid}:attributes`, attribute))
			);
		}
	}

	static async get(tagId: UUID) {
		const [tag_query, attributes] = await Promise.all([
			rdb.hgetall(`tag:${tagId}`),
			rdb.smembers(`tag:${tagId}:attributes`)
		]);

		if (!tag_query || Object.keys(tag_query).length === 0) {
			return null;
		}

		return TagSchema.parse({ ...tag_query, attributes });
	}

	static async getAllByCardId(cardId: UUID) {
		const tags_query = await rdb.smembers(`card:${cardId}:tags`);

		const tags = await Promise.all(tags_query.map((tagId) => TagConnector.get(tagId as UUID)));
		return tags.filter((t): t is ITag => t !== null);
	}

	static async del(tagId: UUID) {
		const tagData = await rdb.hgetall(`tag:${tagId}`);

		const cardId = tagData?.card;
		if (cardId) {
			await rdb.srem(`card:${cardId}:tags`, tagId);
		}

		await Promise.all([rdb.del(`tag:${tagId}`), rdb.del(`tag:${tagId}:attributes`)]);
	}
}

export async function getFullBoard(boardId: UUID) {
	try {
		const board = await BoardConnector.get(boardId);
		if (!board) return null;

		const listIds = board.lists ?? [];

		const lists = (
			await Promise.all(
				listIds.map(async (listId) => {
					const list = await ListConnector.get(listId as UUID);
					if (!list) return null;

					const cardsRaw = await CardConnector.getByListId(list.uuid as UUID);
					const cards = await Promise.all(
						(cardsRaw ?? [])
							.filter((c): c is ICard => c !== null)
							.sort((a, b) => {
								if (a.order !== b.order) return a.order - b.order;
								return a.uuid.localeCompare(b.uuid);
							})
							.map(async (card) => {
								let tagNames: string[] = [];

								try {
									const tagsRaw = await TagConnector.getAllByCardId(card.uuid as UUID);
									tagNames = (tagsRaw ?? [])
										.filter((t): t is ITag => t !== null)
										.map((t) => t.name);
								} catch (err) {
									console.error(
										'getFullBoard: erreur chargement tags pour la carte',
										card.uuid,
										err
									);
								}

								return {
									uuid: card.uuid,
									name: card.name,
									description: card.description,
									order: card.order,
									date: card.date,
									completed: card.completed ?? false,
									tags: tagNames
								};
							})
					);

					return {
						uuid: list.uuid,
						name: list.name,
						board: list.board,
						order: list.order,
						cards
					};
				})
			)
		)
			.filter((l) => l !== null)
			.sort((a, b) => {
				if (a.order !== b.order) return a.order - b.order;
				return a.uuid.localeCompare(b.uuid);
			});

		return { board, lists };
	} catch (err) {
		console.error('getFullBoard: fatal error', err);
		throw err;
	}
}
