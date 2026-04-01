import { z } from 'zod';

const RedisBooleanSchema = z.union([z.boolean(), z.number(), z.string()]).transform((value) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value === 1;

	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true';
});

export const CardSchema = z.object({
	uuid: z.uuidv7(),
	list: z.uuidv7(),
	name: z.string(),
	description: z.string(),
	order: z.coerce.number().default(0),
	date: z.union([z.date(), z.literal('')]),
	tags: z.array(z.uuidv7()).optional(),
	assignees: z.array(z.uuidv7()).optional(),
	checklist: z.array(z.tuple([z.boolean(), z.string()])).optional(),
	completed: RedisBooleanSchema.optional().default(false)
});

export type ICard = z.infer<typeof CardSchema>;
