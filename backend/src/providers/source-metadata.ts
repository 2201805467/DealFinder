import { z } from 'zod';
export const sourceMetadataSchema = z
  .object({
    key: z.enum(['CHEAPSHARK', 'GAMERPOWER']),
    itemId: z.string().min(1).max(300),
    retailerId: z.string().min(1).max(100),
    platforms: z.array(z.string().min(1).max(100)).max(30),
    kind: z.enum(['game', 'loot', 'dlc', 'beta', 'giveaway']),
    attributionUrl: z.enum([
      'https://www.cheapshark.com/',
      'https://www.gamerpower.com/',
    ]),
    referencePriceTrusted: z.boolean(),
    endsAt: z.iso.datetime().optional(),
    endText: z.string().max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.attributionUrl !==
        (v.key === 'CHEAPSHARK'
          ? 'https://www.cheapshark.com/'
          : 'https://www.gamerpower.com/') ||
      (v.key === 'GAMERPOWER' && v.referencePriceTrusted)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid attribution or reference trust.',
      });
  });
