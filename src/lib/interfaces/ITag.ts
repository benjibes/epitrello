import { z } from 'zod';

export const TagSchema = z.object({
	uuid: z.uuidv7(),
	name: z.string(),
	card: z.uuidv7(),
	type: z.string(),
	color: z.string(),
	attributes: z.array(z.string()).default([])
});

export type ITag = z.infer<typeof TagSchema>;
