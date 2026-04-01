import { z } from 'zod';

const RedisBooleanSchema = z.union([z.boolean(), z.number(), z.string()]).transform((value) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value === 1;

	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true';
});

const ChecklistItemSchema = z.tuple([z.boolean(), z.string()]);

const RedisChecklistSchema = z.union([z.array(ChecklistItemSchema), z.string()]).transform((value) => {
	if (Array.isArray(value)) {
		return value;
	}

	const normalized = value.trim();
	if (!normalized) {
		return [];
	}

	try {
		return z.array(ChecklistItemSchema).parse(JSON.parse(normalized));
	} catch {
		return [];
	}
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
	checklist: RedisChecklistSchema.optional(),
	completed: RedisBooleanSchema.optional().default(false),
	github_branch_name: z.string().optional(),
	github_branch_url: z.string().optional(),
	github_branch_status: z.string().optional()
});

export type ICard = z.infer<typeof CardSchema>;
