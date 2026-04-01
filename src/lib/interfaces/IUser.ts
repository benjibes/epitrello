import { z } from 'zod';

export const UserRoleSchema = z.enum(['student', 'ape', 'admin']);

const LegacyAdminSchema = z.union([z.literal('yes'), z.literal('no')]);

export const UserSchema = z
	.object({
		uuid: z.uuidv7(),
		role: UserRoleSchema.optional(),
		admin: LegacyAdminSchema.optional(),
		username: z.string(),
		email: z.email(),
		password_hash: z.union([z.hash('sha256'), z.literal('')]),
		profile_picture_url: z.union([z.url(), z.literal('')]),
		boards: z.array(z.uuidv7()).optional()
	})
	.transform(({ admin: _legacyAdmin, role, ...rest }) => ({
		...rest,
		role: role ?? (_legacyAdmin === 'yes' ? 'admin' : 'student')
	}));

export type IUser = z.infer<typeof UserSchema>;
export type IUserRole = z.infer<typeof UserRoleSchema>;
