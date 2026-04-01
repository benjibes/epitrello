import { z } from 'zod';

export const ShareRoleSchema = z.enum(['viewer', 'editor']);

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
	
});

export type IBoard = z.infer<typeof BoardSchema>;
export type ShareRole = z.infer<typeof ShareRoleSchema>;
