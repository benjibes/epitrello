import { UserRoleSchema, type IUser, type IUserRole } from '$lib/interfaces/IUser';

export function normalizeUserRole(value: unknown): IUserRole | null {
	const parsed = UserRoleSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function resolveUserRole(user: Pick<IUser, 'role'> | null | undefined): IUserRole {
	return normalizeUserRole(user?.role) ?? 'student';
}

export function isAdminUser(user: Pick<IUser, 'role'> | null | undefined) {
	return resolveUserRole(user) === 'admin';
}

export function isApeUser(user: Pick<IUser, 'role'> | null | undefined) {
	return resolveUserRole(user) === 'ape';
}

export function isStudentUser(user: Pick<IUser, 'role'> | null | undefined) {
	return resolveUserRole(user) === 'student';
}
