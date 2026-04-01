import { z } from 'zod';

export const ShareRoleSchema = z.enum(['viewer', 'editor']);

const RedisBooleanSchema = z.union([z.boolean(), z.number(), z.string()]).transform((value) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value === 1;

	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true';
});

export const BoardSchema = z.object({
	uuid: z.uuidv7(),
	name: z.string(),
	owner: z.uuidv7(),
	editors: z.array(z.uuidv7()).optional(),
	viewers: z.array(z.uuidv7()).optional(),
	lists: z.array(z.uuidv7()).optional(),
	background_image_url: z.union([z.url(), z.literal('')]),
	theme: z.union([z.string(), z.literal('')]),
	share_token: z.string().optional().default(''),
	share_default_role: ShareRoleSchema.optional().default('viewer'),
	github_enabled: RedisBooleanSchema.optional().default(false),
	github_repo_owner: z.string().optional(),
	github_repo_name: z.string().optional(),
	github_base_branch: z.string().optional()	
});

export type IBoard = z.infer<typeof BoardSchema>;
export type ShareRole = z.infer<typeof ShareRoleSchema>;
