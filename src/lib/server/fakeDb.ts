export type User = {
	id: string;
	email: string;
	name?: string | null;
};

const users = new Map<string, User>();

export function saveUser(user: User) {
	users.set(user.id, user);
}

export function getUserById(id: string): User | undefined {
	return users.get(id);
}

export function getAllUsers(): User[] {
	return Array.from(users.values());
}

export type Board = {
	id: string;
	name: string;
	ownerId: string;
};

const boards = new Map<string, Board>();
let nextBoardId = 1;

export function createBoard(ownerId: string, name: string): Board {
	const id = String(nextBoardId++);
	const board: Board = { id, name, ownerId };
	boards.set(id, board);
	return board;
}

export function getBoardById(id: string): Board | undefined {
	return boards.get(id);
}

export function getBoardsByOwnerId(ownerId: string): Board[] {
	return Array.from(boards.values()).filter((b) => b.ownerId === ownerId);
}

export function deleteBoard(id: string): boolean {
	return boards.delete(id);
}
