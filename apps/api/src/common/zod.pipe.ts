import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';

/** Validates a body or query against a shared .strict() schema; unknown fields are rejected. */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (issue.code === 'unrecognized_keys') {
        for (const k of issue.keys) fields[k] = 'This field cannot be set.';
      } else {
        fields[key] ??= issue.message;
      }
    }
    throw new AppError(400, 'validation_failed', 'Check the highlighted fields.', fields);
  }
}
