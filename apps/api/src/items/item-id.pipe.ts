import { Injectable, type PipeTransform } from '@nestjs/common';
import { Errors } from '../common/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id is treated like an id you cannot see: 404, nothing else revealed. */
@Injectable()
export class ItemIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw Errors.notFound();
    return value;
  }
}
