import 'dotenv/config';
import { z } from 'zod';

/**
 * All process configuration enters through this schema (Technical Spec §17,
 * Build Instructions §6: no secret read anywhere else). Providers whose keys
 * are absent in development get console-logging fallbacks in their services;
 * production refuses to boot without the variables it actually needs.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    DATABASE_URL: z.string().min(1).optional(),
    JWT_ACCESS_SECRET: z.string().min(32).optional(),
    JWT_REFRESH_SECRET: z.string().min(32).optional(),
    BREVO_API_KEY: z.string().min(1).optional(),
    TURNSTILE_SECRET: z.string().min(1).optional(),
    CLOUDINARY_URL: z.string().min(1).optional(),
    TURN_SHARED_SECRET: z.string().min(1).optional(),
    TURN_HOST: z.string().min(1).optional(),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      // Everything the deployed API cannot run without. Later milestones append
      // to this list as their features become load-bearing.
      const requiredInProduction = ['DATABASE_URL'] as const;
      for (const key of requiredInProduction) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parse an environment map, throwing a readable aggregate error on failure. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
