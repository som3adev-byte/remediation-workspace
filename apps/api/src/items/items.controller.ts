import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createItemSchema,
  TRANSITION_ACTIONS,
  TRANSITION_SCHEMAS,
  type TransitionAction,
  listQuerySchema,
  updateItemSchema,
  type CreateItemInput,
  type ListQuery,
  type UpdateItemInput,
} from '@rw/shared';
import { CurrentActor } from '../auth/actor.decorator';
import type { Actor } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ItemsService } from './items.service';
import { ItemIdPipe } from './item-id.pipe';
import { Errors } from '../common/errors';

@Controller('items')
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    return this.items.list(actor, query);
  }

  @Get('assignees')
  assignees(@CurrentActor() actor: Actor) {
    return this.items.assignees(actor);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ItemIdPipe) id: string) {
    return this.items.get(actor, id);
  }

  @Get(':id/activity')
  activity(@CurrentActor() actor: Actor, @Param('id', ItemIdPipe) id: string) {
    return this.items.activity(actor, id);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(createItemSchema)) body: CreateItemInput) {
    return this.items.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ItemIdPipe) id: string,
    @Body(new ZodValidationPipe(updateItemSchema)) body: UpdateItemInput,
  ) {
    return this.items.update(actor, id, body);
  }

  /** POST /items/:id/transitions/start | submit | approve | request_changes */
  @Post(':id/transitions/:action')
  @HttpCode(200)
  transition(
    @CurrentActor() actor: Actor,
    @Param('id', ItemIdPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
  ) {
    if (!(TRANSITION_ACTIONS as readonly string[]).includes(action)) throw Errors.notFound();
    const a = action as TransitionAction;
    const input = new ZodValidationPipe(TRANSITION_SCHEMAS[a]).transform(body);
    return this.items.transition(actor, id, a, input);
  }
}
